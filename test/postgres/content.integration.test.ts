import { OperationsError } from '../../src/modules/content-operations/domain/operations-contracts.js';
import {
  affiliateHash,
  validateAffiliateBriefing,
} from '../../src/modules/affiliate/domain/affiliate-contracts.js';
import { scriptContentHash } from '../../src/modules/content/domain/script-contracts.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { CONTENT_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/content/infrastructure/postgres-content.migrations.js';
import { PostgresContentPersistence } from '../../src/modules/content/infrastructure/postgres-content.persistence.js';
import { ContentModule } from '../../src/modules/content/content.module.js';
import { ContentService } from '../../src/modules/content/application/content.service.js';
import { contentFixture, submission, script } from './content-fixture.js';
import { contentStore } from '../support/content-store.js';
import { OperationsPersistence } from '../../src/modules/content-operations/infrastructure/operations.persistence.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { selectionContentHash } from '../../src/modules/content/domain/idea-selection-contracts.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';

function selected(ideas: any[]) {
  const { idea, score } = ideas[0];
  const value = {
    schemaVersion: 'idea-selection/1.0.0',
    ideaSelectionId: 'selection_001',
    pipelineRunId: idea.pipelineRunId,
    projectId: idea.projectId,
    projectVersion: idea.projectVersion,
    ideaBatchId: idea.ideaBatchId,
    ideaCandidateId: idea.ideaCandidateId,
    ideaScoreId: score.ideaScoreId,
    ideaContentHash: idea.contentHash,
    ideaScoreContentHash: score.contentHash,
    decision: 'SELECTED' as const,
    actor: { type: 'HUMAN' as const, id: 'operator_001' },
    decidedAt: '2026-09-28T13:00:00.000Z',
    editorialRationale: 'Escolha editorial explícita',
    revision: 1,
    supersedesIdeaSelectionId: null,
    contentHash: '',
  };
  value.contentHash = selectionContentHash(value);
  return value;
}
async function failure(operation: () => unknown) {
  try {
    await operation();
    throw new Error('expected rejection');
  } catch (error: any) {
    return { code: error.code, field: error.field, message: error.message };
  }
}
describe('Content real PostgreSQL', () => {
  let database: PostgresDatabase;
  let fixture: ReturnType<typeof contentFixture>;
  let sqlite: ReturnType<ReturnType<typeof contentStore>['open']>;
  let persistence: PostgresContentPersistence;
  let deps: ConstructorParameters<typeof PostgresContentPersistence>[1];
  beforeAll(async () => {
    database = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(database);
  });
  beforeEach(async () => {
    await assertDisposableDatabase(database);
    for (const schema of ['content', 'research', 'project', 'platform'])
      await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await new PostgresMigrationRunner(database).migrate(migrations);
    fixture = contentFixture({ editorial: false });
    sqlite = contentStore(fixture.database).open();
    const operations = new OperationsPersistence(fixture.database).open(true);
    const run = operations.getRun(submission().pipelineRunId)!;
    operations.close();
    const shortlist = structuredClone(
      await sqlite.research.getShortlist(submission().researchShortlistId),
    );
    deps = {
      operations: {
        get: (id) => {
          if (id !== run.pipelineRunId)
            throw new OperationsError(
              'PIPELINE_RUN_NOT_FOUND',
              'pipelineRunId',
            );
          return structuredClone(run);
        },
      },
      affiliate: new AffiliateRunContextService(
        new SqliteAffiliateRunContextPersistence(fixture.database),
      ),
      research: {
        getShortlist: async (id) =>
          id === shortlist!.artifactId ? structuredClone(shortlist) : null,
        getInsight: async () => null,
      },
    };
    persistence = new PostgresContentPersistence(database, deps);
  });
  afterEach(() => {
    sqlite?.close();
    fixture?.close();
  });
  afterAll(async () => {
    await database?.close();
  });
  it('records unchanged v1/v2, v3 checksum, idempotent reexecution and transactional failed DDL', async () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3]);
    expect(
      (
        await database.query(
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
    expect(
      await new PostgresMigrationRunner(database).migrate(migrations),
    ).toEqual({ applied: [], currentVersion: 3 });
    await expect(
      new PostgresMigrationRunner(database).migrate([
        ...migrations,
        {
          version: 4,
          name: '004_failed_fixture',
          sql: 'CREATE TABLE content.rollback_probe(id integer); SELECT missing_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('content.rollback_probe') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    await expect(
      new PostgresMigrationRunner(database).migrate([
        ...migrations.slice(0, 2),
        { ...migrations[2], sql: migrations[2].sql + '\n-- drift' },
      ]),
    ).rejects.toThrow();
  });
  it('preserves exact ideas, scoring, selections, scripts, revisions, replay and lineage', async () => {
    const pg = await persistence.open();
    const ideas = await pg.registerBatch(submission());
    expect(ideas).toEqual(sqlite.registerBatch(submission()));
    expect(await pg.registerBatch(submission())).toEqual(ideas);
    const selection = selected(ideas);
    expect(await pg.registerSelection(selection)).toEqual(
      sqlite.registerSelection(selection),
    );
    expect(await pg.registerSelection(selection)).toEqual(selection);
    const value = script(selection);
    expect(await pg.registerScript(value)).toEqual(
      sqlite.registerScript(value),
    );
    const revision = script(selection, {
      scriptId: 'script_revision_2',
      revision: 2,
      supersedesScriptId: value.scriptId,
    });
    expect(await pg.registerScript(revision)).toEqual(
      sqlite.registerScript(revision),
    );
    expect(await pg.listScriptsBySelection(selection.ideaSelectionId)).toEqual(
      sqlite.listScriptsBySelection(selection.ideaSelectionId),
    );
    for (const table of ['artifact_lineage', 'artifact_lineage_inputs']) {
      const actual = (
        await database.query(`SELECT * FROM content.${table} ORDER BY 1,2`)
      ).rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'string' &&
            ['project_version', 'position', 'artifact_version'].includes(key)
              ? Number(value)
              : value,
          ]),
        ),
      );
      expect(actual).toEqual(
        sqlite.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all(),
      );
    }
    await pg.close();
    const recovered = await persistence.open();
    expect(await recovered.getScript(revision.scriptId)).toEqual(revision);
    await recovered.close();
  });
  it('preserves validation errors and missing reads', async () => {
    const pg = await persistence.open();
    for (const input of [
      { ...submission(), pipelineRunId: 'missing_run' },
      { ...submission(), researchShortlistId: 'missing_shortlist' },
      { ...submission(), proposals: [] },
      { ...submission(), projectVersion: 2 },
      { ...submission(), ideaBatchId: 'invalid space' },
    ])
      expect(await failure(() => pg.registerBatch(input))).toEqual(
        await failure(() => sqlite.registerBatch(input)),
      );
    expect(await pg.getIdeaWithScore('missing_001')).toBeNull();
    await pg.close();
  });
  it('serializes concurrent replay and rejects different content using same identity', async () => {
    const a = await persistence.open(),
      b = await persistence.open();
    const results = await Promise.all([
      a.registerBatch(submission()),
      b.registerBatch(submission()),
    ]);
    expect(results[0]).toEqual(results[1]);
    const changed = {
      ...submission(),
      proposals: [
        { ...submission().proposals[0], title: 'Outra ideia editorial' },
      ],
    };
    expect(await failure(() => a.registerBatch(changed))).toEqual(
      await failure(() => {
        sqlite.registerBatch(submission());
        return sqlite.registerBatch(changed);
      }),
    );
    expect(
      (await database.query('SELECT count(*) FROM content.idea_batches'))
        .rows[0].count,
    ).toBe('1');
    await a.close();
    await b.close();
  });
  it('rolls back all batch, score, evidence and lineage writes then retries', async () => {
    await database.query(
      "CREATE FUNCTION content.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON content.idea_scores FOR EACH ROW EXECUTE FUNCTION content.fixture_fail()",
    );
    const pg = await persistence.open();
    await expect(pg.registerBatch(submission())).rejects.toThrow();
    for (const table of [
      'idea_batches',
      'idea_candidates',
      'idea_scores',
      'artifact_lineage',
      'artifact_lineage_inputs',
    ])
      expect(
        (await database.query(`SELECT count(*) FROM content.${table}`)).rows[0]
          .count,
      ).toBe('0');
    await database.query('DROP TRIGGER fixture_fail ON content.idea_scores');
    expect(await pg.registerBatch(submission())).toEqual(
      sqlite.registerBatch(submission()),
    );
    await pg.close();
  });
  it('protects immutable history, FK, read-only and closed handles', async () => {
    const pg = await persistence.open();
    await pg.registerBatch(submission());
    await expect(
      database.query("UPDATE content.idea_batches SET origin='OPERATOR'"),
    ).rejects.toMatchObject({ sqlState: 'P3001' });
    await expect(
      database.query(
        "INSERT INTO content.idea_candidate_evidence VALUES ('missing_001','REFERENCE_EVIDENCE',1,'evidence_001')",
      ),
    ).rejects.toMatchObject({ sqlState: '23503' });
    const readonly = await persistence.open(true);
    await expect(
      readonly.registerBatch({ ...submission(), ideaBatchId: 'batch_new' }),
    ).rejects.toThrow();
    await readonly.close();
    await pg.close();
    await expect(pg.getIdeaWithScore('idea_candidate_1')).rejects.toThrow(
      'CONTENT_HANDLE_CLOSED',
    );
  });
  it('persists affiliate editorial evidence and commercial scripts with controlled read dependencies', async () => {
    const body = {
      schemaVersion: 'affiliate-briefing/1.0.0' as const,
      briefingId: 'brief_001',
      campaignId: 'campaign_001',
      campaignRevision: 1,
      productId: 'product_001',
      productRevision: 1,
      productName: 'Fone autorizado',
      attributes: [
        { name: 'connection', value: 'Bluetooth', evidenceRef: 'ev_spec' },
      ],
      mediaRefs: ['fixture:media'],
      cta: 'Confira o produto.',
      disclosure: 'Publicidade afiliada.',
      affiliateUrl: 'https://example.test/affiliate',
      evidence: [
        {
          id: 'ev_spec',
          kind: 'PRODUCT_SPECIFICATION' as const,
          sourceRef: 'fixture:spec',
          recordedAt: '2026-09-28T12:00:00Z',
        },
        {
          id: 'ev_rights',
          kind: 'MEDIA_USAGE_RIGHT' as const,
          sourceRef: 'fixture:rights',
          recordedAt: '2026-09-28T12:00:00Z',
        },
      ],
    };
    const briefing = validateAffiliateBriefing({
      ...body,
      contentHash: affiliateHash(body),
    });
    const affiliate = { resolveRunBriefing: () => briefing };
    const store = new PostgresContentPersistence(database, {
      ...deps,
      affiliate,
    });
    const pg = await store.open();
    const value = {
      schemaVersion: 'affiliate-editorial-selection/1.0.0',
      selectionId: 'editorial_001',
      pipelineRunId: submission().pipelineRunId,
      projectId: submission().projectId,
      projectVersion: 1,
      briefingId: briefing.briefingId,
      briefingHash: briefing.contentHash,
      evidenceRefs: ['ev_spec', 'ev_rights'],
      title: 'Conheça este fone',
      editorialAngle: 'Conectividade para o cotidiano',
      decision: 'SELECTED',
      actor: { type: 'HUMAN', id: 'operator_001' },
      decidedAt: '2026-09-28T13:00:00Z',
      contentHash: '',
    };
    value.contentHash = affiliateHash(value);
    expect(await pg.registerAffiliateEditorialSelection(value)).toEqual(value);
    expect(await pg.registerAffiliateEditorialSelection(value)).toEqual(value);
    const commercial = script(value, {
      schemaVersion: 'script/2.0.0',
      editorialSelectionId: value.selectionId,
      editorialSelectionContentHash: value.contentHash,
      cta: briefing.cta,
    });
    for (const key of [
      'ideaSelectionId',
      'ideaSelectionContentHash',
      'ideaCandidateId',
      'ideaContentHash',
    ])
      delete commercial[key];
    commercial.contentHash = scriptContentHash(commercial);
    expect(await pg.registerScript(commercial)).toEqual(commercial);
    expect(await pg.getScript(commercial.scriptId)).toEqual(commercial);
    const changed = { ...value, title: 'Outro título', contentHash: '' };
    changed.contentHash = affiliateHash(changed);
    await expect(
      pg.registerAffiliateEditorialSelection(changed),
    ).rejects.toMatchObject({ code: 'AFFILIATE_EDITORIAL_ID_REUSED' });
    await pg.close();
  });
  it('maps uniqueness errors safely and preserves JSON bytes and decimal score values', async () => {
    const pg = await persistence.open();
    const ideas = await pg.registerBatch(submission());
    sqlite.registerBatch(submission());
    const duplicate = { ...submission(), ideaBatchId: 'batch_duplicate' };
    expect(await failure(() => pg.registerBatch(duplicate))).toEqual(
      await failure(() => sqlite.registerBatch(duplicate)),
    );
    const row = (
      await database.query(
        'SELECT payload_json::text AS raw,total::text AS total FROM content.idea_scores',
      )
    ).rows[0];
    expect(row.raw).toBe(JSON.stringify(ideas[0].score));
    expect(Number(row.total)).toBe(ideas[0].score.total);
    const choice = selected(ideas);
    await pg.registerSelection(choice);
    sqlite.registerSelection(choice);
    const value = script(choice, { estimatedDurationSeconds: 30.125 });
    expect(await failure(() => pg.registerScript(value))).toEqual(
      await failure(() => sqlite.registerScript(value)),
    );
    await pg.close();
  });
  it('preserves multi-candidate scoring and deterministic historical order', async () => {
    const input = {
      ...submission(),
      proposals: [
        ...submission().proposals,
        {
          ...submission().proposals[0],
          ideaCandidateId: 'idea_candidate_2',
          title: 'Outra rotina com IA',
        },
      ],
    };
    const pg = await persistence.open();
    expect(await pg.registerBatch(input)).toEqual(sqlite.registerBatch(input));
    expect(await pg.listIdeasByPipelineRun(input.pipelineRunId)).toEqual(
      sqlite.listIdeasByPipelineRun(input.pipelineRunId),
    );
    await pg.close();
  });
  it('rejects lineage hash corruption and verifies migration identity before opening', async () => {
    const pg = await persistence.open();
    await pg.registerBatch(submission());
    await expect(
      database.query(
        "INSERT INTO content.artifact_lineage_inputs VALUES ('idea_candidate_1',9,'INTERNAL_ARTIFACT','idea-score:idea_candidate_1',$1)",
        ['f'.repeat(64)],
      ),
    ).rejects.toMatchObject({ sqlState: 'P3002' });
    await pg.close();
    await database.query(
      'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=3',
      ['0'.repeat(64)],
    );
    await expect(persistence.open()).rejects.toThrow(
      'CONTENT_SCHEMA_VERSION_UNSUPPORTED',
    );
  });
  it('supports NestJS opt-in HTTP and blocks cross-domain generation before effects', async () => {
    const module = await Test.createTestingModule({
      imports: [ContentModule.postgres(getTestPostgresConfig(), deps)],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const batch = await request(app.getHttpServer())
        .post('/content/idea-batches')
        .send(submission())
        .expect(201);
      expect(batch.body).toEqual(sqlite.registerBatch(submission()));
      await request(app.getHttpServer())
        .get('/content/ideas/missing_001')
        .expect(404);
      await request(app.getHttpServer())
        .post('/content/idea-batches')
        .send({ ...submission(), proposals: [] })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_IDEA_BATCH'));
      const selection = selected(batch.body);
      await request(app.getHttpServer())
        .post('/content/idea-selections')
        .send(selection)
        .expect(201);
      await request(app.getHttpServer())
        .post('/content/scripts')
        .send(script(selection))
        .expect(201);
      await request(app.getHttpServer())
        .post('/content/editorial-generations')
        .send({})
        .expect(409)
        .expect(({ body }) =>
          expect(body.code).toBe('CONTENT_CROSS_DOMAIN_TRANSACTION_REQUIRED'),
        );
      expect(app.get(ContentService)).toBeInstanceOf(ContentService);
    } finally {
      await app.close();
    }
  });
});
