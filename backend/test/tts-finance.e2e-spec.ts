import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FinanceModule,
  FINANCE_DATABASE,
} from '../src/finance/finance.module.js';
import { FinanceService } from '../src/finance/application/finance.service.js';
import { ttsFinanceFixture } from './support/tts-finance-fixture.js';
import { time } from './support/finance-fixture.js';

it('exposes TTS financial evidence through Nest without offering paid HTTP dispatch', async () => {
  const f = ttsFinanceFixture();
  const module = await Test.createTestingModule({ imports: [FinanceModule] })
    .overrideProvider(FINANCE_DATABASE)
    .useValue(f.path)
    .compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const finance = module.get(FinanceService),
      http = app.getHttpServer();
    finance.approveTts(f.plan, f.approval);
    finance.beginTts(f.plan, time);
    await request(http)
      .get('/finance/tts/tts_001')
      .expect(200)
      .expect((r) => {
        expect(r.body.state).toBe('SUBMITTING');
        expect(r.body.billing).toBeNull();
        expect(r.body.request.guaranteedMaximum).toBe(false);
      });
    expect(() => finance.dispatchTts('tts_001', time)).toThrow(
      expect.objectContaining({ code: 'TTS_FINANCIAL_GUARANTEE_REQUIRED' }),
    );
    await request(http)
      .post('/finance/tts/tts_001/dispatch')
      .send({})
      .expect(404);
    finance.markTtsUnknown('tts_001', 'TTS_TIMEOUT');
    finance.recordTtsResult('tts_001', {
      audio: f.audio,
      billing: { actualCostUsd: '0.004', evidenceReference: 'fixture/invoice' },
    });
    const reconciled = finance.reconcileTts(
      'tts_001',
      'fixture/reconciliation',
    );
    await request(http)
      .get('/finance/tts/tts_001')
      .expect(200)
      .expect((r) => expect(r.body).toEqual(reconciled));
    await request(http)
      .get('/finance/ledger/run_001')
      .expect(200)
      .expect((r) => expect(r.body.events).toHaveLength(1));
    await request(http).get('/finance/tts/absent').expect(404);
    await request(http).get('/finance/tts/invalid!').expect(400);
  } finally {
    await app.close();
    f.close();
  }
});
