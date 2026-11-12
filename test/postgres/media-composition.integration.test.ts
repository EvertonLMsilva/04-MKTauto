import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-composition.migrations.js';
import { MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/media/infrastructure/postgres-media-voice.migrations.js';
import { PostgresMediaCompositionPersistence } from '../../src/modules/media/infrastructure/postgres-media-composition.persistence.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  mediaCompositionFixture,
  changedPlan,
  compositionScriptRevision,
} from './media-composition-fixture.js';
import { createHash } from 'node:crypto';
import { compositionPlanIdentityHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import {
  MediaPostgresModule,
  POSTGRES_MEDIA_COMPOSITION,
  POSTGRES_MEDIA_CATALOG,
  POSTGRES_MEDIA_VOICE,
} from '../../src/modules/media/media-postgres.module.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';
import { researchScriptFixture } from './media-catalog-fixture.js';
import { PostgresMediaCatalogPersistence } from '../../src/modules/media/infrastructure/postgres-media-catalog.persistence.js';

describe('Media Composition PostgreSQL real', () => {
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
  async function usingComposition(
    options: { mixed?: boolean; video?: boolean },
    action: (
      f: Awaited<ReturnType<typeof mediaCompositionFixture>>,
      pg: Awaited<ReturnType<PostgresMediaCompositionPersistence['open']>>,
    ) => Promise<void>,
  ) {
    await new PostgresMigrationRunner(db).migrate(migrations);
    const f = await mediaCompositionFixture(db, options),
      pg = await new PostgresMediaCompositionPersistence(db).open();
    try {
      await action(f, pg);
    } finally {
      await pg.close();
      f.cleanupComposition();
    }
  }
  const compositionCount = async () =>
    (
      await db.query(
        "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='composition_plan'",
      )
    ).rows[0].count;
  const outcome = async (action: () => unknown) => {
    try {
      await action();
      throw new Error('EXPECTED_FAILURE');
    } catch (error: any) {
      if (!error.code) throw error;
      return { code: error.code, field: error.field ?? error.path };
    }
  };
  it('appends v9, preserves v1-v8 checksums, reexecutes and rejects drift', async () => {
    expect(migrations.slice(0, 8)).toEqual(
      MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY,
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
      currentVersion: 9,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 8),
        { ...migrations[8], sql: migrations[8].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
  });
  it.each([false, true])(
    'registers/replays V2=%s with native SQLite identity, payload, lineage and lists',
    async (mixed) => {
      await new PostgresMigrationRunner(db).migrate(migrations);
      const f = await mediaCompositionFixture(db, { mixed, video: mixed }),
        pg = await new PostgresMediaCompositionPersistence(db).open();
      try {
        expect(await pg.registerCompositionPlan(f.plan)).toEqual(
          f.nativeComposition.registerCompositionPlan(f.plan),
        );
        expect(await pg.registerCompositionPlan(f.plan)).toEqual(f.plan);
        expect(await pg.getCompositionPlan(f.plan.compositionPlanId)).toEqual(
          f.nativeComposition.getCompositionPlan(f.plan.compositionPlanId),
        );
        expect(
          await pg.listCompositionPlansByPipelineRun(f.plan.pipelineRunId),
        ).toEqual(
          f.nativeComposition.listCompositionPlansByPipelineRun(
            f.plan.pipelineRunId,
          ),
        );
        expect(
          await pg.listCompositionPlansByScript(f.script.scriptId),
        ).toEqual([f.plan]);
        const lineage = f.nativeComposition.getArtifact(
          f.plan.compositionPlanId,
        )!;
        expect(
          (
            await db.query(
              'SELECT identity_hash FROM content.artifact_lineage WHERE artifact_id=$1',
              [f.plan.compositionPlanId],
            )
          ).rows[0].identity_hash,
        ).toBe(
          createHash('sha256').update(JSON.stringify(lineage)).digest('hex'),
        );
        expect(
          (await db.query('SELECT identity_hash FROM media.composition_plans'))
            .rows[0].identity_hash,
        ).toBe(compositionPlanIdentityHash(f.plan));
        const next = changedPlan(f.plan, {
          compositionPlanId: 'composition_002',
          revision: 2,
          supersedesCompositionPlanId: f.plan.compositionPlanId,
        });
        expect(await pg.registerCompositionPlan(next)).toEqual(
          f.nativeComposition.registerCompositionPlan(next),
        );
      } finally {
        await pg.close();
        f.cleanupComposition();
      }
    },
  );
  it.each([false, true])(
    'preserves native narration-only reuse constraints for V2=%s',
    async (mixed) =>
      usingComposition({ mixed }, async (f, pg) => {
        const next = await compositionScriptRevision(db, f);
        if (mixed)
          expect(await pg.registerCompositionPlan(next.plan)).toEqual(
            f.nativeComposition.registerCompositionPlan(next.plan),
          );
        else {
          expect(
            await outcome(() => pg.registerCompositionPlan(next.plan)),
          ).toEqual(
            await outcome(() =>
              f.nativeComposition.registerCompositionPlan(next.plan),
            ),
          );
          await expect(
            pg.registerCompositionPlan(next.plan),
          ).rejects.toMatchObject({ code: 'COMPOSITION_PLAN_SCOPE_MISMATCH' });
          expect(await compositionCount()).toBe('0');
        }
      }),
  );
  it('rejects valid canonical voice and asset records bound to incompatible scripts', async () =>
    usingComposition({}, async (f, pg) => {
      const next = await compositionScriptRevision(db, f, {
        visualChanged: true,
      });
      await expect(
        pg.registerCompositionPlan(
          changedPlan(f.plan, {
            voiceTrackId: next.voice.voiceTrackId,
            voiceTrackContentHash: next.voice.contentHash,
          }),
        ),
      ).rejects.toMatchObject({ code: 'VOICE_TRACK_SCRIPT_MISMATCH' });
      await expect(pg.registerCompositionPlan(next.plan)).rejects.toMatchObject(
        { code: 'MEDIA_ASSET_SCRIPT_MISMATCH' },
      );
      expect(await compositionCount()).toBe('0');
    }));
  it('preserves multiple segments, ordered inputs and exact visual coverage; rejects timeline gaps/overlaps', async () =>
    usingComposition({}, async (f, pg) => {
      const next = await compositionScriptRevision(db, f, {
        extraDirection: true,
      });
      for (const startMilliseconds of [1999, 2001]) {
        const p = changedPlan(next.plan, {
          segments: next.plan.segments.map((s: any, i: number) =>
            i ? { ...s, startMilliseconds } : s,
          ),
        });
        expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
          await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
        );
      }
      expect(await pg.registerCompositionPlan(next.plan)).toEqual(
        f.nativeComposition.registerCompositionPlan(next.plan),
      );
      expect(
        (
          await db.query(
            'SELECT position, input_id FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
            [next.plan.compositionPlanId],
          )
        ).rows.map((r) => r.input_id),
      ).toEqual([
        next.script.scriptId,
        next.voice.voiceTrackId,
        ...next.assets.map((a) => a.mediaAssetId),
      ]);
    }));
  it('rejects cycles even if a corrupted payload and stored identity are recomputed together', async () =>
    usingComposition({}, async (f, pg) => {
      await pg.registerCompositionPlan(f.plan);
      await assertDisposableDatabase(db);
      const cycle = changedPlan(f.plan, {
        revision: 2,
        supersedesCompositionPlanId: f.plan.compositionPlanId,
      });
      await db.transaction(async (client) => {
        await client.query(
          'ALTER TABLE media.composition_plans DISABLE TRIGGER immutable_composition_plans',
        );
        await client.query(
          'UPDATE media.composition_plans SET revision=2,supersedes_composition_plan_id=$1,payload_json=$2,identity_hash=$3,content_hash=$4 WHERE composition_plan_id=$1',
          [
            f.plan.compositionPlanId,
            JSON.stringify(cycle),
            compositionPlanIdentityHash(cycle),
            cycle.contentHash,
          ],
        );
        await client.query(
          'ALTER TABLE media.composition_plans ENABLE TRIGGER immutable_composition_plans',
        );
      });
      await expect(
        pg.getCompositionPlan(f.plan.compositionPlanId),
      ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_COMPOSITION_PLAN' });
    }));
  it('rolls back v9 tables/functions/lineage trigger on failed DDL', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 8));
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 8),
        {
          ...migrations[8],
          sql: migrations[8].sql + '\nSELECT missing_composition_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regclass('media.composition_plans') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='media_composition_lineage_owner'",
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (
        await db.query(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        )
      ).rows[0].version,
    ).toBe(8);
  });
  it('requires v9 and its checksum without migrating on open', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 8));
    await expect(
      new PostgresMediaCompositionPersistence(db).open(),
    ).rejects.toMatchObject({
      code: 'MEDIA_COMPOSITION_SCHEMA_VERSION_UNSUPPORTED',
    });
    await new PostgresMigrationRunner(db).migrate(migrations);
    await db.query(
      'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=9',
      ['0'.repeat(64)],
    );
    await expect(
      new PostgresMediaCompositionPersistence(db).open(),
    ).rejects.toMatchObject({
      code: 'MEDIA_COMPOSITION_SCHEMA_VERSION_UNSUPPORTED',
    });
  });
  it('preserves V1 video and licensed source bindings without running providers', async () =>
    usingComposition({ video: true }, async (f, pg) => {
      const fetch = vi.fn(() => {
        throw new Error('EXTERNAL_EFFECT_FORBIDDEN');
      });
      vi.stubGlobal('fetch', fetch);
      expect(await pg.registerCompositionPlan(f.plan)).toEqual(
        f.nativeComposition.registerCompositionPlan(f.plan),
      );
      expect(fetch).not.toHaveBeenCalled();
    }));
  it('preserves V2 image framing and optional STATIC_ALLOWED intent', async () =>
    usingComposition({ mixed: true }, async (f, pg) => {
      const p = changedPlan(f.plan, {
        segments: f.plan.segments.map((s: any) => ({
          ...s,
          framingStrategy: 'CONTAIN_9_16',
          movementRequirement: 'STATIC_ALLOWED',
        })),
      });
      expect(await pg.registerCompositionPlan(p)).toEqual(
        f.nativeComposition.registerCompositionPlan(p),
      );
      expect(await pg.getCompositionPlan(p.compositionPlanId)).toEqual(p);
    }));
  it.each(['TRIM', 'LOOP'])(
    'preserves V2 %s source-duration policy with SQLite parity',
    async (playbackMode) =>
      usingComposition({ mixed: true, video: true }, async (f, pg) => {
        const p = changedPlan(f.plan, {
          segments: f.plan.segments.map((s: any) => ({
            ...s,
            sourceStartMilliseconds: 1000,
            playbackMode,
          })),
        });
        if (playbackMode === 'TRIM') {
          expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
            await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
          );
          await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
            code: 'MEDIA_DURATION_INSUFFICIENT',
          });
          expect(await compositionCount()).toBe('0');
        } else
          expect(await pg.registerCompositionPlan(p)).toEqual(
            f.nativeComposition.registerCompositionPlan(p),
          );
      }),
  );
  it('rejects scope/hash/aspect/duration/missing-entity conflicts with native SQLite error parity', async () =>
    usingComposition({}, async (f, pg) => {
      const scenarios: [Record<string, unknown>, string][] = [
        [{ pipelineRunId: 'run_missing' }, 'PIPELINE_RUN_NOT_FOUND'],
        [{ projectVersion: 2 }, 'COMPOSITION_PLAN_RUN_SCOPE_MISMATCH'],
        [{ projectId: 'project_other' }, 'COMPOSITION_PLAN_RUN_SCOPE_MISMATCH'],
        [{ scriptId: 'script_missing' }, 'SCRIPT_NOT_FOUND'],
        [{ scriptContentHash: 'f'.repeat(64) }, 'SCRIPT_CONTENT_HASH_MISMATCH'],
        [{ voiceTrackId: 'voice_missing' }, 'VOICE_TRACK_NOT_FOUND'],
        [
          { voiceTrackContentHash: 'f'.repeat(64) },
          'VOICE_TRACK_CONTENT_HASH_MISMATCH',
        ],
        [{ outputAspectRatio: '1:1' }, 'OUTPUT_ASPECT_RATIO_MISMATCH'],
        [
          {
            durationMilliseconds: 6000,
            segments: f.plan.segments.map((s: any) => ({
              ...s,
              endMilliseconds: 6000,
            })),
          },
          'VOICE_TRACK_DURATION_MISMATCH',
        ],
        [
          {
            segments: f.plan.segments.map((s: any) => ({
              ...s,
              mediaAssetId: 'asset_missing',
            })),
          },
          'MEDIA_ASSET_NOT_FOUND',
        ],
        [
          {
            segments: f.plan.segments.map((s: any) => ({
              ...s,
              mediaAssetContentHash: 'f'.repeat(64),
            })),
          },
          'MEDIA_ASSET_CONTENT_HASH_MISMATCH',
        ],
        [
          {
            segments: f.plan.segments.map((s: any) => ({
              ...s,
              visualDirectionPosition: 2,
            })),
          },
          'VISUAL_DIRECTION_COVERAGE_MISMATCH',
        ],
      ];
      for (const [changes, code] of scenarios) {
        const p = changedPlan(f.plan, changes);
        expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
          await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
        );
        await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
          code,
        });
      }
      expect(await compositionCount()).toBe('0');
    }));
  it('uses canonical timeline and content-hash validation without creating lineage', async () =>
    usingComposition({}, async (f, pg) => {
      for (const p of [
        { ...f.plan, contentHash: 'f'.repeat(64) },
        changedPlan(f.plan, {
          segments: f.plan.segments.map((s: any) => ({
            ...s,
            startMilliseconds: 1,
          })),
        }),
        changedPlan(f.plan, { durationMilliseconds: 4999 }),
        changedPlan(f.plan, { segments: [] }),
        changedPlan(f.plan, { outputAspectRatio: '4:3' }),
      ]) {
        expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
          await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
        );
      }
      expect(await compositionCount()).toBe('0');
    }));
  it('rejects V2 in a static profile without changing the run snapshot', async () =>
    usingComposition({}, async (f, pg) => {
      const p = changedPlan(f.plan, {
        schemaVersion: 'composition-plan/2.0.0',
        productionProfile: 'MIXED_MEDIA_V2',
        compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
        segments: f.plan.segments.map((s: any) => ({
          ...s,
          mediaType: 'IMAGE',
          sourceStartMilliseconds: 0,
          playbackMode: 'TRIM',
          originalAudioMuted: true,
          framingStrategy: 'COVER_CROP_9_16',
          transition: {
            policyVersion: 'composition-transition/1.0.0',
            type: 'CUT',
            durationMilliseconds: 0,
          },
        })),
      });
      expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
        await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
      );
      await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
        code: 'PRODUCTION_PROFILE_MISMATCH',
      });
      expect(await compositionCount()).toBe('0');
    }));
  it('checks V1 video duration and V2 source-start/type against actual catalog metadata', async () =>
    usingComposition({ mixed: true, video: true }, async (f, pg) => {
      for (const [change, code] of [
        [{ sourceStartMilliseconds: 5000 }, 'MEDIA_TRIM_START_OUT_OF_RANGE'],
        [{ mediaType: 'IMAGE' }, 'MEDIA_ASSET_TYPE_MISMATCH'],
      ] as const) {
        const p = changedPlan(f.plan, {
          segments: f.plan.segments.map((s: any) => ({ ...s, ...change })),
        });
        expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
          await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
        );
        await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
          code,
        });
      }
    }));
  it('blocks motion-required and generated V2 video until canonical temporal QC is migrated', async () =>
    usingComposition({ mixed: true, video: true }, async (f, pg) => {
      const motion = changedPlan(f.plan, {
        segments: f.plan.segments.map((s: any) => ({
          ...s,
          movementRequirement: 'REAL_MOTION_REQUIRED',
        })),
      });
      await expect(pg.registerCompositionPlan(motion)).rejects.toMatchObject({
        code: 'MEDIA_COMPOSITION_TEMPORAL_QC_DEPENDENCY_REQUIRED',
      });
      const catalog = await new PostgresMediaCatalogPersistence(db).open();
      const generated = {
        ...f.asset,
        mediaAssetId: 'asset_generated',
        revision: 2,
        supersedesMediaAssetId: f.asset.mediaAssetId,
        origin: 'PROVIDER_GENERATED',
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
        source: null,
      };
      try {
        await catalog.registerMediaAsset(generated);
      } finally {
        await catalog.close();
      }
      const p = changedPlan(f.plan, {
        segments: f.plan.segments.map((s: any) => ({
          ...s,
          mediaAssetId: generated.mediaAssetId,
        })),
      });
      await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
        code: 'MEDIA_COMPOSITION_TEMPORAL_QC_DEPENDENCY_REQUIRED',
      });
      expect(await compositionCount()).toBe('0');
    }));
  it('blocks a valid Research-dependent script instead of inventing missing lineage or context', async () =>
    usingComposition({}, async (f, pg) => {
      const script = await researchScriptFixture(db),
        p = changedPlan(f.plan, {
          pipelineRunId: script.pipelineRunId,
          projectId: script.projectId,
          projectVersion: script.projectVersion,
          scriptId: script.scriptId,
          scriptContentHash: script.contentHash,
        });
      await expect(pg.registerCompositionPlan(p)).rejects.toMatchObject({
        code: 'MEDIA_CONTENT_CONTEXT_REQUIRED',
      });
      expect(await compositionCount()).toBe('0');
    }));
  it('preserves revisions, successor, historical reads and conflicting replay semantics', async () =>
    usingComposition({}, async (f, pg) => {
      await pg.registerCompositionPlan(f.plan);
      f.nativeComposition.registerCompositionPlan(f.plan);
      for (const change of [
        { createdAt: '2026-10-12T00:00:00Z' },
        { compositionPlanId: 'composition_other' },
        {
          compositionPlanId: 'composition_missing_previous',
          revision: 2,
          supersedesCompositionPlanId: 'composition_missing',
        },
        {
          compositionPlanId: 'composition_skipped',
          revision: 3,
          supersedesCompositionPlanId: f.plan.compositionPlanId,
        },
      ]) {
        const p = changedPlan(f.plan, change);
        expect(await outcome(() => pg.registerCompositionPlan(p))).toEqual(
          await outcome(() => f.nativeComposition.registerCompositionPlan(p)),
        );
      }
      const next = changedPlan(f.plan, {
        compositionPlanId: 'composition_next',
        revision: 2,
        supersedesCompositionPlanId: f.plan.compositionPlanId,
      });
      await pg.registerCompositionPlan(next);
      f.nativeComposition.registerCompositionPlan(next);
      expect(
        await pg.getCompositionPlanSuccessor(f.plan.compositionPlanId),
      ).toEqual(next);
      expect(
        await pg.getCompositionPlanSuccessor(next.compositionPlanId),
      ).toBeNull();
      expect(await pg.getCompositionPlan(f.plan.compositionPlanId)).toEqual(
        f.plan,
      );
      expect(await pg.listCompositionPlansByScript(f.plan.scriptId)).toEqual(
        f.nativeComposition.listCompositionPlansByScript(f.plan.scriptId),
      );
      await expect(
        pg.registerCompositionPlan(
          changedPlan(next, { compositionPlanId: 'stale_revision' }),
        ),
      ).rejects.toMatchObject({ code: 'COMPOSITION_PLAN_REVISION_CONFLICT' });
    }));
  it('serializes replay and competing revisions without duplicated plans, segments or lineage', async () =>
    usingComposition({}, async (f, a) => {
      const b = await new PostgresMediaCompositionPersistence(db).open();
      try {
        expect(
          await Promise.all([
            a.registerCompositionPlan(f.plan),
            b.registerCompositionPlan(f.plan),
          ]),
        ).toEqual([f.plan, f.plan]);
        const revisions = ['composition_rev_a', 'composition_rev_b'].map(
          (compositionPlanId) =>
            changedPlan(f.plan, {
              compositionPlanId,
              revision: 2,
              supersedesCompositionPlanId: f.plan.compositionPlanId,
            }),
        );
        const results = await Promise.allSettled(
          revisions.map((p, i) => (i ? a : b).registerCompositionPlan(p)),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'COMPOSITION_PLAN_REVISION_CONFLICT' },
        });
        expect(await compositionCount()).toBe('2');
        expect(
          (
            await db.query(
              'SELECT count(*) FROM media.composition_plan_segments',
            )
          ).rows[0].count,
        ).toBe('2');
      } finally {
        await b.close();
      }
    }));
  it('recovers canonical payload, lineage, revision and replay after a pool restart', async () =>
    usingComposition({ mixed: true, video: true }, async (f, pg) => {
      await pg.registerCompositionPlan(f.plan);
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const other = await new PostgresMediaCompositionPersistence(
          restarted,
        ).open();
        try {
          expect(
            await other.getCompositionPlan(f.plan.compositionPlanId),
          ).toEqual(f.plan);
          expect(await other.registerCompositionPlan(f.plan)).toEqual(f.plan);
        } finally {
          await other.close();
        }
      } finally {
        await restarted.close();
      }
    }));
  it('uses one physical connection, one BEGIN/COMMIT and locks 3/4/5/7 for real canonical readers', async () =>
    usingComposition({}, async (f) => {
      let pool!: Pool;
      const observed = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (options) => (pool = new Pool(options)),
      );
      try {
        await assertDisposableDatabase(observed);
        const pg = await new PostgresMediaCompositionPersistence(
          observed,
        ).open();
        try {
          const client = await pool.connect(),
            queries = vi.spyOn(client, 'query');
          client.release();
          const connects = vi.spyOn(pool, 'connect'),
            independent = vi.spyOn(pool, 'query');
          await pg.registerCompositionPlan(f.plan);
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
  it.each(['composition_plans', 'composition_plan_segments'])(
    'rolls back true lineage and plan state when SQL fails at %s',
    async (table) =>
      usingComposition({}, async (f, pg) => {
        await assertDisposableDatabase(db);
        await db.query(`CREATE FUNCTION media.fixture_composition_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE='P9999',MESSAGE='composition_fixture_failure'; END $$;
      CREATE TRIGGER fixture_composition_failure BEFORE INSERT ON media.${table}
      FOR EACH ROW EXECUTE FUNCTION media.fixture_composition_failure();`);
        await expect(pg.registerCompositionPlan(f.plan)).rejects.toMatchObject({
          code: 'COMPOSITION_PLAN_PERSISTENCE_FAILED',
        });
        expect(
          await pg.getCompositionPlan(f.plan.compositionPlanId),
        ).toBeNull();
        expect(await compositionCount()).toBe('0');
        expect(
          (
            await db.query(
              'SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=$1',
              [f.plan.compositionPlanId],
            )
          ).rows[0].count,
        ).toBe('0');
        expect(
          (
            await db.query(
              'SELECT count(*) FROM media.composition_plan_segments',
            )
          ).rows[0].count,
        ).toBe('0');
      }),
  );
  it('rolls back before outer commit and refuses missing participants and isolated transaction upgrades', async () =>
    usingComposition({}, async (f, pg) => {
      await expect(
        db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
          await pg.registerCompositionPlan(f.plan);
          throw new Error('before_commit');
        }),
      ).rejects.toThrow('before_commit');
      expect(await pg.getCompositionPlan(f.plan.compositionPlanId)).toBeNull();
      expect(await compositionCount()).toBe('0');
      await expect(
        db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
          pg.registerCompositionPlan(f.plan),
        ),
      ).rejects.toMatchObject({
        code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
      await expect(
        db.transaction(() => pg.registerCompositionPlan(f.plan)),
      ).rejects.toMatchObject({
        code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
    }));
  it('rejects orphan lineage and an incomplete plan at the real deferred commit boundary', async () =>
    usingComposition({}, async (f, pg) => {
      await pg.registerCompositionPlan(f.plan);
      await expect(
        db.transaction(async (client) => {
          await client.query(
            "INSERT INTO content.artifact_lineage SELECT 'orphan_composition',schema_version,artifact_type,99,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at FROM content.artifact_lineage WHERE artifact_id=$1",
            [f.plan.compositionPlanId],
          );
        }),
      ).rejects.toMatchObject({ sqlState: 'P9004' });
      await db.query(`CREATE FUNCTION media.fixture_skip_segment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER fixture_skip_segment BEFORE INSERT ON media.composition_plan_segments FOR EACH ROW EXECUTE FUNCTION media.fixture_skip_segment();`);
      const next = changedPlan(f.plan, {
        compositionPlanId: 'composition_incomplete',
        revision: 2,
        supersedesCompositionPlanId: f.plan.compositionPlanId,
      });
      // Direct SQL with real canonical scope/lineage bypasses application read-back, exercising deferred completeness.
      await expect(
        db.transaction(async (client) => {
          await client.query(
            'INSERT INTO content.artifact_lineage SELECT $1,schema_version,artifact_type,2,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,$2,generation_metadata_json,created_at FROM content.artifact_lineage WHERE artifact_id=$3',
            [
              next.compositionPlanId,
              next.contentHash,
              f.plan.compositionPlanId,
            ],
          );
          await client.query(
            'INSERT INTO content.artifact_lineage_inputs SELECT $1,position,kind,input_id,content_hash FROM content.artifact_lineage_inputs WHERE artifact_id=$2',
            [next.compositionPlanId, f.plan.compositionPlanId],
          );
          await client.query(
            'INSERT INTO media.composition_plans SELECT $1,schema_version,identity_hash,pipeline_run_id,project_id,project_version,script_id,script_content_hash,voice_track_id,voice_track_content_hash,output_aspect_ratio,timeline_unit,continuity_mode,duration_milliseconds,$2,created_at,2,$3,production_profile,composition_policy_version,$4::json FROM media.composition_plans WHERE composition_plan_id=$3',
            [
              next.compositionPlanId,
              next.contentHash,
              f.plan.compositionPlanId,
              JSON.stringify(next),
            ],
          );
        }),
      ).rejects.toMatchObject({ sqlState: 'P9004' });
      expect(await pg.getCompositionPlan(next.compositionPlanId)).toBeNull();
      expect(await compositionCount()).toBe('1');
    }));
  it('keeps both plan and segment history immutable at SQL level', async () =>
    usingComposition({}, async (f, pg) => {
      await pg.registerCompositionPlan(f.plan);
      for (const table of ['composition_plans', 'composition_plan_segments'])
        for (const sql of [
          `UPDATE media.${table} SET composition_plan_id=composition_plan_id`,
          `DELETE FROM media.${table}`,
        ])
          await expect(db.query(sql)).rejects.toMatchObject({
            sqlState: 'P9005',
          });
    }));
  it.each(['header', 'payload', 'segment', 'lineage', 'inputs'])(
    'detects adulterated %s with the stored identity hash unchanged',
    async (target) =>
      usingComposition({}, async (f, pg) => {
        await pg.registerCompositionPlan(f.plan);
        await assertDisposableDatabase(db);
        const table =
          target === 'header' || target === 'payload'
            ? 'media.composition_plans'
            : target === 'segment'
              ? 'media.composition_plan_segments'
              : target === 'lineage'
                ? 'content.artifact_lineage'
                : 'content.artifact_lineage_inputs';
        const trigger =
          target === 'header' || target === 'payload'
            ? 'immutable_composition_plans'
            : target === 'segment'
              ? 'immutable_composition_segments'
              : target === 'lineage'
                ? 'immutable_artifact_lineage'
                : 'immutable_artifact_lineage_inputs';
        await db.transaction(async (client) => {
          await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
          if (target === 'header')
            await client.query(
              `UPDATE ${table} SET duration_milliseconds=4999 WHERE composition_plan_id=$1`,
              [f.plan.compositionPlanId],
            );
          else if (target === 'payload')
            await client.query(
              `UPDATE ${table} SET payload_json=pg_catalog.jsonb_set(payload_json::jsonb,'{createdAt}','"2026-10-12T00:00:00Z"'::jsonb)::json WHERE composition_plan_id=$1`,
              [f.plan.compositionPlanId],
            );
          else if (target === 'segment')
            await client.query(
              `UPDATE ${table} SET end_milliseconds=4999 WHERE composition_plan_id=$1`,
              [f.plan.compositionPlanId],
            );
          else
            await client.query(
              `UPDATE ${table} SET content_hash=$1 WHERE artifact_id=$2`,
              ['e'.repeat(64), f.plan.compositionPlanId],
            );
          await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        });
        await expect(
          pg.getCompositionPlan(f.plan.compositionPlanId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_COMPOSITION_PLAN' });
      }),
  );
  it.each(['voice_tracks', 'media_assets'])(
    'rejects insufficient commercial rights from a corrupted %s dependency',
    async (table) =>
      usingComposition({}, async (f, pg) => {
        await assertDisposableDatabase(db);
        const trigger =
          table === 'voice_tracks'
            ? 'immutable_voice_tracks'
            : 'immutable_assets';
        await db.transaction(async (client) => {
          await client.query(
            `ALTER TABLE media.${table} DISABLE TRIGGER ${trigger}`,
          );
          await client.query(
            `UPDATE media.${table} SET payload_json=pg_catalog.jsonb_set(payload_json::jsonb,'{rights,commercialUseAllowed}','false'::jsonb)::json`,
          );
          await client.query(
            `ALTER TABLE media.${table} ENABLE TRIGGER ${trigger}`,
          );
        });
        await expect(pg.registerCompositionPlan(f.plan)).rejects.toMatchObject({
          code:
            table === 'voice_tracks'
              ? 'INVALID_PERSISTED_VOICE_TRACK'
              : 'INVALID_PERSISTED_MEDIA_ASSET',
        });
        expect(await compositionCount()).toBe('0');
      }),
  );
  it('retains read-only/closed handles and keeps Nest startup idle with all opt-ins on one database', async () =>
    usingComposition({}, async (f) => {
      const ro = await new PostgresMediaCompositionPersistence(db).open(true);
      await expect(ro.registerCompositionPlan(f.plan)).rejects.toMatchObject({
        code: 'MEDIA_CATALOG_READ_ONLY',
      });
      await ro.close();
      await expect(
        ro.getCompositionPlan(f.plan.compositionPlanId),
      ).rejects.toMatchObject({ code: 'MEDIA_CATALOG_HANDLE_CLOSED' });
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
        expect(app.get(POSTGRES_MEDIA_COMPOSITION)).toBeInstanceOf(
          PostgresMediaCompositionPersistence,
        );
        expect(app.get(POSTGRES_MEDIA_CATALOG)).toBeDefined();
        expect(app.get(POSTGRES_MEDIA_VOICE)).toBeDefined();
      } finally {
        await app.close();
      }
    }));
});
