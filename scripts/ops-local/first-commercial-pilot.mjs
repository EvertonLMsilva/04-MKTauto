import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { externalPath, safeEnvironment, repository } from './lib.mjs';

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const sha256 = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const regular = (file) => {
  externalPath(file);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    fail('PILOT_REGULAR_FILE_REQUIRED');
  return file;
};
const json = (file) => {
  regular(file);
  if (lstatSync(file).size > 16384) fail('PILOT_CONFIG_TOO_LARGE');
  return JSON.parse(readFileSync(file, 'utf8'));
};

/** No implicit .env, operational database, TTS, network, server or data generation. */
export async function inspectPilot(args, inspect) {
  if (
    args.length !== 3 ||
    !['--dry-run', '--verify'].includes(args[0]) ||
    args[1] !== '--config'
  )
    fail('PILOT_USAGE_REQUIRED');
  const config = json(externalPath(args[2]));
  if (
    config.schemaVersion !== 'first-commercial-pilot-local/1.0.0' ||
    config.classification !== 'FICTITIOUS_TEST_ONLY' ||
    config.provider !== 'fake'
  )
    fail('PILOT_DISPOSABLE_FIXTURE_REQUIRED');
  const root = externalPath(config.root);
  for (const name of ['data', 'media', 'voice', 'render', 'evidence', 'tmp']) {
    const directory = externalPath(join(root, name));
    if (!lstatSync(directory).isDirectory()) fail('PILOT_DIRECTORY_REQUIRED');
  }
  const database = regular(join(root, 'data', 'pilot.sqlite'));
  // A content-bound marker is required; a filename or a fake provider alone is insufficient.
  const marker = json(join(root, 'FICTITIOUS_TEST_ONLY.json'));
  const before = sha256(database);
  if (
    marker.purpose !== 'MKTAUTO-RELEASE-FIRST-COMMERCIAL-PILOT-001' ||
    marker.classification !== 'FICTITIOUS_TEST_ONLY' ||
    marker.databaseSha256 !== before
  )
    fail('PILOT_DISPOSABLE_IDENTITY_MISMATCH');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{2,199}$/.test(config.executionId) ||
    (config.packageHash !== undefined &&
      !/^[a-f0-9]{64}$/.test(config.packageHash))
  )
    fail('PILOT_QUERY_INVALID');
  for (const name of ['ffmpeg', 'ffprobe']) {
    regular(config[name]);
    execFileSync(config[name], ['-version'], {
      timeout: 5000,
      windowsHide: true,
      stdio: 'ignore',
    });
  }
  const result = {
    schemaVersion: 'first-commercial-pilot-smoke/1.0.0',
    classification: 'FICTITIOUS_TEST_ONLY',
    mode: args[0].slice(2),
    dependencies: 'AVAILABLE',
    databaseSha256: before,
    commercialPilotStatus: 'WAITING_REAL_PRODUCT_EVIDENCE',
    humanApproval: 'NOT_GRANTED_FOR_REAL_PILOT',
    publicationAuthorized: false,
    paidCalls: 'DISABLED',
    nextAction: 'VERIFY_DISPOSABLE_EXECUTION',
    report: null,
  };
  if (args[0] === '--verify') {
    result.report = await (inspect ?? inspectServices)(config);
    result.nextAction = result.report.nextAction;
    if (sha256(database) !== before) fail('PILOT_DATABASE_CHANGED');
  }
  return result;
}

async function inspectServices(config) {
  const env = safeEnvironment({
    root: config.root,
    resources: { FFMPEG_PATH: config.ffmpeg, FFPROBE_PATH: config.ffprobe },
    // No inference or evidence signing occurs during inspection.
    evidenceKey: '0'.repeat(64),
    backendPort: 3124,
    frontendPort: 5187,
  });
  const previous = { ...process.env };
  const fetch = globalThis.fetch;
  let app;
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    globalThis.fetch = async () => fail('PILOT_NETWORK_FORBIDDEN');
    const compiled = join(repository, 'dist', 'modules', 'operations');
    if (!existsSync(join(compiled, 'first-commercial-pilot.service.js')))
      fail('PILOT_BUILD_REQUIRED');
    await import('reflect-metadata');
    const [
      { NestFactory },
      { OperationsModule },
      { FirstCommercialPilotService },
    ] = await Promise.all([
      import('@nestjs/core'),
      import(pathToFileURL(join(compiled, 'operations.module.js')).href),
      import(
        pathToFileURL(join(compiled, 'first-commercial-pilot.service.js')).href
      ),
    ]);
    app = await NestFactory.createApplicationContext(OperationsModule, {
      logger: false,
      abortOnError: false,
    });
    return await app.get(FirstCommercialPilotService).inspect({
      executionId: config.executionId,
      ...(config.packageHash ? { packageHash: config.packageHash } : {}),
    });
  } finally {
    try {
      await app?.close();
    } finally {
      globalThis.fetch = fetch;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    process.stdout.write(
      JSON.stringify(await inspectPilot(process.argv.slice(2)), null, 2) + '\n',
    );
  } catch (error) {
    const code =
      typeof error?.code === 'string' && /^PILOT_[A-Z_]+$/.test(error.code)
        ? error.code
        : 'PILOT_INSPECTION_FAILED';
    process.stdout.write(
      JSON.stringify({
        status: 'BLOCKED',
        code,
        commercialPilotStatus: 'NOT_ACCEPTED',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
