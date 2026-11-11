import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MediaModule } from './media.module.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { migrateFinance40 } from '../finance/infrastructure/finance-schema-migration.js';
import { ttsFinanceFixture } from '../../../test/support/tts-finance-fixture.js';
import { time } from '../../../test/support/finance-fixture.js';

it('exposes only non-executing narration operations through the Media module', async () => {
  const f = ttsFinanceFixture();
  migrateFinance40(
    f.legacy.db,
    readFileSync(
      new URL(
        '../../infrastructure/database/migrations/040_financial_adjustments.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    time,
  );
  const module = await Test.createTestingModule({ imports: [MediaModule] })
    .overrideProvider(FINANCE_DATABASE)
    .useValue(f.path)
    .compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const finance = module.get(FinanceService),
      http = app.getHttpServer();
    const base = '/media/narrations';
    await request(http)
      .post(`${base}/preparations`)
      .send(f.plan)
      .expect(201)
      .expect((r) => expect(r.body.request).toEqual(f.request));
    for (let i = 0; i < 2; i++) {
      await request(http)
        .post(`${base}/approvals`)
        .send({ plan: f.plan, approval: f.approval })
        .expect(201)
        .expect((r) => expect(r.body).toEqual(f.approval));
    }
    await request(http).get(`${base}/tts_001`).expect(404);
    // Seed historical metadata only; no synthesis or dispatch is performed.
    finance.beginTts(f.plan, time);
    finance.markTtsUnknown('tts_001', 'TTS_TIMEOUT');
    const unknown = finance.getTts('tts_001');
    await request(http)
      .get(`${base}/tts_001`)
      .expect(200)
      .expect((r) => expect(r.body).toEqual(unknown));
    await request(http)
      .post(`${base}/tts_001/reconciliations`)
      .send({ evidenceReference: 'fixture/reconcile' })
      .expect(409);
    await request(http)
      .post(`${base}/tts_001/reconciliations`)
      .send({ evidenceReference: ' ' })
      .expect(409);
    expect(finance.getTts('tts_001')).toEqual(unknown);
    finance.recordTtsResult('tts_001', {
      audio: f.audio,
      billing: { actualCostUsd: '0.004', evidenceReference: 'fixture/invoice' },
    });
    await request(http)
      .get(`${base}/tts_001`)
      .expect(200)
      .expect((r) => expect(r.body.audio).toEqual(f.audio));
    for (let i = 0; i < 2; i++) {
      await request(http)
        .post(`${base}/tts_001/reconciliations`)
        .send({ evidenceReference: 'fixture/reconcile' })
        .expect(201)
        .expect((r) => expect(r.body.state).toBe('COMPLETED'));
    }
    await request(http)
      .post(`${base}/tts_001/reconciliations`)
      .send({ evidenceReference: 'fixture/other' })
      .expect(409);
    await request(http)
      .post(`${base}/approvals`)
      .send({
        plan: f.plan,
        approval: { ...f.approval, requestHash: 'a'.repeat(64) },
      })
      .expect(400);
    await request(http).get(`${base}/invalid!`).expect(400);
    await request(http)
      .post(`${base}/tts_001/reconciliations`)
      .send({ evidenceReference: 'fixture/ref', audio: f.audio })
      .expect(400);
    for (const path of ['dispatch', 'execute', 'submit', 'results'])
      await request(http).post(`${base}/tts_001/${path}`).send({}).expect(404);
    expect(finance.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
    expect(f.legacy.db.prepare('PRAGMA user_version').get().user_version).toBe(
      40,
    );
  } finally {
    await app.close();
    f.close();
  }
});
