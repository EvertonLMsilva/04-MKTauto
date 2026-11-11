import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { localFixture } from '../../../test/support/local-flow-fixture.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { MediaService } from './application/media.service.js';
import { createVideoComposer } from './infrastructure/ffmpeg-composer.provider.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from './domain/video-composition-contracts.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
it('composes, burns subtitles and decodes actual local fixture media with FFmpeg', async () => {
  const binary = (name: string) =>
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  const f = await localFixture();
  try {
    const env = {
      ...f.env,
      FFMPEG_PATH: binary('ffmpeg'),
      FFPROBE_PATH: binary('ffprobe'),
      LOCAL_MEDIA_EVIDENCE_ROOT: join(f.root, 'real-evidence'),
    };
    const clip = join(f.root, 'fixture.mp4');
    await runProcess(
      env.FFMPEG_PATH,
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=720x1280:r=30:d=6',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        clip,
      ],
      { timeoutMs: 60000, maxLogBytes: 65536 },
    );
    const { readFileSync } = await import('node:fs');
    const hash = new LocalEvidenceStorage(f.mediaRoot).put(
      readFileSync(clip),
      'mp4',
    );
    const mediaRepository = f.store.open();
    let asset: any;
    try {
      const previous = mediaRepository.getMediaAsset('media_native_002')!;
      asset = mediaRepository.registerMediaAsset({
        ...previous,
        mediaAssetId: 'media_real_003',
        contentHash: hash,
        mediaReference: `media:sha256_${hash}`,
        revision: 3,
        supersedesMediaAssetId: previous.mediaAssetId,
      });
    } finally {
      mediaRepository.close();
    }
    const plan = {
      ...f.plan,
      compositionPlanId: 'plan_real_002',
      revision: 2,
      supersedesCompositionPlanId: f.plan.compositionPlanId,
      segments: f.plan.segments.map((s: any, i: number) =>
        i
          ? {
              ...s,
              mediaAssetId: asset.mediaAssetId,
              mediaAssetContentHash: hash,
            }
          : s,
      ),
    };
    plan.contentHash = compositionPlanContentHash(plan);
    f.media.registerCompositionPlan(plan);
    const media = new MediaService(
      f.store,
      await createVideoComposer(f.store, env),
    );
    const service = new LocalFlowRuntime(f.open, media, env, {
      verify: async () => true,
    });
    await service.acceptAlignment(f.evidence);
    const subtitles = service.subtitles(f.evidence.output.alignmentId);
    const request = {
      ...f.request('compose_real_001'),
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
    };
    request.contentHash = videoCompositionRequestHash(request);
    const source = await service.compose(request);
    const final = await service.burn(
      source.videoRenderId,
      subtitles.subtitleId,
    );
    expect(final.compositionPlanContentHash).toBe(plan.contentHash);
    const qc = await service.qc(final.videoRenderId);
    expect(qc.result).toBe('PASS');
    const bytes = await service.previewBytes(final.videoRenderId);
    const evidenceRoot = process.env.MKTAUTO_MEDIA_CLOSURE_EVIDENCE_ROOT;
    if (evidenceRoot) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { createHash } = await import('node:crypto');
      mkdirSync(evidenceRoot, { recursive: true });
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        final.contentHash,
      );
      writeFileSync(join(evidenceRoot, 'fixture-final.mp4'), bytes);
      writeFileSync(
        join(evidenceRoot, 'fixture-evidence.json'),
        JSON.stringify(
          {
            fixtureOnly: true,
            productionCampaign: false,
            alignment:
              'Existing authorized test double; not physical CTC inference',
            voice: 'Owned PCM test fixture; not newly synthesized TTS',
            compositionPlanId: plan.compositionPlanId,
            compositionPlanContentHash: plan.contentHash,
            render: final,
            qc,
            humanApproval: false,
          },
          null,
          2,
        ),
      );
    }
    expect(bytes.length).toBeGreaterThan(1000);
  } finally {
    f.close();
  }
}, 120000);
