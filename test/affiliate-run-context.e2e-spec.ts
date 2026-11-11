import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/modules/project/infrastructure/project-database.config.js';
import { AFFILIATE_DATABASE } from '../src/modules/affiliate/infrastructure/affiliate-database.config.js';
import { AFFILIATE_RUN_CONTEXT } from '../src/modules/affiliate/application/ports/affiliate-run-context.port.js';
import type { AffiliateRunContext } from '../src/modules/affiliate/application/ports/affiliate-run-context.port.js';
import { affiliateRunFixture } from './support/affiliate-run-fixture.js';

describe('Affiliate run/context HTTP (e2e)', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  let app: INestApplication<App>;
  beforeEach(async () => {
    fixture = affiliateRunFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(fixture.database)
      .overrideProvider(AFFILIATE_DATABASE)
      .useValue(fixture.database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    fixture?.cleanup();
  });
  const command = {
    pipelineRunId: 'run_001',
    briefingId: 'brief_001',
    idempotencyKey: 'bind_one',
  };
  it('binds, replays and resolves exact run briefing without executing a pipeline', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/affiliate/runs/run_001')
          .expect(200)
      ).body,
    ).toEqual({ binding: null, briefing: null });
    const first = (
      await request(app.getHttpServer())
        .post('/affiliate/run-bindings')
        .send(command)
        .expect(201)
    ).body;
    expect(
      (
        await request(app.getHttpServer())
          .post('/affiliate/run-bindings')
          .send(command)
          .expect(201)
      ).body,
    ).toEqual(first);
    const view = (
      await request(app.getHttpServer())
        .get('/affiliate/runs/run_001?expectedBriefingId=brief_001')
        .expect(200)
    ).body;
    expect(view).toEqual({
      binding: first,
      briefing: fixture.catalog.resolveRunBriefing('run_001'),
    });
    expect(
      fixture.catalog.bindRun(
        { pipelineRunId: 'run_001', briefingId: 'brief_001' },
        'bind_one',
      ),
    ).toEqual(first);
    const context = app.get<AffiliateRunContext>(AFFILIATE_RUN_CONTEXT);
    const identity = {
      generationRequestId: 'generation:001',
      contentHash: 'a'.repeat(64),
    };
    expect(context.prepareScriptGeneration(identity, 'run_001')).toEqual(
      view.briefing,
    );
    expect(() =>
      context.verifyScriptGenerationContext(identity, 'run_001', view.briefing),
    ).not.toThrow();
  });
  it('exports internal reservation capability and preserves generic-context blocking', async () => {
    const context = app.get<AffiliateRunContext>(AFFILIATE_RUN_CONTEXT);
    expect(
      context.prepareScriptGeneration(
        { generationRequestId: 'generation:001', contentHash: 'a'.repeat(64) },
        'run_001',
      ),
    ).toBeNull();
    const response = await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send(command)
      .expect(409);
    expect(response.body).toEqual({
      code: 'AFFILIATE_RUN_BINDING_TOO_LATE',
      field: 'pipelineRunId',
    });
  });
  it('maps missing references, malformed input, expected briefing and idempotency conflicts', async () => {
    await request(app.getHttpServer())
      .get('/affiliate/runs/missing')
      .expect(404);
    await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send({ ...command, extra: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send({ ...command, briefingId: 'missing' })
      .expect(404);
    const unbound = await request(app.getHttpServer())
      .get('/affiliate/runs/run_001?expectedBriefingId=brief_001')
      .expect(409);
    expect(unbound.body).toEqual({
      code: 'AFFILIATE_BRIEFING_NOT_BOUND',
      field: 'briefingId',
    });
    await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send(command)
      .expect(201);
    const conflict = await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send({ ...command, briefingId: 'missing' })
      .expect(409);
    expect(conflict.body).toEqual({
      code: 'AFFILIATE_IDEMPOTENCY_CONFLICT',
      field: 'idempotencyKey',
    });
  });
  it('sanitizes operational storage failure and rolls back binding', async () => {
    fixture.base.db.exec(
      "CREATE TRIGGER force_binding_failure AFTER INSERT ON affiliate_run_bindings BEGIN SELECT RAISE(ABORT,'private path token=secret'); END;",
    );
    const response = await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send(command)
      .expect(500);
    expect(response.body).toEqual({ code: 'AFFILIATE_OPERATION_FAILED' });
    expect(fixture.catalog.getRunBinding('run_001')).toBeNull();
    expect(
      fixture.base.db
        .prepare('SELECT 1 FROM affiliate_commands WHERE idempotency_key=?')
        .get('bind_one'),
    ).toBeUndefined();
  });
});
