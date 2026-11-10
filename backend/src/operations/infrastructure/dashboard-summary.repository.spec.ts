import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteDashboardSummaryRepository } from './dashboard-summary.repository.js';
import { DashboardSummaryService } from '../dashboard-summary.service.js';

const roots: string[] = [];
const connections: DatabaseSync[] = [];
const now = () => new Date('2026-11-09T12:00:00.000Z');
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections.splice(0)) {
    if (db.isOpen) db.close();
  }
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !root.startsWith(join(tmpdir(), 'dashboard-summary-'))
    )
      throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(version = 41) {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-summary-'));
  roots.push(root);
  const path = join(root, 'isolated.sqlite');
  const db = new DatabaseSync(path);
  connections.push(db);
  db.exec(`
    PRAGMA user_version=${version};
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO schema_migrations VALUES(41,'041_campaign_orchestration'),
      (42,'042_instagram_publication'),(43,'043_multi_network_publication_reservations'),
      (44,'044_facebook_publication_supersession');
    CREATE TABLE campaign_executions(execution_id TEXT PRIMARY KEY,campaign_id TEXT,status TEXT);
    CREATE TABLE media_assets(media_asset_id TEXT PRIMARY KEY,origin TEXT,content_hash TEXT,media_reference TEXT,revision INTEGER);
    CREATE TABLE quality_control_reports(quality_control_report_id TEXT PRIMARY KEY,
      schema_version TEXT,policy_version TEXT,video_render_id TEXT,video_render_content_hash TEXT,
      result TEXT,approval_blocked INTEGER,checked_at TEXT,content_hash TEXT,payload_json TEXT);
    CREATE TABLE social_publication_context(singleton INTEGER PRIMARY KEY,execution_mode TEXT,database_id TEXT);
    CREATE TABLE social_publication_operations(operation_id TEXT PRIMARY KEY,package_hash TEXT,
      account_id TEXT,payload_json TEXT,root_operation_id TEXT);
    CREATE TABLE manual_distribution_records(kind TEXT,record_id TEXT,payload_json TEXT);
    CREATE TABLE p4_artifacts(kind TEXT,artifact_id TEXT,payload_json TEXT);
    CREATE TABLE human_approval_decisions(decision TEXT);
    CREATE TABLE fal_generations(generation_key TEXT,state TEXT,output_json TEXT);
  `);
  const summary = () =>
    new DashboardSummaryService(
      new SqliteDashboardSummaryRepository(path, now),
    ).summary();
  return { db, path, summary };
}

function qc(db: DatabaseSync, id: string, result: string, render = id) {
  const payload = {
    schemaVersion: 'quality-control-report/1.0.0',
    policyVersion: 'quality-control-policy/1.0.0',
    qualityControlReportId: id,
    videoRenderId: render,
    videoRenderContentHash: 'a'.repeat(64),
    result,
    approvalBlocked: result === 'FAIL',
    checkedAt: now().toISOString(),
    contentHash: 'b'.repeat(64),
  };
  db.prepare(
    'INSERT INTO quality_control_reports VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    payload.schemaVersion,
    payload.policyVersion,
    render,
    payload.videoRenderContentHash,
    result,
    Number(payload.approvalBlocked),
    payload.checkedAt,
    payload.contentHash,
    JSON.stringify(payload),
  );
}

function social(
  db: DatabaseSync,
  mode: 'fake' | 'live',
  id: string,
  state: string,
  root: string | null = null,
  mediaId = id,
) {
  db.prepare(
    'INSERT OR IGNORE INTO social_publication_context VALUES(1,?,?)',
  ).run(mode, 'isolated-source');
  db.prepare('INSERT INTO social_publication_operations VALUES(?,?,?,?,?)').run(
    id,
    'c'.repeat(64),
    '12345',
    JSON.stringify({
      operationId: id,
      accountId: '12345',
      packageHash: 'c'.repeat(64),
      executionMode: mode,
      databaseId: 'isolated-source',
      state,
      mediaId: state === 'PUBLISHED' ? mediaId : null,
      network: 'INSTAGRAM',
    }),
    root,
  );
}

