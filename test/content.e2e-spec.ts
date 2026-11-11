import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/modules/project/infrastructure/project-database.config.js';
import { AFFILIATE_DATABASE } from '../src/modules/affiliate/infrastructure/affiliate-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from '../src/modules/content-operations/application/ports/operations.port.js';
import { CONTENT_DATABASE } from '../src/modules/content/infrastructure/content.persistence.js';
import {
  contentFixture,
  submission,
  script,
} from './support/content-fixture.js';

describe('Content editorial HTTP', () => {
  let fixture: ReturnType<typeof contentFixture>, app: INestApplication<App>;
  beforeEach(async () => {
    fixture = contentFixture();
    let builder = Test.createTestingModule({ imports: [AppModule] });
    for (const token of [
      PROJECT_DATABASE,
      AFFILIATE_DATABASE,
      CONTENT_OPERATIONS_DATABASE,
      CONTENT_DATABASE,
    ])
      builder = builder.overrideProvider(token).useValue(fixture.database);
    const module = await builder.compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    fixture.close();
  });
  it('serves historical ideas and decisions and registers exact script replay', async () => {
    const http = app.getHttpServer();
    await request(http)
      .get('/content/ideas')
      .query({ pipelineRunId: fixture.selected.pipelineRunId })
      .expect(200)
      .expect((response) => expect(response.body).toHaveLength(1));
    await request(http)
      .get(`/content/idea-selections/${fixture.selected.ideaSelectionId}`)
      .expect(200)
      .expect((response) => expect(response.body).toEqual(fixture.selected));
    const value = script(fixture.selected);
    const saved = await request(http)
      .post('/content/scripts')
      .send(value)
      .expect(201);
    await request(http)
      .post('/content/scripts')
      .send(value)
      .expect(201)
      .expect((response) => expect(response.body).toEqual(saved.body));
    await request(http)
      .get(`/content/scripts/${value.scriptId}`)
      .expect(200)
      .expect((response) => expect(response.body).toEqual(saved.body));
  });
  it('maps validation, absence and identity conflicts without exposing internals', async () => {
    const http = app.getHttpServer();
    await request(http).post('/content/scripts').send({}).expect(400);
    await request(http).get('/content/scripts/script_missing').expect(404);
    await request(http).get('/content/ideas').expect(400);
    await request(http)
      .post('/content/affiliate-selections')
      .send({
        schemaVersion: 'affiliate-editorial-selection/1.0.0',
        selectionId: 'INVALID',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        briefingId: 'brief_001',
        briefingHash: 'a'.repeat(64),
        evidenceRefs: ['ev_spec'],
        title: 'Produto exemplo',
        editorialAngle: 'Abordagem exemplo',
        decision: 'SELECTED',
        actor: { type: 'HUMAN', id: 'operator_001' },
        decidedAt: '2026-10-14T12:00:00Z',
        contentHash: 'b'.repeat(64),
      })
      .expect(400);
    const value = submission();
    value.proposals[0].title = 'Outra abordagem editorial válida';
    await request(http)
      .post('/content/idea-batches')
      .send(value)
      .expect(409)
      .expect((response) =>
        expect(response.body.code).toBe('IDEA_BATCH_ID_REUSED'),
      );
    await request(http)
      .post('/content/idea-selections')
      .send(fixture.selected)
      .expect(201)
      .expect((response) => expect(response.body).toEqual(fixture.selected));
  });
});
