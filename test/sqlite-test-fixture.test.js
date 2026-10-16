import { provisionSchema } from "../backend/dist/administration/schema-provisioner.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteProjectRepository as ProjectRepository } from '../backend/dist/project/infrastructure/sqlite-project.repository.js';
import { withTemporarySqlite } from './sqlite-test-fixture.js';

test('fecha todas as conexões e remove fixture após falha de assertion', () => {
  let repository, raw, path;
  assert.throws(() => withTemporarySqlite('mktauto-cleanup-', (file, open) => {
    path = file;
    const setup = open(DatabaseSync, path);
    provisionSchema(setup);
    setup.close();
    repository = open(ProjectRepository, path);
    raw = open(DatabaseSync, path);
    assert.fail('forced assertion failure');
  }), /forced assertion failure/);
  assert.equal(repository.db.isOpen, false);
  assert.equal(raw.isOpen, false);
  assert.equal(existsSync(dirname(path)), false);
});
