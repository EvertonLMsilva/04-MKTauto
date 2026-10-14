import { SqliteProjectPersistence } from '../infrastructure/sqlite-project.persistence.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectCommandService } from './project-command.service.js';
import { ProjectCommandError } from './ports/project-commands.port.js';
import { projectFixture } from '../../../test/support/project-fixture.js';

describe('ProjectCommandService', () => {
  const command = {
    idempotencyKey: 'adapter:create',
    actor: 'operator:test',
    occurredAt: '2026-10-14T12:00:00Z',
    project: {
      id: 'project_adapter',
      name: 'Adapter',
      niche: 'Tecnologia',
      audience: { profile: 'Operador' },
      channel: { publishing: { networks: ['instagram'] } },
    },
  };

  it('persists the legacy hash, replays without extra effects and closes on rejection', async () => {
    const fixture = await projectFixture();
    const close = vi.spyOn(
      fixture.repository.ProjectRepository.prototype,
      'close',
    );
    try {
      const adapter = new ProjectCommandService(
        new SqliteProjectPersistence(fixture.database),
      );
      const result = await adapter.createProject(command);
      expect(await adapter.createProject(command)).toEqual(result);
      await expect(
        adapter.createProject({ ...command, actor: 'other' }),
      ).rejects.toBeInstanceOf(ProjectCommandError);
      expect(close).toHaveBeenCalledTimes(3);
      const raw = new DatabaseSync(fixture.database, { readOnly: true });
      try {
        expect(
          raw.prepare('SELECT payload_hash FROM project_commands').get()
            ?.payload_hash,
        ).toMatch(/^[a-f0-9]{64}$/);
        expect(
          raw.prepare('SELECT COUNT(*) AS count FROM project_commands').get()
            ?.count,
        ).toBe(1);
        expect(
          raw
            .prepare(
              'SELECT COUNT(*) AS count FROM project_snapshots WHERE project_id = ?',
            )
            .get('project_adapter')?.count,
        ).toBe(1);
      } finally {
        raw.close();
      }
    } finally {
      close.mockRestore();
      fixture.cleanup();
    }
  });

  it('never creates missing databases or migrates old schemas', async () => {
    const fixture = await projectFixture();
    try {
      const absent = join(fixture.directory, 'absent', 'missing.sqlite');
      await expect(
        new ProjectCommandService(
          new SqliteProjectPersistence(absent),
        ).createProject(command),
      ).rejects.toThrow();
      expect(existsSync(join(fixture.directory, 'absent'))).toBe(false);
      const old = join(fixture.directory, 'old.sqlite');
      const raw = new DatabaseSync(old);
      raw.exec('PRAGMA user_version = 1');
      raw.close();
      const before = fixture.files();
      await expect(
        new ProjectCommandService(
          new SqliteProjectPersistence(old),
        ).createProject(command),
      ).rejects.toThrow('PROJECT_SCHEMA_VERSION_UNSUPPORTED');
      expect(fixture.files()).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });

  it.each([null, '', 'relative.sqlite'])(
    'requires an explicit absolute database: %s',
    async (path) => {
      await expect(
        new ProjectCommandService(
          new SqliteProjectPersistence(path),
        ).createProject(command),
      ).rejects.toThrow('explicit absolute path');
    },
  );
});
