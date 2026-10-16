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
import { MediaPersistence } from './infrastructure/media.persistence.js';
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
