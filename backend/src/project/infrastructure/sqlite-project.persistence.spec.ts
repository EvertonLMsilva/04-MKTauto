import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteProjectPersistence } from './sqlite-project.persistence.js';
import { projectFixture } from '../../../test/support/project-fixture.js';

describe('SqliteProjectPersistence', () => {
  it('reads historical snapshots without changing database bytes or WAL frames and closes each connection', async () => {
    const fixture = await projectFixture();
    const before = fixture.files();
    const close = vi.spyOn(
      fixture.repository.ProjectRepository.prototype,
      'close',
    );
    try {
      const reader = new SqliteProjectPersistence(fixture.database);
      expect(await reader.get('project_001', 1)).toEqual(fixture.historical);
      expect(await reader.get('project_001', 2)).toEqual(fixture.current);
      expect(await reader.get('project_001', 3)).toBeNull();
      expect(close).toHaveBeenCalledTimes(3);
      expect(fixture.files()).toEqual(before);
    } finally {
      close.mockRestore();
      fixture.cleanup();
    }
  });

  it('reads committed WAL versions without modifying WAL frames', async () => {
    const fixture = await projectFixture();
    const writer = new fixture.repository.ProjectRepository(fixture.database);
    try {
      const third = writer.createVersion(
        {
          id: 'project_001',
          version: 3,
          name: 'WAL version',
          niche: 'Tecnologia',
          audience: { profile: 'Operador' },
          channel: { publishing: { networks: ['instagram'] } },
        },
        { expectedVersion: 2 },
      );
      const before = fixture.files();
      expect(before.wal).not.toBe('');
      expect(
        await new SqliteProjectPersistence(fixture.database).get(
          'project_001',
          3,
        ),
      ).toEqual(third);
      expect(fixture.files()).toEqual(before);
    } finally {
      writer.close();
      fixture.cleanup();
    }
  });

  it('closes the connection when stored snapshot violates the contract', async () => {
    const fixture = await projectFixture();
    const raw = new DatabaseSync(fixture.database);
    raw.exec('DROP TRIGGER IF EXISTS project_snapshots_no_update');
    const triggers = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='project_snapshots'",
      )
      .all();
    for (const trigger of triggers)
      raw.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
    raw
      .prepare(
        'UPDATE project_snapshots SET snapshot_json = ? WHERE version = 1',
      )
      .run('{}');
    raw.close();
    const before = fixture.files();
    const close = vi.spyOn(
      fixture.repository.ProjectRepository.prototype,
      'close',
    );
    try {
      await expect(
        new SqliteProjectPersistence(fixture.database).get('project_001', 1),
      ).rejects.toThrow();
      expect(close).toHaveBeenCalledExactlyOnceWith();
      expect(fixture.files()).toEqual(before);
    } finally {
      close.mockRestore();
      fixture.cleanup();
    }
  });

  it('does not create missing databases or migrate incompatible schemas', async () => {
    const fixture = await projectFixture();
    try {
      const absent = join(fixture.directory, 'absent', 'missing.sqlite');
      await expect(
        new SqliteProjectPersistence(absent).get('project_001', 1),
      ).rejects.toThrow();
      expect(existsSync(join(fixture.directory, 'absent'))).toBe(false);
      const old = join(fixture.directory, 'old.sqlite');
      const raw = new DatabaseSync(old);
      raw.exec('PRAGMA user_version = 1');
      raw.close();
      const before = fixture.files();
      await expect(
        new SqliteProjectPersistence(old).get('project_001', 1),
      ).rejects.toThrow('PROJECT_SCHEMA_VERSION_UNSUPPORTED');
      expect(fixture.files()).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });

  it.each([null, '', 'relative.sqlite'])(
    'rejects unconfigured or relative database paths: %s',
    async (path) => {
      await expect(
        new SqliteProjectPersistence(path).get('project_001', 1),
      ).rejects.toThrow('explicit absolute path');
    },
  );
});
