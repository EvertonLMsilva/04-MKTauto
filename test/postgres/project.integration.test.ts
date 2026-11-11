import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PostgresDatabase,
  PostgresMigrationRunner,
} from '../../src/infrastructure/database/postgres/index.js';
import { ProjectModule } from '../../src/modules/project/project.module.js';
import { PROJECT_DATABASE } from '../../src/modules/project/infrastructure/project-database.config.js';
import { PROJECT_REPOSITORY } from '../../src/modules/project/application/ports/project-repository.port.js';
import { ProjectCommandService } from '../../src/modules/project/application/project-command.service.js';
import { ProjectCommandError } from '../../src/modules/project/application/ports/project-commands.port.js';
import type { ProjectCommands } from '../../src/modules/project/application/ports/project-commands.port.js';
import type { ProjectSnapshotReader } from '../../src/modules/project/application/ports/project-snapshot-reader.port.js';
import { createProjectSnapshot } from '../../src/modules/project/domain/project-contracts.js';
import { SqliteProjectPersistence } from '../../src/modules/project/infrastructure/sqlite-project.persistence.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { PROJECT_POSTGRES_MIGRATIONS } from '../../src/modules/project/infrastructure/postgres-project.migrations.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';

const timestamp = '2026-10-14T12:00:00.000Z';
const uniqueId = () => `project_pg_${randomUUID().replaceAll('-', '')}`;
const project = (id: string, version = 1) => ({
  id,
  version,
  name: version === 1 ? 'Original' : 'Atual',
  niche: 'Tecnologia',
  audience: { profile: 'Operador' },
  channel: { publishing: { networks: ['instagram'] } },
});
const metadata = (idempotencyKey: string) => ({
  idempotencyKey,
  actor: 'operator:test',
  occurredAt: timestamp,
});

interface Audit {
  projects: number;
  snapshots: number;
  commands: {
    idempotency_key: string;
    command_type: string;
    payload_hash: string;
    actor: string;
    occurred_at: string;
    project_version: number;
    result_json: string;
    result: unknown;
  }[];
}

function assertDeepFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

async function failure(
  run: () => Promise<unknown>,
  code: string,
  field: string,
) {
  try {
    await run();
    throw new Error('Expected a rejected Project command');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectCommandError);
    expect(error).toMatchObject({ code, field });
    return {
      code: (error as ProjectCommandError).code,
      field: (error as ProjectCommandError).field,
    };
  }
}

