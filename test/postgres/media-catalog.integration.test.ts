import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/media/infrastructure/postgres-media-catalog.migrations.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { PostgresMediaCatalogPersistence } from '../../src/modules/media/infrastructure/postgres-media-catalog.persistence.js';
import {
  MediaPostgresModule,
  POSTGRES_MEDIA_CATALOG,
} from '../../src/modules/media/media-postgres.module.js';
import {
  mediaCatalogFixture,
  catalogAsset,
  licensedAsset,
  acquisition,
  selection,
  mediaRun,
  researchScriptFixture,
} from './media-catalog-fixture.js';
import { mediaAssetIdentityHash } from '../../src/modules/media/domain/media-asset-contracts.js';
import { mediaSelectionRequestHash } from '../../src/modules/media/domain/media-selection-contracts.js';
import { mediaAcquisitionRequestHash } from '../../src/modules/media/domain/media-acquisition-contracts.js';
import { MEDIA_CATALOG_PARTICIPANTS } from '../../src/modules/media/infrastructure/postgres-media-catalog.session.js';
describe('Media Catalog PostgreSQL real', () => {
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
  it('appends v7, preserves checksums v1-v6 and reexecutes without drift', async () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
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
      currentVersion: 7,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 6),
        { ...migrations[6], sql: migrations[6].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
  });
  it('rolls back v7 schema and the canonical lineage trigger on failed DDL', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 6));
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 6),
        {
          ...migrations[6],
          sql: migrations[6].sql + '\nSELECT missing_media_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT pg_catalog.to_regnamespace('media') AS schema"))
        .rows[0].schema,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname='media_lineage_owner'",
        )
      ).rows[0].count,
    ).toBe('0');
  });
  describe('atomic catalog operations', () => {
    let f: Awaited<ReturnType<typeof mediaCatalogFixture>>,
      store: PostgresMediaCatalogPersistence;
    beforeEach(async () => {
      await new PostgresMigrationRunner(db).migrate(migrations);
      f = await mediaCatalogFixture(db);
      store = new PostgresMediaCatalogPersistence(db);
    });
    afterEach(() => {
      f?.native.close();
      f?.cleanup();
    });
    const lineageRows = async (id: string) =>
      (
        await db.query(
          'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
          [id],
        )
      ).rows;
    it('registers canonical assets and exact lineage in the same transaction with SQLite parity', async () => {
      const pg = await store.open();
      try {
        const asset = catalogAsset(f.script);
        expect(await pg.registerMediaAsset(asset)).toEqual(
          f.native.registerMediaAsset(asset),
        );
        expect(await pg.getMediaAsset(asset.mediaAssetId)).toEqual(
          f.native.getMediaAsset(asset.mediaAssetId),
        );
        expect(await pg.listMediaAssetsByPipelineRun(mediaRun)).toEqual(
          f.native.listMediaAssetsByPipelineRun(mediaRun),
        );
        expect(await pg.listMediaAssetsByScript(f.script.scriptId)).toEqual(
          f.native.listMediaAssetsByScript(f.script.scriptId),
        );
        expect(
          await pg.listMediaAssetsByVisualDirection(f.script.scriptId, 1),
        ).toEqual(
          f.native.listMediaAssetsByVisualDirection(f.script.scriptId, 1),
        );
        const row = (await lineageRows(asset.mediaAssetId))[0];
        expect(
          (
            await db.query(
              'SELECT identity_hash FROM media.media_assets WHERE media_asset_id=$1',
              [asset.mediaAssetId],
            )
          ).rows[0].identity_hash,
        ).toBe(mediaAssetIdentityHash(asset));
        const native = f.native.getArtifact(asset.mediaAssetId)!;
        expect(row.identity_hash).toBe(
          createHash('sha256').update(JSON.stringify(native)).digest('hex'),
        );
        expect(
          (
            await db.query(
              'SELECT position::integer AS position,kind,input_id AS "inputId",content_hash AS "contentHash" FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
              [asset.mediaAssetId],
            )
          ).rows,
        ).toEqual(native.inputs);
      } finally {
        await pg.close();
      }
    });
    it('preserves licensed VIDEO provenance, rights and physical hashes without remote acquisition', async () => {
      const fetch = vi.fn(() => {
        throw new Error('EXTERNAL_EFFECT_FORBIDDEN');
      });
      vi.stubGlobal('fetch', fetch);
      const pg = await store.open();
      try {
        const asset = licensedAsset(f.script);
        expect(await pg.registerMediaAsset(asset)).toEqual(
          f.native.registerMediaAsset(asset),
        );
        expect(await pg.getMediaAsset(asset.mediaAssetId)).toEqual(asset);
        expect(
          (
            await db.query(
              'SELECT provider,external_asset_id FROM media.media_asset_sources',
            )
          ).rows,
        ).toEqual([
          {
            provider: asset.provider,
            external_asset_id: asset.source!.externalAssetId,
          },
        ]);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await pg.close();
      }
    });
    it('rejects commercial rights, provenance and physical identity violations before any lineage write', async () => {
      const pg = await store.open();
      try {
        for (const [asset, code] of [
          [
            catalogAsset(f.script, {
              rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
            }),
            'COMMERCIAL_USE_REQUIRED',
          ],
          [
            catalogAsset(f.script, {
              rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
            }),
            'RIGHTS_ORIGIN_MISMATCH',
          ],
          [
            catalogAsset(f.script, {
              mediaReference: `media:sha256_${'b'.repeat(64)}`,
            }),
            'MEDIA_IDENTITY_INVALID',
          ],
          [
            licensedAsset(f.script, {
              source: {
                ...licensedAsset(f.script).source!,
                licenseUrl: 'http://example.com/license',
              },
            }),
            'INVALID_SOURCE_URL',
          ],
        ] as const)
          await expect(pg.registerMediaAsset(asset)).rejects.toMatchObject({
            code,
          });
        expect(
          (await db.query('SELECT count(*) FROM media.media_assets')).rows[0]
            .count,
        ).toBe('0');
        expect(
          (
            await db.query(
              "SELECT count(*) FROM content.artifact_lineage WHERE artifact_type='media_asset'",
            )
          ).rows[0].count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('rejects wrong run/project/script hash and direction while preserving the SQLite error contracts', async () => {
      const pg = await store.open();
      try {
        for (const [asset, code] of [
          [
            catalogAsset(f.script, { pipelineRunId: 'run_missing' }),
            'PIPELINE_RUN_NOT_FOUND',
          ],
          [
            catalogAsset(f.script, { projectVersion: 2 }),
            'MEDIA_ASSET_RUN_SCOPE_MISMATCH',
          ],
          [
            catalogAsset(f.script, { scriptId: 'script_missing' }),
            'SCRIPT_NOT_FOUND',
          ],
          [
            catalogAsset(f.script, { scriptContentHash: 'd'.repeat(64) }),
            'SCRIPT_CONTENT_HASH_MISMATCH',
          ],
          [
            catalogAsset(f.script, { visualDirectionPosition: 77 }),
            'VISUAL_DIRECTION_NOT_FOUND',
          ],
        ] as const) {
          await expect(pg.registerMediaAsset(asset)).rejects.toMatchObject({
            code,
          });
          expect(() => f.native.registerMediaAsset(asset)).toThrow(
            expect.objectContaining({ code }),
          );
        }
      } finally {
        await pg.close();
      }
    });
    it('preserves valid revisions/supersession and deterministic ordering with SQLite', async () => {
      const pg = await store.open();
      try {
        const first = catalogAsset(f.script);
        const second = catalogAsset(f.script, {
          mediaAssetId: 'media_revision_002',
          revision: 2,
          supersedesMediaAssetId: first.mediaAssetId,
          contentHash: 'b'.repeat(64),
          mediaReference: `media:sha256_${'b'.repeat(64)}`,
        });
        for (const asset of [first, second])
          expect(await pg.registerMediaAsset(asset)).toEqual(
            f.native.registerMediaAsset(asset),
          );
        expect(await pg.listMediaAssetsByScript(f.script.scriptId)).toEqual(
          f.native.listMediaAssetsByScript(f.script.scriptId),
        );
        expect(
          (
            await db.query(
              'SELECT input_id,content_hash FROM content.artifact_lineage_inputs WHERE artifact_id=$1 AND position=2',
              [second.mediaAssetId],
            )
          ).rows,
        ).toEqual([
          { input_id: first.mediaAssetId, content_hash: first.contentHash },
        ]);
        await expect(
          pg.registerMediaAsset({
            ...second,
            mediaAssetId: 'media_revision_duplicate',
          }),
        ).rejects.toMatchObject({ code: 'MEDIA_ASSET_REVISION_CONFLICT' });
        await expect(
          pg.registerMediaAsset({
            ...second,
            mediaAssetId: 'media_revision_missing',
            revision: 3,
            supersedesMediaAssetId: 'missing_asset',
          }),
        ).rejects.toMatchObject({ code: 'SUPERSEDED_MEDIA_ASSET_NOT_FOUND' });
      } finally {
        await pg.close();
      }
    });
    it('registers acquisition and gets the same receipt/replay as SQLite', async () => {
      const pg = await store.open();
      try {
        const request = acquisition(f.script);
        const asset = catalogAsset(f.script, {
          mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
        });
        const input = { request, mediaAsset: asset };
        expect(await pg.registerAcquiredMediaAsset(input)).toEqual(
          f.native.registerAcquiredMediaAsset(input),
        );
        expect(
          await pg.getMediaAcquisition(request.mediaAcquisitionRequestId),
        ).toEqual(
          f.native.getMediaAcquisition(request.mediaAcquisitionRequestId),
        );
        expect(await pg.registerAcquiredMediaAsset(input)).toEqual(asset);
        expect(await pg.getMediaAcquisition('missing_acquisition')).toBeNull();
        const changed = { ...request, requestedAt: '2026-10-12T12:00:00.000Z' };
        changed.contentHash = mediaAcquisitionRequestHash(changed);
        await expect(
          pg.registerAcquiredMediaAsset({
            request: changed,
            mediaAsset: asset,
          }),
        ).rejects.toMatchObject({
          code: 'MEDIA_ACQUISITION_REQUEST_ID_REUSED',
        });
      } finally {
        await pg.close();
      }
    });
    it('rejects acquisition binding/Finance dependency and rolls back a failed acquisition receipt', async () => {
      const pg = await store.open();
      try {
        const request = acquisition(f.script),
          asset = catalogAsset(f.script, {
            mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
          });
        await expect(
          pg.registerAcquiredMediaAsset({
            request,
            mediaAsset: { ...asset, createdAt: '2026-10-12T12:00:00.000Z' },
          }),
        ).rejects.toMatchObject({ code: 'MEDIA_ACQUISITION_SCOPE_MISMATCH' });
        await expect(
          pg.registerAcquiredMediaAsset({
            request,
            mediaAsset: asset,
            telemetry: {},
          }),
        ).rejects.toMatchObject({ code: 'MEDIA_FINANCE_DEPENDENCY_REQUIRED' });
        await db.query(
          "CREATE FUNCTION media.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_receipt BEFORE INSERT ON media.media_acquisition_requests FOR EACH ROW EXECUTE FUNCTION media.fail_receipt()",
        );
        await expect(
          pg.registerAcquiredMediaAsset({ request, mediaAsset: asset }),
        ).rejects.toMatchObject({ code: 'MEDIA_ASSET_PERSISTENCE_FAILED' });
        expect(await lineageRows(asset.mediaAssetId)).toEqual([]);
        expect(await pg.getMediaAsset(asset.mediaAssetId)).toBeNull();
      } finally {
        await pg.close();
      }
    });
    it('preserves selection receipts, replay and the explicit VIDEO to IMAGE fallback with SQLite', async () => {
      const pg = await store.open();
      try {
        const asset = catalogAsset(f.script);
        await pg.registerMediaAsset(asset);
        f.native.registerMediaAsset(asset);
        const request = selection(
          f.script,
          'selection_fallback',
          'MIXED_MEDIA_V2',
        );
        const input = {
          request,
          mediaAsset: asset,
          fallbackCode: 'PROVIDER_NO_ELIGIBLE_VIDEO',
        };
        expect(await pg.registerMediaSelection(input)).toEqual(
          f.native.registerMediaSelection(input),
        );
        expect(
          await pg.getMediaSelection(request.mediaSelectionRequestId),
        ).toEqual(f.native.getMediaSelection(request.mediaSelectionRequestId));
        expect(await pg.registerMediaSelection(input)).toEqual(asset);
        const changed = { ...request, requestedAt: '2026-10-12T12:00:00Z' };
        changed.contentHash = mediaSelectionRequestHash(changed);
        await expect(
          pg.registerMediaSelection({ ...input, request: changed }),
        ).rejects.toMatchObject({ code: 'MEDIA_SELECTION_REQUEST_ID_REUSED' });
      } finally {
        await pg.close();
      }
    });
    it('rejects selection fallback/scope mismatches without mutating an existing asset', async () => {
      const pg = await store.open();
      try {
        const asset = catalogAsset(f.script);
        await pg.registerMediaAsset(asset);
        const request = selection(
          f.script,
          'selection_invalid',
          'MIXED_MEDIA_V2',
        );
        await expect(
          pg.registerMediaSelection({ request, mediaAsset: asset }),
        ).rejects.toMatchObject({ code: 'MEDIA_SELECTION_FALLBACK_INVALID' });
        await expect(
          pg.registerMediaSelection({
            request,
            mediaAsset: { ...asset, scriptContentHash: 'd'.repeat(64) },
          }),
        ).rejects.toMatchObject({
          code: 'MEDIA_SELECTION_SCOPE_MISMATCH',
          field: 'mediaAsset',
        });
        expect(
          (
            await db.query(
              'SELECT count(*) FROM media.media_selection_requests',
            )
          ).rows[0].count,
        ).toBe('0');
        expect(await pg.getMediaAsset(asset.mediaAssetId)).toEqual(asset);
      } finally {
        await pg.close();
      }
    });
    it('rolls back lineage/inputs after a failure between lineage and asset, then recovers cleanly', async () => {
      await db.query(
        "CREATE FUNCTION media.fail_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_asset BEFORE INSERT ON media.media_assets FOR EACH ROW EXECUTE FUNCTION media.fail_asset()",
      );
      const pg = await store.open();
      try {
        const asset = licensedAsset(f.script);
        await expect(pg.registerMediaAsset(asset)).rejects.toMatchObject({
          code: 'MEDIA_ASSET_PERSISTENCE_FAILED',
        });
        for (const table of ['media_assets', 'media_asset_sources'])
          expect(
            (await db.query(`SELECT count(*) FROM media.${table}`)).rows[0]
              .count,
          ).toBe('0');
        expect(await lineageRows(asset.mediaAssetId)).toEqual([]);
        expect(
          (
            await db.query(
              'SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=$1',
              [asset.mediaAssetId],
            )
          ).rows[0].count,
        ).toBe('0');
        await db.query('DROP TRIGGER fail_asset ON media.media_assets');
        expect(await pg.registerMediaAsset(asset)).toEqual(asset);
      } finally {
        await pg.close();
      }
    });
    it('forbids orphan Media lineage even through a direct SQL commit', async () => {
      await expect(
        db.query(
          "INSERT INTO content.artifact_lineage SELECT 'orphan_media','artifact-lineage/1.0.0','media_asset',1,identity_hash,pipeline_run_id,project_id,project_version,'media:orphan','sha256',content_hash,NULL,created_at FROM content.artifact_lineage WHERE artifact_type='script' LIMIT 1",
        ),
      ).rejects.toMatchObject({ sqlState: 'P7004' });
      expect(await lineageRows('orphan_media')).toEqual([]);
    });
    it('serializes concurrent workers: one logical revision/receipt, exact idempotent replay', async () => {
      const a = await store.open(),
        b = await store.open();
      try {
        const asset = catalogAsset(f.script);
        const results = await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            (i % 2 ? a : b).registerMediaAsset(asset),
          ),
        );
        for (const result of results) expect(result).toEqual(asset);
        await expect(
          a.registerMediaAsset({
            ...asset,
            contentHash: 'b'.repeat(64),
            mediaReference: `media:sha256_${'b'.repeat(64)}`,
          }),
        ).rejects.toMatchObject({ code: 'MEDIA_ASSET_ID_REUSED' });
        const conflict = await Promise.allSettled([
          a.registerMediaAsset(
            catalogAsset(f.script, {
              mediaAssetId: 'revision_002_a',
              revision: 2,
              supersedesMediaAssetId: asset.mediaAssetId,
            }),
          ),
          b.registerMediaAsset(
            catalogAsset(f.script, {
              mediaAssetId: 'revision_002_b',
              revision: 2,
              supersedesMediaAssetId: asset.mediaAssetId,
            }),
          ),
        ]);
        expect(conflict.filter((r) => r.status === 'fulfilled')).toHaveLength(
          1,
        );
        expect(conflict.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { code: 'MEDIA_ASSET_REVISION_CONFLICT' },
        });
        expect(
          (await db.query('SELECT count(*) FROM media.media_assets')).rows[0]
            .count,
        ).toBe('2');
      } finally {
        await a.close();
        await b.close();
      }
    });
    it('keeps assets, sources, acquisition/selection receipts immutable at SQL level', async () => {
      const pg = await store.open();
      try {
        const request = acquisition(f.script, 'acq_video_001', 'VIDEO'),
          asset = licensedAsset(f.script, {
            mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
          });
        await pg.registerAcquiredMediaAsset({ request, mediaAsset: asset });
        await pg.registerMediaSelection({
          request: selection(f.script, 'select_video_001', 'MIXED_MEDIA_V2'),
          mediaAsset: asset,
        });
        for (const [table, column] of [
          ['media_assets', 'media_asset_id'],
          ['media_asset_sources', 'media_asset_id'],
          ['media_acquisition_requests', 'media_acquisition_request_id'],
          ['media_selection_requests', 'media_selection_request_id'],
        ])
          for (const sql of [
            `UPDATE media.${table} SET ${column}=${column}`,
            `DELETE FROM media.${table}`,
          ])
            await expect(db.query(sql)).rejects.toMatchObject({
              sqlState: 'P7006',
            });
      } finally {
        await pg.close();
      }
    });
    it('recreates the pool and recovers the same receipt and lineage identity', async () => {
      const first = new PostgresDatabase(getTestPostgresConfig());
      await assertDisposableDatabase(first);
      const repo = await new PostgresMediaCatalogPersistence(first).open();
      const request = acquisition(f.script),
        asset = catalogAsset(f.script, {
          mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
        });
      await repo.registerAcquiredMediaAsset({ request, mediaAsset: asset });
      const receipt = await repo.getMediaAcquisition(
        request.mediaAcquisitionRequestId,
      );
      await repo.close();
      await first.close();
      const restarted = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restarted);
        const other = await new PostgresMediaCatalogPersistence(
          restarted,
        ).open();
        try {
          expect(
            await other.registerAcquiredMediaAsset({
              request,
              mediaAsset: asset,
            }),
          ).toEqual(asset);
          expect(
            await other.getMediaAcquisition(request.mediaAcquisitionRequestId),
          ).toEqual(receipt);
        } finally {
          await other.close();
        }
      } finally {
        await restarted.close();
      }
    });
    it('shares one physical connection/BEGIN/COMMIT with canonical Content lineage', async () => {
      let pool!: Pool;
      const observed = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (options) => (pool = new Pool(options)),
      );
      try {
        await assertDisposableDatabase(observed);
        const repo = await new PostgresMediaCatalogPersistence(observed).open();
        const client = await pool.connect();
        const queries = vi.spyOn(client, 'query');
        client.release();
        const connects = vi.spyOn(pool, 'connect'),
          independent = vi.spyOn(pool, 'query');
        await repo.registerMediaAsset(catalogAsset(f.script));
        expect(connects).toHaveBeenCalledTimes(1);
        expect(independent).not.toHaveBeenCalled();
        const sql = queries.mock.calls.map(([q]) =>
          typeof q === 'string' ? q : (q as any).text,
        );
        expect(sql.filter((t) => t === 'BEGIN')).toHaveLength(1);
        expect(sql.filter((t) => t === 'COMMIT')).toHaveLength(1);
        expect(sql.filter((t) => t === 'ROLLBACK')).toHaveLength(0);
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
        await repo.close();
      } finally {
        vi.restoreAllMocks();
        await observed.close();
      }
    });
    it('joins an explicit four-domain unit and rolls back all Media/lineage state on outer failure', async () => {
      const pg = await store.open();
      try {
        await expect(
          db.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, async () => {
            await pg.registerMediaAsset(catalogAsset(f.script));
            throw new Error('outer_failure');
          }),
        ).rejects.toThrow('outer_failure');
        expect(await pg.getMediaAsset('media_asset_001')).toBeNull();
        expect(await lineageRows('media_asset_001')).toEqual([]);
        await expect(
          db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
            pg.registerMediaAsset(catalogAsset(f.script)),
          ),
        ).rejects.toMatchObject({
          code: 'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
        });
      } finally {
        await pg.close();
      }
    });
    it('preserves read-only/closed handles and does not add producers, providers or migrations at Nest startup', async () => {
      const pg = await store.open(true);
      await expect(
        pg.registerMediaAsset(catalogAsset(f.script)),
      ).rejects.toMatchObject({ code: 'MEDIA_CATALOG_READ_ONLY' });
      expect(await pg.getMediaAsset('media_asset_001')).toBeNull();
      await pg.close();
      await expect(pg.getMediaAsset('media_asset_001')).rejects.toMatchObject({
        code: 'MEDIA_CATALOG_HANDLE_CLOSED',
      });
      const idle = new PostgresDatabase(getTestPostgresConfig());
      const queries = vi.spyOn(idle, 'query'),
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
        expect(app.get(POSTGRES_MEDIA_CATALOG)).toBeInstanceOf(
          PostgresMediaCatalogPersistence,
        );
      } finally {
        await app.close();
      }
    });
    it('detects corrupted lineage columns instead of trusting its unchanged identity_hash', async () => {
      const pg = await store.open();
      try {
        const asset = catalogAsset(f.script);
        await pg.registerMediaAsset(asset);
        await assertDisposableDatabase(db);
        await db.transaction(async (client) => {
          await client.query(
            'ALTER TABLE content.artifact_lineage DISABLE TRIGGER immutable_artifact_lineage',
          );
          await client.query(
            'UPDATE content.artifact_lineage SET content_hash=$1 WHERE artifact_id=$2',
            ['b'.repeat(64), asset.mediaAssetId],
          );
          await client.query(
            'ALTER TABLE content.artifact_lineage ENABLE TRIGGER immutable_artifact_lineage',
          );
        });
        await expect(
          pg.getMediaAsset(asset.mediaAssetId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_MEDIA_ASSET' });
      } finally {
        await pg.close();
      }
    });
    it('detects corrupted provenance instead of replaying a valid payload with divergent source rows', async () => {
      const pg = await store.open();
      try {
        const asset = licensedAsset(f.script);
        await pg.registerMediaAsset(asset);
        await assertDisposableDatabase(db);
        await db.transaction(async (client) => {
          await client.query(
            'ALTER TABLE media.media_asset_sources DISABLE TRIGGER immutable_sources',
          );
          await client.query(
            "UPDATE media.media_asset_sources SET external_asset_id='corrupt_fixture'",
          );
          await client.query(
            'ALTER TABLE media.media_asset_sources ENABLE TRIGGER immutable_sources',
          );
        });
        await expect(
          pg.getMediaAsset(asset.mediaAssetId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_MEDIA_ASSET' });
        await expect(pg.registerMediaAsset(asset)).rejects.toMatchObject({
          code: 'INVALID_PERSISTED_MEDIA_ASSET',
        });
      } finally {
        await pg.close();
      }
    });
    it('replays acquisition and selection receipts under concurrent workers without duplicates', async () => {
      const a = await store.open(),
        b = await store.open();
      try {
        const request = acquisition(f.script),
          asset = catalogAsset(f.script, {
            mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
          });
        const acquired = await Promise.all([
          a.registerAcquiredMediaAsset({ request, mediaAsset: asset }),
          b.registerAcquiredMediaAsset({ request, mediaAsset: asset }),
        ]);
        expect(acquired).toEqual([asset, asset]);
        const selected = selection(f.script);
        expect(
          await Promise.all([
            a.registerMediaSelection({ request: selected, mediaAsset: asset }),
            b.registerMediaSelection({ request: selected, mediaAsset: asset }),
          ]),
        ).toEqual([asset, asset]);
        expect(
          (
            await db.query(
              'SELECT count(*) FROM media.media_acquisition_requests',
            )
          ).rows[0].count,
        ).toBe('1');
        expect(
          (
            await db.query(
              'SELECT count(*) FROM media.media_selection_requests',
            )
          ).rows[0].count,
        ).toBe('1');
      } finally {
        await a.close();
        await b.close();
      }
    });
    it('fails closed for a Content row outside the supported coordinated script composition', async () => {
      const existingScript = await researchScriptFixture(db);
      const pg = await store.open();
      try {
        await expect(
          pg.registerMediaAsset(catalogAsset(existingScript)),
        ).rejects.toMatchObject({ code: 'MEDIA_CONTENT_CONTEXT_REQUIRED' });
        expect(
          (await db.query('SELECT count(*) FROM media.media_assets')).rows[0]
            .count,
        ).toBe('0');
      } finally {
        await pg.close();
      }
    });
    it('rejects checksum drift without provisioning or selecting SQLite', async () => {
      await db.query(
        'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=7',
        ['a'.repeat(64)],
      );
      await expect(store.open()).rejects.toMatchObject({
        code: 'MEDIA_CATALOG_SCHEMA_VERSION_UNSUPPORTED',
      });
    });
  });
});
