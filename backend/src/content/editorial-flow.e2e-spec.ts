import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import {
  p2EditorialFixture,
  p2FinancialProof as proof,
  P2_TIME as time,
} from '../../test/support/p2-editorial-fixture.js';
import { ContentModule } from './content.module.js';
import { CONTENT_DATABASE } from './infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../research/infrastructure/research-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from '../content-operations/application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { EDITORIAL_PROVIDER } from './application/editorial-provider.port.js';
import {
  FakeEditorialProvider,
  UnavailableEditorialProvider,
} from './infrastructure/fake-editorial.provider.js';

describe('Editorial Nest HTTP cutover with schema 40', () => {
  let app: INestApplication;
  let f: ReturnType<typeof p2EditorialFixture>;
  let provider: FakeEditorialProvider;
  const input = {
    generationRequestId: 'gen_http_001',
    pipelineRunId: 'run_e04_001',
    briefingId: 'brief_http_001',
    researchShortlistId: 'research-shortlist:001',
    referenceInsightId: 'reference-insight:001',
    requestedAt: '2026-10-14T12:00:00Z',
    supersedesScriptId: null,
  };
  beforeEach(async () => {
    f = p2EditorialFixture({
      pipelineRunId: input.pipelineRunId,
      projectId: 'project_curiosidades_ia',
      briefingId: input.briefingId,
      references: true,
    });
    input.researchShortlistId = f.shortlist.artifactId;
    provider = new FakeEditorialProvider();
    let builder = Test.createTestingModule({ imports: [ContentModule] });
    for (const token of [
      CONTENT_DATABASE,
      AFFILIATE_DATABASE,
      PROJECT_DATABASE,
      RESEARCH_DATABASE,
      CONTENT_OPERATIONS_DATABASE,
      FINANCE_DATABASE,
    ])
      builder = builder.overrideProvider(token).useValue(f.database);
    const module = await builder
      .overrideProvider(EDITORIAL_PROVIDER)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    f?.cleanup();
  });
  it('produces and replays editorial artifacts from real Research and Affiliate public readers', async () => {
    const spy = vi.spyOn(provider, 'script');
    const first = await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].references?.artifactId).toBe(
      input.referenceInsightId,
    );
    expect(first.body.script.origin).toBe('AUTOMATION');
    expect(first.body.script.reviewFlags).toContain('HUMAN_REVIEW_REQUIRED');
    const saved = await request(app.getHttpServer())
      .get(`/content/scripts/${first.body.script.scriptId}`)
      .expect(200);
    expect(saved.body).toEqual(first.body.script);
    const db = new DatabaseSync(f.database, { readOnly: true });
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(40);
      expect(db.prepare('SELECT COUNT(*) AS n FROM cost_events').get()?.n).toBe(
        0,
      );
      const researchEvidence = JSON.parse(
        String(
          db
            .prepare(
              "SELECT result_json FROM pipeline_stage_attempts WHERE stage='RESEARCH'",
            )
            .get()?.result_json,
        ),
      );
      expect(researchEvidence.value.references.artifactId).toBe(
        input.referenceInsightId,
      );
    } finally {
      db.close();
    }
  });
  it('blocks paid dispatch with insufficient budget and UNKNOWN; fake still works', async () => {
    const finance = app.get(FinanceService);
    finance.configureGlobal({ dailyUsd: '0.01', monthlyUsd: '0.01' });
    expect(() =>
      finance.reserveGlobal(
        { ...proof(), operationId: input.generationRequestId },
        time,
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'GLOBAL_DAILY_BUDGET_EXCEEDED' }),
    );
    provider.mode = 'PAID';
    const spy = vi.spyOn(provider, 'ideas');
    const blocked = await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(400);
    expect(blocked.body.code).toBe('GLOBAL_PRICE_UNPROVEN');
    finance.configureGlobal({ dailyUsd: '10', monthlyUsd: '100' });
    finance.reserveGlobal(
      { ...proof(), operationId: input.generationRequestId },
      time,
    );
    finance.dispatchGlobal(input.generationRequestId, time);
    finance.unknownGlobal(input.generationRequestId);
    const unknown = await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(409);
    expect(unknown.body.code).toBe('EDITORIAL_FINANCE_UNKNOWN');
    expect(spy).not.toHaveBeenCalled();
    finance.configureGlobal({ dailyUsd: '0.01', monthlyUsd: '0.01' });
    provider.mode = 'LOCAL';
    await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(201);
    expect(finance.getGlobalOperation(input.generationRequestId)?.state).toBe(
      'UNKNOWN',
    );
  });
  it('returns a sanitized 503 when the provider is not configured', async () => {
    const unavailable = new UnavailableEditorialProvider();
    vi.spyOn(provider, 'ideas').mockImplementation(() => unavailable.ideas());
    const response = await request(app.getHttpServer())
      .post('/content/editorial-generations')
      .send(input)
      .expect(503);
    expect(response.body.code).toBe('EDITORIAL_PROVIDER_UNAVAILABLE');
  });
});
