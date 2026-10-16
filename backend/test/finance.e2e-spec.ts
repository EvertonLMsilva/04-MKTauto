import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { FINANCE_DATABASE } from '../src/finance/finance.module.js';
import { FinanceSession } from '../src/finance/infrastructure/finance.session.js';
import {
  campaignFinanceFixture,
  cost,
  proof,
  time,
} from './support/finance-fixture.js';
describe('Finance HTTP without providers', () => {
  let f: ReturnType<typeof campaignFinanceFixture>, app: INestApplication<App>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(time));
    f = campaignFinanceFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FINANCE_DATABASE)
      .useValue(f.path)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    f.close();
    vi.useRealTimers();
  });
  it('records costs, preserves exact replay and exposes ordered history and ledgers', async () => {
    const http = app.getHttpServer(),
      value = cost();
    const created = await request(http)
      .post('/finance/costs')
      .send(value)
      .expect(201);
    expect(
      (await request(http).post('/finance/costs').send(value).expect(201)).body,
    ).toEqual(created.body);
    await request(http)
      .post('/finance/costs')
      .send({ ...value, amount: '0.2' })
      .expect(409);
    expect(
      (await request(http).get('/finance/costs/cost_001').expect(200)).body,
    ).toEqual(created.body);
    expect(
      (
        await request(http)
          .get('/finance/costs?pipelineRunId=run_001')
          .expect(200)
      ).body,
    ).toEqual([created.body]);
    expect(
      (await request(http).get('/finance/ledger/run_001').expect(200)).body
        .totalsByCurrency,
    ).toEqual([{ currency: 'USD', amount: '0.04' }]);
    expect(
      (await request(http).get('/finance/campaigns/camp_001/usage').expect(200))
        .body.committedUsd,
    ).toBe('0.04');
    expect(
      (await request(http).get('/finance/usage').expect(200)).body.policy
        .daily_usd,
    ).toBe('1');
  });
  it('reads persisted receipts and cached results without offering untrusted dispatch endpoints', async () => {
    const ts = new FinanceSession(f.path);
    try {
      await ts.executePaid(proof('a', '0.1'), async () => ({ mock: true }));
    } finally {
      ts.close();
    }
    const result = await request(app.getHttpServer())
      .get('/finance/operations/a')
      .expect(200);
    expect(result.body.state).toBe('COMPLETED');
    expect(JSON.parse(result.body.result_json)).toEqual({ mock: true });
    await request(app.getHttpServer())
      .post('/finance/reservations')
      .send(proof())
      .expect(404);
    await request(app.getHttpServer())
      .post('/finance/operations/a/dispatch')
      .send({})
      .expect(404);
  });
  it('rejects malformed costs and returns missing records as 404', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/finance/costs')
      .send({ ...cost(), amount: 0.1 })
      .expect(400);
    await request(http).get('/finance/costs/cost_absent').expect(404);
    await request(http).get('/finance/costs').expect(400);
    await request(http).get('/finance/ledger/run_absent').expect(404);
    await request(http).get('/finance/operations/absent').expect(404);
  });
});
