import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { join } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/project/infrastructure/project-database.config.js';
import { PROJECT_SNAPSHOT_READER } from '../src/project/application/ports/project-snapshot-reader.port.js';
import { projectFixture } from './support/project-fixture.js';

describe('Project versions (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: Awaited<ReturnType<typeof projectFixture>>;
  beforeEach(async () => {
    fixture = await projectFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(fixture.database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    fixture?.cleanup();
  });

  it('creates, versions and archives with exact retries and immutable history', async () => {
    const metadata = {
      actor: 'operator:test',
      occurredAt: '2026-10-14T12:00:00Z',
    };
    const project = {
      id: 'project_new',
      name: 'New',
      niche: 'Tecnologia',
      audience: { profile: 'Operador' },
      channel: { publishing: { networks: ['instagram'] } },
    };
    const create = { ...metadata, idempotencyKey: 'create:new', project };
    const first = await request(app.getHttpServer())
      .post('/projects')
      .send(create)
      .expect(201);
    expect(
      (
        await request(app.getHttpServer())
          .post('/projects')
          .send(create)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    await request(app.getHttpServer())
      .post('/projects')
      .send({ ...create, idempotencyKey: 'duplicate:new' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/projects')
      .send({ ...create, project: { ...project, name: 'Changed' } })
      .expect(409);
    const version = {
      ...metadata,
      idempotencyKey: 'version:new',
      expectedVersion: 1,
      project: { ...project, version: 2, name: 'Second' },
    };
    const second = await request(app.getHttpServer())
      .post('/projects/project_new/versions')
      .send(version)
      .expect(201);
    expect(second.body.project.version).toBe(2);
    expect(
      (
        await request(app.getHttpServer())
          .post('/projects/project_new/versions')
          .send(version)
          .expect(201)
      ).body,
    ).toEqual(second.body);
    await request(app.getHttpServer())
      .post('/projects/project_new/versions')
      .send({ ...version, idempotencyKey: 'stale' })
      .expect(409);
    expect(
      (
        await request(app.getHttpServer())
          .get('/projects/project_new')
          .expect(200)
      ).body,
    ).toEqual(second.body);
    const archive = {
      ...metadata,
      idempotencyKey: 'archive:new',
      projectId: 'project_new',
      expectedVersion: 2,
    };
    const archived = await request(app.getHttpServer())
      .post('/projects/project_new/archive')
      .send(archive)
      .expect(200);
    expect(archived.body.archivedAt).toBe('2026-10-14T12:00:00.000Z');
    expect(
      (
        await request(app.getHttpServer())
          .post('/projects/project_new/archive')
          .send(archive)
          .expect(200)
      ).body,
    ).toEqual(archived.body);
    await request(app.getHttpServer())
      .post('/projects/project_new/versions')
      .send({
        ...version,
        idempotencyKey: 'archived',
        expectedVersion: 2,
        project: { ...project, version: 3 },
      })
      .expect(409);
    expect(
      (
        await request(app.getHttpServer())
          .get('/projects/project_new/versions/1')
          .expect(200)
      ).body,
    ).toEqual(first.body);
    expect(
      (
        await request(app.getHttpServer())
          .get('/projects/project_new')
          .expect(200)
      ).body,
    ).toEqual(second.body);
  });

  it('rejects invalid commands, mismatched IDs and missing projects without changing data', async () => {
    const before = fixture.files();
    const metadata = {
      actor: 'operator:test',
      occurredAt: '2026-10-14T12:00:00Z',
      idempotencyKey: 'invalid',
    };
    await request(app.getHttpServer())
      .post('/projects')
      .send({ ...metadata, secret: 'hidden' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/projects')
      .send({ ...metadata, project: {} })
      .expect(400);
    await request(app.getHttpServer())
      .post('/projects/project_001/archive')
      .send({ ...metadata, projectId: 'project_other', expectedVersion: 2 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/projects/project_missing/archive')
      .send({ ...metadata, projectId: 'project_missing', expectedVersion: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .get('/projects/project_missing')
      .expect(404);
    expect(fixture.files()).toEqual(before);
  });

  it('returns the unchanged historical contract, current version, and 404 without fallback', async () => {
    const before = fixture.files();
    const historical = await request(app.getHttpServer())
      .get('/projects/project_001/versions/1')
      .expect(200);
    expect(historical.body).toEqual(fixture.historical);
    const current = await request(app.getHttpServer())
      .get('/projects/project_001/versions/2')
      .expect(200);
    expect(current.body).toEqual(fixture.current);
    await request(app.getHttpServer())
      .get('/projects/project_001/versions/3')
      .expect(404);
    await request(app.getHttpServer())
      .get('/projects/project_missing/versions/1')
      .expect(404);
    expect(fixture.files()).toEqual(before);
  });

  it.each([
    '/projects/UPPER/versions/1',
    '/projects/ab/versions/1',
    '/projects/project_001/versions/0',
    '/projects/project_001/versions/1.5',
    '/projects/project_001/versions/1e2',
    '/projects/project_001/versions/9007199254740992',
  ])('returns 400 for %s', async (url) => {
    const before = fixture.files();
    await request(app.getHttpServer()).get(url).expect(400);
    expect(fixture.files()).toEqual(before);
  });

  it('returns sanitized 500 for a missing database without creating files', async () => {
    await app.close();
    const before = fixture.files();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(join(fixture.directory, 'missing.sqlite'))
      .compile();
    app = module.createNestApplication();
    await app.init();
    const result = await request(app.getHttpServer())
      .get('/projects/project_001/versions/1')
      .expect(500);
    expect(result.body).toEqual({
      code: 'PROJECT_READ_FAILED',
      message: 'Não foi possível consultar o projeto.',
    });
    expect(fixture.files()).toEqual(before);
  });

  it('does not expose operational error details', async () => {
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_SNAPSHOT_READER)
      .useValue({
        get: () => {
          throw new Error('C:/private/db.sqlite token=secret');
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    const result = await request(app.getHttpServer())
      .get('/projects/project_001/versions/1')
      .expect(500);
    expect(JSON.stringify(result.body)).not.toMatch(
      /private|sqlite|secret|stack/,
    );
  });
});
