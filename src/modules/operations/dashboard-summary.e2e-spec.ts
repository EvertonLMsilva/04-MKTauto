import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsModule } from './operations.module.js';
import { DashboardSummaryService } from './dashboard-summary.service.js';
import { SqliteDashboardSummaryRepository } from './infrastructure/dashboard-summary.repository.js';
import { LocalQcGuard } from '../publishing/application/local-qc.guard.js';
import {
  operationalQcIdentity,
  QcIdentityError,
} from '../publishing/application/local-qc-identity.js';

let app: INestApplication;
let root: string;
let path: string;
let before: string;
let reader: SqliteDashboardSummaryRepository;
const digest = () =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'summary-http-'));
  path = join(root, 'isolated.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA user_version=41;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT);
      INSERT INTO schema_migrations VALUES(41,'041_campaign_orchestration');
      CREATE TABLE campaign_executions(execution_id TEXT PRIMARY KEY,status TEXT);
      INSERT INTO campaign_executions VALUES('one','RUNNING'),('two','CANCELLED');`);
  } finally {
    db.close();
  }
  before = digest();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_HTTP_FORBIDDEN');
    }),
  );
  vi.spyOn(operationalQcIdentity, 'authenticate').mockImplementation(
    async (header) => {
      if (header !== 'Bearer isolated-fixture')
        throw new QcIdentityError('QC_AUTHENTICATION_REQUIRED', 401);
      return { id: 'isolated_operator', credentialHash: 'fixture-only' };
    },
  );
  reader = new SqliteDashboardSummaryRepository(path);
  const module = await Test.createTestingModule({
    controllers: [OperationsController],
    providers: [
      LocalQcGuard,
      { provide: OperationsService, useValue: {} },
      {
        provide: DashboardSummaryService,
        useValue: new DashboardSummaryService(reader),
      },
    ],
  }).compile();
  app = module.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (root) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !root.startsWith(join(tmpdir(), 'summary-http-'))
    )
      throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

test('authorized GET returns the versioned read-only contract with safe null reasons', async () => {
  const response = await request(app.getHttpServer())
    .get('/operations/dashboard/summary')
    .set('Authorization', 'Bearer isolated-fixture')
    .expect(200)
    .expect('Cache-Control', 'no-store');
  expect(response.body).toMatchObject({
    schemaVersion: 'operations-dashboard-summary/1.0.0',
    runningExecutions: 1,
    activeCampaigns: null,
    generatedMedia: null,
    completedPublications: null,
    scope: { source: 'PROJECT_API_DATABASE', access: 'local-qc-same-origin' },
    availability: {
      activeCampaigns: {
        status: 'UNAVAILABLE',
        reason: 'ACTIVE_CAMPAIGN_DEFINITION_REQUIRED',
      },
    },
  });
  expect(new Date(response.body.generatedAt).toISOString()).toBe(
    response.body.generatedAt,
  );
  expect(JSON.stringify(response.body)).not.toContain(path);
  expect(digest()).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});

test('real LocalQcGuard denies missing authorization before the repository opens', async () => {
  const read = vi.spyOn(reader, 'read');
  await request(app.getHttpServer())
    .get('/operations/dashboard/summary')
    .expect(401)
    .expect({ code: 'QC_AUTHENTICATION_REQUIRED' });
  expect(read).not.toHaveBeenCalled();
  expect(digest()).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});

test('legacy controller modules remain usable and the summary fails closed without its provider', async () => {
  await app.close();
  const module = await Test.createTestingModule({
    controllers: [OperationsController],
    providers: [LocalQcGuard, { provide: OperationsService, useValue: {} }],
  }).compile();
  app = module.createNestApplication();
  await app.init();
  const read = vi.spyOn(reader, 'read');
  await request(app.getHttpServer())
    .get('/operations/dashboard/summary')
    .set('Authorization', 'Bearer isolated-fixture')
    .expect(503)
    .expect('Cache-Control', 'no-store')
    .expect({ code: 'DASHBOARD_SUMMARY_UNAVAILABLE' });
  expect(read).not.toHaveBeenCalled();
  expect(digest()).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});

test('module registers the read service without opening a database during provider creation', () => {
  const providers = Reflect.getMetadata(
    'providers',
    OperationsModule,
  ) as Array<{ provide?: unknown; useFactory?: () => DashboardSummaryService }>;
  const provider = providers.find(
    (candidate) => candidate.provide === DashboardSummaryService,
  )!;
  const open = vi.spyOn(SqliteDashboardSummaryRepository.prototype, 'read');
  expect(provider.useFactory!()).toBeInstanceOf(DashboardSummaryService);
  expect(open).not.toHaveBeenCalled();
});
