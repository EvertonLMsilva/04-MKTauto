import { Test } from '@nestjs/testing';
import { MediaModule } from './media.module.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { OperationsPersistence } from '../content-operations/infrastructure/operations.persistence.js';
import { ContentService } from '../content/application/content.service.js';
import { EditorialFlowService } from '../content/application/editorial-flow.service.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { MediaPersistence } from './infrastructure/media.persistence.js';
import { MediaAssetRepository } from './infrastructure/media-asset.repository.js';
import { CostLedgerRepository } from '../finance/infrastructure/cost-ledger.repository.js';
import { FalGenerationRepository } from '../finance/infrastructure/fal-generation.repository.js';
import { FalFinanceService } from '../finance/application/fal-finance.service.js';
import { FalAcquisitionService } from './application/fal-acquisition.service.js';
import {
  mediaAcquisitionRequestHash,
  validateMediaAcquisitionRequest,
} from './domain/media-acquisition-contracts.js';
import type { MediaAuthorization } from '../affiliate/domain/affiliate-contracts.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import { VideoProductionPreparationService } from './application/video-production-preparation.service.js';
import { VideoGenerationService } from './application/video-generation.service.js';
import { FakeVideoGenerationProvider } from './infrastructure/fake-video-generation.provider.js';

const authorized = (): MediaAuthorization => ({
  mediaRef: 'authorized-image-001',
  contentHash: 'c'.repeat(64),
  commercialUse: 'GRANTED',
  processing: 'GRANTED',
  localProcessing: true,
  externalProviders: ['fal_ai'],
});
async function nativeFixture(
  mediaAuthorization: MediaAuthorization | null = authorized(),
) {
  const f = p2EditorialFixture({
    mediaAuthorization: mediaAuthorization ?? undefined,
  });
  try {
    const affiliate = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    const operations = new OperationsPersistence(f.database);
    const content = new ContentService(contentStore(f.database));
    const catalog = new AffiliateService(
      new SqliteAffiliatePersistence(f.database),
      { get: vi.fn() },
    );
    const editorial = new EditorialFlowService(
      content,
      affiliate,
      { getShortlist: () => f.shortlist, getInsight: () => null },
      operations,
      { getGlobalOperation: () => null },
      new FakeEditorialProvider(),
      catalog,
    );
    const { script } = await editorial.generate({
      generationRequestId: 'fal_script_001',
      pipelineRunId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: f.shortlist.artifactId,
      referenceInsightId: null,
      requestedAt: '2026-10-14T12:01:00Z',
      supersedesScriptId: null,
    });
    const finance = new FalFinanceService({
      open: () =>
        new FalGenerationRepository(new CostLedgerRepository(f.database)),
    });
    const queue = {
      submit: vi.fn(async (_parameters: unknown) => ({
        requestId: 'request_001',
      })),
      status: vi.fn(async () => ({ status: 'IN_QUEUE' })),
      result: vi.fn(async () => ({
        video: { url: 'https://v.fal.media/synthetic.mp4' },
      })),
      download: vi.fn(async () =>
        Buffer.from('synthetic-video-with-original-audio'),
      ),
    };
    const storage = {
      store: vi.fn(async (_bytes: Uint8Array) => ({
        contentHash: 'b'.repeat(64),
        mediaReference: 'media:sha256_' + 'b'.repeat(64),
        format: 'mp4',
        mimeType: 'video/mp4',
        widthPixels: 768,
        heightPixels: 1024,
        durationMilliseconds: 5000,
        hasAudio: true,
      })),
      verify: vi.fn(async () => true),
    };
    const preparations = new VideoProductionPreparationService(
      content,
      new ContentOperationsService(operations, { get: vi.fn() }, affiliate),
      catalog,
    );
    const resolveImage = vi.fn(async () => ({
      url: 'https://example.com/authorized.png',
      contentHash: 'c'.repeat(64),
      provenance: { evidenceRef: 'ev_rights', sourceRef: 'authorization-001' },
    }));
    const service = () =>
      new FalAcquisitionService({
        store: new MediaPersistence(
          f.database,
          { get: (id) => f.base.getRun(id)! },
          content,
        ),
        finance,
        briefings: affiliate,
        queue,
        storage,
        resolveImage,
        preparations,
      });
    const body = {
      schemaVersion: 'media-acquisition-request/1.0.0',
      mediaAcquisitionRequestId: 'fal_acq_001',
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      visualDirectionPosition: 1,
      assetType: 'VIDEO',
      requestedAt: '2026-10-14T12:02:00Z',
    };
    const request = validateMediaAcquisitionRequest({
      ...body,
      contentHash: mediaAcquisitionRequestHash(body),
    });
    const config = {
      mediaRef: 'authorized-image-001',
      budget: { amount: '2', currency: 'USD' },
      estimate: { amount: '1', currency: 'USD', source: 'fixture/1.0.0' },
      rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    };
    const preparation = await preparations.prepare({
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      scriptRevision: script.revision,
      scenes: script.visualDirections.map((d) => ({
        visualDirectionPosition: d.position,
        sceneMediaType: 'GENERATED_VIDEO',
        movementRequirement: 'REAL_MOTION_REQUIRED',
      })),
    });
    return {
      ...f,
      service,
      request,
      config,
      queue,
      storage,
      finance,
      preparation,
      resolveImage,
    };
  } catch (error) {
    f.cleanup();
    throw error;
  }
}