test('counts every RUNNING execution beyond 100, never distinct campaigns or other states', () => {
  const f = fixture();
  const insert = f.db.prepare('INSERT INTO campaign_executions VALUES(?,?,?)');
  f.db.exec('BEGIN');
  for (let index = 0; index < 151; index++)
    insert.run(`run_${index}`, 'same_campaign', 'RUNNING');
  for (const state of [
    'SCHEDULED',
    'WAITING_INPUT',
    'WAITING_RECONCILIATION',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ])
    insert.run(state, state, state);
  f.db.exec('COMMIT');
  f.db.close();
  expect(f.summary()).toMatchObject({
    runningExecutions: 151,
    activeCampaigns: null,
    availability: {
      activeCampaigns: { reason: 'ACTIVE_CAMPAIGN_DEFINITION_REQUIRED' },
    },
  });
});

test('registered generated hashes, revisions, opaque references and completed jobs do not prove materialization', () => {
  const f = fixture();
  const insert = f.db.prepare('INSERT INTO media_assets VALUES(?,?,?,?,?)');
  insert.run(
    'first',
    'PROVIDER_GENERATED',
    'a'.repeat(64),
    `media:sha256_${'a'.repeat(64)}`,
    1,
  );
  insert.run(
    'revision',
    'PROVIDER_GENERATED',
    'a'.repeat(64),
    `media:sha256_${'a'.repeat(64)}`,
    2,
  );
  insert.run(
    'opaque',
    'PROVIDER_GENERATED',
    'b'.repeat(64),
    'opaque-reference',
    1,
  );
  insert.run('owned', 'OPERATOR_OWNED', 'c'.repeat(64), 'owned', 1);
  f.db.exec(
    "INSERT INTO fal_generations VALUES('completed_job','COMPLETED',NULL)",
  );
  f.db.close();
  expect(f.summary()).toMatchObject({
    generatedMedia: null,
    availability: {
      generatedMedia: { reason: 'MEDIA_MATERIALIZATION_NOT_PROVEN' },
    },
  });
});

test.each(['fake', 'live'] as const)(
  'published %s posts are isolated from other mode, manual records, states and attempts',
  (mode) => {
    const f = fixture();
    social(f.db, mode, 'published', 'PUBLISHED');
    for (const state of [
      'PREPARED',
      'CREATING_CONTAINER',
      'PROCESSING',
      'READY',
      'PUBLISHING',
      'UNCERTAIN',
      'FAILED',
      'EXPIRED',
      'BLOCKED',
    ])
      social(f.db, mode, state, state);
    f.db.exec(
      "INSERT INTO manual_distribution_records VALUES('PUBLICATION','manual','{}')",
    );
    f.db.close();
    const result = f.summary();
    expect(
      result[
        mode === 'fake' ? 'socialPublicationsFake' : 'socialPublicationsLive'
      ],
    ).toBe(1);
    expect(
      result[
        mode === 'fake' ? 'socialPublicationsLive' : 'socialPublicationsFake'
      ],
    ).toBeNull();
    expect(result.completedPublications).toBeNull();
    expect(result.scope.publicationMode).toBe(mode);
  },
);

test('supersession chain counts one published remote identity; competing roots are a conflict', () => {
  const f = fixture(44);
  social(f.db, 'fake', 'original', 'PUBLISHED', null, 'remote_post');
  social(f.db, 'fake', 'successor', 'PUBLISHED', 'original', 'remote_post');
  expect(f.summary().socialPublicationsFake).toBe(1);
  social(f.db, 'fake', 'unrelated', 'PUBLISHED', null, 'remote_post');
  f.db.close();
  expect(f.summary()).toMatchObject({
    socialPublicationsFake: null,
    availability: {
      socialPublicationsFake: { reason: 'PUBLICATION_IDENTITY_CONFLICT' },
    },
  });
});

test('mixed provenance and published posts without remote media identity are unavailable', () => {
  const f = fixture();
  social(f.db, 'fake', 'first', 'PUBLISHED');
  social(f.db, 'live', 'mixed', 'PUBLISHED');
  expect(f.summary().socialPublicationsFake).toBeNull();
  f.db.exec(
    'DELETE FROM social_publication_operations; DELETE FROM social_publication_context',
  );
  social(f.db, 'live', 'bad', 'PUBLISHED', null, '');
  f.db.close();
  expect(f.summary().socialPublicationsLive).toBeNull();
});

test.each(['operationId', 'accountId', 'packageHash'])(
  'mismatched persisted publication %s is unavailable',
  (field) => {
    const f = fixture();
    social(f.db, 'fake', 'published', 'PUBLISHED');
    f.db.prepare(
      "UPDATE social_publication_operations SET payload_json=json_set(payload_json,?, 'conflicting_identity')",
    ).run(`$.${field}`);
    f.db.close();
    expect(f.summary().availability.socialPublicationsFake.reason).toBe(
      'INVALID_PUBLICATION_SOURCE',
    );
  },
);

