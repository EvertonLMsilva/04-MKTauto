import { historicalResidualPersistence } from '../../test/support/historical-residual-persistence.js';
import { historicalResidualContracts } from '../../test/support/historical-residual-contracts.js';
import { fixture } from '../../test/support/composition-plan-fixture.js';
import { raceMedia } from '../../test/support/media-concurrency.js';
import { render } from '../../test/support/publishing-render-fixture.js';
import { VideoCompositionService } from './application/video-composition.service.js';
import { videoCompositionRequestHash } from './domain/video-composition-contracts.js';
import { VideoRenderRepository } from './infrastructure/video-render.reader.js';
const legacy = historicalResidualPersistence('video-composition-service');
const legacyContracts = historicalResidualContracts(
  'video-composition-contracts',
);
function request(plan: any, overrides: any = {}) {
  const value = {
    schemaVersion: 'video-composition-request/1.0.0',
    videoCompositionRequestId: 'compose_001',
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    requestedAt: '2026-09-28T23:30:00.000Z',
    ...overrides,
  };
  return { ...value, contentHash: videoCompositionRequestHash(value) };
}
function output() {
  return {
    durationMilliseconds: 10000,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    contentHash: 'f'.repeat(64),
    logicalReference: 'render:output_001',
  };
}
function repository(f: ReturnType<typeof fixture>) {
  return new VideoRenderRepository(
    f.path,
    { get: (id) => f.repository.getRun(id) },
    { getScript: () => f.script },
  );
}
describe('initial composition JS/TS parity', () => {
  it.each([false, true])(
    'serializes parallel receipt writers, conflicting=%s',
    async (conflicting) => {
      const f = fixture();
      try {
        f.media.registerCompositionPlan(f.value);
        const a = request(f.value),
          b = conflicting
            ? request(f.value, { videoCompositionRequestId: 'compose_002' })
            : a;
        const values = [a, b].map((v) => ({
          request: v,
          videoRender: render(f.value, {
            videoRenderId: `video_render:${v.videoCompositionRequestId}`,
          }),
        }));
        const results = await raceMedia(
          f.path,
          'registerVideoComposition',
          values,
          f.script,
          { run: f.repository.getRun(f.value.pipelineRunId), render: true },
        );
        expect(results.filter((r) => r.ok)).toHaveLength(conflicting ? 1 : 2);
        if (conflicting)
          expect(results.find((r) => !r.ok)?.code).toBe(
            'VIDEO_RENDER_REVISION_CONFLICT',
          );
        const r = repository(f);
        try {
          expect(
            r.listVideoRendersByCompositionPlan(f.value.compositionPlanId),
          ).toHaveLength(1);
        } finally {
          r.close();
        }
      } finally {
        f.close();
      }
    },
  );
  it.each(['hash', 'dimensions', 'container', 'reference', 'cancel'])(
    'rejects invalid %s before persisting',
    async (mode) => {
      const f = fixture();
      const r = repository(f);
      try {
        f.media.registerCompositionPlan(f.value);
        const compose = vi.fn(async () => ({
          ...output(),
          ...(mode === 'container' ? { containerFormat: 'webm' } : {}),
          ...(mode === 'reference'
            ? { logicalReference: 'https://private' }
            : {}),
        }));
        const service = new VideoCompositionService(r, { compose });
        const v = request(
          f.value,
          mode === 'hash'
            ? { compositionPlanContentHash: '0'.repeat(64) }
            : mode === 'dimensions'
              ? { widthPixels: 1920 }
              : {},
        );
        expect(videoCompositionRequestHash(v)).toBe(
          legacyContracts.videoCompositionRequestHash(v),
        );
        const controller = new AbortController();
        if (mode === 'cancel') controller.abort();
        await expect(
          service.compose(v, { signal: controller.signal }),
        ).rejects.toBeInstanceOf(Error);
        expect(r.getVideoComposition('compose_001')).toBeNull();
        if (['hash', 'dimensions', 'cancel'].includes(mode))
          expect(compose).not.toHaveBeenCalled();
      } finally {
        r.close();
        f.close();
      }
    },
  );
  it.each([false, true])(
    'persists, replays and verifies lineage V2=%s',
    async (mixed) => {
      const f = fixture(mixed),
        g = fixture(mixed);
      const r = repository(f);
      try {
        f.media.registerCompositionPlan(f.value);
        g.repository.registerCompositionPlan(g.value);
        const compose = vi.fn(async () => output());
        const service = new VideoCompositionService(r, { compose });
        const expected = await new legacy.VideoCompositionService(
          g.repository,
          { compose: async () => output() },
        ).compose(request(g.value));
        expect(await service.compose(request(f.value))).toEqual(expected);
        expect(await service.compose(request(f.value))).toEqual(expected);
        expect(compose).toHaveBeenCalledTimes(1);
        expect(r.getVideoComposition('compose_001')).toEqual(
          g.repository.getVideoComposition('compose_001'),
        );
        expect(r.getArtifact(expected.videoRenderId)).toEqual(
          g.repository.getArtifact(expected.videoRenderId),
        );
        await expect(
          service.compose(
            request(f.value, { requestedAt: '2026-09-29T23:30:00.000Z' }),
          ),
        ).rejects.toMatchObject({
          code: 'VIDEO_COMPOSITION_REQUEST_ID_REUSED',
        });
      } finally {
        r.close();
        f.close();
        g.close();
      }
    },
  );
  it.each(['failure', 'duration', 'rollback'])(
    'leaves no receipt or lineage after %s',
    async (mode) => {
      const f = fixture();
      const r = repository(f);
      try {
        f.media.registerCompositionPlan(f.value);
        if (mode === 'rollback')
          r.db.exec(
            "CREATE TEMP TRIGGER reject_receipt BEFORE INSERT ON video_composition_requests BEGIN SELECT RAISE(ABORT,'receipt failure'); END",
          );
        const service = new VideoCompositionService(r, {
          compose: async () => {
            if (mode === 'failure') throw new Error('private details');
            return {
              ...output(),
              durationMilliseconds: mode === 'duration' ? 1 : 10000,
            };
          },
        });
        await expect(service.compose(request(f.value))).rejects.toBeInstanceOf(
          Error,
        );
        expect(r.getVideoComposition('compose_001')).toBeNull();
        expect(r.getArtifact('video_render:compose_001')).toBeNull();
      } finally {
        r.close();
        f.close();
      }
    },
  );
  it('resolves overlapping identical requests and rejects competing initial revisions', async () => {
    const f = fixture();
    const r = repository(f),
      s = repository(f);
    try {
      f.media.registerCompositionPlan(f.value);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const a = new VideoCompositionService(r, {
        compose: async () => {
          await pending;
          return output();
        },
      });
      const b = new VideoCompositionService(s, {
        compose: async () => output(),
      });
      const first = a.compose(request(f.value));
      const winner = await b.compose(request(f.value));
      release();
      expect(await first).toEqual(winner);
      await expect(
        b.compose(
          request(f.value, { videoCompositionRequestId: 'compose_002' }),
        ),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_REVISION_CONFLICT' });
    } finally {
      r.close();
      s.close();
      f.close();
    }
  });
});
