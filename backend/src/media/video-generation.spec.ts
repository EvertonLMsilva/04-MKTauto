import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import type { VideoProductionPreparationV1 } from './domain/video-production-preparation.js';
import { FakeVideoGenerationProvider } from './infrastructure/fake-video-generation.provider.js';
import { VideoGenerationService } from './application/video-generation.service.js';
import { Test } from '@nestjs/testing';
import { MediaModule } from './media.module.js';

const boundaries = vi.hoisted(() => ({
  sqlite: vi.fn(() => {
    throw new Error('SQLITE_FORBIDDEN');
  }),
}));
vi.mock('node:sqlite', () => ({ DatabaseSync: boundaries.sqlite }));

function fixture(outcome: 'COMPLETE' | 'FAIL_ONCE' = 'COMPLETE') {
  const preparation = {
    schemaVersion: 'video-production-preparation/1.0.0',
    preparationId: 'preparation_001',
    contentHash: affiliateHash('preparation'),
    script: {
      scriptId: 'script_001',
      revision: 2,
      contentHash: affiliateHash('script'),
    },
    commercial: { productId: 'product_001', productRevision: 3 },
    shopeeSource: { sourceId: 'shopee_001', revision: 4 },
    scenes: [
      {
        sceneId: 'scene_001',
        position: 1,
        visualDirection: {
          position: 1,
          blockPosition: 1,
          description: 'Produto em movimento.',
        },
        sceneMediaType: 'GENERATED_VIDEO',
        movementRequirement: 'REAL_MOTION_REQUIRED',
        rights: { status: 'UNCONFIRMED' },
        acquisitionPlanned: {
          scriptId: 'script_001',
          scriptContentHash: affiliateHash('script'),
          visualDirectionPosition: 1,
          assetType: 'VIDEO',
        },
      },
    ],
  } as unknown as VideoProductionPreparationV1;
  seal(preparation);
  const provider = new FakeVideoGenerationProvider(outcome);
  const service = new VideoGenerationService(provider);
  const request = {
    operationId: 'operation_001',
    scenePosition: 1,
    preparation,
  };
  return { preparation, provider, service, request };
}
function seal(preparation: VideoProductionPreparationV1) {
  const { preparationId: _id, contentHash: _hash, ...body } = preparation;
  preparation.contentHash = affiliateHash(body);
  preparation.preparationId = `video_preparation:${preparation.contentHash}`;
}
describe('offline in-memory video generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('resolves in MediaModule without SQLite, finance jobs or network', async () => {
    const f = fixture();
    vi.stubEnv('FAL_GENERATION_MODE', 'fake');
    vi.stubEnv('PROJECT_API_DATABASE', 'INVALID_DATABASE_MUST_NOT_BE_OPENED');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('NETWORK_FORBIDDEN');
      }),
    );
    const module = await Test.createTestingModule({
      imports: [MediaModule],
    }).compile();
    try {
      const service = module.get(VideoGenerationService);
      await service.submit(f.request);
      expect(service.poll('operation_001').state).toBe('COMPLETED');
      expect(boundaries.sqlite).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
  it('rejects LIVE module configuration', async () => {
    vi.stubEnv('FAL_GENERATION_MODE', 'live');
    await expect(
      Test.createTestingModule({ imports: [MediaModule] }).compile(),
    ).rejects.toThrow('FAL_LIVE_DISABLED');
  });
  it('submits deterministically without materializing or approving media', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('NETWORK_FORBIDDEN');
      }),
    );
    const f = fixture();
    const submitted = await f.service.submit(f.request);
    expect(submitted.state).toBe('SUBMITTED');
    expect(await f.service.submit(f.request)).toEqual(submitted);
    expect(await fixture().service.submit(f.request)).toEqual(submitted);
    const completed = f.service.poll(f.request.operationId);
    expect(completed.state).toBe('COMPLETED');
    expect(completed.materialization).toBe('NOT_MATERIALIZED');
    expect(completed.motionValidation).toBe('NOT_VALIDATED');
    expect(completed.compositionReady).toBe(false);
    expect(completed.mediaAsset).toBeNull();
    expect(completed.request.prompt).toBe('Produto em movimento.');
    expect(completed.request.preparation).toEqual(f.preparation);
    expect(completed.qcRequired).toContain('TEMPORAL_MOTION_EVIDENCE');
    expect(completed.qcRequired).toContain('SCENE_CONSISTENCY_EVIDENCE');
    expect(JSON.stringify(completed)).not.toMatch(
      /https:|mediaAssetId|mediaReference/,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(await f.service.submit(f.request)).toEqual(completed);
  });
  it('recovers a failure in memory and replays terminal completion', async () => {
    const f = fixture('FAIL_ONCE');
    await f.service.submit(f.request);
    expect(f.service.poll('operation_001').state).toBe('FAILED');
    expect(f.service.poll('operation_001').state).toBe('FAILED');
    expect(f.service.recover('operation_001').state).toBe('SUBMITTED');
    expect(f.service.recover('operation_001').attempt).toBe(2);
    const done = f.service.poll('operation_001');
    expect(done.state).toBe('COMPLETED');
    expect(f.service.recover('operation_001')).toEqual(done);
  });
  it('serializes concurrent equivalent submissions and isolates operation identities', async () => {
    const f = fixture();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => f.service.submit(f.request)),
    );
    expect(
      results.every(
        (x) => x.attempt === 1 && x.fakeJobId === results[0].fakeJobId,
      ),
    ).toBe(true);
    const other = await f.service.submit({
      ...f.request,
      operationId: 'operation_002',
    });
    expect(other.fakeJobId).not.toBe(results[0].fakeJobId);
    f.service.poll('operation_001');
    expect(f.service.recover('operation_002').state).toBe('SUBMITTED');
  });
  it('rejects conflicting payloads concurrently without replacing the first operation', async () => {
    const f = fixture();
    await f.service.submit(f.request);
    f.preparation.script.revision = 3;
    seal(f.preparation);
    const results = await Promise.allSettled([
      f.service.submit(f.request),
      f.service.submit(f.request),
    ]);
    expect(results.every((x) => x.status === 'rejected')).toBe(true);
    expect(
      f.service.poll('operation_001').request.preparation.contentHash,
    ).not.toBe(f.preparation.contentHash);
  });
  it('loses all state when the provider instance restarts', async () => {
    const f = fixture();
    await f.service.submit(f.request);
    expect(() => fixture().service.poll('operation_001')).toThrow(
      'FAKE_JOB_NOT_FOUND',
    );
  });
  it.each(['STATIC_IMAGE', 'ANIMATED_STILL', 'RECORDED_VIDEO'])(
    'does not generate %s',
    async (type) => {
      const f = fixture();
      f.preparation.scenes[0].sceneMediaType = type as 'STATIC_IMAGE';
      seal(f.preparation);
      await expect(f.service.submit(f.request)).rejects.toThrow(
        type === 'RECORDED_VIDEO'
          ? 'RECORDED_VIDEO_ACQUISITION_REQUIRED'
          : 'REAL_MOTION_INTENT_REQUIRED',
      );
      expect(() => f.service.poll('operation_001')).toThrow(
        'FAKE_JOB_NOT_FOUND',
      );
    },
  );
  it('rejects preparation tampering before submission', async () => {
    const f = fixture();
    f.preparation.script.revision = 3;
    await expect(f.service.submit(f.request)).rejects.toThrow(
      'VIDEO_GENERATION_PREPARATION_CONFLICT',
    );
    expect(() => f.service.poll('operation_001')).toThrow('FAKE_JOB_NOT_FOUND');
  });
  it('rejects missing scenes and prevents mutation of retained state', async () => {
    const f = fixture();
    await expect(
      f.service.submit({ ...f.request, scenePosition: 99 }),
    ).rejects.toThrow('VIDEO_GENERATION_SCENE_NOT_FOUND');
    const job = await f.service.submit(f.request);
    expect(() => {
      job.state = 'FAILED';
    }).toThrow();
    expect(f.service.recover('operation_001').state).toBe('SUBMITTED');
  });
});