test('V1 QC counts PASS/WARN/FAIL and excludes P4, temporal and human approvals', () => {
  const f = fixture();
  qc(f.db, 'pass', 'PASS');
  qc(f.db, 'warn', 'WARN');
  qc(f.db, 'fail', 'FAIL');
  f.db.exec(
    "INSERT INTO p4_artifacts VALUES('qc_report','v2','{}'),('qc_report','temporal','{}'); INSERT INTO human_approval_decisions VALUES('APPROVED')",
  );
  f.db.close();
  expect(f.summary()).toMatchObject({
    qcApproved: 1,
    qcEvaluated: 3,
    qcApprovalRate: 100 / 3,
  });
});

test('empty verified source has zero counts but null QC percentage, not a fabricated zero rate', () => {
  const f = fixture();
  social(f.db, 'fake', 'failed', 'FAILED');
  f.db.close();
  expect(f.summary()).toMatchObject({
    runningExecutions: 0,
    socialPublicationsFake: 0,
    qcApproved: 0,
    qcEvaluated: 0,
    qcApprovalRate: null,
    availability: { qcApprovalRate: { reason: 'NO_QC_EVALUATIONS' } },
  });
});

test('duplicate QC identity and inconsistent persisted results are never silently combined', () => {
  const f = fixture();
  qc(f.db, 'one', 'PASS', 'same_render');
  qc(f.db, 'two', 'FAIL', 'same_render');
  expect(f.summary()).toMatchObject({
    qcApproved: null,
    qcEvaluated: null,
    qcApprovalRate: null,
  });
  f.db.exec('DELETE FROM quality_control_reports');
  qc(f.db, 'bad', 'PASS');
  f.db.exec("UPDATE quality_control_reports SET result='FAIL'");
  f.db.close();
  expect(f.summary().availability.qcEvaluated.reason).toBe('INVALID_QC_SOURCE');
});

test('missing configuration, file, incompatible schema and missing tables are distinct from empty data', () => {
  expect(
    new DashboardSummaryService(
      new SqliteDashboardSummaryRepository(null, now),
    ).summary().availability.runningExecutions.reason,
  ).toBe('DATABASE_NOT_CONFIGURED');
  const f = fixture();
  f.db.exec('DROP TABLE campaign_executions');
  expect(f.summary().runningExecutions).toBeNull();
  f.db.exec('PRAGMA user_version=40');
  expect(f.summary().availability.qcEvaluated.reason).toBe(
    'SCHEMA_INCOMPATIBLE',
  );
  f.db.close();
  expect(
    new SqliteDashboardSummaryRepository(
      join(f.path, 'missing.sqlite'),
      now,
    ).read().runningExecutions.reason,
  ).toBe('DATABASE_UNAVAILABLE');
});

test('one transaction preserves snapshot across counts while a separate connection commits changes', () => {
  const f = fixture();
  f.db.exec('PRAGMA journal_mode=WAL');
  qc(f.db, 'first', 'PASS');
  let wrote = false;
  const original = Object.getOwnPropertyDescriptor(
    DatabaseSync.prototype,
    'prepare',
  )!.value as DatabaseSync['prepare'];
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (!wrote && sql.includes('dashboard_qc')) {
      wrote = true;
      f.db.exec(
        "INSERT INTO campaign_executions VALUES('late','campaign','RUNNING')",
      );
      qc(f.db, 'late_qc', 'FAIL');
    }
    return original.call(this, sql);
  });
  expect(f.summary()).toMatchObject({ runningExecutions: 0, qcEvaluated: 1 });
  vi.restoreAllMocks();
  expect(f.summary()).toMatchObject({ runningExecutions: 1, qcEvaluated: 2 });
  f.db.close();
});

test('query does not alter SQLite bytes and exposes only safe logical sources', () => {
  const f = fixture();
  qc(f.db, 'safe', 'PASS');
  f.db.close();
  const digest = () =>
    createHash('sha256').update(readFileSync(f.path)).digest('hex');
  const before = digest();
  const result = f.summary();
  expect(digest()).toBe(before);
  expect(JSON.stringify(result)).not.toContain(f.path);
  expect(result.generatedAt).toBe(now().toISOString());
});
