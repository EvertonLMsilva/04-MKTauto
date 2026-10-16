import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const backend = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'mktauto-project-compiled-'));
try {
  const database = join(temporary, 'project.sqlite');
  const provision = new DatabaseSync(database);
  try {
    for (const name of [
      '003_project_catalog.sql',
      '004_project_commands.sql',
    ]) {
      provision.exec(
        readFileSync(
          join(backend, '..', 'src', 'db', 'migrations', name),
          'utf8',
        ),
      );
    }
    provision.exec('PRAGMA user_version = 39');
  } finally {
    provision.close();
  }
  // Only compiled backend and dependencies are available to the child process.
  cpSync(join(backend, 'dist'), join(temporary, 'dist'), { recursive: true });
  symlinkSync(
    join(backend, 'node_modules'),
    join(temporary, 'node_modules'),
    'junction',
  );
  writeFileSync(join(temporary, 'package.json'), '{"type":"module"}');
  const script = join(temporary, 'smoke.mjs');
  writeFileSync(
    script,
    `
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './dist/app.module.js';
const app = await NestFactory.create(AppModule, { logger: false });
try {
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function call(path, body, status) {
    const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    assert.equal(response.status, status);
    return response.json();
  }
  const metadata = { actor: 'operator:smoke', occurredAt: '2026-10-14T12:00:00Z' };
  const project = { id: 'project_smoke', name: 'Smoke', niche: 'Tecnologia', audience: { profile: 'Público' }, channel: { publishing: { networks: ['instagram'] } } };
  const create = { ...metadata, idempotencyKey: 'smoke:create', project };
  const first = await call('/projects', create, 201);
  assert.deepEqual(await call('/projects', create, 201), first);
  const second = await call('/projects/project_smoke/versions', { ...metadata, idempotencyKey: 'smoke:version', expectedVersion: 1, project: { ...project, version: 2 } }, 201);
  assert.deepEqual(await call('/projects/project_smoke', null, 200), second);
  assert.deepEqual(await call('/projects/project_smoke/versions/1', null, 200), first);
  const archive = { ...metadata, idempotencyKey: 'smoke:archive', projectId: project.id, expectedVersion: 2 };
  const archived = await call('/projects/project_smoke/archive', archive, 200);
  assert.equal(archived.archivedAt, '2026-10-14T12:00:00.000Z');
  assert.deepEqual(await call('/projects/project_smoke/archive', archive, 200), archived);
  console.log('PASS: five compiled endpoints, replay and immutable history without legacy runtime');
} finally { await app.close(); }
`,
  );
  process.stdout.write(
    execFileSync(process.execPath, [script], {
      cwd: temporary,
      env: { ...process.env, PROJECT_API_DATABASE: database },
      encoding: 'utf8',
      timeout: 30000,
    }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
