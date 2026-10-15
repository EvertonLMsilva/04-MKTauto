import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from './schema-provisioner.js';

const path = process.argv[2];
if (!path || !isAbsolute(path) || process.argv.length !== 3)
  throw new Error('Usage: db:provision -- <explicit absolute SQLite path>');
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
try {
  provisionSchema(db);
  console.log('SQLite schema 41 provisioned');
} finally {
  db.close();
}
