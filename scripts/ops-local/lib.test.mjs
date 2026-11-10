import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { repository, workerFile, flags, initialize, loadConfig, safeEnvironment, externalPath, parseArguments, matchesWorkerIdentity, validStopRequest, backup, stop, status, writeNewJson, runDirectory, portAvailable } from './lib.mjs';

const parent = process.platform === 'win32' ? 'D:\\' : tmpdir();
const base = mkdtempSync(join(parent, 'mktauto-ops-test-'));
test.after(() => {
  const target = resolve(base);
  assert.ok(target.startsWith(resolve(parent) + (resolve(parent).endsWith(sep) ? '' : sep)));
  assert.ok(target.includes('mktauto-ops-test-'));
  rmSync(target, { recursive: true, force: true });
});
const frontend = join(base, 'frontend');
mkdirSync(frontend);
writeFileSync(join(frontend, 'vite.config.ts'), 'export default {}');
// Small SQLite fixture only. Never import/provision the operational schema in these tests.
const provisionFixture = db => {
  db.exec("PRAGMA user_version=44; CREATE TABLE social_publication_context(singleton INTEGER,execution_mode TEXT,database_id TEXT); INSERT INTO social_publication_context VALUES(1,'fake','test-db'); CREATE TABLE facts(id INTEGER PRIMARY KEY,value TEXT);");
};
async function pilot(name, extra = {}) {
  const root = join(base, name);
  await initialize({ root, frontend, ...extra }, provisionFixture);
  return root;
}

