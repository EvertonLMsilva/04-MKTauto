import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_SUBTITLE_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-subtitle.migrations.js';
import { MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/media/infrastructure/postgres-media-render.migrations.js';
import { PostgresMediaSubtitlePersistence } from '../../src/modules/media/infrastructure/postgres-media-subtitle.persistence.js';
import { PostgresMediaRenderPersistence } from '../../src/modules/media/infrastructure/postgres-media-render.persistence.js';
import {
  getTestPostgresConfig,
  assertDisposableDatabase,
} from './test-database.js';
import { subtitleFixture } from './media-subtitle-fixture.js';
import { createHash } from 'node:crypto';
import { PinnedAlignmentVerifier } from '../../src/modules/media/application/alignment.port.js';
import { alignmentHash } from '../../src/modules/media/domain/alignment-contracts.js';
import { documentBytes } from '../../src/modules/media/infrastructure/local-evidence-storage.js';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import {
  MediaPostgresModule,
  POSTGRES_MEDIA_SUBTITLE,
} from '../../src/modules/media/media-postgres.module.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';

describe('Local subtitles PostgreSQL with canonical proof', () => {
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
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db?.close();
  });
  async function usingSubtitle(
    work: (
      f: Awaited<ReturnType<typeof subtitleFixture>>,
      repo: Awaited<ReturnType<PostgresMediaSubtitlePersistence['open']>>,
    ) => Promise<void>,
  ) {
    await new PostgresMigrationRunner(db).migrate(migrations);
    const f = await subtitleFixture(db),
      repo = await new PostgresMediaSubtitlePersistence(db, f.proof).open();
    try {
      await work(f, repo);
    } finally {
      await repo.close();
      f.close();
    }
  }
  it('appends v11 and preserves v1-v10 names/SQL/checksums on replay', async () => {
    expect(migrations.slice(0, 10)).toEqual(
      MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY,
    );
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
      currentVersion: 11,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 10),
        { ...migrations[10], sql: migrations[10].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
  });
  it('stores verified alignment/subtitle hashes and exact unchanged SQLite lineage without transcript/SRT/ASS blobs', async () =>
    usingSubtitle(async (f, repo) => {
      const value = await repo.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
      expect(value.document).toEqual(f.subtitle);
      expect(
        await repo.registerLocalSubtitle(
          f.subtitleDocumentHash,
          f.alignmentDocumentHash,
        ),
      ).toEqual(value);
      for (const id of [f.evidence.output.alignmentId, f.subtitle.subtitleId]) {
        const native = f.voiceNative.getArtifact(id)!;
        expect(
          (
            await db.query(
              'SELECT identity_hash FROM content.artifact_lineage WHERE artifact_id=$1',
              [id],
            )
          ).rows[0].identity_hash,
        ).toBe(
          createHash('sha256').update(JSON.stringify(native)).digest('hex'),
        );
      }
    }));
  it('stores local revision 2 with all three ordered lineage inputs and recovers both versions', async () =>
    usingSubtitle(async (f, repo) => {
      await repo.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
      const renders = await new PostgresMediaRenderPersistence(
        db,
        f.proof,
      ).open();
      try {
        expect(
          await renders.registerBurned(f.burned, f.subtitle.subtitleId),
        ).toEqual(
          f.voiceNative.transaction(() =>
            f.voiceNative.registerBurned(
              f.burned,
              f.subtitle.subtitleId,
              f.evidenceFiles,
            ),
          ),
        );
        expect(
          await renders.registerBurned(f.burned, f.subtitle.subtitleId),
        ).toEqual(f.burned);
        expect(await renders.getVideoRender(f.source.videoRenderId)).toEqual(
          f.source,
        );
        expect(
          await renders.getVideoRenderSuccessor(f.source.videoRenderId),
        ).toEqual(f.burned);
        const native = f.voiceNative.getArtifact(f.burned.videoRenderId)!;
        expect(
          (
            await db.query(
              'SELECT identity_hash FROM content.artifact_lineage WHERE artifact_id=$1',
              [f.burned.videoRenderId],
            )
          ).rows[0].identity_hash,
        ).toBe(
          createHash('sha256').update(JSON.stringify(native)).digest('hex'),
        );
      } finally {
        await renders.close();
      }
    }));
  it('rolls back v11 DDL and restores the exact v10 SQL validation function', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 10));
    const query =
      "SELECT pg_catalog.pg_get_functiondef('media.validate_render_scope()'::regprocedure) AS definition";
    const before = (await db.query(query)).rows[0].definition;
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 10),
        {
          ...migrations[10],
          sql: migrations[10].sql + '\nSELECT nonexistent_subtitle_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect((await db.query(query)).rows[0].definition).toBe(before);
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regclass('media.local_subtitles') AS name",
        )
      ).rows[0].name,
    ).toBeNull();
    expect(
      (
        await db.query(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        )
      ).rows[0].version,
    ).toBe(10);
  });
  it('requires v11 checksums explicitly while preserving preexisting v10 normal renders', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 10));
    const f = await subtitleFixture(db);
    try {
      await expect(
        new PostgresMediaSubtitlePersistence(db, f.proof).open(),
      ).rejects.toMatchObject({
        code: 'MEDIA_SUBTITLE_SCHEMA_VERSION_UNSUPPORTED',
      });
      await new PostgresMigrationRunner(db).migrate(migrations);
      const source = await new PostgresMediaRenderPersistence(db).open();
      try {
        expect(await source.getVideoRender(f.source.videoRenderId)).toEqual(
          f.source,
        );
        const next = {
          ...f.source,
          videoRenderId: 'normal_revision_002',
          revision: 2,
          supersedesVideoRenderId: f.source.videoRenderId,
        };
        expect(await source.registerVideoRender(next)).toEqual(next);
      } finally {
        await source.close();
      }
      await db.query(
        'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=11',
        ['0'.repeat(64)],
      );
      await expect(
        new PostgresMediaSubtitlePersistence(db, f.proof).open(),
      ).rejects.toMatchObject({
        code: 'MEDIA_SUBTITLE_SCHEMA_VERSION_UNSUPPORTED',
      });
    } finally {
      f.close();
    }
  });
  it('rejects missing proof and an untrusted real alignment hash; VERIFIED is not sufficient', async () =>
    usingSubtitle(async (f) => {
      const absent = await new PostgresMediaSubtitlePersistence(db).open();
      try {
        await expect(
          absent.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
        ).rejects.toMatchObject({
          code: 'MEDIA_SUBTITLE_PROOF_SOURCE_REQUIRED',
        });
      } finally {
        await absent.close();
      }
      const untrusted = await new PostgresMediaSubtitlePersistence(db, {
        ...f.proof,
        alignmentVerifier: new PinnedAlignmentVerifier(new Set()),
      }).open();
      try {
        await expect(
          untrusted.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
        ).rejects.toMatchObject({ code: 'ALIGNMENT_PROVENANCE_UNVERIFIED' });
      } finally {
        await untrusted.close();
      }
      expect(
        (await db.query('SELECT count(*) FROM media.local_alignments')).rows[0]
          .count,
      ).toBe('0');
    }));
  it('rejects self-rehashed modified alignment evidence even when its shape and bindings are valid', async () =>
    usingSubtitle(async (f, repo) => {
      const evidence = structuredClone(f.evidence);
      evidence.parameters.extraParameter = 'changed';
      evidence.output.evidenceHash = alignmentHash(evidence);
      const ah = f.evidenceFiles.put(documentBytes(evidence), 'json'),
        d = { ...f.subtitle, evidenceHash: evidence.output.evidenceHash };
      const dh = f.evidenceFiles.put(documentBytes(d), 'json');
      await expect(repo.registerLocalSubtitle(dh, ah)).rejects.toMatchObject({
        code: 'ALIGNMENT_PROVENANCE_UNVERIFIED',
      });
      expect(
        (await db.query('SELECT count(*) FROM media.local_subtitles')).rows[0]
          .count,
      ).toBe('0');
    }));
  it.each([
    'alignmentId',
    'evidenceHash',
    'scriptId',
    'voiceTrackId',
    'scriptContentHash',
  ])(
    'rejects divergent %s against real canonical alignment/script/voice',
    async (field) =>
      usingSubtitle(async (f, repo) => {
        const d = {
          ...f.subtitle,
          [field]: field.endsWith('Hash')
            ? 'e'.repeat(64)
            : 'missing_canonical_id',
        };
        const dh = f.evidenceFiles.put(documentBytes(d), 'json');
        await expect(
          repo.registerLocalSubtitle(dh, f.alignmentDocumentHash),
        ).rejects.toMatchObject({ code: 'LOCAL_SUBTITLE_BINDING_INVALID' });
        expect(
          (await db.query('SELECT count(*) FROM media.local_subtitles')).rows[0]
            .count,
        ).toBe('0');
      }),
  );
  it.each(['srtHash', 'assHash'])(
    'rejects valid but unrelated %s bytes without rewriting them',
    async (field) =>
      usingSubtitle(async (f, repo) => {
        const hash = f.evidenceFiles.put(
          Buffer.from('unrelated subtitle bytes'),
          field === 'srtHash' ? 'srt' : 'ass',
        );
        const dh = f.evidenceFiles.put(
          documentBytes({ ...f.subtitle, [field]: hash }),
          'json',
        );
        await expect(
          repo.registerLocalSubtitle(dh, f.alignmentDocumentHash),
        ).rejects.toMatchObject({
          code: 'LOCAL_SUBTITLE_PRESENTATION_INVALID',
        });
      }),
  );
  it('rejects absent/corrupt audio and SRT proof instead of accepting declared hashes', async () =>
    usingSubtitle(async (f) => {
      for (const proof of [
        { ...f.proof, readAudio: () => Buffer.from('bad audio') },
        {
          ...f.proof,
          readEvidence: (hash: string, ext: 'json' | 'srt' | 'ass') =>
            ext === 'srt'
              ? Buffer.from('bad srt')
              : f.proof.readEvidence(hash, ext),
        },
      ]) {
        const r = await new PostgresMediaSubtitlePersistence(db, proof).open();
        try {
          await expect(
            r.registerLocalSubtitle(
              f.subtitleDocumentHash,
              f.alignmentDocumentHash,
            ),
          ).rejects.toThrow();
        } finally {
          await r.close();
        }
      }
      const missing = await new PostgresMediaSubtitlePersistence(db, {
        ...f.proof,
        readAudio: () => {
          throw new Error('fixture missing');
        },
      }).open();
      try {
        await expect(
          missing.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
        ).rejects.toMatchObject({ code: 'LOCAL_SUBTITLE_PROOF_UNAVAILABLE' });
      } finally {
        await missing.close();
      }
      expect(
        (await db.query('SELECT count(*) FROM media.local_alignments')).rows[0]
          .count,
      ).toBe('0');
    }));
  it('checks strict document identity/fields and conflicts without changing accepted records', async () =>
    usingSubtitle(async (f, repo) => {
      const record = await repo.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
      const bad = f.evidenceFiles.put(
        documentBytes({ ...f.subtitle, extra: 'field' }),
        'json',
      );
      await expect(
        repo.registerLocalSubtitle(bad, f.alignmentDocumentHash),
      ).rejects.toMatchObject({ code: 'LOCAL_SUBTITLE_CONTRACT_INVALID' });
      const id = f.evidenceFiles.put(
        documentBytes({ ...f.subtitle, subtitleId: 'subtitle_wrong_identity' }),
        'json',
      );
      await expect(
        repo.registerLocalSubtitle(id, f.alignmentDocumentHash),
      ).rejects.toMatchObject({ code: 'LOCAL_SUBTITLE_ID_INVALID' });
      expect(await repo.getLocalSubtitle(f.subtitle.subtitleId)).toEqual(
        record,
      );
      expect(await repo.getLocalSubtitle('subtitle_missing')).toBeNull();
    }));
  it('serializes replay, restarts the pool and still requires the original external proof', async () =>
    usingSubtitle(async (f, a) => {
      const b = await new PostgresMediaSubtitlePersistence(db, f.proof).open();
      try {
        const values = await Promise.all([
          a.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
          b.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
        ]);
        expect(values[0]).toEqual(values[1]);
        expect(
          (await db.query('SELECT count(*) FROM media.local_alignments'))
            .rows[0].count,
        ).toBe('1');
      } finally {
        await b.close();
      }
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const r = await new PostgresMediaSubtitlePersistence(
          restarted,
          f.proof,
        ).open();
        try {
          expect(
            (await r.getLocalSubtitle(f.subtitle.subtitleId))?.document,
          ).toEqual(f.subtitle);
        } finally {
          await r.close();
        }
      } finally {
        await restarted.close();
      }
    }));
  it('rolls back alignment, subtitle and both lineages when the subtitle insert fails', async () =>
    usingSubtitle(async (f, repo) => {
      await db.query(`CREATE FUNCTION media.fixture_subtitle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1199',MESSAGE='subtitle_fixture_failure'; END $$;
      CREATE TRIGGER fixture_subtitle_failure BEFORE INSERT ON media.local_subtitles FOR EACH ROW EXECUTE FUNCTION media.fixture_subtitle_failure();`);
      await expect(
        repo.registerLocalSubtitle(
          f.subtitleDocumentHash,
          f.alignmentDocumentHash,
        ),
      ).rejects.toThrow();
      expect(
        (await db.query('SELECT count(*) FROM media.local_alignments')).rows[0]
          .count,
      ).toBe('0');
      expect(
        (
          await db.query(
            "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type IN ('local_alignment','local_subtitles')",
          )
        ).rows[0].count,
      ).toBe('0');
    }));
  it('uses one connection and locks 3/4/5/7', async () =>
    usingSubtitle(async (f) => {
      let pool!: Pool;
      const observed = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (options) => (pool = new Pool(options)),
      );
      try {
        await assertDisposableDatabase(observed);
        const repo = await new PostgresMediaSubtitlePersistence(
          observed,
          f.proof,
        ).open();
        try {
          const client = await pool.connect(),
            queries = vi.spyOn(client, 'query');
          client.release();
          const connects = vi.spyOn(pool, 'connect'),
            independent = vi.spyOn(pool, 'query');
          await repo.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          );
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
          await repo.close();
        }
      } finally {
        vi.restoreAllMocks();
        await observed.close();
      }
    }));
  it('rolls back a complete new import on outer failure and refuses missing participants', async () =>
    usingSubtitle(async (f, repo) => {
      await expect(
        db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
          await repo.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          );
          throw new Error('outer_failure');
        }),
      ).rejects.toThrow('outer_failure');
      expect(
        (await db.query('SELECT count(*) FROM media.local_alignments')).rows[0]
          .count,
      ).toBe('0');
      expect(
        (
          await db.query(
            "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type IN ('local_alignment','local_subtitles')",
          )
        ).rows[0].count,
      ).toBe('0');
      await expect(
        db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
          repo.registerLocalSubtitle(
            f.subtitleDocumentHash,
            f.alignmentDocumentHash,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
    }));
  it('rejects an independently trusted conflicting alignment ID without overwriting history', async () =>
    usingSubtitle(async (f, repo) => {
      await repo.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
      const evidence = structuredClone(f.evidence);
      evidence.parameters.latencyMs = 123;
      evidence.output.evidenceHash = alignmentHash(evidence);
      const ah = f.evidenceFiles.put(documentBytes(evidence), 'json');
      const doc = {
        ...f.subtitle,
        evidenceHash: evidence.output.evidenceHash,
        subtitleId: `subtitle_local:${evidence.output.evidenceHash}:${f.subtitle.subtitleId.split(':').at(-1)}`,
      };
      const dh = f.evidenceFiles.put(documentBytes(doc), 'json');
      const alternate = await new PostgresMediaSubtitlePersistence(db, {
        ...f.proof,
        alignmentVerifier: new PinnedAlignmentVerifier(
          new Set([
            f.evidence.output.evidenceHash,
            evidence.output.evidenceHash,
          ]),
        ),
      }).open();
      try {
        await expect(
          alternate.registerLocalSubtitle(dh, ah),
        ).rejects.toMatchObject({ code: 'LOCAL_ID_REUSED' });
      } finally {
        await alternate.close();
      }
      expect(
        (await repo.getLocalSubtitle(f.subtitle.subtitleId))?.document,
      ).toEqual(f.subtitle);
      expect(
        (await db.query('SELECT count(*) FROM media.local_subtitles')).rows[0]
          .count,
      ).toBe('1');
    }));
  it.each(['local_alignments', 'local_subtitles'])(
    'keeps %s immutable and rejects corrupted metadata',
    async (table) =>
      usingSubtitle(async (f, repo) => {
        await repo.registerLocalSubtitle(
          f.subtitleDocumentHash,
          f.alignmentDocumentHash,
        );
        await expect(
          db.query(`DELETE FROM media.${table}`),
        ).rejects.toMatchObject({ sqlState: 'P1103' });
        await db.transaction(async (client) => {
          await client.query(
            `ALTER TABLE media.${table} DISABLE TRIGGER immutable_${table}`,
          );
          await client.query(`UPDATE media.${table} SET evidence_hash=$1`, [
            'e'.repeat(64),
          ]);
          await client.query(
            `ALTER TABLE media.${table} ENABLE TRIGGER immutable_${table}`,
          );
        });
        await expect(
          repo.getLocalSubtitle(f.subtitle.subtitleId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_LOCAL_SUBTITLE' });
      }),
  );
  it('rejects corrupt subtitle lineage and ownerless local evidence at commit', async () =>
    usingSubtitle(async (f, repo) => {
      await repo.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
      await expect(
        db.transaction(async (client) => {
          await client.query(
            "INSERT INTO content.artifact_lineage SELECT 'orphan_local_subtitle',schema_version,artifact_type,1,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at FROM content.artifact_lineage WHERE artifact_id=$1",
            [f.subtitle.subtitleId],
          );
        }),
      ).rejects.toMatchObject({ sqlState: 'P1102' });
      await db.transaction(async (client) => {
        await client.query(
          'ALTER TABLE content.artifact_lineage_inputs DISABLE TRIGGER immutable_artifact_lineage_inputs',
        );
        await client.query(
          'UPDATE content.artifact_lineage_inputs SET content_hash=$1 WHERE artifact_id=$2 AND position=1',
          ['e'.repeat(64), f.subtitle.subtitleId],
        );
        await client.query(
          'ALTER TABLE content.artifact_lineage_inputs ENABLE TRIGGER immutable_artifact_lineage_inputs',
        );
      });
      await expect(
        repo.getLocalSubtitle(f.subtitle.subtitleId),
      ).rejects.toMatchObject({ code: 'LOCAL_LINEAGE_INVALID' });
    }));
  it('keeps proof opt-in, read-only handles and Nest startup inactive', async () =>
    usingSubtitle(async (f) => {
      const ro = await new PostgresMediaSubtitlePersistence(db, f.proof).open(
        true,
      );
      await expect(
        ro.registerLocalSubtitle(
          f.subtitleDocumentHash,
          f.alignmentDocumentHash,
        ),
      ).rejects.toMatchObject({ code: 'MEDIA_CATALOG_READ_ONLY' });
      await ro.close();
      await expect(
        ro.getLocalSubtitle(f.subtitle.subtitleId),
      ).rejects.toMatchObject({ code: 'MEDIA_CATALOG_HANDLE_CLOSED' });
      const idle = new PostgresDatabase(getTestPostgresConfig()),
        q = vi.spyOn(idle, 'query'),
        tx = vi.spyOn(idle, 'transaction');
      const app = await Test.createTestingModule({
        imports: [
          MediaPostgresModule.register(getTestPostgresConfig(), {
            subtitleProof: f.proof,
          }),
        ],
      })
        .overrideProvider(PostgresDatabase)
        .useValue(idle)
        .compile();
      try {
        await app.init();
        expect(q).not.toHaveBeenCalled();
        expect(tx).not.toHaveBeenCalled();
        expect(app.get(POSTGRES_MEDIA_SUBTITLE)).toBeInstanceOf(
          PostgresMediaSubtitlePersistence,
        );
      } finally {
        await app.close();
      }
    }));
});
