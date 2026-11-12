import {
  PostgresDatabase,
  PostgresMigrationRunner,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_SUBTITLE_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-subtitle.migrations.js';
import { PostgresMediaSubtitlePersistence } from '../../src/modules/media/infrastructure/postgres-media-subtitle.persistence.js';
import { PostgresMediaRenderPersistence } from '../../src/modules/media/infrastructure/postgres-media-render.persistence.js';
import { subtitleFixture } from './media-subtitle-fixture.js';
import {
  getTestPostgresConfig,
  assertDisposableDatabase,
} from './test-database.js';
import {
  documentBytes,
  digest,
} from '../../src/modules/media/infrastructure/local-evidence-storage.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';
import { p4Metadata } from './media-render-fixture.js';

describe('Burn-in strict PostgreSQL lineage', () => {
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
  async function usingBurn(
    work: (
      f: Awaited<ReturnType<typeof subtitleFixture>>,
      r: Awaited<ReturnType<PostgresMediaRenderPersistence['open']>>,
    ) => Promise<void>,
  ) {
    await new PostgresMigrationRunner(db).migrate(migrations);
    const f = await subtitleFixture(db),
      sub = await new PostgresMediaSubtitlePersistence(db, f.proof).open();
    try {
      await sub.registerLocalSubtitle(
        f.subtitleDocumentHash,
        f.alignmentDocumentHash,
      );
    } finally {
      await sub.close();
    }
    const r = await new PostgresMediaRenderPersistence(db, f.proof).open();
    try {
      await work(f, r);
    } finally {
      await r.close();
      f.close();
    }
  }
  const count = async () =>
    (await db.query('SELECT count(*) FROM media.video_render_burnins')).rows[0]
      .count;
  it.each(['missing', 'supersession', 'revision', 'dimensions', 'identity'])(
    'rejects invalid burn-in %s without bindings or render orphans',
    async (mode) =>
      usingBurn(async (f, r) => {
        const value = {
          ...f.burned,
          ...(mode === 'supersession'
            ? { supersedesVideoRenderId: 'render_missing' }
            : {}),
          ...(mode === 'revision' ? { revision: 3 } : {}),
          ...(mode === 'dimensions'
            ? { widthPixels: 720, heightPixels: 1280 }
            : {}),
          ...(mode === 'identity'
            ? { videoRenderId: 'render_wrong_local_identity' }
            : {}),
        };
        await expect(
          r.registerBurned(
            value,
            mode === 'missing' ? 'subtitle_missing' : f.subtitle.subtitleId,
          ),
        ).rejects.toThrow();
        expect(await count()).toBe('0');
        expect(await r.getVideoRender(f.burned.videoRenderId)).toBeNull();
      }),
  );
  it('rejects conflicting replay and serializes concurrent exact burn-in replays', async () =>
    usingBurn(async (f, a) => {
      const b = await new PostgresMediaRenderPersistence(db, f.proof).open();
      try {
        expect(
          await Promise.all([
            a.registerBurned(f.burned, f.subtitle.subtitleId),
            b.registerBurned(f.burned, f.subtitle.subtitleId),
          ]),
        ).toEqual([f.burned, f.burned]);
        await expect(
          a.registerBurned(
            { ...f.burned, contentHash: 'e'.repeat(64) },
            f.subtitle.subtitleId,
          ),
        ).rejects.toMatchObject({ code: 'VIDEO_RENDER_ID_REUSED' });
        expect(await count()).toBe('1');
      } finally {
        await b.close();
      }
    }));
  it('recovers subtitle proof and both render versions after pool restart without enabling generic P4', async () =>
    usingBurn(async (f, r) => {
      await r.registerBurned(f.burned, f.subtitle.subtitleId);
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const other = await new PostgresMediaRenderPersistence(
          restarted,
          f.proof,
        ).open();
        try {
          expect(await other.getVideoRender(f.source.videoRenderId)).toEqual(
            f.source,
          );
          expect(await other.getVideoRender(f.burned.videoRenderId)).toEqual(
            f.burned,
          );
          expect(
            await other.registerBurned(f.burned, f.subtitle.subtitleId),
          ).toEqual(f.burned);
          await expect(
            other.registerVideoRender(p4Metadata(f.source)),
          ).rejects.toMatchObject({
            code: 'MEDIA_RENDER_P4_DEPENDENCY_REQUIRED',
          });
        } finally {
          await other.close();
        }
      } finally {
        await restarted.close();
      }
    }));
  it('rolls back the binding, render and lineage on intermediate SQL failure and before outer commit', async () =>
    usingBurn(async (f, r) => {
      await expect(
        db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
          await r.registerBurned(f.burned, f.subtitle.subtitleId);
          throw new Error('before_commit');
        }),
      ).rejects.toThrow('before_commit');
      expect(await count()).toBe('0');
      expect(await r.getVideoRender(f.burned.videoRenderId)).toBeNull();
      await db.query(`CREATE FUNCTION media.fixture_burn_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1199',MESSAGE='burn_fixture_failure'; END $$;
   CREATE TRIGGER fixture_burn_failure BEFORE INSERT ON media.video_renders FOR EACH ROW EXECUTE FUNCTION media.fixture_burn_failure();`);
      await expect(
        r.registerBurned(f.burned, f.subtitle.subtitleId),
      ).rejects.toMatchObject({ code: 'VIDEO_RENDER_PERSISTENCE_FAILED' });
      expect(await count()).toBe('0');
      expect(
        (
          await db.query(
            'SELECT count(*) FROM content.artifact_lineage WHERE artifact_id=$1',
            [f.burned.videoRenderId],
          )
        ).rows[0].count,
      ).toBe('0');
    }));
  it.each([
    'missing',
    'order',
    'extra',
    'sourceHash',
    'subtitleHash',
    'metadata',
  ])(
    'SQL rejects %s in the exact three-entry canonical SQLite lineage',
    async (mode) =>
      usingBurn(async (f) => {
        f.voiceNative.transaction(() =>
          f.voiceNative.registerBurned(
            f.burned,
            f.subtitle.subtitleId,
            f.evidenceFiles,
          ),
        );
        const native = f.voiceNative.db;
        const row = {
          ...native
            .prepare('SELECT * FROM artifact_lineage WHERE artifact_id=?')
            .get(f.burned.videoRenderId),
        };
        const render = {
          ...native
            .prepare('SELECT * FROM video_renders WHERE video_render_id=?')
            .get(f.burned.videoRenderId),
        };
        let inputs = native
          .prepare(
            'SELECT * FROM artifact_lineage_inputs WHERE artifact_id=? ORDER BY position',
          )
          .all(f.burned.videoRenderId)
          .map((x: any) => ({ ...x }));
        if (mode === 'missing') inputs = inputs.slice(0, 2);
        if (mode === 'order')
          inputs = [inputs[2], inputs[1], inputs[0]].map(
            (x: any, i: number) => ({ ...x, position: i + 1 }),
          );
        if (mode === 'extra')
          inputs.push({
            ...inputs[1],
            position: 4,
            input_id: f.voice.voiceTrackId,
            content_hash: f.voice.contentHash,
          });
        if (mode === 'sourceHash') inputs[1].content_hash = 'e'.repeat(64);
        if (mode === 'subtitleHash') inputs[2].content_hash = 'e'.repeat(64);
        if (mode === 'metadata')
          row.generation_metadata_json = JSON.stringify({
            ...JSON.parse(row.generation_metadata_json),
            provider: 'untrusted',
          });
        await expect(
          db.transaction(async (client) => {
            const insert = async (
              table: string,
              columns: Record<string, unknown>,
            ) =>
              client.query(
                `INSERT INTO ${table}(${Object.keys(columns).join(',')}) VALUES(${Object.keys(
                  columns,
                )
                  .map((_, i) => `$${i + 1}`)
                  .join(',')})`,
                Object.values(columns),
              );
            await insert('media.video_render_burnins', {
              video_render_id: f.burned.videoRenderId,
              source_render_id: f.source.videoRenderId,
              subtitle_id: f.subtitle.subtitleId,
              document_hash: digest(documentBytes(f.burned)),
            });
            await insert('content.artifact_lineage', row);
            for (const input of inputs)
              await insert('content.artifact_lineage_inputs', input);
            await insert('media.video_renders', render);
          }),
        ).rejects.toMatchObject({
          // The shared Content trigger rejects wrong parent hashes before the render trigger.
          sqlState:
            mode === 'sourceHash' || mode === 'subtitleHash'
              ? 'P3002'
              : 'P1001',
        });
        expect(await count()).toBe('0');
      }),
  );
  it('rejects bindings with orphan subtitles and keeps accepted burn-in bindings immutable', async () =>
    usingBurn(async (f, r) => {
      await expect(
        db.query('INSERT INTO media.video_render_burnins VALUES($1,$2,$3,$4)', [
          f.burned.videoRenderId,
          f.source.videoRenderId,
          'subtitle_missing',
          digest(documentBytes(f.burned)),
        ]),
      ).rejects.toMatchObject({ sqlState: '23503' });
      await r.registerBurned(f.burned, f.subtitle.subtitleId);
      for (const sql of [
        'UPDATE media.video_render_burnins SET subtitle_id=subtitle_id',
        'DELETE FROM media.video_render_burnins',
      ])
        await expect(db.query(sql)).rejects.toMatchObject({
          sqlState: 'P1103',
        });
    }));
  it('rejects attaching burn-in metadata to a preexisting normal render', async () =>
    usingBurn(async (f, r) => {
      const next = {
        ...f.source,
        videoRenderId: 'normal_other_revision',
        revision: 2,
        supersedesVideoRenderId: f.source.videoRenderId,
      };
      await r.registerVideoRender(next);
      await expect(
        db.query('INSERT INTO media.video_render_burnins VALUES($1,$2,$3,$4)', [
          next.videoRenderId,
          f.source.videoRenderId,
          f.subtitle.subtitleId,
          digest(documentBytes(next)),
        ]),
      ).rejects.toMatchObject({ sqlState: 'P1104' });
      expect(await count()).toBe('0');
    }));
  it('detects changed metadata on reads instead of accepting a cached lineage hash', async () =>
    usingBurn(async (f, r) => {
      await r.registerBurned(f.burned, f.subtitle.subtitleId);
      await db.transaction(async (client) => {
        await client.query(
          'ALTER TABLE content.artifact_lineage DISABLE TRIGGER immutable_artifact_lineage',
        );
        await client.query(
          "UPDATE content.artifact_lineage SET generation_metadata_json=pg_catalog.jsonb_set(generation_metadata_json::jsonb,'{provider}','\"untrusted\"'::jsonb)::json WHERE artifact_id=$1",
          [f.burned.videoRenderId],
        );
        await client.query(
          'ALTER TABLE content.artifact_lineage ENABLE TRIGGER immutable_artifact_lineage',
        );
      });
      await expect(
        r.getVideoRender(f.burned.videoRenderId),
      ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_VIDEO_RENDER' });
    }));
});