test('CLI accepts only the documented commands/options, including explicit QC path', () => {
  const result = parseArguments(['init', '--root', base, '--frontend', frontend, '--identities', join(base, 'ids.json'), '--backend-port', '3124']);
  assert.equal(result.options.backendPort, '3124');
  assert.throws(() => parseArguments(['start', '--root', base, '--live', 'true']), /ARGUMENT_INVALID/);
  assert.throws(() => parseArguments(['start', '--root', base, '--root', base]), /ARGUMENT_INVALID/);
  assert.throws(() => parseArguments(['unknown']), /COMMAND_REQUIRED/);
});
test('unsafe roots and resource paths are rejected before creating files', async () => {
  assert.throws(() => externalPath('relative'), /ABSOLUTE_PATH_REQUIRED/);
  assert.throws(() => externalPath(join(repository, 'pilot-forbidden')), /GIT_PATH_FORBIDDEN/);
  await assert.rejects(initialize({ root: join(base, 'bad-port'), frontend, backendPort: '22' }, provisionFixture), /PORT_INVALID/);
  const resourceFile = join(base, 'relative-resource.json');
  writeFileSync(resourceFile, JSON.stringify({ FFMPEG_PATH: 'relative.exe' }));
  await assert.rejects(initialize({ root: join(base, 'bad-resource'), frontend, resources: resourceFile }, provisionFixture), /RESOURCE_ABSOLUTE_PATH_REQUIRED/);
  assert.equal(existsSync(join(base, 'bad-resource')), false);
});
test('init copies only approved local resources, creates new evidence key and never copies credential content', async () => {
  const source = join(base, 'resources.json'), identities = join(base, 'identities.json');
  const sourceBytes = JSON.stringify({ FFMPEG_PATH: join(base, 'ffmpeg.exe'), LOCAL_ALIGNMENT_DEVICE: 'cpu', OPENAI_API_KEY: 'secret-do-not-copy', PROJECT_API_DATABASE: 'old.sqlite', INSTAGRAM_PUBLICATION_MODE: 'live', LOCAL_ALIGNMENT_EVIDENCE_KEY: 'old-key' });
  writeFileSync(source, sourceBytes);
  writeFileSync(identities, 'not-json-identity-content-must-not-be-read');
  const root = await pilot('resources-pilot', { resources: source, identities });
  const config = loadConfig(root);
  assert.deepEqual(Object.keys(config.resources).sort(), ['FFMPEG_PATH', 'LOCAL_ALIGNMENT_DEVICE']);
  assert.match(config.evidenceKey, /^[a-f0-9]{64}$/);
  assert.equal(config.identities, identities);
  assert.equal(readFileSync(source, 'utf8'), sourceBytes);
  assert.equal(readFileSync(identities, 'utf8'), 'not-json-identity-content-must-not-be-read');
  const written = readFileSync(join(root, 'private', 'config.json'), 'utf8');
  assert.ok(!written.includes('secret-do-not-copy'));
  assert.ok(!written.includes('old-key'));
});
test('init cannot overwrite any existing root or database', async () => {
  const root = await pilot('exclusive-pilot');
  const before = readFileSync(join(root, 'data', 'pilot.sqlite'));
  await assert.rejects(initialize({ root, frontend }, provisionFixture), /ROOT_ALREADY_EXISTS/);
  assert.deepEqual(readFileSync(join(root, 'data', 'pilot.sqlite')), before);
});
test('a database linked to another path is rejected before runtime access', async () => {
  const root = await pilot('linked-database-pilot');
  const alias = join(base, 'database-alias.sqlite');
  linkSync(join(root, 'data', 'pilot.sqlite'), alias);
  try { assert.throws(() => loadConfig(root), /PILOT_DATABASE_PATH_INVALID/); }
  finally { unlinkSync(alias); }
});
test('safe environment drops inherited secrets/LIVE flags/proxy injection and uses only isolated roots', async () => {
  const root = await pilot('environment-pilot');
  const config = loadConfig(root);
  const env = safeEnvironment(config, { PATH: 'system-path', OPENAI_API_KEY: 'secret', INSTAGRAM_PUBLICATION_MODE: 'live', NODE_OPTIONS: '--import bad', HTTP_PROXY: 'http://remote', VITE_SECRET: 'secret' });
  for (const key of ['OPENAI_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'VITE_SECRET', 'FACEBOOK_PUBLICATION_MODE']) assert.equal(env[key], undefined);
  for (const [key, value] of Object.entries(flags)) assert.equal(env[key], value);
  assert.equal(env.PATH, 'system-path');
  assert.equal(env.PROJECT_API_DATABASE, env.SOCIAL_HISTORY_DATABASE);
  assert.equal(env.FFMPEG_RENDER_ROOT, env.PUBLISHING_RENDER_ROOT);
  assert.equal(env.TEMP, join(root, 'tmp'));
  assert.equal(env.MKTAUTO_API_PROXY_TARGET, 'http://127.0.0.1:3124');
  assert.throws(() => safeEnvironment({ ...config, resources: { OPENAI_API_KEY: 'forbidden' } }), /RESOURCE_KEY_FORBIDDEN/);
  assert.throws(() => safeEnvironment({ ...config, resources: { INSTAGRAM_PUBLICATION_MODE: 'live' } }), /RESOURCE_KEY_FORBIDDEN/);
});
test('worker identity and stop requests bind root, unique run and role', () => {
  const run = { root: base, runId: randomUUID(), controlToken: 'a'.repeat(64) };
  const command = `node "${workerFile}" --root "${base}" --run-id ${run.runId} --role backend`;
  assert.equal(matchesWorkerIdentity(command, run, 'backend'), true);
  assert.equal(matchesWorkerIdentity(command, run, 'frontend'), false);
  assert.equal(matchesWorkerIdentity(command, { ...run, runId: randomUUID() }, 'backend'), false);
  assert.equal(validStopRequest({ ...run }, run), true);
  assert.equal(validStopRequest({ ...run, controlToken: 'b'.repeat(64) }, run), false);
  assert.equal(validStopRequest({ ...run, root: frontend }, run), false);
});
test('stop is idempotent with no worker and preserves configuration/data', async () => {
  const root = await pilot('stopped-pilot');
  const before = readFileSync(join(root, 'private', 'config.json'));
  assert.equal((await stop(root)).status, 'STOPPED');
  assert.equal((await stop(root)).status, 'STOPPED');
  assert.deepEqual(readFileSync(join(root, 'private', 'config.json')), before);
  assert.equal(existsSync(join(root, 'data', 'pilot.sqlite')), true);
});
test('stale run stop preserves history and never signals a reused/unknown process', async () => {
  const root = await pilot('stale-pilot'), runId = randomUUID();
  const run = { root, runId, controlToken: 'c'.repeat(64) };
  mkdirSync(runDirectory(root, runId));
  writeNewJson(join(runDirectory(root, runId), 'manifest.json'), run);
  writeNewJson(join(root, 'private', 'current.json'), { runId });
  writeNewJson(join(runDirectory(root, runId), 'backend.json'), { root, runId, role: 'backend', pid: 2147483647, state: 'running' });
  assert.equal((await stop(root)).status, 'STOPPED');
  assert.equal(existsSync(join(runDirectory(root, runId), 'backend.json')), true);
  assert.equal(validStopRequest(JSON.parse(readFileSync(join(root, 'private', `stop-${runId}.request`), 'utf8')), run), true);
  assert.equal(status(root).workers[0].state, 'stale');
});
test('SQLite online backup contains committed WAL records, preserves source and uses unique destinations', async () => {
  const root = await pilot('backup-pilot');
  const source = new DatabaseSync(join(root, 'data', 'pilot.sqlite'));
  try {
    source.exec("PRAGMA journal_mode=WAL; INSERT INTO facts(value) VALUES('persisted');");
    const first = await backup(root), second = await backup(root);
    assert.notEqual(first.destination, second.destination);
    const copy = new DatabaseSync(first.destination, { readOnly: true });
    try {
      assert.equal(copy.prepare('SELECT value FROM facts').get().value, 'persisted');
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { copy.close(); }
    assert.equal(source.prepare('SELECT count(*) AS n FROM facts').get().n, 1);
    assert.equal(readdirSync(join(root, 'backups')).filter(name => name.endsWith('.sqlite')).length, 2);
  } finally { source.close(); }
});
test('occupied loopback port is rejected without affecting its listener', async () => {
  const server = createServer();
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  try { await assert.rejects(portAvailable(server.address().port), /PORT_OCCUPIED/); assert.equal(server.listening, true); }
  finally { await new Promise(ok => server.close(ok)); }
});
