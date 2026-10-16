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
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';

async function nativeFixture() {
  const f = p2EditorialFixture();
  try {
    const affiliate = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    const operations = new OperationsPersistence(f.database);
    const content = new ContentService(contentStore(f.database));
    const editorial = new EditorialFlowService(
      content,
      affiliate,
      { getShortlist: () => f.shortlist, getInsight: () => null },
      operations,
      { getGlobalOperation: () => null },
      new FakeEditorialProvider(),
      new AffiliateService(new SqliteAffiliatePersistence(f.database), {
        get: vi.fn(),
      }),
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
      submit: vi.fn(async () => ({ requestId: 'request_001' })),
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
        resolveImage: async () => ({
          url: 'https://example.com/authorized.png',
          contentHash: 'c'.repeat(64),
        }),
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
    const request = { ...body, contentHash: mediaAcquisitionRequestHash(body) };
    const config = {
      mediaRef: 'authorized-image-001',
      budget: { amount: '2', currency: 'USD' },
      estimate: { amount: '1', currency: 'USD', source: 'fixture/1.0.0' },
      rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    };
    return { ...f, service, request, config, queue, storage, finance };
  } catch (error) {
    f.cleanup();
    throw error;
  }
}

describe('NestJS fal acquisition boundary', () => {
  afterEach(() => vi.unstubAllEnvs());
  const financialSnapshot = (f: Awaited<ReturnType<typeof nativeFixture>>) =>
    [
      'fal_generations',
      'fal_generation_requests',
      'fal_financial_settlements',
      'cost_events',
    ].map((table) =>
      f.base.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
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
