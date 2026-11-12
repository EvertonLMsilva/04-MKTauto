import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from './operations.module.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import {
  operationalQcIdentity,
  QcIdentityError,
} from '../publishing/application/local-qc-identity.js';
import { localMediaReadiness } from '../media/application/local-media-readiness.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';

let app: INestApplication;
let f: ReturnType<typeof p2EditorialFixture>;
let id: string;
let original: string;
const digest = () =>
  createHash('sha256').update(readFileSync(f.database)).digest('hex');
beforeEach(async () => {
  f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const setupFinance = new FinanceSession(f.database);
  try {
    setupFinance.configureGlobal();
  } finally {
    setupFinance.close();
  }
  const e = new CampaignRepository(f.base.db).schedule(
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'run_preflight',
      scheduledAt: '2026-11-11T12:00:00Z',
    },
    { mode: 'LOCAL_VALIDATION', videoProduction: { mode: 'LOCAL_IMAGES' } },
    '2026-11-11T12:00:00Z',
  );
  id = e.execution_id;
  for (const [k, v] of Object.entries({
    PROJECT_API_DATABASE: f.database,
    SOCIAL_HISTORY_DATABASE: f.database,
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    CONTENT_EDITORIAL_PROVIDER: 'fake',
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_FORBIDDEN');
    }),
  );
  vi.spyOn(operationalQcIdentity, 'authenticate').mockImplementation(
    async (header) => {
      if (header !== 'Bearer isolated-fixture')
        throw new QcIdentityError('QC_AUTHENTICATION_REQUIRED', 401);
      return { id: 'fixture_reader', credentialHash: 'fixture-only' };
    },
  );
  const module = await Test.createTestingModule({
    imports: [OperationsModule],
  }).compile();
  app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
  // Actual module and Finance reader; only local resource inspection is replaced with an offline double.
  vi.spyOn(app.get(LocalFlowService), 'readiness').mockReturnValue(
    localMediaReadiness(),
  );
  original = digest();
});
afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  f?.cleanup();
});
const read = (execution = id) =>
  request(app.getHttpServer())
    .get(`/operations/executions/${execution}/preflight`)
    .set('Authorization', 'Bearer isolated-fixture');
test('real SQLite HTTP reads replay without writes, claims, reservations, effects or notifications', async () => {
  expect(app.get(FinanceService).getGlobalReadiness().status).toBe('READY');
  const finance = vi.spyOn(app.get(FinanceService), 'getGlobalReadiness');
  const campaigns = app.get(CampaignAdministration);
  const before = campaigns.history(id);
  const a = await read().expect(200).expect('Cache-Control', 'no-store');
  const b = await read().expect(200);
  expect(b.body).toEqual(a.body);
  expect(a.body.schemaVersion).toBe('operations-preflight/1.0.0');
  expect(a.body.state).toBe('SCHEDULED');
  expect(a.body.finance.status).toBe('READY');
  expect(a.body.finance.spendingAuthorized).toBe(false);
  expect(a.body.media.status).toBe('UNKNOWN');
  expect(finance).toHaveBeenCalledTimes(2);
  expect(campaigns.history(id)).toEqual(before);
  expect(digest()).toBe(original);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(a.body)).not.toMatch(
    /claim_token|evidenceReference|credentialHash|catalog.sqlite/,
  );
});
test('QC authentication is mandatory and not-found is sanitized', async () => {
  await request(app.getHttpServer())
    .get(`/operations/executions/${id}/preflight`)
    .expect(401);
  await read('missing_execution').expect(404);
  expect(digest()).toBe(original);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('missing Finance policy stays UNKNOWN and the read never configures defaults', async () => {
  f.base.db.exec('DELETE FROM global_finance_policy');
  const before = digest();
  const response = await read().expect(200);
  expect(response.body.finance.status).toBe('UNKNOWN');
  expect(response.body.finance.daily).toBeNull();
  expect(response.body.finance.spendingAuthorized).toBe(false);
  expect(digest()).toBe(before);
});
