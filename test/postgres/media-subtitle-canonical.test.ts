import {
  PostgresDatabase,
  PostgresMigrationRunner,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/media/infrastructure/postgres-media-render.migrations.js';
import {
  getTestPostgresConfig,
  assertDisposableDatabase,
} from './test-database.js';
import { subtitleFixture } from './media-subtitle-fixture.js';
import {
  localEvidenceLineage,
  burnedRenderLineage,
} from '../../src/modules/media/infrastructure/postgres-media-subtitle.contracts.js';
import {
  digest,
  documentBytes,
} from '../../src/modules/media/infrastructure/local-evidence-storage.js';
it('proves exact local_alignment/local_subtitles/burn-in identities against unchanged SQLite source', async () => {
  const db = new PostgresDatabase(getTestPostgresConfig());
  let f: Awaited<ReturnType<typeof subtitleFixture>> | undefined;
  try {
    await assertDisposableDatabase(db);
    for (const schema of [
      'media',
      'finance',
      'campaign',
      'affiliate',
      'content',
      'research',
      'project',
      'platform',
    ])
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await new PostgresMigrationRunner(db).migrate(
      MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY,
    );
    f = await subtitleFixture(db);
    expect(digest(documentBytes(f.subtitle))).toBe(f.subtitleDocumentHash);
    expect(
      localEvidenceLineage(
        f.evidence.output.alignmentId,
        'local_alignment',
        f.voice,
        f.alignmentDocumentHash,
        [
          { inputId: f.voice.voiceTrackId, contentHash: f.voice.contentHash },
          { inputId: f.script.scriptId, contentHash: f.script.contentHash },
        ],
      ),
    ).toEqual(f.voiceNative.getArtifact(f.evidence.output.alignmentId));
    expect(
      localEvidenceLineage(
        f.subtitle.subtitleId,
        'local_subtitles',
        f.voice,
        f.subtitleDocumentHash,
        [
          {
            inputId: f.evidence.output.alignmentId,
            contentHash: f.alignmentDocumentHash,
          },
          { inputId: f.script.scriptId, contentHash: f.script.contentHash },
          { inputId: f.voice.voiceTrackId, contentHash: f.voice.contentHash },
        ],
      ),
    ).toEqual(f.voiceNative.getArtifact(f.subtitle.subtitleId));
    f.voiceNative.transaction(() =>
      f!.voiceNative.registerBurned(
        f!.burned,
        f!.subtitle.subtitleId,
        f!.evidenceFiles,
      ),
    );
    expect(
      burnedRenderLineage(f.burned, f.source, {
        subtitleId: f.subtitle.subtitleId,
        documentHash: f.subtitleDocumentHash,
      }),
    ).toEqual(f.voiceNative.getArtifact(f.burned.videoRenderId));
  } finally {
    f?.close();
    await db.close();
  }
});
