import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/project/infrastructure/project-database.config.js';
import { AFFILIATE_DATABASE } from '../src/affiliate/infrastructure/affiliate-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from '../src/content-operations/application/ports/operations.port.js';
import { CONTENT_OPERATIONS } from '../src/content-operations/application/ports/operations.port.js';
import type { ContentOperationsService } from '../src/content-operations/application/content-operations.service.js';
import { affiliateRunFixture } from './support/affiliate-run-fixture.js';
describe('Content Operations HTTP without pipelines', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  let app: INestApplication<App>;
  const command = {
    schemaVersion: 'pipeline-handoff/1.0.0',
    pipelineRunId: 'run_http',
    projectId: 'project_001',
    projectVersion: 1,
    startedAt: '2026-10-14T12:00:00Z',
  };
  beforeEach(async () => {
    fixture = affiliateRunFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(fixture.database)
      .overrideProvider(AFFILIATE_DATABASE)
      .useValue(fixture.database)
      .overrideProvider(CONTENT_OPERATIONS_DATABASE)
      .useValue(fixture.database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    fixture?.cleanup();
  });
  it('starts and replays an exact snapshot, then binds via public Affiliate API', async () => {
    const first = (
      await request(app.getHttpServer())
        .post('/content-operations/runs')
        .send(command)
        .expect(201)
    ).body;
    expect(first.state).toBe('RUNNING');
    expect(first.completedAt).toBeNull();
    expect(
      (
        await request(app.getHttpServer())
          .post('/content-operations/runs')
          .send(command)
          .expect(201)
      ).body,
    ).toEqual(first);
    await request(app.getHttpServer())
      .post('/affiliate/run-bindings')
      .send({
        pipelineRunId: 'run_http',
        briefingId: 'brief_001',
        idempotencyKey: 'http_binding',
      })
      .expect(201);
    expect(
      (
        await request(app.getHttpServer())
          .get('/affiliate/runs/run_http')
          .expect(200)
      ).body.binding.pipelineRunId,
    ).toBe('run_http');
    expect(
      app
        .get<ContentOperationsService>(CONTENT_OPERATIONS)
        .resolveAffiliateBriefing('run_http', 'brief_001'),
    ).toEqual(fixture.catalog.resolveRunBriefing('run_http'));
    expect(
      (
        await request(app.getHttpServer())
          .get('/content-operations/runs/run_http/checkpoints')
          .expect(200)
      ).body.every((s: { state: string }) => s.state === 'PENDING'),
    ).toBe(true);
    expect(
      (
        await request(app.getHttpServer())
          .get(
            '/content-operations/runs?projectId=project_001&projectVersion=1',
          )
          .expect(200)
      ).body,
    ).toHaveLength(2);
    expect(
      fixture.base.db.prepare('SELECT count(*) n FROM scripts').get().n,
    ).toBe(0);
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM pipeline_stage_attempts')
        .get().n,
    ).toBe(0);
  });
  it('transitions and resumes without implying production is complete', async () => {
    await request(app.getHttpServer())
      .post('/content-operations/runs')
      .send(command)
      .expect(201);
    const fail = {
      nextState: 'FAILED',
      completedAt: '2026-10-14T12:01:00Z',
      error: { code: 'NETWORK_TIMEOUT', field: 'stage', private: 'secret' },
    };
    await request(app.getHttpServer())
      .post('/content-operations/runs/run_http/transitions')
      .send(fail)
      .expect(201);
    const resumed = (
      await request(app.getHttpServer())
        .post('/content-operations/runs/run_http/resume')
        .send({ resumedAt: '2026-10-14T12:02:00Z' })
        .expect(201)
    ).body;
    expect(resumed.state).toBe('RUNNING');
    expect(resumed.completedAt).toBeNull();
    const success = {
      nextState: 'SUCCEEDED',
      completedAt: '2026-10-14T12:03:00Z',
    };
    await request(app.getHttpServer())
      .post('/content-operations/runs/run_http/transitions')
      .send(success)
      .expect(201);
    await request(app.getHttpServer())
      .post('/content-operations/runs/run_http/transitions')
      .send(fail)
      .expect(409);
    expect(
      (
        await request(app.getHttpServer())
          .get('/content-operations/runs/run_http')
          .expect(200)
      ).body,
    ).toEqual(fixture.base.getRun('run_http'));
  });
  it('rejects invalid commands, missing references and sanitizes database failures', async () => {
    await request(app.getHttpServer())
      .post('/content-operations/runs')
      .send({ ...command, extra: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/content-operations/runs')
      .send({ ...command, projectVersion: 9 })
      .expect(404);
    await request(app.getHttpServer())
      .get('/content-operations/runs/missing')
      .expect(404);
    await request(app.getHttpServer())
      .post('/content-operations/runs')
      .send(command)
      .expect(201);
    await request(app.getHttpServer())
      .post('/content-operations/runs')
      .send({ ...command, startedAt: '2026-10-14T12:01:00Z' })
      .expect(409);
    fixture.base.db.exec(
      "CREATE TRIGGER forced_content_failure BEFORE INSERT ON pipeline_run_transitions WHEN NEW.previous_state IS NOT NULL BEGIN SELECT RAISE(ABORT,'private path token=secret'); END",
    );
    const failed = await request(app.getHttpServer())
      .post('/content-operations/runs/run_http/transitions')
      .send({ nextState: 'SUCCEEDED', completedAt: '2026-10-14T12:01:00Z' })
      .expect(500);
    expect(failed.body).toEqual({ code: 'CONTENT_OPERATION_FAILED' });
    expect(fixture.base.getRun('run_http').state).toBe('RUNNING');
  });
});