describe('NestJS fal acquisition boundary', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('LIVE_NETWORK_FORBIDDEN');
      }),
    ),
  );
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const financialSnapshot = (f: Awaited<ReturnType<typeof nativeFixture>>) =>
    [
      'fal_generations',
      'fal_generation_requests',
      'fal_financial_settlements',
      'cost_events',
    ].map((table) =>
      f.base.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    );
  const model = {
    endpoint: 'minimax/h3-max-turbo/image-to-video',
    duration: 5,
    resolution: '768P',
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
  };
  function prepared(f: Awaited<ReturnType<typeof nativeFixture>>) {
    const config = { ...f.config, model };
    const input = {
      preparation: f.preparation,
      scenePosition: 1,
      request: f.request,
      authorization: {
        authorized: true,
        actorId: 'operator_test',
        statement: 'Simulated execution only.',
        preparationHash: f.preparation.contentHash,
        requestHash: f.request.contentHash,
        modelHash: affiliateHash(model),
        budgetHash: affiliateHash(config.budget),
      },
    };
    return { input, config };
  }
  it('integrates prepared motion scenes with persistent jobs, canonical media and unvalidated QC', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      const generation = new VideoGenerationService(
        new FakeVideoGenerationProvider(),
        f.service(),
      );
      await expect(
        generation.generatePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_GENERATION_PENDING');
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(f.queue.submit.mock.calls[0][0]).toMatchObject({
        image_url: 'https://example.com/authorized.png',
        duration: 5,
        resolution: '768P',
        prompt: f.preparation.scenes[0].visualDirection.description,
      });
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      const result = await f.service().acquirePrepared(p.input, p.config);
      expect(result).toMatchObject({
        jobState: 'COMPLETED',
        materialization: 'MATERIALIZED',
        motionValidation: 'NOT_VALIDATED',
        compositionReady: false,
        mediaAsset: { mediaReference: 'media:sha256_' + 'b'.repeat(64) },
      });
      expect(await f.service().acquirePrepared(p.input, p.config)).toEqual(
        result,
      );
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(
        f.finance.getByAcquisitionRequest(f.request.mediaAcquisitionRequestId)
          ?.basis.preparation,
      ).toEqual(f.preparation);
    } finally {
      f.cleanup();
    }
  });
  it.each([
    'rights',
    'authorization',
    'budgetBinding',
    'provenance',
    'model',
    'preparation',
    'image',
  ])(
    'blocks prepared %s failures before Finance or queue calls',
    async (kind) => {
      const f = await nativeFixture(
        kind === 'rights'
          ? { ...authorized(), processing: 'DENIED' }
          : authorized(),
      );
      try {
        const p = prepared(f);
        if (kind === 'authorization') p.input.authorization.authorized = false;
        if (kind === 'budgetBinding')
          p.config.budget = { ...p.config.budget, amount: '9' };
        if (kind === 'provenance')
          f.resolveImage.mockResolvedValue({
            url: 'https://example.com/authorized.png',
            contentHash: 'c'.repeat(64),
            provenance: {
              evidenceRef: 'ev_rights',
              sourceRef: 'another_source',
            },
          });
        if (kind === 'model') p.config.model = { ...model, duration: 9 };
        if (kind === 'image')
          f.resolveImage.mockResolvedValue({
            url: 'http://example.com/unauthorized.png',
            contentHash: 'c'.repeat(64),
            provenance: {
              evidenceRef: 'ev_rights',
              sourceRef: 'authorization-001',
            },
          });
        if (kind === 'preparation') {
          p.input.preparation = structuredClone(f.preparation);
          p.input.preparation.scenes[0].visualDirection.description =
            'Forged scene';
          const {
            contentHash: _hash,
            preparationId: _id,
            ...body
          } = p.input.preparation;
          p.input.preparation.contentHash = affiliateHash(body);
          p.input.preparation.preparationId = `video_preparation:${p.input.preparation.contentHash}`;
          p.input.authorization.preparationHash =
            p.input.preparation.contentHash;
        }
        const before = financialSnapshot(f);
        await expect(
          f.service().acquirePrepared(p.input, p.config),
        ).rejects.toThrow();
        expect(financialSnapshot(f)).toEqual(before);
        for (const call of Object.values(f.queue))
          expect(call).not.toHaveBeenCalled();
      } finally {
        f.cleanup();
      }
    },
  );
  it.each([
    'provenanceMissing',
    'hashMismatch',
    'invalidHash',
    'credentials',
    'fragment',
    'missingAuthorization',
    'nonGenerated',
    'requestBinding',
  ])('rejects prepared %s before reservation', async (kind) => {
    const f = await nativeFixture();
    try {
      const p = prepared(f),
        reserve = vi.spyOn(f.finance, 'reserve');
      const image: any = {
        url: 'https://example.com/authorized.png',
        contentHash: 'c'.repeat(64),
        provenance: {
          evidenceRef: 'ev_rights',
          sourceRef: 'authorization-001',
        },
      };
      if (kind === 'provenanceMissing') delete image.provenance;
      if (kind === 'hashMismatch') image.contentHash = 'd'.repeat(64);
      if (kind === 'invalidHash') image.contentHash = 'not-a-hash';
      if (kind === 'credentials')
        image.url = 'https://user:secret@example.com/authorized.png';
      if (kind === 'fragment') image.url += '#untrusted';
      f.resolveImage.mockResolvedValue(image);
      if (kind === 'missingAuthorization')
        (p.input as any).authorization = undefined;
      if (kind === 'nonGenerated') {
        const preparation = structuredClone(p.input.preparation);
        preparation.scenes[0].sceneMediaType = 'RECORDED_VIDEO';
        const { contentHash: _hash, preparationId: _id, ...body } = preparation;
        preparation.contentHash = affiliateHash(body);
        preparation.preparationId = `video_preparation:${preparation.contentHash}`;
        p.input.preparation = preparation;
      }
      if (kind === 'requestBinding') {
        p.input.request = { ...p.input.request, visualDirectionPosition: 999 };
        p.input.request.contentHash = mediaAcquisitionRequestHash(
          p.input.request,
        );
        p.input.authorization.requestHash = p.input.request.contentHash;
      }
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow();
      expect(reserve).not.toHaveBeenCalled();
      expect(f.queue.submit).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
    }
  });
  it('rejects conflicts on restart instead of changing a persisted request', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      await f.service().acquirePrepared(p.input, p.config);
      const changed = structuredClone(p.input);
      changed.request.requestedAt = '2026-10-14T12:03:00Z';
      changed.request.contentHash = mediaAcquisitionRequestHash(
        changed.request,
      );
      changed.authorization.requestHash = changed.request.contentHash;
      const before = financialSnapshot(f);
      await expect(
        f.service().acquirePrepared(changed, p.config),
      ).rejects.toThrow('PROVIDER_REQUEST_CONFLICT');
      expect(financialSnapshot(f)).toEqual(before);
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
    } finally {
      f.cleanup();
    }
  });
  it('serializes prepared submissions, preserves Finance aliases and replays the original receipt after the run ends', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      await Promise.allSettled([
        f.service().acquirePrepared(p.input, p.config),
        f.service().acquirePrepared(p.input, p.config),
      ]);
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      const [a, b] = await Promise.all([
        f.service().acquirePrepared(p.input, p.config),
        f.service().acquirePrepared(p.input, p.config),
      ]);
      expect(a).toEqual(b);
      const alias = structuredClone(p.input);
      alias.request.mediaAcquisitionRequestId = 'prepared_alias';
      alias.request.contentHash = mediaAcquisitionRequestHash(alias.request);
      alias.authorization.requestHash = alias.request.contentHash;
      expect(
        (await f.service().acquirePrepared(alias, p.config)).mediaAsset,
      ).toEqual(a.mediaAsset);
      expect(
        f.base.db.prepare('SELECT count(*) n FROM fal_generations').get()?.n,
      ).toBe(1);
      // Existing Media receipt identity belongs to the original request; Finance retains aliases.
      expect(
        f.base.db
          .prepare('SELECT count(*) n FROM media_acquisition_requests')
          .get()?.n,
      ).toBe(1);
      expect(
        f.base.db
          .prepare('SELECT count(*) n FROM fal_generation_requests')
          .get()?.n,
      ).toBe(2);
      finishRun(f);
      expect(
        (await f.service().acquirePrepared(p.input, p.config)).mediaAsset,
      ).toEqual(a.mediaAsset);
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
    } finally {
      f.cleanup();
    }
  });
  it.each(['insufficient', 'missingBudget', 'missingEstimate'])(
    'applies persistent Finance gates for %s',
    async (kind) => {
      const f = await nativeFixture();
      try {
        const p = prepared(f);
        const config: any = {
          ...p.config,
          budget:
            kind === 'missingBudget'
              ? null
              : { ...p.config.budget, amount: '0.01' },
        };
        if (kind === 'missingEstimate') config.estimate = null;
        if (config.budget)
          p.input.authorization.budgetHash = affiliateHash(config.budget);
        const before = financialSnapshot(f);
        await expect(
          f.service().acquirePrepared(p.input, config),
        ).rejects.toThrow(
          kind === 'insufficient'
            ? 'PROVIDER_BUDGET_EXCEEDED'
            : kind === 'missingBudget'
              ? 'PROVIDER_INVALID_BUDGET'
              : 'PROVIDER_COST_ESTIMATE_REQUIRED',
        );
        expect(financialSnapshot(f)).toEqual(before);
        expect(f.queue.submit).not.toHaveBeenCalled();
      } finally {
        f.cleanup();
      }
    },
  );
  it('reconciles only observed simulated costs without treating unknown cost as zero', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_GENERATION_PENDING');
      const job = f.finance.getByAcquisitionRequest(
        f.request.mediaAcquisitionRequestId,
      )!;
      expect(job.observedCostAmount).toBeNull();
      const observation = {
        amount: '0.10',
        final: false,
        currency: 'USD',
        source: 'simulated-invoice/1',
        occurredAt: '2026-10-14T12:10:00Z',
      };
      f.finance.recordObservedCost(job.key, observation);
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      expect(
        await f.service().acquirePrepared(p.input, p.config),
      ).toMatchObject({ financiallySettled: false, observedCostAmount: '0.1' });
      f.finance.recordObservedCost(job.key, { ...observation, final: true });
      expect(
        await f.service().acquirePrepared(p.input, p.config),
      ).toMatchObject({ financiallySettled: true, observedCostAmount: '0.1' });
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
    } finally {
      f.cleanup();
    }
  });
  it('keeps a completed job separate from failed materialization and recovers without resubmitting', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      f.storage.store.mockRejectedValueOnce(
        new Error('SIMULATED_STORAGE_UNAVAILABLE'),
      );
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('SIMULATED_STORAGE_UNAVAILABLE');
      expect(
        f.finance.getByAcquisitionRequest(f.request.mediaAcquisitionRequestId),
      ).toMatchObject({ state: 'COMPLETED', output: null });
      expect(
        f.base.db
          .prepare('SELECT count(*) n FROM media_acquisition_requests')
          .get()?.n,
      ).toBe(0);
      expect(
        await f.service().acquirePrepared(p.input, p.config),
      ).toMatchObject({
        materialization: 'MATERIALIZED',
        motionValidation: 'NOT_VALIDATED',
      });
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
    } finally {
      f.cleanup();
    }
  });
  it('preserves uncertain timeout recovery and does not retry a paid submission', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f);
      f.queue.submit.mockRejectedValue(new Error('SIMULATED_TIMEOUT'));
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_RECONCILIATION_PENDING');
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_RECONCILIATION_PENDING');
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(
        f.finance.getByAcquisitionRequest(f.request.mediaAcquisitionRequestId),
      ).toMatchObject({ state: 'RECONCILIATION_PENDING', output: null });
    } finally {
      f.cleanup();
    }
  });
  it('rejects cancellation before reservation and preserves provider failures', async () => {
    const f = await nativeFixture();
    try {
      const p = prepared(f),
        signal = new AbortController();
      signal.abort();
      const before = financialSnapshot(f);
      await expect(
        f
          .service()
          .acquirePrepared(p.input, p.config, { signal: signal.signal }),
      ).rejects.toThrow('PROVIDER_CANCELLED');
      expect(financialSnapshot(f)).toEqual(before);
      f.queue.status.mockResolvedValue({
        status: 'COMPLETED',
        error: 'simulated_failure',
      } as any);
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_GENERATION_FAILED');
      await expect(
        f.service().acquirePrepared(p.input, p.config),
      ).rejects.toThrow('PROVIDER_GENERATION_FAILED');
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(f.storage.store).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
    }
  });
  it.each([
    'legacy',
    'commercialOnly',
    'processingOnly',
    'denied',
    'unknown',
    'localOnly',
    'hash',
    'reference',
  ])(
    'blocks %s rights before provider dispatch or financial reservation',
    async (kind) => {
      const a = authorized();
      if (kind === 'commercialOnly') a.processing = 'UNCONFIRMED';
      if (kind === 'processingOnly') a.commercialUse = 'UNCONFIRMED';
      if (kind === 'denied') a.processing = 'DENIED';
      if (kind === 'unknown') a.commercialUse = 'UNCONFIRMED';
      if (kind === 'localOnly') a.externalProviders = [];
      if (kind === 'hash') a.contentHash = 'd'.repeat(64);
      if (kind === 'reference') a.mediaRef = 'another-image';
      const f = await nativeFixture(kind === 'legacy' ? null : a);
      try {
        const before = financialSnapshot(f);
        await expect(
          f.service().acquire(f.request, f.config),
        ).rejects.toMatchObject({
          code: 'MEDIA_PROCESSING_RIGHTS_UNCONFIRMED',
        });
        const p = prepared(f);
        await expect(
          f.service().acquirePrepared(p.input, p.config),
        ).rejects.toMatchObject({
          code: 'MEDIA_PROCESSING_RIGHTS_UNCONFIRMED',
        });
        for (const call of Object.values(f.queue))
          expect(call).not.toHaveBeenCalled();
        expect(f.storage.store).not.toHaveBeenCalled();
        expect(financialSnapshot(f)).toEqual(before);
      } finally {
        f.cleanup();
      }
    },
  );
  const finishRun = (f: Awaited<ReturnType<typeof nativeFixture>>) =>
    f.base.transitionRun({
      pipelineRunId: 'run_001',
      nextState: 'SUCCEEDED',
      completedAt: '2026-10-14T13:00:00Z',
    });

  it.each(['RUNNING', 'SUCCEEDED'])(
    'replays a valid receipt in %s without provider or financial writes',
    async (state) => {
      const f = await nativeFixture();
      try {
        f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
        const asset = await f.service().acquire(f.request, f.config);
        if (state === 'SUCCEEDED') finishRun(f);
        const before = financialSnapshot(f);
        vi.clearAllMocks();
        expect(await f.service().acquire(f.request, f.config)).toEqual(asset);
        expect(await f.service().acquire(f.request, f.config)).toEqual(asset);
        for (const call of Object.values(f.queue))
          expect(call).not.toHaveBeenCalled();
        expect(f.storage.store).not.toHaveBeenCalled();
        expect(f.storage.verify).toHaveBeenCalledTimes(2);
        expect(financialSnapshot(f)).toEqual(before);
      } finally {
        f.cleanup();
      }
    },
  );

  it('blocks acquisition without a receipt after completion', async () => {
    const f = await nativeFixture();
    try {
      finishRun(f);
      const before = financialSnapshot(f);
      await expect(
        f.service().acquire(f.request, f.config),
      ).rejects.toMatchObject({ code: 'PROVIDER_RUN_NOT_ACTIVE' });
      for (const call of Object.values(f.queue))
        expect(call).not.toHaveBeenCalled();
      expect(financialSnapshot(f)).toEqual(before);
    } finally {
      f.cleanup();
    }
  });

  it.each(['request', 'scope', 'context', 'artifact'])(
    'rejects incompatible %s on completed replay without side effects',
    async (kind) => {
      const f = await nativeFixture();
      try {
        f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
        const asset = await f.service().acquire(f.request, f.config);
        finishRun(f);
        const before = financialSnapshot(f);
        vi.clearAllMocks();
        const body = { ...f.request, requestedAt: '2026-10-14T12:03:00Z' };
        const request =
          kind === 'request'
            ? { ...body, contentHash: mediaAcquisitionRequestHash(body) }
            : f.request;
        const config =
          kind === 'context'
            ? { ...f.config, mediaRef: 'another-image' }
            : f.config;
        if (kind === 'artifact') f.storage.verify.mockResolvedValue(false);
        if (kind === 'scope')
          vi.spyOn(
            MediaAssetRepository.prototype,
            'getMediaAcquisition',
          ).mockReturnValueOnce({
            requestHash: f.request.contentHash,
            mediaAsset: { ...asset, projectId: 'another_project' },
          });
        await expect(
          f.service().acquire(request, config),
        ).rejects.toMatchObject({
          code:
            kind === 'artifact'
              ? 'PROVIDER_ARTIFACT_UNAVAILABLE'
              : 'PROVIDER_REQUEST_CONFLICT',
        });
        for (const call of Object.values(f.queue))
          expect(call).not.toHaveBeenCalled();
        expect(f.storage.store).not.toHaveBeenCalled();
        expect(financialSnapshot(f)).toEqual(before);
      } finally {
        vi.restoreAllMocks();
        f.cleanup();
      }
    },
  );
  it('is provided by Media and refuses normal execution before opening storage', async () => {
    const { FalAcquisitionService } =
      await import('./application/fal-acquisition.service.js');
    const module = await Test.createTestingModule({
      imports: [MediaModule],
    }).compile();
    try {
      const service = module.get(FalAcquisitionService);
      await expect(service.acquire({}, {})).rejects.toThrow(
        'FAL_LIVE_DISABLED',
      );
    } finally {
      await module.close();
    }
  });
  it('rejects explicit live selection in the normal module', async () => {
    vi.stubEnv('FAL_GENERATION_MODE', 'live');
    await expect(
      Test.createTestingModule({ imports: [MediaModule] }).compile(),
    ).rejects.toThrow('FAL_LIVE_DISABLED');
  });
  it('recovers in native Media/Finance repositories, preserves audio and never resubmits after reopening', async () => {
    const f = await nativeFixture();
    try {
      await expect(
        f.service().acquire(f.request, f.config),
      ).rejects.toMatchObject({ code: 'PROVIDER_GENERATION_PENDING' });
      expect(f.finance.getByAcquisitionRequest('fal_acq_001')).toMatchObject({
        requestId: 'request_001',
        state: 'IN_QUEUE',
      });
      f.queue.status.mockResolvedValue({ status: 'COMPLETED' });
      const asset = await f.service().acquire(f.request, f.config);
      expect(asset).toMatchObject({
        origin: 'PROVIDER_GENERATED',
        provider: 'fal_ai',
        technicalProperties: { hasAudio: true },
      });
      expect(await f.service().acquire(f.request, f.config)).toEqual(asset);
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(f.queue.download).toHaveBeenCalledTimes(1);
      expect(f.storage.store.mock.calls[0][0]).toEqual(
        Buffer.from('synthetic-video-with-original-audio'),
      );
      expect(
        f.base.db
          .prepare('SELECT count(*) n FROM media_acquisition_requests')
          .get()?.n,
      ).toBe(1);
      expect(
        f.base.db
          .prepare(
            'SELECT count(*) n FROM artifact_lineage WHERE artifact_id=?',
          )
          .get(asset.mediaAssetId)?.n,
      ).toBe(1);
      expect(
        f.base.db.prepare('SELECT count(*) n FROM cost_events').get()?.n,
      ).toBe(0);
    } finally {
      f.cleanup();
    }
  });
  it('keeps an unknown paid submission blocked after reopening and rejects unauthorized media before dispatch', async () => {
    const f = await nativeFixture();
    try {
      await expect(
        f
          .service()
          .acquire(f.request, { ...f.config, mediaRef: 'not-authorized' }),
      ).rejects.toMatchObject({ code: 'PROVIDER_IMAGE_NOT_AUTHORIZED' });
      expect(f.queue.submit).not.toHaveBeenCalled();
      f.queue.submit.mockRejectedValue(
        new Error('synthetic transport failure'),
      );
      await expect(
        f.service().acquire(f.request, f.config),
      ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_PENDING' });
      await expect(
        f.service().acquire(f.request, f.config),
      ).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_PENDING' });
      expect(f.queue.submit).toHaveBeenCalledTimes(1);
      expect(f.finance.getByAcquisitionRequest('fal_acq_001')).toMatchObject({
        state: 'RECONCILIATION_PENDING',
        requestId: null,
      });
    } finally {
      f.cleanup();
    }
  });
});
