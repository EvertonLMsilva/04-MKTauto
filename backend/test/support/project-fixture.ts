import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteProjectRepository } from '../../src/project/infrastructure/sqlite-project.repository.js';
import type { ProjectSnapshot } from '../../src/project/application/ports/project-snapshot-reader.port.js';

export async function projectFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-project-api-'));
  const database = join(directory, 'projects.sqlite');
  const provision = new DatabaseSync(database);
  try {
    for (const name of ['003_project_catalog.sql', '004_project_commands.sql'])
      provision.exec(
        readFileSync(
          new URL('../../../src/db/migrations/' + name, import.meta.url),
          'utf8',
        ),
      );
    provision.exec('PRAGMA user_version = 39;');
  } finally {
    provision.close();
  }
  const repository = new SqliteProjectRepository(database);
  let historical: ProjectSnapshot;
  let current: ProjectSnapshot;
  try {
    const project = {
      id: 'project_001',
      name: 'Original',
      niche: 'Tecnologia',
      audience: { profile: 'Operador' },
      channel: { publishing: { networks: ['instagram'] } },
    };
    historical = repository.create(project);
    current = repository.createVersion(
      { ...project, version: 2, name: 'Atual' },
      { expectedVersion: 1 },
    );
  } finally {
    repository.close();
  }
  return {
    directory,
    database,
    historical,
    current,
    repository: { ProjectRepository: SqliteProjectRepository },
    // SQLite WAL readers may create empty WAL and shared-memory lock files.
    // Compare database bytes and WAL frames; shared-memory lock bookkeeping is not data.
    files: () => ({
      databases: Object.fromEntries(
        readdirSync(directory)
          .filter((name) => !name.endsWith('-wal') && !name.endsWith('-shm'))
          .sort()
          .map((name) => [
            name,
            createHash('sha256')
              .update(readFileSync(join(directory, name)))
              .digest('hex'),
          ]),
      ),
      wal: existsSync(database + '-wal')
        ? readFileSync(database + '-wal').length === 0
          ? ''
          : createHash('sha256')
              .update(readFileSync(database + '-wal'))
              .digest('hex')
        : '',
    }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
