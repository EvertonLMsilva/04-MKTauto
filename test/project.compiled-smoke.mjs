import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const backend = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'mktauto-project-compiled-'));
  const cleanupTarget = relative(tmpdir(), temporary);
  if (!isAbsolute(temporary) || cleanupTarget.startsWith('..') || !cleanupTarget.startsWith('mktauto-project-compiled-')) throw new Error('UNSAFE_SMOKE_CLEANUP');
try {
  const database = join(temporary, 'project.sqlite');
  // No source tree is copied: the compiled runtime must include its SQL assets.
  cpSync(join(backend, 'dist'), join(temporary, 'dist'), { recursive: true });
  cpSync(join(backend, 'python'), join(temporary, 'python'), { recursive: true });
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
import { Logger } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from './dist/infrastructure/administration/schema-provisioner.js';
import { bootstrap } from './dist/bootstrap.js';
const db = new DatabaseSync(process.env.PROJECT_API_DATABASE);
try {
  provisionSchema(db, 44);
  provisionSchema(db, 44);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 44);
  assert.equal(db.prepare('SELECT count(*) AS total FROM schema_migrations').get().total, 44);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
} finally { db.close(); }
Logger.overrideLogger(['error']);
const app = await bootstrap();
try {
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
  console.log('PASS: packaged SQL, schema 44 replay, compiled bootstrap, module injection and five Project endpoints');
} finally { await app.close(); }
`,
  );
  process.stdout.write(
    execFileSync(process.execPath, [script], {
      cwd: temporary,
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        TEMP: temporary, TMP: temporary, PROJECT_API_DATABASE: database, PORT: '0',
        CAMPAIGN_SCHEDULER_ENABLED: 'false', INSTAGRAM_SCHEDULER_ENABLED: 'false',
        OPERATIONAL_NOTIFICATIONS_ENABLED: 'false', DISCORD_NOTIFICATIONS_ENABLED: 'false',
        OPENAI_TTS_LIVE_ENABLED: 'false', INSTAGRAM_LIVE_POSTS_ENABLED: 'false', FACEBOOK_LIVE_POSTS_ENABLED: 'false',
        FAL_GENERATION_MODE: 'fake', CONTENT_EDITORIAL_PROVIDER: 'fake',
        SHOPEE_AFFILIATE_MODE: 'fake', INSTAGRAM_PUBLICATION_MODE: 'fake',
        INSTAGRAM_ACCOUNT_ID: '987654321001', INSTAGRAM_API_VERSION: 'v25.0',
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
      },
      encoding: 'utf8',
      timeout: 30000,
    }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
