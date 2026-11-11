import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const workerFile = fileURLToPath(new URL('./worker.mjs', import.meta.url));
export const resourceKeys = Object.freeze([
  'FFMPEG_PATH', 'FFPROBE_PATH', 'LOCAL_TTS_MANIFEST', 'LOCAL_TTS_MANIFEST_SHA256',
  'LOCAL_ALIGNMENT_PYTHON', 'LOCAL_ALIGNMENT_MODEL_ROOT', 'LOCAL_ALIGNMENT_MODEL_SHA256',
  'LOCAL_ALIGNMENT_DEVICE', 'LOCAL_ALIGNMENT_TEXT_POLICY',
]);
export const flags = Object.freeze({
  CAMPAIGN_SCHEDULER_ENABLED: 'false', INSTAGRAM_SCHEDULER_ENABLED: 'false',
  OPERATIONAL_NOTIFICATIONS_ENABLED: 'false', DISCORD_NOTIFICATIONS_ENABLED: 'false',
  OPENAI_TTS_LIVE_ENABLED: 'false', FAL_GENERATION_MODE: 'fake', CONTENT_EDITORIAL_PROVIDER: 'fake',
  SHOPEE_AFFILIATE_MODE: 'fake', INSTAGRAM_PUBLICATION_MODE: 'fake',
  INSTAGRAM_LIVE_POSTS_ENABLED: 'false', FACEBOOK_LIVE_POSTS_ENABLED: 'false',
  TEMPORAL_QC_MODE: 'offline', FFMPEG_VIDEO_POLICY_VERSION: 'ffmpeg-video-policy/1.0.0',
  FFMPEG_VIDEO_FRAME_RATE: '30', INSTAGRAM_ACCOUNT_ID: '987654321001', INSTAGRAM_API_VERSION: 'v25.0',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
  PYTHONUTF8: '1',
});
const directories = ['private', 'data', 'media', 'voice', 'render', 'evidence', 'tmp', 'logs', 'runs', 'backups'];
export const fail = code => { throw new Error(code); };
export const errorCode = error => [error?.message, error?.code].find(value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,100}$/.test(value)) ?? 'OPS_LOCAL_FAILED';
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const writeNewJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const equalPath = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
export function externalPath(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0') || input !== input.trim()) fail('ABSOLUTE_PATH_REQUIRED');
  const path = resolve(input);
  if (path === parse(path).root) fail('FILESYSTEM_ROOT_FORBIDDEN');
  for (let current = path; ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail('SYMLINK_PATH_FORBIDDEN');
    if (existsSync(join(current, '.git'))) fail('GIT_PATH_FORBIDDEN');
    if (dirname(current) === current) break;
  }
  return path;
}
function port(input) {
  if (!/^\d+$/.test(String(input)) || !Number.isInteger(Number(input)) || Number(input) < 1024 || Number(input) > 65535) fail('PORT_INVALID');
  return Number(input);
}
function resourcesFrom(value, filter = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('RESOURCES_INVALID');
  const source = value.env ?? value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('RESOURCES_INVALID');
  if (!filter && Object.keys(source).some(key => !resourceKeys.includes(key))) fail('RESOURCE_KEY_FORBIDDEN');
  const result = {};
  for (const key of resourceKeys) {
    if (source[key] === undefined || source[key] === '') continue;
    const item = source[key];
    if (typeof item !== 'string' || item.length > 4096 || /[\r\n\0]/.test(item)) fail('RESOURCE_VALUE_INVALID');
    if (key.endsWith('_SHA256') && !/^[a-f0-9]{64}$/.test(item)) fail('RESOURCE_HASH_INVALID');
    if (['FFMPEG_PATH', 'FFPROBE_PATH', 'LOCAL_TTS_MANIFEST', 'LOCAL_ALIGNMENT_PYTHON', 'LOCAL_ALIGNMENT_MODEL_ROOT'].includes(key) && !isAbsolute(item)) fail('RESOURCE_ABSOLUTE_PATH_REQUIRED');
    result[key] = item;
  }
  return result;
}
function protectDirectory(path) {
  if (process.platform !== 'win32') return;
  const output = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = output.match(/"(S-1-[0-9-]+)"/)?.[1];
  if (!sid) fail('WINDOWS_IDENTITY_REQUIRED');
  execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant:r', '*S-1-5-18:(OI)(CI)F'], { stdio: 'ignore', windowsHide: true });
}
export function validateConfig(config, root) {
  if (!config || config.version !== 1 || !equalPath(config.root, root) || !equalPath(config.backendRoot, repository)) fail('CONFIG_IDENTITY_INVALID');
  if (!isAbsolute(config.frontendRoot) || !existsSync(join(config.frontendRoot, 'vite.config.ts'))) fail('FRONTEND_REQUIRED');
  if (port(config.backendPort) === port(config.frontendPort)) fail('PORTS_MUST_DIFFER');
  resourcesFrom(config.resources);
  if (!/^[a-f0-9]{64}$/.test(config.evidenceKey)) fail('EVIDENCE_KEY_INVALID');
  if (config.identities) externalPath(config.identities);
  for (const directory of directories) {
    const path = join(root, directory);
    if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) fail('PILOT_DIRECTORY_INVALID');
  }
  if (lstatSync(join(root, 'private', 'config.json')).isSymbolicLink()) fail('CONFIG_PATH_INVALID');
  const database = join(root, 'data', 'pilot.sqlite');
  if (!existsSync(database)) fail('PILOT_DATABASE_REQUIRED');
  const info = lstatSync(database);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('PILOT_DATABASE_PATH_INVALID');
  return config;
}
export function loadConfig(input) {
  const root = externalPath(input);
  const file = join(root, 'private', 'config.json');
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || lstatSync(file).size > 65536) fail('CONFIG_REQUIRED');
  return validateConfig(readJson(file), root);
}
export function safeEnvironment(config, inherited = process.env) {
  const root = externalPath(config.root);
  const resources = resourcesFrom(config.resources);
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|HOME)$/i.test(key) && value !== undefined) env[key] = value;
  }
  Object.assign(env, resources, flags, {
    PROJECT_API_DATABASE: join(root, 'data', 'pilot.sqlite'), SOCIAL_HISTORY_DATABASE: join(root, 'data', 'pilot.sqlite'),
    FFMPEG_MEDIA_ROOT: join(root, 'media'), FFMPEG_VOICE_ROOT: join(root, 'voice'),
    FFMPEG_RENDER_ROOT: join(root, 'render'), PUBLISHING_RENDER_ROOT: join(root, 'render'),
    LOCAL_MEDIA_EVIDENCE_ROOT: join(root, 'evidence'), LOCAL_ALIGNMENT_EVIDENCE_KEY: config.evidenceKey,
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), PORT: String(config.backendPort),
    VITE_API_BASE_URL: `http://127.0.0.1:${config.frontendPort}`,
    MKTAUTO_API_PROXY_TARGET: `http://127.0.0.1:${config.backendPort}`,
  });
  if (config.identities) env.QC_IDENTITIES_FILE = externalPath(config.identities);
  return env;
}
export async function initialize(options, provision) {
  const root = externalPath(options.root);
  if (process.platform === 'win32' && parse(root).root.toLowerCase() !== 'd:\\') fail('ROOT_D_DRIVE_REQUIRED');
  if (existsSync(root)) fail('ROOT_ALREADY_EXISTS');
  if (!existsSync(dirname(root))) fail('ROOT_PARENT_REQUIRED');
  if (!isAbsolute(options.frontend ?? '') || !existsSync(join(options.frontend, 'vite.config.ts'))) fail('FRONTEND_REQUIRED');
  let resources = {};
  if (options.resources) {
    const path = externalPath(options.resources);
    if (!path.toLowerCase().endsWith('.json') || !lstatSync(path).isFile() || lstatSync(path).size > 65536) fail('RESOURCE_FILE_INVALID');
    resources = resourcesFrom(readJson(path), true);
  }
  const identities = options.identities ? externalPath(options.identities) : null;
  if (identities && (!existsSync(identities) || !lstatSync(identities).isFile())) fail('QC_IDENTITIES_FILE_REQUIRED');
  const config = { version: 1, root, backendRoot: repository, frontendRoot: resolve(options.frontend),
    backendPort: port(options.backendPort ?? 3124), frontendPort: port(options.frontendPort ?? 5187),
    resources, identities, evidenceKey: randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
  if (config.backendPort === config.frontendPort) fail('PORTS_MUST_DIFFER');
  const provisioner = join(repository, 'dist', 'infrastructure', 'administration', 'schema-provisioner.js');
  if (!provision && !existsSync(provisioner)) fail('BACKEND_BUILD_REQUIRED');
  mkdirSync(root, { mode: 0o700 });
  protectDirectory(root);
  for (const directory of directories) mkdirSync(join(root, directory), { mode: 0o700 });
  writeNewJson(join(root, 'private', 'config.json'), config);
  const database = join(root, 'data', 'pilot.sqlite');
  closeSync(openSync(database, 'wx', 0o600));
  const db = new DatabaseSync(database);
  try {
    const official = provision ?? (await import(pathToFileURL(provisioner).href)).provisionSchema;
    official(db, 44);
    if (Number(db.prepare('PRAGMA user_version').get().user_version) !== 44 || db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('PILOT_SCHEMA_INVALID');
    const context = db.prepare('SELECT execution_mode,database_id FROM social_publication_context WHERE singleton=1').get();
    if (context?.execution_mode !== 'fake' || !context.database_id) fail('PILOT_FAKE_CONTEXT_REQUIRED');
  } finally { db.close(); }
  return { status: 'INITIALIZED', root, schema: 44, executionMode: 'fake', identitiesConfigured: Boolean(identities) };
}
export function parseArguments(argv) {
  const [command, ...args] = argv;
  if (!['init', 'start', 'status', 'stop', 'backup'].includes(command)) fail('COMMAND_REQUIRED');
  const allowed = command === 'init' ? ['root', 'frontend', 'resources', 'identities', 'backend-port', 'frontend-port'] : ['root'];
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) fail('ARGUMENT_INVALID');
    options[key] = args[i + 1];
  }
  if (!options.root) fail('ROOT_REQUIRED');
  return { command, options: { ...options, backendPort: options['backend-port'], frontendPort: options['frontend-port'] } };
}
export async function portAvailable(number) {
  await new Promise((ok, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('PORT_OCCUPIED')));
    server.listen({ port: number, host: '127.0.0.1', exclusive: true }, () => server.close(ok));
  });
}
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const activeFile = root => join(root, 'private', 'current.json');
export const runDirectory = (root, runId) => {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId)) fail('RUN_ID_INVALID');
  return join(root, 'runs', runId);
};
export function loadRun(root, runId) {
  const directory = runDirectory(root, runId);
  const run = readJson(join(directory, 'manifest.json'));
  if (run.runId !== runId || !equalPath(run.root, root) || !/^[a-f0-9]{64}$/.test(run.controlToken)) fail('RUN_IDENTITY_INVALID');
  return run;
}
export function matchesWorkerIdentity(commandLine, run, role) {
  if (typeof commandLine !== 'string') return false;
  return commandLine.toLowerCase().includes(workerFile.toLowerCase()) &&
    commandLine.toLowerCase().includes(run.root.toLowerCase()) &&
    new RegExp(`--run-id\\s+"?${run.runId}(?:"|\\s|$)`).test(commandLine) &&
    new RegExp(`--role\\s+"?${role}(?:"|\\s|$)`).test(commandLine);
}
function processCommand(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim() || null;
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch { return null; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export function roleState(root, run, role, inspect = true) {
  const file = join(runDirectory(root, run.runId), `${role}.json`);
  const launch = join(runDirectory(root, run.runId), `${role}.launch.json`);
  if (!existsSync(file) && !existsSync(launch)) return { role, state: 'not-started', owned: false };
  const value = readJson(existsSync(file) ? file : launch);
  if (value.root !== root || value.runId !== run.runId || value.role !== role || !Number.isSafeInteger(value.pid)) fail('WORKER_IDENTITY_INVALID');
  const live = alive(value.pid);
  const owned = live && (!inspect || matchesWorkerIdentity(processCommand(value.pid), run, role));
  return { role, pid: value.pid, state: live ? owned ? value.state : 'unverified' : ['stopped', 'failed'].includes(value.state) ? value.state : 'stale', owned, code: value.code ?? null };
}
export function status(input) {
  const config = loadConfig(input), root = config.root;
  if (!existsSync(activeFile(root))) return { status: 'STOPPED', root, runtime: process.version, runId: null, workers: [] };
  const { runId } = readJson(activeFile(root));
  const run = loadRun(root, runId);
  const workers = ['backend', 'frontend'].map(role => roleState(root, run, role));
  return { status: workers.every(worker => worker.state === 'running' && worker.owned) ? 'RUNNING' : workers.some(worker => worker.owned || worker.state === 'unverified') ? 'PARTIAL' : 'STOPPED', root, runtime: process.version, runId, workers };
}
function requestStop(root, run) {
  const path = join(root, 'private', `stop-${run.runId}.request`);
  if (!existsSync(path)) writeNewJson(path, { root, runId: run.runId, controlToken: run.controlToken });
}
export function validStopRequest(value, run) {
  return value?.root === run.root && value?.runId === run.runId && value?.controlToken === run.controlToken;
}
async function awaitStopped(root, run, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (['backend', 'frontend'].every(role => {
      const state = roleState(root, run, role, false);
      return ['not-started', 'stopped', 'failed', 'stale'].includes(state.state) && !state.owned;
    })) return;
    await pause(250);
  }
  fail('GRACEFUL_STOP_TIMEOUT');
}
function lock(root) {
  const file = join(root, 'private', 'lifecycle.lock');
  if (existsSync(file)) {
    const previous = readJson(file);
    if (!Number.isSafeInteger(previous.pid) || alive(previous.pid)) fail('LIFECYCLE_BUSY');
    renameSync(file, join(root, 'runs', `abandoned-lock-${randomUUID()}.json`));
  }
  writeNewJson(file, { pid: process.pid });
  return () => unlinkSync(file);
}
export async function stop(input) {
  const config = loadConfig(input), root = config.root, release = lock(root);
  try {
    if (!existsSync(activeFile(root))) return { status: 'STOPPED', root, runId: null, workers: [] };
    const run = loadRun(root, readJson(activeFile(root)).runId);
    // The request is consumed only by a wrapper matching root + runId + token.
    // No PID is ever signalled, even if a stale PID now belongs to another app.
    requestStop(root, run);
    await awaitStopped(root, run);
    return status(root);
  } finally { release(); }
}
function requiredRuntime(config) {
  for (const file of ['bootstrap.js', 'app.module.js', 'infrastructure/administration/schema-provisioner.js']) if (!existsSync(join(repository, 'dist', file))) fail('BACKEND_BUILD_REQUIRED');
  for (const [base, name] of [[repository, '@nestjs/core'], [config.frontendRoot, 'vite']]) {
    try { createRequire(join(base, 'package.json')).resolve(name); } catch { fail('RUNTIME_DEPENDENCIES_REQUIRED'); }
  }
}
export async function start(input) {
  const config = loadConfig(input), root = config.root, release = lock(root);
  let run;
  try {
    if (status(root).status !== 'STOPPED') fail('PILOT_ALREADY_ACTIVE');
    requiredRuntime(config);
    await portAvailable(config.backendPort);
    await portAvailable(config.frontendPort);
    const runId = randomUUID();
    run = { root, runId, controlToken: randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
    const directory = runDirectory(root, runId);
    mkdirSync(directory, { mode: 0o700 });
    writeNewJson(join(directory, 'manifest.json'), run);
    const next = join(root, 'private', `current-${runId}.json`);
    writeNewJson(next, { runId });
    renameSync(next, activeFile(root));
    for (const role of ['backend', 'frontend']) {
      const log = openSync(join(root, 'logs', `${runId}-${role}.log`), 'wx', 0o600);
      try {
        const child = spawn(process.execPath, [workerFile, '--root', root, '--run-id', runId, '--role', role], {
          cwd: role === 'backend' ? repository : config.frontendRoot, env: safeEnvironment(config),
          detached: true, windowsHide: true, stdio: ['ignore', log, log],
        });
        await new Promise((ok, reject) => { child.once('spawn', ok); child.once('error', () => reject(new Error('WORKER_SPAWN_FAILED'))); });
        writeNewJson(join(directory, `${role}.launch.json`), { root, runId, role, pid: child.pid, state: 'starting' });
        child.unref();
      } finally { closeSync(log); }
      const deadline = Date.now() + 45000;
      let ready = false;
      while (Date.now() < deadline) {
        const state = roleState(root, run, role, false);
        if (['failed', 'stale', 'stopped'].includes(state.state)) fail(state.code ?? 'WORKER_START_FAILED');
        if (state.state === 'running' && state.owned) {
          try {
            const response = await fetch(`http://127.0.0.1:${role === 'backend' ? config.backendPort : config.frontendPort}/`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
            if (response.ok) { ready = true; await response.body?.cancel(); break; }
          } catch { /* Startup can still be listening shortly after its state record. */ }
        }
        await pause(200);
      }
      if (!ready) fail('HTTP_START_TIMEOUT');
    }
    return status(root);
  } catch (error) {
    if (run) {
      requestStop(root, run);
      try { await awaitStopped(root, run); } catch { fail('START_ROLLBACK_INCOMPLETE'); }
    }
    throw error;
  } finally { release(); }
}
export async function backup(input) {
  const config = loadConfig(input), root = config.root;
  const destination = join(root, 'backups', `pilot-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`);
  closeSync(openSync(destination, 'wx', 0o600));
  const source = new DatabaseSync(join(root, 'data', 'pilot.sqlite'), { readOnly: true });
  try { await sqliteBackup(source, destination); } finally { source.close(); }
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    const schema = Number(snapshot.prepare('PRAGMA user_version').get().user_version);
    if (schema !== 44 || snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('BACKUP_INTEGRITY_FAILED');
    writeNewJson(destination + '.json', { createdAt: new Date().toISOString(), source: join(root, 'data', 'pilot.sqlite'), schema, integrity: 'ok', method: 'node:sqlite backup' });
    return { status: 'BACKUP_CREATED', destination, schema, integrity: 'ok' };
  } finally { snapshot.close(); }
}
