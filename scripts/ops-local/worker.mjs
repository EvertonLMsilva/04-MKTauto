import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { loadConfig, loadRun, runDirectory, safeEnvironment, validStopRequest, errorCode } from './lib.mjs';

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => index % 2 ? pairs : [...pairs, [value.slice(2), args[index + 1]]], []));
const config = loadConfig(values.root);
const run = loadRun(config.root, values['run-id']);
const role = values.role;
if (!['backend', 'frontend'].includes(role)) throw new Error('WORKER_ROLE_INVALID');
// Replace inherited environment again before importing application code.
const env = safeEnvironment(config);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
const stateFile = join(runDirectory(config.root, run.runId), `${role}.json`);
const state = (name, code) => {
  const temp = stateFile + `.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ root: config.root, runId: run.runId, role, pid: process.pid, state: name, updatedAt: new Date().toISOString(), ...(code ? { code } : {}) }), { flag: 'wx', mode: 0o600 });
  renameSync(temp, stateFile);
};
let server, timer, closing;
async function close(code = 0) {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(timer);
    state('stopping');
    try { await server?.close(); state('stopped'); }
    catch { state('failed', 'GRACEFUL_CLOSE_FAILED'); code = 1; }
    process.exit(code);
  })();
  return closing;
}
try {
  if (existsSync(stateFile)) throw new Error('WORKER_STATE_ALREADY_EXISTS');
  state('starting');
  if (role === 'backend') {
    const { validateConfiguration } = await import(pathToFileURL(join(config.backendRoot, 'backend', 'dist', 'bootstrap.js')).href);
    const { AppModule } = await import(pathToFileURL(join(config.backendRoot, 'backend', 'dist', 'app.module.js')).href);
    const require = createRequire(join(config.backendRoot, 'backend', 'package.json'));
    const { NestFactory } = await import(pathToFileURL(require.resolve('@nestjs/core')).href);
    validateConfiguration(process.env);
    server = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    server.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    await server.listen(config.backendPort, '127.0.0.1');
  } else {
    const require = createRequire(join(config.frontendRoot, 'package.json'));
    const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
    server = await createServer({ root: config.frontendRoot, configFile: join(config.frontendRoot, 'vite.config.ts'),
      // Skip Vite's env injection; the existing config retains its own loadEnv call.
      envDir: false, server: { host: '127.0.0.1', port: config.frontendPort, strictPort: true },
    });
    await server.listen();
  }
  state('running');
  const request = join(config.root, 'private', `stop-${run.runId}.request`);
  const check = () => {
    if (!existsSync(request)) return;
    try { if (validStopRequest(JSON.parse(readFileSync(request, 'utf8')), run)) void close(); }
    catch { /* Invalid requests never stop another run. */ }
  };
  timer = setInterval(check, 250);
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  check();
} catch (error) {
  clearInterval(timer);
  try { await server?.close(); } catch { /* Report the original sanitized failure. */ }
  state('failed', errorCode(error));
  process.stderr.write(errorCode(error) + '\n');
  process.exit(1);
}
