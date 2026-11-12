import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-render.migrations.js';
import { MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/media/infrastructure/postgres-media-composition.migrations.js';
import { PostgresMediaRenderPersistence } from '../../src/modules/media/infrastructure/postgres-media-render.persistence.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  mediaRenderFixture,
  nativeInitial,
  nativeRevision,
  renderMetadata,
  p4Metadata,
} from './media-render-fixture.js';
import {
  videoRenderIdentityHash,
  validateVideoRender,
} from '../../src/modules/media/domain/video-render-contracts.js';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import {
  MediaPostgresModule,
  POSTGRES_MEDIA_RENDER,
} from '../../src/modules/media/media-postgres.module.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';
import { PostgresMediaCompositionPersistence } from '../../src/modules/media/infrastructure/postgres-media-composition.persistence.js';
import { changedPlan } from './media-composition-fixture.js';

describe('Media VideoRender PostgreSQL real', () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await db?.close();
  });
  async function usingRender(
    mixed: boolean,
    work: (
      f: Awaited<ReturnType<typeof mediaRenderFixture>>,
      pg: Awaited<ReturnType<PostgresMediaRenderPersistence['open']>>,
    ) => Promise<void>,
  ) {
    await new PostgresMigrationRunner(db).migrate(migrations);
    const f = await mediaRenderFixture(db, { mixed }),
      pg = await new PostgresMediaRenderPersistence(db).open();
    try {
      await work(f, pg);
    } finally {
      await pg.close();
      f.cleanupRender();
    }
  }
  it('appends v10 with immutable historical checksums, reexecutes and rejects drift', async () => {
    expect(migrations.slice(0, 9)).toEqual(
      MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY,
    );
    expect(migrations.map((m) => m.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
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
      currentVersion: 10,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 9),
        { ...migrations[9], sql: migrations[9].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
  });
  it.each([false, true])(
    'stores V1 render of CompositionPlan V2=%s with native SQLite JSON/hash/lineage parity',
    async (mixed) =>
      usingRender(mixed, async (f, pg) => {
        expect(await pg.registerVideoRender(f.render)).toEqual(
          nativeInitial(f, f.render),
        );
        expect(await pg.getVideoRender(f.render.videoRenderId)).toEqual(
          f.nativeRender.getVideoRender(f.render.videoRenderId),
        );
        expect(
          await pg.listVideoRendersByCompositionPlan(f.plan.compositionPlanId),
        ).toEqual(
          f.nativeRender.listVideoRendersByCompositionPlan(
            f.plan.compositionPlanId,
          ),
        );
        expect(
          (await db.query('SELECT identity_hash FROM media.video_renders'))
            .rows[0].identity_hash,
        ).toBe(videoRenderIdentityHash(f.render));
        const artifact = f.nativeRender.getArtifact(f.render.videoRenderId)!;
        expect(
          (
            await db.query(
              'SELECT identity_hash FROM content.artifact_lineage WHERE artifact_id=$1',
              [f.render.videoRenderId],
            )
          ).rows[0].identity_hash,
        ).toBe(
          createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
        );
      }),
  );
  const count = async () =>
    (
      await db.query(
        "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='video_render'",
      )
    ).rows[0].count;
  const outcome = async (work: () => unknown) => {
    try {
      await work();
      throw new Error('EXPECTED_FAILURE');
    } catch (error: any) {
      if (!error.code) throw error;
      return { code: error.code, field: error.field ?? error.path };
    }
  };
  it('rolls back v10 DDL and its owner trigger without touching the v9 schema', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 9));
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 9),
        {
          ...migrations[9],
          sql: migrations[9].sql + '\nSELECT missing_render_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regclass('media.video_renders') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='media_render_lineage_owner'",
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (
        await db.query(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        )
      ).rows[0].version,
    ).toBe(9);
  });
  it('requires v10/checksum explicitly and never migrates on open', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 9));
    await expect(
      new PostgresMediaRenderPersistence(db).open(),
    ).rejects.toMatchObject({
      code: 'MEDIA_RENDER_SCHEMA_VERSION_UNSUPPORTED',
    });
    await new PostgresMigrationRunner(db).migrate(migrations);
    await db.query(
      'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=10',
      ['0'.repeat(64)],
    );
    await expect(
      new PostgresMediaRenderPersistence(db).open(),
    ).rejects.toMatchObject({
      code: 'MEDIA_RENDER_SCHEMA_VERSION_UNSUPPORTED',
    });
  });
  it.each(['mp4', 'webm', 'mov'])(
    'preserves canonical %s metadata and opaque logical reference without external effects',
    async (containerFormat) =>
      usingRender(false, async (f, pg) => {
        const fetch = vi.fn(() => {
          throw new Error('FORBIDDEN_EXTERNAL_EFFECT');
        });
        vi.stubGlobal('fetch', fetch);
        const r = renderMetadata(f.plan, {
          containerFormat,
          logicalReference: 'render:operator_registered_001',
        });
        expect(await pg.registerVideoRender(r)).toEqual(nativeInitial(f, r));
        expect(fetch).not.toHaveBeenCalled();
        expect(Object.isFrozen(await pg.getVideoRender(r.videoRenderId))).toBe(
          true,
        );
      }),
  );
  it('rejects mismatched plan/hash/project/run/duration/aspect with native SQLite error parity', async () =>
    usingRender(false, async (f, pg) => {
      for (const [change, code] of [
        [
          { compositionPlanId: 'composition_missing' },
          'COMPOSITION_PLAN_NOT_FOUND',
        ],
        [
          { compositionPlanContentHash: 'e'.repeat(64) },
          'COMPOSITION_PLAN_CONTENT_HASH_MISMATCH',
        ],
        [{ pipelineRunId: 'run_missing' }, 'PIPELINE_RUN_NOT_FOUND'],
        [{ projectId: 'project_other' }, 'VIDEO_RENDER_RUN_SCOPE_MISMATCH'],
        [{ projectVersion: 2 }, 'VIDEO_RENDER_RUN_SCOPE_MISMATCH'],
        [{ durationMilliseconds: 4999 }, 'VIDEO_RENDER_DURATION_MISMATCH'],
        [
          { outputAspectRatio: '1:1', widthPixels: 1080, heightPixels: 1080 },
          'OUTPUT_ASPECT_RATIO_MISMATCH',
        ],
      ] as const) {
        const r = renderMetadata(f.plan, change);
        expect(await outcome(() => pg.registerVideoRender(r))).toEqual(
          await outcome(() => nativeInitial(f, r)),
        );
        await expect(pg.registerVideoRender(r)).rejects.toMatchObject({ code });
      }
      expect(await count()).toBe('0');
    }));
  it('uses canonical dimensions/format/hash/revision validation without weakening contracts', async () =>
    usingRender(false, async (f, pg) => {
      for (const change of [
        { widthPixels: 0 },
        { heightPixels: 100001 },
        { widthPixels: 1079 },
        { containerFormat: 'avi' },
        { durationMilliseconds: 86400001 },
        { contentHash: 'bad' },
        { revision: 0 },
        { revision: 2, supersedesVideoRenderId: null },
        { revision: 1, supersedesVideoRenderId: 'render_previous' },
        { schemaVersion: 'video-render/unknown' },
      ]) {
        const r = { ...f.render, ...change };
        expect(await outcome(() => pg.registerVideoRender(r))).toEqual(
          await outcome(() => validateVideoRender(r)),
        );
      }
      expect(await count()).toBe('0');
    }));
  it.each([
    'https://example.com/private.mp4',
    'file:private_001',
    'object:private_001',
    'render:secret_001',
    'render:token_001',
    'render:../escape',
    'D:\\private\\video.mp4',
  ])(
    'rejects unsafe LogicalReference %s before any lineage write',
    async (logicalReference) =>
      usingRender(false, async (f, pg) => {
        await expect(
          pg.registerVideoRender({ ...f.render, logicalReference }),
        ).rejects.toMatchObject({ code: 'INVALID_LOGICAL_REFERENCE' });
        expect(await count()).toBe('0');
      }),
  );
  it('rejects conflicting identity, logical revision and a cross-domain artifact ID collision', async () =>
    usingRender(false, async (f, pg) => {
      await expect(
        pg.registerVideoRender({
          ...f.render,
          videoRenderId: f.voice.voiceTrackId,
        }),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_ID_REUSED' });
      await pg.registerVideoRender(f.render);
      for (const change of [
        { contentHash: 'e'.repeat(64) },
        { createdAt: '2026-11-12T00:00:00Z' },
        { logicalReference: 'render:changed_ref' },
      ])
        await expect(
          pg.registerVideoRender({ ...f.render, ...change }),
        ).rejects.toMatchObject({ code: 'VIDEO_RENDER_ID_REUSED' });
      await expect(
        pg.registerVideoRender({
          ...f.render,
          videoRenderId: 'render_conflict',
        }),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_REVISION_CONFLICT' });
      expect(await count()).toBe('1');
    }));
  it('retains revisions/supersession/history and SQLite canonical read/list/hash parity', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      nativeInitial(f, f.render);
      const second = renderMetadata(f.plan, {
        videoRenderId: 'render_revision_002',
        revision: 2,
        supersedesVideoRenderId: f.render.videoRenderId,
        containerFormat: 'webm',
        widthPixels: 720,
        heightPixels: 1280,
        contentHash: 'e'.repeat(64),
        logicalReference: 'render:revision_002',
      });
      expect(await pg.registerVideoRender(second)).toEqual(
        nativeRevision(f, second),
      );
      const third = renderMetadata(f.plan, {
        videoRenderId: 'render_revision_003',
        revision: 3,
        supersedesVideoRenderId: second.videoRenderId,
      });
      expect(await pg.registerVideoRender(third)).toEqual(
        nativeRevision(f, third),
      );
      expect(await pg.getVideoRenderSuccessor(f.render.videoRenderId)).toEqual(
        second,
      );
      expect(await pg.getVideoRenderSuccessor(second.videoRenderId)).toEqual(
        third,
      );
      expect(await pg.getVideoRenderSuccessor(third.videoRenderId)).toBeNull();
      expect(await pg.getVideoRender(f.render.videoRenderId)).toEqual(f.render);
      expect(await pg.registerVideoRender(f.render)).toEqual(f.render);
      expect(
        await pg.listVideoRendersByCompositionPlan(f.plan.compositionPlanId),
      ).toEqual(
        f.nativeRender.listVideoRendersByCompositionPlan(
          f.plan.compositionPlanId,
        ),
      );
      const nativeRun = f.nativeRender.db
        .prepare(
          'SELECT video_render_id FROM video_renders WHERE pipeline_run_id=? ORDER BY created_at,composition_plan_id,revision,video_render_id',
        )
        .all(f.render.pipelineRunId)
        .map((r: any) => f.nativeRender.getVideoRender(r.video_render_id));
      expect(
        await pg.listVideoRendersByPipelineRun(f.render.pipelineRunId),
      ).toEqual(nativeRun);
      await expect(
        pg.registerVideoRender({ ...second, videoRenderId: 'render_stale' }),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_REVISION_CONFLICT' });
    }));
  it('rejects missing or skipped predecessors before lineage is persisted', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      await expect(
        pg.registerVideoRender({
          ...f.render,
          videoRenderId: 'render_missing_previous',
          revision: 2,
          supersedesVideoRenderId: 'render_missing',
        }),
      ).rejects.toMatchObject({ code: 'SUPERSEDED_VIDEO_RENDER_NOT_FOUND' });
      await expect(
        pg.registerVideoRender({
          ...f.render,
          videoRenderId: 'render_skipped',
          revision: 3,
          supersedesVideoRenderId: f.render.videoRenderId,
        }),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_REVISION_MISMATCH' });
      expect(await count()).toBe('1');
    }));
  it('rejects a real predecessor bound to a different canonical CompositionPlan', async () =>
    usingRender(false, async (f, pg) => {
      const plan = changedPlan(f.plan, {
        compositionPlanId: 'composition_other',
        revision: 2,
        supersedesCompositionPlanId: f.plan.compositionPlanId,
      });
      const plans = await new PostgresMediaCompositionPersistence(db).open();
      try {
        await plans.registerCompositionPlan(plan);
      } finally {
        await plans.close();
      }
      const other = renderMetadata(plan, {
        videoRenderId: 'render_other_plan',
      });
      await pg.registerVideoRender(other);
      await expect(
        pg.registerVideoRender({
          ...f.render,
          videoRenderId: 'render_cross_plan',
          revision: 2,
          supersedesVideoRenderId: other.videoRenderId,
        }),
      ).rejects.toMatchObject({
        code: 'VIDEO_RENDER_SUPERSESSION_SCOPE_MISMATCH',
        field: 'compositionPlanId',
      });
      expect(await count()).toBe('1');
    }));
  it('blocks valid V2/P4 contracts until their origin/audio/narration lineage is migrated', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      const p4 = p4Metadata(f.render);
      expect(p4.schemaVersion).toBe('video-render/2.0.0');
      await expect(pg.registerVideoRender(p4)).rejects.toMatchObject({
        code: 'MEDIA_RENDER_P4_DEPENDENCY_REQUIRED',
      });
      expect(
        (
          await db.query(
            'SELECT count(*) FROM content.artifact_lineage WHERE artifact_id=$1',
            [p4.videoRenderId],
          )
        ).rows[0].count,
      ).toBe('0');
      expect(await count()).toBe('1');
    }));
  it('serializes replay and competing revisions with one winner and no duplicate lineage', async () =>
    usingRender(false, async (f, a) => {
      const b = await new PostgresMediaRenderPersistence(db).open();
      try {
        expect(
          await Promise.all([
            a.registerVideoRender(f.render),
            b.registerVideoRender(f.render),
          ]),
        ).toEqual([f.render, f.render]);
        const results = await Promise.allSettled(
          ['render_race_a', 'render_race_b'].map((videoRenderId, i) =>
            (i ? a : b).registerVideoRender({
              ...f.render,
              videoRenderId,
              revision: 2,
              supersedesVideoRenderId: f.render.videoRenderId,
            }),
          ),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'VIDEO_RENDER_REVISION_CONFLICT' },
        });
        expect(await count()).toBe('2');
      } finally {
        await b.close();
      }
    }));
  it('restarts the pool and recovers revisions, lineage and idempotent replay', async () =>
    usingRender(true, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      const next = {
        ...f.render,
        videoRenderId: 'render_after_restart',
        revision: 2,
        supersedesVideoRenderId: f.render.videoRenderId,
      };
      await pg.registerVideoRender(next);
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const other = await new PostgresMediaRenderPersistence(
          restarted,
        ).open();
        try {
          expect(await other.registerVideoRender(next)).toEqual(next);
          expect(
            await other.getVideoRenderSuccessor(f.render.videoRenderId),
          ).toEqual(next);
        } finally {
          await other.close();
        }
      } finally {
        await restarted.close();
      }
    }));
  it('keeps one physical connection/BEGIN/COMMIT and the existing 3/4/5/7 locks for canonical reads', async () =>
    usingRender(false, async (f) => {
      let pool!: Pool;
      const observed = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (options) => (pool = new Pool(options)),
      );
      try {
        await assertDisposableDatabase(observed);
        const pg = await new PostgresMediaRenderPersistence(observed).open();
        try {
          const client = await pool.connect(),
            queries = vi.spyOn(client, 'query');
          client.release();
          const connects = vi.spyOn(pool, 'connect'),
            independent = vi.spyOn(pool, 'query');
          await pg.registerVideoRender(f.render);
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
    }));
  it('rolls back lineage and inputs when SQL fails between lineage and render', async () =>
    usingRender(false, async (f, pg) => {
      await assertDisposableDatabase(db);
      await db.query(`CREATE FUNCTION media.fixture_render_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE='P1099',MESSAGE='render_fixture_failure'; END $$;
      CREATE TRIGGER fixture_render_failure BEFORE INSERT ON media.video_renders FOR EACH ROW EXECUTE FUNCTION media.fixture_render_failure();`);
      await expect(pg.registerVideoRender(f.render)).rejects.toMatchObject({
        code: 'VIDEO_RENDER_PERSISTENCE_FAILED',
      });
      expect(await count()).toBe('0');
      expect(
        (
          await db.query(
            'SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=$1',
            [f.render.videoRenderId],
          )
        ).rows[0].count,
      ).toBe('0');
      expect(await pg.getVideoRender(f.render.videoRenderId)).toBeNull();
    }));
  it('rolls back before outer commit and refuses missing participants or isolated transaction upgrades', async () =>
    usingRender(false, async (f, pg) => {
      await expect(
        db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
          await pg.registerVideoRender(f.render);
          throw new Error('before_commit');
        }),
      ).rejects.toThrow('before_commit');
      expect(await pg.getVideoRender(f.render.videoRenderId)).toBeNull();
      expect(await count()).toBe('0');
      await expect(
        db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
          pg.registerVideoRender(f.render),
        ),
      ).rejects.toMatchObject({
        code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
      await expect(
        db.transaction(() => pg.registerVideoRender(f.render)),
      ).rejects.toMatchObject({
        code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
    }));
  it('rejects orphan VideoRender lineage at the real deferred commit boundary', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      await expect(
        db.transaction(async (client) => {
          await client.query(
            "INSERT INTO content.artifact_lineage SELECT 'orphan_render',schema_version,artifact_type,99,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at FROM content.artifact_lineage WHERE artifact_id=$1",
            [f.render.videoRenderId],
          );
        }),
      ).rejects.toMatchObject({ sqlState: 'P1003' });
      expect(
        (
          await db.query(
            "SELECT count(*) FROM content.artifact_lineage WHERE artifact_id='orphan_render'",
          )
        ).rows[0].count,
      ).toBe('0');
    }));
  it('rejects SQL-level dimension and logical-reference violations even if immutability is bypassed in the marked fixture', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      await assertDisposableDatabase(db);
      for (const clause of [
        'width_pixels=1079',
        "container_format='avi'",
        "logical_reference='render:secret_001'",
      ])
        await expect(
          db.transaction(async (client) => {
            await client.query(
              'ALTER TABLE media.video_renders DISABLE TRIGGER immutable_video_renders',
            );
            await client.query(`UPDATE media.video_renders SET ${clause}`);
          }),
        ).rejects.toMatchObject({ sqlState: '23514' });
      expect(await pg.getVideoRender(f.render.videoRenderId)).toEqual(f.render);
    }));
  it('keeps render history immutable at SQL level', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      for (const sql of [
        'UPDATE media.video_renders SET video_render_id=video_render_id',
        'DELETE FROM media.video_renders',
      ])
        await expect(db.query(sql)).rejects.toMatchObject({
          sqlState: 'P1004',
        });
    }));
  it.each(['header', 'payload', 'lineage', 'inputs'])(
    'detects adulterated %s without trusting the unchanged identity hash',
    async (target) =>
      usingRender(false, async (f, pg) => {
        await pg.registerVideoRender(f.render);
        await assertDisposableDatabase(db);
        const table =
          target === 'header' || target === 'payload'
            ? 'media.video_renders'
            : target === 'lineage'
              ? 'content.artifact_lineage'
              : 'content.artifact_lineage_inputs';
        const trigger =
          target === 'header' || target === 'payload'
            ? 'immutable_video_renders'
            : target === 'lineage'
              ? 'immutable_artifact_lineage'
              : 'immutable_artifact_lineage_inputs';
        await db.transaction(async (client) => {
          await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
          if (target === 'header')
            await client.query(
              "UPDATE media.video_renders SET logical_reference='render:tampered_ref'",
            );
          else if (target === 'payload')
            await client.query(
              "UPDATE media.video_renders SET payload_json=pg_catalog.jsonb_set(payload_json::jsonb,'{createdAt}','\"2026-11-12T00:00:00Z\"'::jsonb)::json",
            );
          else
            await client.query(
              `UPDATE ${table} SET content_hash=$1 WHERE artifact_id=$2`,
              ['e'.repeat(64), f.render.videoRenderId],
            );
          await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        });
        await expect(
          pg.getVideoRender(f.render.videoRenderId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_VIDEO_RENDER' });
      }),
  );
  it('detects supersession cycles even with recomputed payload/hash columns', async () =>
    usingRender(false, async (f, pg) => {
      await pg.registerVideoRender(f.render);
      await assertDisposableDatabase(db);
      const cycle = {
        ...f.render,
        revision: 2,
        supersedesVideoRenderId: f.render.videoRenderId,
      };
      await db.transaction(async (client) => {
        await client.query(
          'ALTER TABLE media.video_renders DISABLE TRIGGER immutable_video_renders',
        );
        await client.query(
          'UPDATE media.video_renders SET revision=2,supersedes_video_render_id=$1,payload_json=$2,identity_hash=$3 WHERE video_render_id=$1',
          [
            f.render.videoRenderId,
            JSON.stringify(cycle),
            videoRenderIdentityHash(cycle),
          ],
        );
        await client.query(
          'ALTER TABLE media.video_renders ENABLE TRIGGER immutable_video_renders',
        );
      });
      await expect(
        pg.getVideoRender(f.render.videoRenderId),
      ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_VIDEO_RENDER' });
    }));
  it('rejects adulterated canonical CompositionPlan rather than trusting its row hash', async () =>
    usingRender(false, async (f, pg) => {
      await assertDisposableDatabase(db);
      await db.transaction(async (client) => {
        await client.query(
          'ALTER TABLE media.composition_plans DISABLE TRIGGER immutable_composition_plans',
        );
        await client.query(
          'UPDATE media.composition_plans SET duration_milliseconds=4999',
        );
        await client.query(
          'ALTER TABLE media.composition_plans ENABLE TRIGGER immutable_composition_plans',
        );
      });
      await expect(pg.registerVideoRender(f.render)).rejects.toMatchObject({
        code: 'INVALID_PERSISTED_COMPOSITION_PLAN',
      });
      expect(await count()).toBe('0');
    }));
  it('preserves read-only/closed handles and idle Nest startup without producers or DDL', async () =>
    usingRender(false, async (f) => {
      const ro = await new PostgresMediaRenderPersistence(db).open(true);
      await expect(ro.registerVideoRender(f.render)).rejects.toMatchObject({
        code: 'MEDIA_CATALOG_READ_ONLY',
      });
      expect(await ro.getVideoRender('render_missing')).toBeNull();
      await ro.close();
      await expect(ro.getVideoRender('render_missing')).rejects.toMatchObject({
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
        expect(app.get(POSTGRES_MEDIA_RENDER)).toBeInstanceOf(
          PostgresMediaRenderPersistence,
        );
      } finally {
        await app.close();
      }
    }));
});
