import {
  ReferenceProjectDatabase,
  ReferenceProjectService,
  seedRows,
} from '../../../../test/support/frozen-parity.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../../infrastructure/administration/schema-provisioner.js';
import { SqliteProjectRepository } from './sqlite-project.repository.js';
import { ProjectApplicationService } from '../application/project-application.service.js';
import { projectFixture } from '../../../../test/support/project-fixture.js';

const project = {
  id: 'project_parity',
  name: ' Nome ',
  niche: ' Tecnologia ',
  audience: { profile: 'Público' },
  channel: { publishing: { networks: ['instagram'] } },
};
const metadata = {
  actor: ' operator:test ',
  occurredAt: '2026-10-14T09:00:00-03:00',
};
const create = { ...metadata, idempotencyKey: 'parity:create', project };
const version = {
  ...metadata,
  idempotencyKey: 'parity:version',
  expectedVersion: 1,
  project: { ...project, version: 2 },
};
const archive = {
  ...metadata,
  idempotencyKey: 'parity:archive',
  projectId: project.id,
  expectedVersion: 2,
};
function rows(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return ['projects', 'project_snapshots', 'project_commands'].map((table) =>
      raw
        .prepare(
          `SELECT * FROM ${table} WHERE ${table === 'projects' ? 'id' : 'project_id'} = ? ORDER BY 1`,
        )
        .all(project.id),
    );
  } finally {
    raw.close();
  }
}
function failure(run: () => unknown) {
  try {
    run();
    return null;
  } catch (error) {
    const e = error as {
      name: string;
      code?: string;
      field?: string;
      message: string;
    };
    return { name: e.name, code: e.code, field: e.field, message: e.message };
  }
}
describe('SQLite commands against frozen legacy evidence', () => {
  it.each([39, 42])(
    'reads independently frozen legacy history and replays commands on schema %s without migrating',
    (schema) => {
      const golden = JSON.parse(
        readFileSync(
          new URL('../../../../test/support/frozen-project.json', import.meta.url),
          'utf8',
        ),
      );
      const scenario = Object.entries(golden.records).find(([name]) =>
        name.includes('produces byte-identical'),
      )![1] as Record<string, any[]>;
      const expected = scenario['project.archiveProject']![0]!.rows;
      const directory = mkdtempSync(join(tmpdir(), 'project-frozen-history-'));
      const path = join(directory, 'history.sqlite');
      const db = new DatabaseSync(path);
      try {
        provisionSchema(db, schema);
        seedRows(db, expected);
        const before = db
          .prepare('SELECT * FROM schema_migrations ORDER BY version')
          .all();
        const repository = new SqliteProjectRepository(path);
        try {
          const service = new ProjectApplicationService(repository);
          for (const [method, command] of [
            ['createProject', create],
            ['createProjectVersion', version],
            ['archiveProject', archive],
          ] as const)
            expect(service[method](command)).toEqual(
              scenario['project.' + method]![0]!.result,
            );
          for (const snapshot of expected[1])
            expect(repository.get(project.id, snapshot.version)).toEqual(
              JSON.parse(snapshot.snapshot_json),
            );
          expect(rows(path)).toEqual(expected);
          expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(
            schema,
          );
          expect(
            db
              .prepare('SELECT * FROM schema_migrations ORDER BY version')
              .all(),
          ).toEqual(before);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        } finally {
          repository.close();
        }
      } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it('canonicalizes object keys and metadata while preserving significant array order', async () => {
    const fixture = await projectFixture();
    const legacy = new ReferenceProjectDatabase(fixture.database);
    const repository = new SqliteProjectRepository(fixture.database);
    try {
      const a = new ReferenceProjectService(legacy);
      const b = new ProjectApplicationService(repository);
      const input = {
        ...create,
        project: {
          ...project,
          subniches: ['IA', 'Ferramentas'],
          channel: { publishing: { networks: ['instagram', 'threads'] } },
        },
      };
      const first = a.createProject(input);
      const reordered = {
        project: {
          audience: project.audience,
          channel: input.project.channel,
          subniches: input.project.subniches,
          niche: 'tecnologia',
          name: 'Nome',
          id: project.id,
        },
        occurredAt: '2026-10-14T12:00:00.000Z',
        actor: 'operator:test',
        idempotencyKey: input.idempotencyKey,
      };
      expect(b.createProject(reordered)).toEqual(first);
      const changed = {
        ...input,
        project: { ...input.project, subniches: ['Ferramentas', 'IA'] },
      };
      expect(failure(() => b.createProject(changed))).toEqual(
        failure(() => a.createProject(changed)),
      );
      expect(failure(() => b.createProject(changed))?.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(rows(fixture.database)[2]).toHaveLength(1);
    } finally {
      repository.close();
      legacy.close();
      fixture.cleanup();
    }
  });
  it.each([
    null,
    [],
    {},
    { ...create, actor: '' },
    { ...create, occurredAt: '1' },
    { ...create, idempotencyKey: 'unsafe key' },
    { ...create, unexpected: true },
    { ...create, project: { ...project, password: 'private', id: 'UPPER' } },
    { ...create, project: { ...project, version: 2 } },
  ])('preserves command error precedence and fields %#', async (command) => {
    const fixture = await projectFixture();
    const legacy = new ReferenceProjectDatabase(fixture.database);
    const repository = new SqliteProjectRepository(fixture.database);
    try {
      expect(
        failure(() =>
          new ProjectApplicationService(repository).createProject(command),
        ),
      ).toEqual(
        failure(() =>
          new ReferenceProjectService(legacy).createProject(command),
        ),
      );
      expect(rows(fixture.database)).toEqual([[], [], []]);
    } finally {
      repository.close();
      legacy.close();
      fixture.cleanup();
    }
  });
  it('preserves conflicts and first state failure while leaving history intact', async () => {
    const left = await projectFixture();
    const right = await projectFixture();
    const legacy = new ReferenceProjectDatabase(left.database);
    const repository = new SqliteProjectRepository(right.database);
    try {
      const a = new ReferenceProjectService(legacy);
      const b = new ProjectApplicationService(repository);
      a.createProject(create);
      b.createProject(create);
      for (const command of [
        { ...create, actor: 'other' },
        { ...create, idempotencyKey: 'duplicate' },
      ])
        expect(failure(() => b.createProject(command))).toEqual(
          failure(() => a.createProject(command)),
        );
      for (const command of [
        { ...version, expectedVersion: 2 },
        { ...version, project: { ...project, version: 3 } },
        {
          ...version,
          project: { ...project, id: 'project_missing', version: 2 },
        },
        { ...version, expectedVersion: 0 },
      ])
        expect(failure(() => b.createProjectVersion(command))).toEqual(
          failure(() => a.createProjectVersion(command)),
        );
      a.createProjectVersion(version);
      b.createProjectVersion(version);
      a.archiveProject(archive);
      b.archiveProject(archive);
      const retryArchive = {
        ...archive,
        idempotencyKey: 'repeat-archive',
        expectedVersion: 1,
      };
      expect(failure(() => b.archiveProject(retryArchive))).toEqual(
        failure(() => a.archiveProject(retryArchive)),
      );
      const afterArchive = {
        ...version,
        idempotencyKey: 'after-archive',
        expectedVersion: 1,
      };
      expect(failure(() => b.createProjectVersion(afterArchive))).toEqual(
        failure(() => a.createProjectVersion(afterArchive)),
      );
      expect(rows(right.database)).toEqual(rows(left.database));
    } finally {
      repository.close();
      legacy.close();
      left.cleanup();
      right.cleanup();
    }
  });
  it('rolls back each mutation if command registration fails, then permits clean retry', async () => {
    const fixture = await projectFixture();
    const repository = new SqliteProjectRepository(fixture.database);
    try {
      const service = new ProjectApplicationService(repository);
      for (const [type, run] of [
        ['CREATE_PROJECT', () => service.createProject(create)],
        ['CREATE_PROJECT_VERSION', () => service.createProjectVersion(version)],
        ['ARCHIVE_PROJECT', () => service.archiveProject(archive)],
      ] as const) {
        const before = rows(fixture.database);
        repository.db.exec(
          `CREATE TRIGGER reject_command BEFORE INSERT ON project_commands WHEN NEW.command_type = '${type}' BEGIN SELECT RAISE(ABORT, 'FORCED_FAILURE'); END;`,
        );
        expect(run).toThrow('FORCED_FAILURE');
        expect(rows(fixture.database)).toEqual(before);
        expect(repository.db.isTransaction).toBe(false);
        repository.db.exec('DROP TRIGGER reject_command');
        run();
      }
      expect(repository.get(project.id, 1)?.project.name).toBe('Nome');
      expect(repository.getProject(project.id)?.archivedAt).toBe(
        '2026-10-14T12:00:00.000Z',
      );
      expect(() =>
        repository.db
          .prepare(
            'UPDATE project_snapshots SET snapshot_json = ? WHERE project_id = ?',
          )
          .run('{}', project.id),
      ).toThrow('IMMUTABLE_PROJECT_SNAPSHOT');
      expect(() =>
        repository.db
          .prepare('DELETE FROM project_commands WHERE project_id = ?')
          .run(project.id),
      ).toThrow('IMMUTABLE_PROJECT_COMMAND');
    } finally {
      repository.close();
      fixture.cleanup();
    }
  });
  it('protects expected versions across two independent connections', async () => {
    const fixture = await projectFixture();
    const first = new SqliteProjectRepository(fixture.database);
    const second = new SqliteProjectRepository(fixture.database);
    try {
      const a = new ProjectApplicationService(first);
      const b = new ProjectApplicationService(second);
      a.createProject(create);
      a.createProjectVersion(version);
      expect(() =>
        b.createProjectVersion({ ...version, idempotencyKey: 'stale' }),
      ).toThrow('EXPECTED_VERSION_MISMATCH');
      expect(second.get(project.id)?.project.version).toBe(2);
      expect(rows(fixture.database)[2]).toHaveLength(2);
    } finally {
      first.close();
      second.close();
      fixture.cleanup();
    }
  });
  it('produces byte-identical JSON, hashes and rows through all transitions', async () => {
    const left = await projectFixture();
    const right = await projectFixture();
    const legacy = new ReferenceProjectDatabase(left.database);
    const repository = new SqliteProjectRepository(right.database);
    try {
      const a = new ReferenceProjectService(legacy);
      const b = new ProjectApplicationService(repository);
      expect(b.createProject(create)).toEqual(a.createProject(create));
      expect(b.createProjectVersion(version)).toEqual(
        a.createProjectVersion(version),
      );
      expect(b.archiveProject(archive)).toEqual(a.archiveProject(archive));
      expect(rows(right.database)).toEqual(rows(left.database));
      expect(b.createProject(create)).toEqual(a.createProject(create));
      expect(b.createProjectVersion(version)).toEqual(
        a.createProjectVersion(version),
      );
      expect(b.archiveProject(archive)).toEqual(a.archiveProject(archive));
    } finally {
      repository.close();
      legacy.close();
      left.cleanup();
      right.cleanup();
    }
  });
  it('replays frozen commands and NestJS commands in both directions after archival', async () => {
    const fixture = await projectFixture();
    const legacy = new ReferenceProjectDatabase(fixture.database);
    const repository = new SqliteProjectRepository(fixture.database);
    try {
      const a = new ReferenceProjectService(legacy);
      const b = new ProjectApplicationService(repository);
      const first = a.createProject(create);
      expect(b.createProject(create)).toEqual(first);
      const second = b.createProjectVersion(version);
      expect(a.createProjectVersion(version)).toEqual(second);
      const archived = a.archiveProject(archive);
      expect(b.archiveProject(archive)).toEqual(archived);
      expect(b.createProject(create)).toEqual(first);
      expect(a.createProjectVersion(version)).toEqual(second);
    } finally {
      repository.close();
      legacy.close();
      fixture.cleanup();
    }
  });
});
