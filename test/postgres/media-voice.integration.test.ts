import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-voice.migrations.js';
import { MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/media/infrastructure/postgres-media-catalog.migrations.js';
import { PostgresMediaVoicePersistence } from '../../src/modules/media/infrastructure/postgres-media-voice.persistence.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  mediaVoiceFixture,
  voiceTrack,
  voiceEvidence,
} from './media-voice-fixture.js';
import { voiceTrackIdentityHash } from '../../src/modules/media/domain/voice-track-contracts.js';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import {
  MediaPostgresModule,
  POSTGRES_MEDIA_VOICE,
  POSTGRES_MEDIA_CATALOG,
} from '../../src/modules/media/media-postgres.module.js';
import { PostgresMediaCatalogPersistence } from '../../src/modules/media/infrastructure/postgres-media-catalog.persistence.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';
import { researchScriptFixture } from './media-catalog-fixture.js';

describe('Media Voice PostgreSQL real', () => {
  let db: PostgresDatabase;
  beforeAll(async () => {
    db = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(db);
  });
  beforeEach(async () => {
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
  });
  afterAll(async () => {
    await db?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('appends v8 without changing v1-v7, reexecutes and rejects checksum drift', async () => {
    expect(migrations.slice(0, 7)).toEqual(
      MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY,
    );
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await new PostgresMigrationRunner(db).migrate(migrations);
    expect(
      (
        await db.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(
      migrations.map((m) => ({
        version: m.version,
        name: m.name,
        checksum: postgresMigrationChecksum(m.sql),
      })),
    );
    expect(await new PostgresMigrationRunner(db).migrate(migrations)).toEqual({
      applied: [],
      currentVersion: 8,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 7),
        { ...migrations[7], sql: migrations[7].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
  });
  it('rolls back v8 DDL and the voice-only lineage owner trigger on migration failure', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 7));
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 7),
        {
          ...migrations[7],
          sql: migrations[7].sql + '\nSELECT nonexistent_voice_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regclass('media.voice_tracks') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='media_voice_lineage_owner'",
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (
        await db.query(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        )
      ).rows[0].version,
    ).toBe(7);
  });
  it('requires v8/checksum explicitly without migrating during open', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 7));
    await expect(
      new PostgresMediaVoicePersistence(db).open(),
    ).rejects.toMatchObject({ code: 'MEDIA_VOICE_SCHEMA_VERSION_UNSUPPORTED' });
    await new PostgresMigrationRunner(db).migrate(migrations);
    await db.query(
      'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=8',
      ['0'.repeat(64)],
    );
    await expect(
      new PostgresMediaVoicePersistence(db).open(),
    ).rejects.toMatchObject({ code: 'MEDIA_VOICE_SCHEMA_VERSION_UNSUPPORTED' });
  });
  describe('opt-in repository', () => {
    let f: Awaited<ReturnType<typeof mediaVoiceFixture>>;
    let store: PostgresMediaVoicePersistence;
    beforeEach(async () => {
      await new PostgresMigrationRunner(db).migrate(migrations);
      f = await mediaVoiceFixture(db);
      store = new PostgresMediaVoicePersistence(db);
    });
    afterEach(() => {
      f?.cleanupVoice();
    });
    it('persists authorized recording with exact SQLite payload, identity and lineage', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        expect(
          await pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
        ).toEqual(
          f.voiceNative.transaction(() =>
            f.voiceNative.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ),
        );
        expect(await pg.getVoiceTrack(v.voiceTrackId)).toEqual(
          f.voiceNative.getVoiceTrack(v.voiceTrackId),
        );
        const lineage = f.voiceNative.getArtifact(v.voiceTrackId)!;
        const row = (
          await db.query(
            'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
            [v.voiceTrackId],
          )
        ).rows[0];
        expect(row.identity_hash).toBe(
          createHash('sha256').update(JSON.stringify(lineage)).digest('hex'),
        );
        expect(
          (await db.query('SELECT identity_hash FROM media.voice_tracks'))
            .rows[0].identity_hash,
        ).toBe(voiceTrackIdentityHash(v));
      } finally {
        await pg.close();
      }
    });
    it('rejects identity and evidence conflicts without partial writes', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
        await expect(
          pg.registerLocalVoice(
            { ...v, voiceStyle: 'different' },
            e.documentHash,
            e.rightsHash,
          ),
        ).rejects.toMatchObject({ code: 'LOCAL_ID_REUSED' });
        await expect(
          pg.registerLocalVoice(v, 'd'.repeat(64), e.rightsHash),
        ).rejects.toMatchObject({ code: 'LOCAL_ID_REUSED' });
        await expect(
          pg.registerLocalVoice(v, e.documentHash, 'd'.repeat(64)),
        ).rejects.toMatchObject({ code: 'LOCAL_ID_REUSED' });
        expect(
          (await db.query('SELECT count(*) FROM media.voice_tracks')).rows[0]
            .count,
        ).toBe('1');
      } finally {
        await pg.close();
      }
    });
    it.each(['OPERATOR_RECORDING', 'AUTHORIZED_RECORDING'])(
      'preserves %s rights and opaque storage metadata without reading audio',
      async (origin) => {
        const pg = await store.open();
        try {
          const v = voiceTrack(f.script, {
              origin,
              rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
              storageReference: 'object:authorized-recording',
            }),
            e = voiceEvidence(v);
          expect(
            await pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ).toEqual(
            f.voiceNative.transaction(() =>
              f.voiceNative.registerLocalVoice(v, e.documentHash, e.rightsHash),
            ),
          );
        } finally {
          await pg.close();
        }
      },
    );
    it.each(['local_piper', 'local_espeak_ng', 'local_kokoro'])(
      'persists local %s voice and evidence hashes without invoking synthesis',
      async (provider) => {
        const fetch = vi.fn(() => {
          throw new Error('FORBIDDEN_EXTERNAL_EFFECT');
        });
        vi.stubGlobal('fetch', fetch);
        const pg = await store.open();
        try {
          const v = voiceTrack(f.script, { origin: 'SYNTHETIC_TTS', provider }),
            e = voiceEvidence(v);
          expect(
            await pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ).toEqual(
            f.voiceNative.transaction(() =>
              f.voiceNative.registerLocalVoice(v, e.documentHash, e.rightsHash),
            ),
          );
          expect(
            (
              await db.query(
                'SELECT document_hash,rights_hash FROM media.voice_tracks',
              )
            ).rows[0],
          ).toEqual({
            document_hash: e.documentHash,
            rights_hash: e.rightsHash,
          });
          expect(fetch).not.toHaveBeenCalled();
        } finally {
          await pg.close();
        }
      },
    );
    it('rejects absent local provider at SQL level, including SQL NULL semantics', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script, {
            origin: 'SYNTHETIC_TTS',
            provider: 'local_piper',
          }),
          e = voiceEvidence(v);
        await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
        await assertDisposableDatabase(db);
        // Fixture corruption probe bypasses only immutability; CHECK must still enforce provider.
        await expect(
          db.transaction(async (client) => {
            await client.query(
              'ALTER TABLE media.voice_tracks DISABLE TRIGGER immutable_voice_tracks',
            );
            await client.query('UPDATE media.voice_tracks SET provider=NULL');
            throw new Error('VOICE_PROVIDER_NULL_ACCEPTED');
          }),
        ).rejects.toMatchObject({ sqlState: '23514' });
      } finally {
        await pg.close();
      }
    });
    it('rejects insufficient rights, sensitive references and malformed hashes before writing', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        for (const [value, code] of [
          [
            { ...v, rights: { ...v.rights, commercialUseAllowed: false } },
            'COMMERCIAL_USE_REQUIRED',
          ],
          [
            {
              ...v,
              storageReference: 'https://example.com/audio?token=hidden',
            },
            'INVALID_STORAGE_REFERENCE',
          ],
          [
            { ...v, storageReference: `object:voice/sha256/${'d'.repeat(64)}` },
            'LOCAL_AUDIO_HASH_MISMATCH',
          ],
          [{ ...v, contentHash: 'invalid' }, 'INVALID_HASH'],
          [
            {
              ...v,
              origin: 'SYNTHETIC_TTS',
              provider: 'local_piper',
              rights: {
                usageBasis: 'PROVIDER_TERMS',
                commercialUseAllowed: true,
              },
            },
            'LOCAL_RIGHTS_EVIDENCE_REQUIRED',
          ],
        ] as const)
          await expect(
            pg.registerLocalVoice(value, e.documentHash, e.rightsHash),
          ).rejects.toMatchObject({ code });
        await expect(
          pg.registerLocalVoice(v, 'invalid', e.rightsHash),
        ).rejects.toMatchObject({ code: 'LOCAL_RIGHTS_EVIDENCE_REQUIRED' });
        await expect(
          pg.registerLocalVoice(v, e.documentHash, ''),
        ).rejects.toMatchObject({ code: 'LOCAL_RIGHTS_EVIDENCE_REQUIRED' });
        expect(
          (
            await db.query(
              'SELECT count(*) FROM content.artifact_lineage WHERE artifact_type=$1',
              ['voice_track'],
            )
          ).rows[0].count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('blocks paid/unknown providers and unsupported recording sources without manufacturing Finance evidence', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        for (const provider of ['openai', 'elevenlabs', 'unknown_provider'])
          await expect(
            pg.registerLocalVoice(
              {
                ...v,
                origin: 'SYNTHETIC_TTS',
                provider,
                rights: {
                  usageBasis: 'PROVIDER_TERMS',
                  commercialUseAllowed: true,
                },
              },
              e.documentHash,
              e.rightsHash,
            ),
          ).rejects.toMatchObject({
            code: 'MEDIA_VOICE_FINANCE_DEPENDENCY_REQUIRED',
          });
        await expect(
          pg.registerLocalVoice(
            { ...v, provider: 'openai' },
            e.documentHash,
            e.rightsHash,
          ),
        ).rejects.toMatchObject({ code: 'LOCAL_AUTHORIZED_AUDIO_REQUIRED' });
        expect(
          (await db.query('SELECT count(*) FROM media.voice_tracks')).rows[0]
            .count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('rejects incompatible run, project, version, script, hash and language without lineage', async () => {
      const pg = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        for (const change of [
          { pipelineRunId: 'run_missing' },
          { projectId: 'project_other' },
          { projectVersion: 2 },
          { scriptId: 'script_missing' },
          { scriptContentHash: 'e'.repeat(64) },
          { language: 'en-US' },
        ])
          await expect(
            pg.registerLocalVoice(
              { ...v, ...change },
              e.documentHash,
              e.rightsHash,
            ),
          ).rejects.toMatchObject({ code: 'LOCAL_SCRIPT_BINDING_INVALID' });
        expect(
          (
            await db.query(
              "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='voice_track'",
            )
          ).rows[0].count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('blocks valid Research-dependent scripts instead of using an uncoordinated Content reader', async () => {
      const script = await researchScriptFixture(db),
        pg = await store.open();
      try {
        const v = voiceTrack(script),
          e = voiceEvidence(v);
        await expect(
          pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
        ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_CONTEXT_REQUIRED' });
        expect(
          (await db.query('SELECT count(*) FROM media.voice_tracks')).rows[0]
            .count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('keeps sequential revisions, history, supersession and list ordering equivalent to SQLite', async () => {
      const pg = await store.open();
      try {
        const first = voiceTrack(f.script),
          next = voiceTrack(f.script, {
            voiceTrackId: 'voice_recording_002',
            revision: 2,
            supersedesVoiceTrackId: first.voiceTrackId,
            contentHash: 'd'.repeat(64),
            storageReference: `object:voice/sha256/${'d'.repeat(64)}`,
          });
        for (const v of [first, next]) {
          const e = voiceEvidence(v);
          expect(
            await pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ).toEqual(
            f.voiceNative.transaction(() =>
              f.voiceNative.registerLocalVoice(v, e.documentHash, e.rightsHash),
            ),
          );
        }
        expect(await pg.getVoiceTrackSuccessor(first.voiceTrackId)).toEqual(
          next,
        );
        expect(await pg.getVoiceTrackSuccessor(next.voiceTrackId)).toBeNull();
        expect(await pg.listVoiceTracksByScript(first.scriptId)).toEqual([
          first,
          next,
        ]);
        expect(
          await pg.listVoiceTracksByPipelineRun(first.pipelineRunId),
        ).toEqual([first, next]);
        expect(await pg.getVoiceTrack(first.voiceTrackId)).toEqual(first);
        for (const change of [
          { revision: 4 },
          { supersedesVoiceTrackId: 'voice_missing' },
          { voiceStyle: 'different' },
        ]) {
          const v = voiceTrack(f.script, {
              ...next,
              voiceTrackId: 'voice_invalid_revision',
              revision: 3,
              supersedesVoiceTrackId: next.voiceTrackId,
              ...change,
            }),
            e = voiceEvidence(v);
          await expect(
            pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ).rejects.toMatchObject({ code: 'VOICE_TRACK_REVISION_MISMATCH' });
        }
        const stale = voiceTrack(f.script, {
            ...next,
            voiceTrackId: 'voice_stale',
          }),
          e = voiceEvidence(stale);
        await expect(
          pg.registerLocalVoice(stale, e.documentHash, e.rightsHash),
        ).rejects.toMatchObject({ code: 'VOICE_TRACK_REVISION_CONFLICT' });
      } finally {
        await pg.close();
      }
    });
    it('serializes identical replays and competing revisions without duplicate lineage', async () => {
      const a = await store.open(),
        b = await store.open();
      try {
        const v = voiceTrack(f.script),
          e = voiceEvidence(v);
        expect(
          await Promise.all([
            a.registerLocalVoice(v, e.documentHash, e.rightsHash),
            b.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ]),
        ).toEqual([v, v]);
        const revisions = ['voice_revision_a', 'voice_revision_b'].map(
          (voiceTrackId) =>
            voiceTrack(f.script, {
              voiceTrackId,
              revision: 2,
              supersedesVoiceTrackId: v.voiceTrackId,
            }),
        );
        const results = await Promise.allSettled(
          revisions.map((r, i) => {
            const ev = voiceEvidence(r);
            return (i ? a : b).registerLocalVoice(
              r,
              ev.documentHash,
              ev.rightsHash,
            );
          }),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'VOICE_TRACK_REVISION_CONFLICT' },
        });
        expect(
          (
            await db.query(
              "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='voice_track'",
            )
          ).rows[0].count,
        ).toBe('2');
      } finally {
        await a.close();
        await b.close();
      }
    });
    it('recovers identity, evidence hashes, revision and replay after restarting the pool', async () => {
      const first = new PostgresDatabase(getTestPostgresConfig());
      const v = voiceTrack(f.script),
        e = voiceEvidence(v);
      try {
        const pg = await new PostgresMediaVoicePersistence(first).open();
        try {
          await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
        } finally {
          await pg.close();
        }
      } finally {
        await first.close();
      }
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const pg = await new PostgresMediaVoicePersistence(restarted).open();
        try {
          expect(
            await pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ).toEqual(v);
          expect(await pg.getVoiceTrack(v.voiceTrackId)).toEqual(v);
        } finally {
          await pg.close();
        }
      } finally {
        await restarted.close();
      }
    });
    it('shares one physical connection, one BEGIN/COMMIT and locks 3/4/5/7', async () => {
      let pool!: Pool;
      const observed = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (options) => (pool = new Pool(options)),
      );
      try {
        await assertDisposableDatabase(observed);
        const pg = await new PostgresMediaVoicePersistence(observed).open();
        try {
          const client = await pool.connect(),
            queries = vi.spyOn(client, 'query');
          client.release();
          const connects = vi.spyOn(pool, 'connect'),
            independent = vi.spyOn(pool, 'query');
          const v = voiceTrack(f.script),
            e = voiceEvidence(v);
          await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
          expect(connects).toHaveBeenCalledTimes(1);
          expect(independent).not.toHaveBeenCalled();
          const sql = queries.mock.calls.map(([q]) =>
            typeof q === 'string' ? q : (q as any).text,
          );
          expect(sql.filter((q) => q === 'BEGIN')).toHaveLength(1);
          expect(sql.filter((q) => q === 'COMMIT')).toHaveLength(1);
          expect(
            queries.mock.calls
              .filter(
                ([q]) =>
                  typeof q === 'string' && q.includes('pg_advisory_xact_lock'),
              )
              .map(([, v]) => v),
          ).toEqual([
            [1296782401, 3],
            [1296782401, 4],
            [1296782401, 5],
            [1296782401, 7],
          ]);
        } finally {
          await pg.close();
        }
      } finally {
        vi.restoreAllMocks();
        await observed.close();
      }
    });
    it('rolls back lineage and inputs on failure between lineage and voice insertion', async () => {
      const pg = await store.open(),
        v = voiceTrack(f.script),
        e = voiceEvidence(v);
      await assertDisposableDatabase(db);
      await db.query(`CREATE FUNCTION media.fixture_voice_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='P8999', MESSAGE='voice_insert_failure'; END $$;
        CREATE TRIGGER fixture_voice_failure BEFORE INSERT ON media.voice_tracks
        FOR EACH ROW EXECUTE FUNCTION media.fixture_voice_failure();`);
      try {
        await expect(
          pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
        ).rejects.toMatchObject({ code: 'MEDIA_ASSET_PERSISTENCE_FAILED' });
        expect(await pg.getVoiceTrack(v.voiceTrackId)).toBeNull();
        expect(
          (
            await db.query(
              'SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=$1',
              [v.voiceTrackId],
            )
          ).rows[0].count,
        ).toBe('0');
        expect(
          (
            await db.query(
              'SELECT count(*) FROM content.artifact_lineage WHERE artifact_id=$1',
              [v.voiceTrackId],
            )
          ).rows[0].count,
        ).toBe('0');
      } finally {
        vi.restoreAllMocks();
        await pg.close();
      }
    });
    it('joins the existing unit and rolls back on outer failure or missing participants', async () => {
      const pg = await store.open(),
        v = voiceTrack(f.script),
        e = voiceEvidence(v);
      try {
        await expect(
          db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
            await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
            throw new Error('before_commit_failure');
          }),
        ).rejects.toThrow('before_commit_failure');
        expect(await pg.getVoiceTrack(v.voiceTrackId)).toBeNull();
        await expect(
          db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
            pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
          ),
        ).rejects.toMatchObject({
          code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
        });
        expect(
          (
            await db.query(
              "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='voice_track'",
            )
          ).rows[0].count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('rejects orphan voice lineage at commit without affecting the existing catalog trigger', async () => {
      const pg = await store.open(),
        v = voiceTrack(f.script),
        e = voiceEvidence(v);
      try {
        await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
        await expect(
          db.transaction(async (client) => {
            await client.query(
              `INSERT INTO content.artifact_lineage SELECT 'orphan_voice',schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at FROM content.artifact_lineage WHERE artifact_id=$1`,
              [v.voiceTrackId],
            );
          }),
        ).rejects.toMatchObject({ sqlState: 'P8003' });
        expect(
          (
            await db.query(
              "SELECT count(*) FROM content.artifact_lineage WHERE artifact_id='orphan_voice'",
            )
          ).rows[0].count,
        ).toBe('0');
        expect(
          (
            await db.query(
              "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname IN ('media_lineage_owner','media_voice_lineage_owner')",
            )
          ).rows[0].count,
        ).toBe('2');
      } finally {
        await pg.close();
      }
    });
    it('keeps voice history immutable at SQL level', async () => {
      const pg = await store.open(),
        v = voiceTrack(f.script),
        e = voiceEvidence(v);
      try {
        await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
        for (const sql of [
          'UPDATE media.voice_tracks SET voice_style=voice_style',
          'DELETE FROM media.voice_tracks',
        ])
          await expect(db.query(sql)).rejects.toMatchObject({
            sqlState: 'P8004',
          });
      } finally {
        await pg.close();
      }
    });
    it.each(['voice', 'lineage', 'inputs'])(
      'detects corrupt %s data instead of trusting an unchanged identity hash',
      async (target) => {
        const pg = await store.open(),
          v = voiceTrack(f.script),
          e = voiceEvidence(v);
        try {
          await pg.registerLocalVoice(v, e.documentHash, e.rightsHash);
          await assertDisposableDatabase(db);
          await db.transaction(async (client) => {
            if (target === 'voice') {
              await client.query(
                'ALTER TABLE media.voice_tracks DISABLE TRIGGER immutable_voice_tracks',
              );
              await client.query(
                "UPDATE media.voice_tracks SET voice_style='corrupt'",
              );
              await client.query(
                'ALTER TABLE media.voice_tracks ENABLE TRIGGER immutable_voice_tracks',
              );
            } else {
              const table =
                target === 'lineage'
                  ? 'artifact_lineage'
                  : 'artifact_lineage_inputs';
              const trigger =
                target === 'lineage'
                  ? 'immutable_artifact_lineage'
                  : 'immutable_artifact_lineage_inputs';
              await client.query(
                `ALTER TABLE content.${table} DISABLE TRIGGER ${trigger}`,
              );
              await client.query(
                `UPDATE content.${table} SET content_hash=$1 WHERE artifact_id=$2`,
                ['e'.repeat(64), v.voiceTrackId],
              );
              await client.query(
                `ALTER TABLE content.${table} ENABLE TRIGGER ${trigger}`,
              );
            }
          });
          await expect(pg.getVoiceTrack(v.voiceTrackId)).rejects.toMatchObject({
            code: 'INVALID_PERSISTED_VOICE_TRACK',
          });
        } finally {
          await pg.close();
        }
      },
    );
    it('preserves read-only/closed handles and idle Nest startup without DDL/providers', async () => {
      const pg = await store.open(true),
        v = voiceTrack(f.script),
        e = voiceEvidence(v);
      await expect(
        pg.registerLocalVoice(v, e.documentHash, e.rightsHash),
      ).rejects.toMatchObject({ code: 'MEDIA_CATALOG_READ_ONLY' });
      await pg.close();
      await expect(pg.getVoiceTrack(v.voiceTrackId)).rejects.toMatchObject({
        code: 'MEDIA_CATALOG_HANDLE_CLOSED',
      });
      const idle = new PostgresDatabase(getTestPostgresConfig()),
        queries = vi.spyOn(idle, 'query'),
        tx = vi.spyOn(idle, 'transaction');
      const app = await Test.createTestingModule({
        imports: [MediaPostgresModule.register(getTestPostgresConfig())],
      })
        .overrideProvider(PostgresDatabase)
        .useValue(idle)
        .compile();
      try {
        await app.init();
        expect(queries).not.toHaveBeenCalled();
        expect(tx).not.toHaveBeenCalled();
        expect(app.get(POSTGRES_MEDIA_VOICE)).toBeInstanceOf(
          PostgresMediaVoicePersistence,
        );
        expect(app.get(POSTGRES_MEDIA_CATALOG)).toBeInstanceOf(
          PostgresMediaCatalogPersistence,
        );
      } finally {
        await app.close();
      }
    });
  });
});
