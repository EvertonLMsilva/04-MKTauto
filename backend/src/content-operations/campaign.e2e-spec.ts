import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignOrchestrator } from './application/campaign-orchestrator.js';
import { CampaignError } from './domain/campaign.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import {
  p2EditorialFixture,
  p2FinancialProof,
} from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignOrchestrationModule } from './campaign-orchestration.module.js';
import {
  CampaignAdministration,
  CAMPAIGN_DATABASE,
} from './application/campaign-administration.js';
import { CONTENT_DATABASE } from '../content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../research/infrastructure/research-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from './application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { MEDIA_DATABASE } from '../media/infrastructure/media.persistence.js';
import { PUBLISHING_DATABASE } from '../publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import {
  FakeEditorialProvider,
  UnavailableEditorialProvider,
} from '../content/infrastructure/fake-editorial.provider.js';
import { FinanceService } from '../finance/application/finance.service.js';

describe('P4 native HTTP and Content/Research/Affiliate/Finance integration', () => {
  let f: ReturnType<typeof p2EditorialFixture>,
    app: INestApplication,
    service: CampaignAdministration;
  const provider = new FakeEditorialProvider();
  let body: Record<string, unknown>;
  beforeEach(async () => {
    f = p2EditorialFixture();
    const db = new DatabaseSync(f.database);
    provisionSchema(db);
    db.close();
    let builder = Test.createTestingModule({
      imports: [CampaignOrchestrationModule],
    });
    for (const token of [
      CAMPAIGN_DATABASE,
      CONTENT_DATABASE,
      AFFILIATE_DATABASE,
      PROJECT_DATABASE,
      RESEARCH_DATABASE,
      CONTENT_OPERATIONS_DATABASE,
      FINANCE_DATABASE,
      MEDIA_DATABASE,
      PUBLISHING_DATABASE,
    ])
      builder = builder.overrideProvider(token).useValue(f.database);
    const module = await builder
      .overrideProvider(EDITORIAL_PROVIDER)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
    service = module.get(CampaignAdministration);
    body = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      scheduledAt: '2026-10-14T12:00:00Z',
      runId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: f.shortlist.artifactId,
      generationRequestId: 'p4_editorial_001',
      mode: 'LOCAL_VALIDATION',
    };
  });
  afterEach(async () => {
    await app.close();
    f.cleanup();
  });
  const base = '/content-operations/campaign-executions';
  it('schedules, replays, persists real native editorial checkpoints and waits for audio', async () => {
    const first = await request(app.getHttpServer())
      .post(base)
      .send(body)
      .expect(201);
    const id = first.body.execution_id;
    await request(app.getHttpServer())
      .post(base)
      .send(body)
      .expect(201)
      .expect((r) => expect(r.body.execution_id).toBe(id));
    await Promise.all([service.tick(), service.tick()]);
    await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('WAITING_INPUT'));
    const history = await request(app.getHttpServer())
      .get(`${base}/${id}/history`)
      .expect(200);
    expect(
      history.body.some(
        (h: { event_type: string; evidence: { step: string } }) =>
          h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
      ),
    ).toBe(true);
    const db = new DatabaseSync(f.database, { readOnly: true });
    try {
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n FROM scripts WHERE script_id='script:p4_editorial_001'",
          )
          .get()?.n,
      ).toBe(1);
      expect(db.prepare('SELECT COUNT(*) n FROM cost_events').get()?.n).toBe(0);
    } finally {
      db.close();
    }
    await request(app.getHttpServer()).post(`${base}/${id}/resume`).expect(201);
    await service.tick();
    expect(
      service
        .history(id)
        .filter(
          (h) =>
            h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
        ),
    ).toHaveLength(1);
    await request(app.getHttpServer()).post(`${base}/${id}/cancel`).expect(201);
    await request(app.getHttpServer()).post(`${base}/${id}/resume`).expect(409);
    await request(app.getHttpServer())
      .get(`${base}/missing_execution`)
      .expect(404);
    await request(app.getHttpServer())
      .post(base)
      .send({ ...body, runId: 'different_run' })
      .expect(409);
    await request(app.getHttpServer())
      .post(base)
      .send({ ...body, paid: true })
      .expect(400);
  });
  it('blocks fake editorial in production', async () => {
    const e = await service.schedule({ ...body, mode: 'PRODUCTION' });
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'EDITORIAL_REAL_PROVIDER_REQUIRED',
    );
  });
  it('persists unavailable provider without fabricated completion', async () => {
    const spy = vi
      .spyOn(provider, 'ideas')
      .mockImplementation(() => new UnavailableEditorialProvider().ideas());
    try {
      const e = await service.schedule(body);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'EDITORIAL_PROVIDER_UNAVAILABLE',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('preserves UNKNOWN and never dispatches paid editorial', async () => {
    const finance = app.get(FinanceService),
      proof = { ...p2FinancialProof(), operationId: 'p4_editorial_001' };
    finance.reserveGlobal(proof, new Date().toISOString());
    finance.dispatchGlobal(proof.operationId);
    finance.unknownGlobal(proof.operationId);
    const spy = vi.spyOn(provider, 'ideas');
    try {
      const e = await service.schedule(body);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
      expect(spy).not.toHaveBeenCalled();
      expect(finance.getGlobalOperation(proof.operationId)?.state).toBe(
        'UNKNOWN',
      );
      await expect(service.resume(e.execution_id)).rejects.toThrow(
        'RECONCILIATION_REQUIRED',
      );
      finance.settleGlobal(proof.operationId, {
        actualCostUsd: '0.6',
        evidenceReference: 'fixture:verified-billing',
      });
      await service.resume(e.execution_id);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(finance.getGlobalOperation(proof.operationId)?.state).toBe(
        'COMPLETED',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['DAILY', 'MONTHLY'])(
    'respects actual Finance %s commitments without calling providers',
    async (period) => {
      const finance = app.get(FinanceService);
      if (period === 'MONTHLY')
        finance.configureGlobal({
          dailyUsd: '1',
          monthlyUsd: '0.6',
          timeZone: 'America/Sao_Paulo',
        });
      finance.reserveGlobal(
        {
          ...p2FinancialProof(),
          operationId: 'budget_commitment',
          maximumAmount: period === 'DAILY' ? '1' : '0.6',
        },
        new Date().toISOString(),
      );
      const spy = vi.spyOn(provider, 'ideas');
      try {
        const e = await service.schedule(body);
        await service.tick();
        expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
        expect(JSON.stringify(service.history(e.execution_id))).toContain(
          `GLOBAL_${period}_BUDGET_EXCEEDED`,
        );
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('reconciles a crash after the native editorial effect and before its campaign checkpoint', async () => {
    const e = await service.schedule(body),
      db = new DatabaseSync(f.database),
      r = new CampaignRepository(db);
    let now = new Date().toISOString();
    const workflow = app.get(NativeCampaignWorkflow),
      runner = new CampaignOrchestrator(r, workflow, () => now, 1000);
    const write = r.ownedEvent.bind(r),
      scriptSpy = vi.spyOn(provider, 'script');
    const checkpointSpy = vi
      .spyOn(r, 'ownedEvent')
      .mockImplementation((...args) => {
        if (args[3] === 'STEP_DONE' && args[4].step === 'EDITORIAL')
          throw new CampaignError('CLAIM_LOST');
        return write(...args);
      });
    try {
      await runner.tick();
      expect(r.get(e.execution_id).status).toBe('RUNNING');
      checkpointSpy.mockRestore();
      now = new Date(Date.parse(now) + 2000).toISOString();
      r.recover(now);
      await runner.resume(e.execution_id);
      await runner.tick();
      expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(scriptSpy).toHaveBeenCalledTimes(1);
      expect(
        r
          .history(e.execution_id)
          .filter(
            (h) =>
              h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
          ),
      ).toHaveLength(1);
    } finally {
      checkpointSpy.mockRestore();
      scriptSpy.mockRestore();
      db.close();
    }
  });

  it('accepts missing input references on resume and protects completed stages', async () => {
    const e = await service.schedule(body);
    await service.tick();
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ generationRequestId: 'another_script' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ voiceTrackId: 'authorized_audio_pending' })
      .expect(201);
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'LOCAL_AUDIO_NOT_FOUND',
    );
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ voiceTrackId: 'replacement_voice' })
      .expect(409);
  });
});
