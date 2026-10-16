import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { provisionSchema } from '../../src/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../../src/content-operations/infrastructure/sqlite-operations.repository.js';

const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);

// Seeds through current NestJS repositories, never the retired runtime/reference replay.
export function falFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-fal-nest-'));
  const database = join(directory, 'test.sqlite');
  const db = new DatabaseSync(database);
  try {
    provisionSchema(db);
  } finally {
    db.close();
  }
  const base = new SqliteOperationsRepository(database);
  base.create(fixtures.project());
  return {
    database,
    base,
    cleanup() {
      base.close();
      rmSync(directory, { recursive: true });
    },
  };
}