// The same sequence is the oracle for both adapters; no second copy of domain rules.
async function exerciseContract(
  commands: ProjectCommands,
  reader: ProjectSnapshotReader,
  audit: () => Promise<Audit>,
  id: string,
) {
  const create = {
    ...metadata(`${id}:create`),
    actor: '  operator:test   user  ',
    occurredAt: '2026-10-14T09:00:00-03:00',
    project: project(id),
  };
  const first = await commands.createProject(create);
  assertDeepFrozen(first);
  expect(first).toEqual(createProjectSnapshot(project(id)));
  const replay = await commands.createProject({
    ...create,
    actor: 'operator:test user',
    occurredAt: timestamp,
  });
  assertDeepFrozen(replay);
  expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
  const reused = await failure(
    () => commands.createProject({ ...create, actor: 'other' }),
    'IDEMPOTENCY_KEY_REUSED',
    'idempotencyKey',
  );
  const duplicate = await failure(
    () =>
      commands.createProject({ ...create, idempotencyKey: `${id}:duplicate` }),
    'PROJECT_ID_CONFLICT',
    'project.id',
  );
  const version = {
    ...metadata(`${id}:version`),
    project: project(id, 2),
    expectedVersion: 1,
  };
  const second = await commands.createProjectVersion(version);
  assertDeepFrozen(second);
  expect(await reader.get(id, 1)).toEqual(first);
  expect(await reader.get(id)).toEqual(second);
  const stale = await failure(
    () =>
      commands.createProjectVersion({
        ...version,
        idempotencyKey: `${id}:stale`,
        project: project(id, 3),
      }),
    'EXPECTED_VERSION_MISMATCH',
    'expectedVersion',
  );
  const skipped = await failure(
    () =>
      commands.createProjectVersion({
        ...version,
        idempotencyKey: `${id}:skipped`,
        expectedVersion: 2,
        project: project(id, 4),
      }),
    'PROJECT_VERSION_CONFLICT',
    'project.version',
  );
  const archive = {
    ...metadata(`${id}:archive`),
    projectId: id,
    expectedVersion: 2,
  };
  const archived = await commands.archiveProject(archive);
  assertDeepFrozen(archived);
  expect(archived).toMatchObject({
    id,
    latestVersion: 2,
    archivedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    snapshot: second,
  });
  // Replay precedes current-state validation, including after later version/archive.
  const historicalReplay = await commands.createProject(create);
  const versionReplay = await commands.createProjectVersion(version);
  const archiveReplay = await commands.archiveProject(archive);
  for (const result of [historicalReplay, versionReplay, archiveReplay])
    assertDeepFrozen(result);
  expect(historicalReplay).toEqual(first);
  expect(versionReplay).toEqual(second);
  expect(archiveReplay).toEqual(archived);
  const closed = await failure(
    () =>
      commands.createProjectVersion({
        ...version,
        idempotencyKey: `${id}:closed`,
        expectedVersion: 2,
        project: project(id, 3),
      }),
    'PROJECT_ARCHIVED',
    'project.id',
  );
  const archivedAgain = await failure(
    () =>
      commands.archiveProject({
        ...archive,
        idempotencyKey: `${id}:archive-again`,
        expectedVersion: 1,
      }),
    'PROJECT_ARCHIVED',
    'project.id',
  );
  const historical = await reader.get(id, 1);
  const current = await reader.get(id);
  assertDeepFrozen(historical);
  assertDeepFrozen(current);
  expect(historical).toEqual(first);
  expect(current).toEqual(second);
  expect(await reader.get(id, 3)).toBeNull();
  const persisted = await audit();
  expect(persisted.projects).toBe(1);
  expect(persisted.snapshots).toBe(2);
  expect(persisted.commands).toHaveLength(3);
  for (const command of persisted.commands)
    expect(command.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  return {
    first,
    second,
    archived,
    reused,
    duplicate,
    stale,
    skipped,
    closed,
    archivedAgain,
    persisted,
  };
}

function sqliteFixture() {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'mktauto-pg-project-'));
  const path = join(directory, 'project.sqlite');
  const db = new DatabaseSync(path);
  try {
    for (const migration of [
      '003_project_catalog.sql',
      '004_project_commands.sql',
    ]) {
      db.exec(
        readFileSync(
          new URL(
            `../../src/infrastructure/database/migrations/${migration}`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    }
    db.exec('PRAGMA user_version = 39;');
  } finally {
    db.close();
  }
  const persistence = new SqliteProjectPersistence(path);
  return {
    path,
    persistence,
    async audit(id: string): Promise<Audit> {
      const raw = new DatabaseSync(path, { readOnly: true });
      try {
        return {
          projects: Number(
            raw
              .prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?')
              .get(id)?.count,
          ),
          snapshots: Number(
            raw
              .prepare(
                'SELECT COUNT(*) AS count FROM project_snapshots WHERE project_id = ?',
              )
              .get(id)?.count,
          ),
          commands: raw
            .prepare(
              'SELECT idempotency_key, command_type, payload_hash, actor, occurred_at, project_version, result_json FROM project_commands WHERE project_id = ? ORDER BY idempotency_key',
            )
            .all(id)
            .map((row) => ({
              idempotency_key: String(row.idempotency_key),
              command_type: String(row.command_type),
              payload_hash: String(row.payload_hash),
              actor: String(row.actor),
              occurred_at: String(row.occurred_at),
              project_version: Number(row.project_version),
              result_json: String(row.result_json),
              result: JSON.parse(String(row.result_json)),
            })),
        };
      } finally {
        raw.close();
      }
    },
    cleanup() {
      if (
        dirname(directory) !== parent ||
        !basename(directory).startsWith('mktauto-pg-project-')
      ) {
        throw new Error('Invalid disposable SQLite directory');
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe('Project PostgreSQL integration', () => {
  let db: PostgresDatabase;
  let persistence: PostgresProjectPersistence;
  let commands: ProjectCommandService<true>;
  let config: ReturnType<typeof getTestPostgresConfig>;

  beforeAll(async () => {
    config = getTestPostgresConfig();
    db = new PostgresDatabase(config);
    await assertDisposableDatabase(db);
    // The guard verifies both the local test database and the harness-only marker.
    await db.query('DROP SCHEMA IF EXISTS project CASCADE');
    await db.query('DROP SCHEMA IF EXISTS platform CASCADE');
    await new PostgresMigrationRunner(db).migrate(PROJECT_POSTGRES_MIGRATIONS);
    persistence = new PostgresProjectPersistence(db);
    commands = new ProjectCommandService<true>(persistence);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function audit(id: string): Promise<Audit> {
    const projects = await db.query(
      'SELECT COUNT(*) AS count FROM project.projects WHERE id = $1',
      [id],
    );
    const snapshots = await db.query(
      'SELECT COUNT(*) AS count FROM project.project_snapshots WHERE project_id = $1',
      [id],
    );
    const ledger = await db.query(
      'SELECT idempotency_key, command_type, payload_hash, actor, occurred_at, project_version, result_json::text AS result_json FROM project.project_commands WHERE project_id = $1 ORDER BY idempotency_key',
      [id],
    );
    return {
      projects: Number(projects.rows[0].count),
      snapshots: Number(snapshots.rows[0].count),
      commands: ledger.rows.map(({ result_json, ...row }) => ({
        ...row,
        occurred_at:
          row.occurred_at instanceof Date
            ? row.occurred_at.toISOString()
            : row.occurred_at,
        project_version: Number(row.project_version),
        result_json: result_json,
        result: JSON.parse(result_json),
      })) as Audit['commands'],
    };
  }

  it('matches the disposable SQLite contract, hashes, frozen results and replay after archive', async () => {
    const sqlite = sqliteFixture();
    const id = uniqueId();
    try {
      const expected = await exerciseContract(
        new ProjectCommandService(sqlite.persistence),
        sqlite.persistence,
        () => sqlite.audit(id),
        id,
      );
      const actual = await exerciseContract(
        commands,
        persistence,
        () => audit(id),
        id,
      );
      expect(actual).toEqual(expected);
      for (const key of ['first', 'second', 'archived'] as const) {
        expect(JSON.stringify(actual[key])).toBe(JSON.stringify(expected[key]));
      }
    } finally {
      sqlite.cleanup();
    }
  });

  it('enforces read-only handles and closes each handle idempotently without closing the shared pool', async () => {
    const id = uniqueId();
    const rejectedId = uniqueId();
    const snapshot = await commands.createProject({
      ...metadata(`${id}:lifecycle`),
      project: project(id),
    });
    const before = await audit(id);
    const readOnly = await persistence.open(true);
    const normal = await persistence.open();
    try {
      expect(await readOnly.get(id)).toEqual(snapshot);
      await expect(
        readOnly.create(createProjectSnapshot(project(rejectedId)), {
          createdAt: timestamp,
        }),
      ).rejects.toMatchObject({
        code: 'PROJECT_READ_ONLY',
        field: 'repository',
      });
      expect(await audit(id)).toEqual(before);
      expect(await audit(rejectedId)).toEqual({
        projects: 0,
        snapshots: 0,
        commands: [],
      });
      await readOnly.close();
      await readOnly.close();
      await expect(readOnly.get(id)).rejects.toMatchObject({
        code: 'PROJECT_REPOSITORY_CLOSED',
        field: 'repository',
      });
      expect(await normal.get(id)).toEqual(snapshot);
      await normal.close();
      await normal.close();
      await expect(normal.get(id)).rejects.toMatchObject({
        code: 'PROJECT_REPOSITORY_CLOSED',
        field: 'repository',
      });
      expect(await persistence.get(id)).toEqual(snapshot);
      expect(await db.healthcheck()).toBe(true);
      expect(await audit(id)).toEqual(before);
    } finally {
      await readOnly.close();
      await normal.close();
    }
  });

  it('replays simultaneous identical commands and rejects a changed payload without partial effects', async () => {
    const id = uniqueId();
    const command = { ...metadata(`${id}:same`), project: project(id) };
    const [first, replay] = await Promise.all([
      commands.createProject(command),
      commands.createProject(command),
    ]);
    expect(replay).toEqual(first);
    await failure(
      () => commands.createProject({ ...command, actor: 'other' }),
      'IDEMPOTENCY_KEY_REUSED',
      'idempotencyKey',
    );
    expect(await audit(id)).toMatchObject({ projects: 1, snapshots: 1 });
    expect((await audit(id)).commands).toHaveLength(1);
  });

  it('serializes competing expectedVersion updates and preserves the winning history', async () => {
    const id = uniqueId();
    await commands.createProject({
      ...metadata(`${id}:create`),
      project: project(id),
    });
    const outcomes = await Promise.allSettled(
      ['a', 'b'].map((suffix) =>
        commands.createProjectVersion({
          ...metadata(`${id}:version:${suffix}`),
          expectedVersion: 1,
          project: { ...project(id, 2), name: suffix },
        }),
      ),
    );
    const success = outcomes.filter((result) => result.status === 'fulfilled');
    const rejected = outcomes.filter((result) => result.status === 'rejected');
    expect(success).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ProjectCommandError);
    expect(rejected[0].reason).toMatchObject({
      code: 'EXPECTED_VERSION_MISMATCH',
      field: 'expectedVersion',
    });
    expect(await persistence.get(id)).toEqual(success[0].value);
    const persisted = await audit(id);
    expect(persisted.snapshots).toBe(2);
    expect(persisted.commands).toHaveLength(2);
  });

  it('rolls back a written snapshot when the asynchronous transaction callback fails', async () => {
    const id = uniqueId();
    const repository = await persistence.open();
    try {
      await expect(
        repository.executeCommand(
          {
            ...metadata(`${id}:rollback`),
            commandType: 'CREATE_PROJECT',
            payloadHash: 'a'.repeat(64),
          },
          async (actions) => {
            await actions.create(createProjectSnapshot(project(id)));
            throw new Error('FORCED_PROJECT_ROLLBACK');
          },
        ),
      ).rejects.toThrow('FORCED_PROJECT_ROLLBACK');
      expect(await persistence.get(id)).toBeNull();
      expect(await audit(id)).toEqual({
        projects: 0,
        snapshots: 0,
        commands: [],
      });
      await expect(
        commands.createProject({
          ...metadata(`${id}:rollback`),
          project: project(id),
        }),
      ).resolves.toMatchObject({ project: { id } });
    } finally {
      await repository.close();
    }
  });

  it('enforces immutable snapshots and command history in PostgreSQL itself', async () => {
    const id = uniqueId();
    await commands.createProject({
      ...metadata(`${id}:create`),
      project: project(id),
    });
    const before = await audit(id);
    for (const sql of [
      'UPDATE project.project_snapshots SET snapshot_json = snapshot_json WHERE project_id = $1',
      'DELETE FROM project.project_snapshots WHERE project_id = $1',
    ])
      await expect(db.query(sql, [id])).rejects.toMatchObject({
        code: 'POSTGRES_QUERY_FAILED',
        sqlState: 'P1001',
      });
    for (const sql of [
      'UPDATE project.project_commands SET actor = actor WHERE project_id = $1',
      'DELETE FROM project.project_commands WHERE project_id = $1',
    ])
      await expect(db.query(sql, [id])).rejects.toMatchObject({
        code: 'POSTGRES_QUERY_FAILED',
        sqlState: 'P1002',
      });
    expect(await audit(id)).toEqual(before);
  });

  it('preserves safe integer versions above int4 and at the JavaScript boundary', async () => {
    for (const version of [2_147_483_648, Number.MAX_SAFE_INTEGER]) {
      const id = uniqueId();
      const snapshot = createProjectSnapshot(project(id, version));
      await db.transaction(async (client) => {
        await client.query(
          'INSERT INTO project.projects(id,latest_version,archived_at,created_at,updated_at) VALUES($1,$2,NULL,$3,$3)',
          [id, version, timestamp],
        );
        await client.query(
          'INSERT INTO project.project_snapshots(project_id,version,schema_version,snapshot_json,created_at) VALUES($1,$2,$3,$4,$5)',
          [
            id,
            version,
            snapshot.schemaVersion,
            JSON.stringify(snapshot),
            timestamp,
          ],
        );
      });
      const repository = await persistence.open();
      try {
        const historical = await repository.get(id, version);
        expect(historical).toEqual(snapshot);
        assertDeepFrozen(historical);
        expect(await repository.get(id)).toEqual(snapshot);
        if (version < Number.MAX_SAFE_INTEGER) {
          const next = createProjectSnapshot(project(id, version + 1));
          expect(
            await repository.createVersion(next, {
              expectedVersion: version,
              createdAt: timestamp,
            }),
          ).toEqual(next);
          expect(await repository.get(id, version)).toEqual(snapshot);
          expect(await repository.get(id)).toEqual(next);
        } else {
          const archived = await repository.archive(id, {
            expectedVersion: version,
            archivedAt: timestamp,
          });
          expect(archived.latestVersion).toBe(Number.MAX_SAFE_INTEGER);
          expect(archived.snapshot).toEqual(snapshot);
          assertDeepFrozen(archived);
        }
      } finally {
        await repository.close();
      }
    }
  });

  it('enforces native safe integer checks, JSON types and project/snapshot foreign keys', async () => {
    const id = uniqueId();
    await commands.createProject({
      ...metadata(`${id}:create`),
      project: project(id),
    });
    const before = await audit(id);
    for (const invalidVersion of ['0', '9007199254740992']) {
      await expect(
        db.query(
          'INSERT INTO project.projects(id,latest_version,archived_at,created_at,updated_at) VALUES($1,$2,NULL,$3,$3)',
          [uniqueId(), invalidVersion, timestamp],
        ),
      ).rejects.toMatchObject({
        code: 'POSTGRES_QUERY_FAILED',
        sqlState: '23514',
      });
      await expect(
        db.query(
          'INSERT INTO project.project_snapshots(project_id,version,schema_version,snapshot_json,created_at) VALUES($1,$2,$3,$4,$5)',
          [id, invalidVersion, 'project-contracts/1.0.0', '{}', timestamp],
        ),
      ).rejects.toMatchObject({
        code: 'POSTGRES_QUERY_FAILED',
        sqlState: '23514',
      });
    }
    await expect(
      db.query(
        'INSERT INTO project.project_snapshots(project_id,version,schema_version,snapshot_json,created_at) VALUES($1,1,$2,$3,$4)',
        [uniqueId(), 'project-contracts/1.0.0', '{}', timestamp],
      ),
    ).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: '23503',
    });
    const insertCommand =
      'INSERT INTO project.project_commands(idempotency_key,command_type,payload_hash,actor,occurred_at,project_id,project_version,result_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)';
    const valid = [
      `${id}:constraint`,
      'CREATE_PROJECT_VERSION',
      'a'.repeat(64),
      'operator:test',
      timestamp,
      id,
      '2',
      '{}',
    ];
    await expect(db.query(insertCommand, valid)).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: '23503',
    });
    for (const [index, invalid] of [
      [1, 'UNKNOWN_COMMAND'],
      [2, 'bad'],
      [6, '9007199254740992'],
    ] as const) {
      const values = [...valid];
      values[6] = '1';
      values[index] = invalid;
      await expect(db.query(insertCommand, values)).rejects.toMatchObject({
        code: 'POSTGRES_QUERY_FAILED',
        sqlState: '23514',
      });
    }
    const invalidJson = [...valid];
    invalidJson[6] = '1';
    invalidJson[7] = 'not-json';
    await expect(db.query(insertCommand, invalidJson)).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: '22P02',
    });
    expect(await audit(id)).toEqual(before);
  });

  it('rolls back version mutation when inserting the command receipt fails and permits a clean retry', async () => {
    const id = uniqueId();
    await commands.createProject({
      ...metadata(`${id}:create`),
      project: project(id),
    });
    const before = await audit(id);
    const version = {
      ...metadata(`${id}:receipt`),
      expectedVersion: 1,
      project: project(id, 2),
    };
    await db.query(`CREATE FUNCTION project.reject_project_receipt_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.project_id = TG_ARGV[0] THEN
          RAISE EXCEPTION USING ERRCODE = 'P1099', MESSAGE = 'FIXTURE_RECEIPT_FAILURE';
        END IF;
        RETURN NEW;
      END;
    $$`);
    try {
      await db.query(
        `CREATE TRIGGER fixture_reject_project_receipt BEFORE INSERT ON project.project_commands FOR EACH ROW EXECUTE FUNCTION project.reject_project_receipt_fixture('${id}')`,
      );
      await expect(
        commands.createProjectVersion(version),
      ).rejects.toMatchObject({ sqlState: 'P1099' });
      expect(await audit(id)).toEqual(before);
      expect(await persistence.get(id)).toEqual(
        createProjectSnapshot(project(id)),
      );
    } finally {
      await db.query(
        'DROP TRIGGER IF EXISTS fixture_reject_project_receipt ON project.project_commands',
      );
      await db.query('DROP FUNCTION project.reject_project_receipt_fixture()');
    }
    await expect(commands.createProjectVersion(version)).resolves.toEqual(
      createProjectSnapshot(project(id, 2)),
    );
    const after = await audit(id);
    expect(after.snapshots).toBe(2);
    expect(after.commands).toHaveLength(2);
  });

  it('serves the real NestJS Project HTTP flow through the opt-in PostgreSQL module', async () => {
    let app: INestApplication | undefined;
    const id = uniqueId();
    const module = await Test.createTestingModule({
      imports: [ProjectModule.postgres(config)],
    }).compile();
    try {
      expect(module.get(PROJECT_REPOSITORY)).toBeInstanceOf(
        PostgresProjectPersistence,
      );
      expect(() => module.get(SqliteProjectPersistence)).toThrow();
      app = module.createNestApplication();
      await app.init();
      const command = {
        ...metadata(`${id}:http-create`),
        project: project(id),
      };
      const first = await request(app.getHttpServer())
        .post('/projects')
        .send(command)
        .expect(201);
      expect(first.body).toEqual(createProjectSnapshot(project(id)));
      const replay = await request(app.getHttpServer())
        .post('/projects')
        .send(command)
        .expect(201);
      expect(replay.body).toEqual(first.body);
      const conflict = await request(app.getHttpServer())
        .post('/projects')
        .send({ ...command, actor: 'other' })
        .expect(409);
      expect(conflict.body).toEqual({
        code: 'IDEMPOTENCY_KEY_REUSED',
        field: 'idempotencyKey',
      });
      const version = await request(app.getHttpServer())
        .post(`/projects/${id}/versions`)
        .send({
          ...metadata(`${id}:http-version`),
          project: project(id, 2),
          expectedVersion: 1,
        })
        .expect(201);
      const archived = await request(app.getHttpServer())
        .post(`/projects/${id}/archive`)
        .send({
          ...metadata(`${id}:http-archive`),
          projectId: id,
          expectedVersion: 2,
        })
        .expect(200);
      expect(archived.body.snapshot).toEqual(version.body);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/projects/${id}/versions/1`)
            .expect(200)
        ).body,
      ).toEqual(first.body);
      expect(
        (await request(app.getHttpServer()).get(`/projects/${id}`).expect(200))
          .body,
      ).toEqual(version.body);
      const missing = await request(app.getHttpServer())
        .post(`/projects/${id}_missing/archive`)
        .send({
          ...metadata(`${id}:http-missing`),
          projectId: `${id}_missing`,
          expectedVersion: 1,
        })
        .expect(404);
      expect(missing.body).toEqual({
        code: 'PROJECT_NOT_FOUND',
        field: 'project.id',
      });
      const invalid = await request(app.getHttpServer())
        .post('/projects')
        .send({ ...command, secret: 'fixture-only' })
        .expect(400);
      expect(invalid.body).toEqual({
        code: 'SENSITIVE_FIELD_REJECTED',
        field: 'secret',
      });
      expect(
        JSON.stringify([conflict.body, missing.body, invalid.body]),
      ).not.toMatch(/postgres|password|stack|fixture-only/);
    } finally {
      if (app) await app.close();
      else await module.close();
    }
  });

  it('keeps the default NestJS module wired to SQLite without PostgreSQL opt-in', async () => {
    const sqlite = sqliteFixture();
    const module = await Test.createTestingModule({ imports: [ProjectModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(sqlite.path)
      .compile();
    try {
      expect(module.get(PROJECT_REPOSITORY)).toBeInstanceOf(
        SqliteProjectPersistence,
      );
      expect(() => module.get(PostgresProjectPersistence)).toThrow();
    } finally {
      await module.close();
      sqlite.cleanup();
    }
  });
});
