import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FinanceModule,
  FINANCE_DATABASE,
} from '../src/finance/finance.module.js';
import { FinanceService } from '../src/finance/application/finance.service.js';
import { migrateFinance40 } from '../src/finance/infrastructure/finance-schema-migration.js';
import { ttsFinanceFixture } from './support/tts-finance-fixture.js';
import { time } from './support/finance-fixture.js';

it('keeps the immutable V1 ledger and exposes reconciled V2 net amounts on schema 40', async () => {
  const f = ttsFinanceFixture();
  f.gate.approveTts(f.plan, f.approval);
  f.gate.beginTts(f.plan, time);
  f.gate.finishTts('tts_001', 'UNKNOWN');
  f.gate.accountTts('tts_001');
  const original = f.legacy.getCostLedgerByPipelineRun('run_001');
  migrateFinance40(
    f.legacy.db,
    readFileSync(
      new URL(
        '../../src/db/migrations/040_financial_adjustments.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    time,
  );
  const module = await Test.createTestingModule({ imports: [FinanceModule] })
    .overrideProvider(FINANCE_DATABASE)
    .useValue(f.path)
    .compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const finance = module.get(FinanceService);
    finance.recordTtsResult('tts_001', {
      audio: f.audio,
      billing: { actualCostUsd: '0.001', evidenceReference: 'fixture/invoice' },
    });
    finance.reconcileTts('tts_001', 'fixture/reconciliation');
    const http = app.getHttpServer();
    await request(http)
      .get('/finance/ledger/run_001')
      .expect(200)
      .expect((r) => expect(r.body).toEqual(original));
    await request(http)
      .get('/finance/ledger-v2/run_001')
      .expect(200)
      .expect((r) => {
        expect(r.body.schemaVersion).toBe('cost-ledger/2.0.0');
        expect(r.body.totalsByCurrency).toEqual([
          { currency: 'USD', amount: '0.001' },
        ]);
        expect(r.body.adjustments).toHaveLength(1);
        expect(r.body.reconciliations[0].reconciliationState).toBe(
          'RECONCILED',
        );
      });
    await request(http)
      .get('/finance/tts/tts_001/statement')
      .expect(200)
      .expect((r) => expect(r.body.netCostUsd).toBe('0.001'));
    await request(http)
      .post('/finance/tts/tts_001/dispatch')
      .send({})
      .expect(404);
  } finally {
    await app.close();
    f.close();
  }
});
