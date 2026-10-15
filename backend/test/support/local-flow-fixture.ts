import { ffmpegFixture } from './ffmpeg-composition-fixture.js';
import { LocalFlowRuntime } from '../../src/media/infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from '../../src/media/infrastructure/local-flow.repository.js';
import { alignmentHash } from '../../src/media/domain/alignment-contracts.js';
import { createVideoComposer } from '../../src/media/infrastructure/ffmpeg-composer.provider.js';
import { MediaService } from '../../src/media/application/media.service.js';
import { readFileSync } from 'node:fs';
export async function localFixture() {
  const f = ffmpegFixture();
  f.repository.db.exec(
    readFileSync(
      new URL(
        '../../../src/db/migrations/040_financial_adjustments.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  f.repository.db
    .prepare(
      'INSERT INTO schema_migrations(version,name,applied_at) VALUES(40,?,?)',
    )
    .run('040_financial_adjustments', '2026-10-15T00:00:00Z');
  f.repository.db.exec('PRAGMA user_version=40');
  const media = new MediaService(
    f.store,
    await createVideoComposer(f.store, f.env, f.runner),
  );
  const open = () =>
    new LocalFlowRepository(
      f.path,
      { get: (id) => f.repository.getRun(id) },
      { getScript: () => f.script },
    );
  const flow = new LocalFlowRuntime(
    open,
    media,
    { ...f.env, LOCAL_MEDIA_EVIDENCE_ROOT: f.root + '/evidence' },
    { verify: async () => true },
    async (cmd, args, options) => {
      if (args.includes('-vf')) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.outputPath!, 'burned-fixture');
      }
      return f.runner(cmd, args, options);
    },
  );
  const evidence = {
    input: {
      audioAssetId: f.plan.voiceTrackId,
      audioSha256: f.plan.voiceTrackContentHash,
      scriptId: f.script.scriptId,
      scriptVersion: f.script.revision,
      scriptTextSha256: alignmentHash(f.script.fullNarration),
      durationMs: 10000,
      canonicalText: f.script.fullNarration,
    },
    parameters: { language: 'pt' },
    provenance: 'FORCED_ALIGNMENT' as const,
    output: {
      alignmentId: 'alignment_local_001',
      provider: 'fixture',
      modelVersion: 'fixture/1',
      audioSha256: f.plan.voiceTrackContentHash,
      scriptTextSha256: alignmentHash(f.script.fullNarration),
      segments: [
        {
          startMs: 100,
          endMs: 9900,
          text: f.script.fullNarration,
          textStartOffset: 0,
          textEndOffset: f.script.fullNarration.length,
        },
      ],
      evidenceHash: '',
      status: 'VERIFIED' as const,
    },
  };
  evidence.output.evidenceHash = alignmentHash(evidence);
  evidence.output.segments = Array.from(
    f.script.fullNarration.matchAll(/[^\n]+/g),
    (m: any, i) => ({
      startMs: [100, 3500, 7000][i],
      endMs: [3000, 6500, 9900][i],
      text: m[0],
      textStartOffset: m.index,
      textEndOffset: m.index + m[0].length,
    }),
  );
  evidence.output.evidenceHash = alignmentHash(evidence);
  return { ...f, open, flow, media, evidence };
}
