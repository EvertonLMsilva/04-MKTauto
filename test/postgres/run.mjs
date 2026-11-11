// Creates only its own marked disposable fixture. Never uses an existing PG connection.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const nonce = randomBytes(16).toString('hex');
const marker = `MKTAUTO_PG001_DISPOSABLE_${nonce}`;
const name = `mktauto-pg001-${nonce}`;
const network = `${name}-net`;
const temporaryParent = realpathSync(tmpdir());
const temporary = mkdtempSync(join(temporaryParent, 'mktauto-pg001-'));
let containerId;
let networkId;
let exitCode = 1;
function docker(args, { mayFail = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  if (!mayFail && (result.error || result.status !== 0))
    throw new Error(
      `Disposable fixture Docker action failed: ${args[0]} (private output suppressed)`,
    );
  return result;
}
function cleanupFixture() {
  if (containerId) {
    const inspect = JSON.parse(docker(['inspect', containerId]).stdout)[0];
    if (
      inspect.Config.Labels['mktauto.test.owner'] !== marker ||
      inspect.Name !== '/' + name
    )
      throw new Error('Fixture ownership mismatch: refusing container cleanup');
    docker(['rm', '--force', containerId]);
  }
  if (networkId) {
    const inspect = JSON.parse(
      docker(['network', 'inspect', networkId]).stdout,
    )[0];
    if (
      inspect.Labels['mktauto.test.owner'] !== marker ||
      inspect.Name !== network ||
      Object.keys(inspect.Containers).length
    )
      throw new Error('Fixture ownership mismatch: refusing network cleanup');
    docker(['network', 'rm', networkId]);
  }
  const resolvedTemporary = realpathSync(temporary);
  if (
    dirname(resolvedTemporary) !== temporaryParent ||
    !basename(resolvedTemporary).startsWith('mktauto-pg001-')
  )
    throw new Error('Invalid private temporary-directory boundary');
  rmSync(resolve(resolvedTemporary), { recursive: true, force: false });
  console.log(
    'Disposable fixture removed; existing containers and volumes untouched',
  );
}
try {
  // This exact already-local image is required; no pull, model download or shared server.
  const image = docker([
    'image',
    'inspect',
    'postgres:18.6',
    '--format',
    '{{.Id}}',
  ]).stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('A local postgres:18.6 image is required');
  // Dedicated bridge: this Docker engine suppresses published ports on --internal networks.
  networkId = docker([
    'network',
    'create',
    '--label',
    `mktauto.test.owner=${marker}`,
    network,
  ]).stdout.trim();
  const password = randomBytes(32).toString('hex');
  const envFile = join(temporary, 'postgres.private.env');
  writeFileSync(
    envFile,
    `POSTGRES_DB=mktauto\nPOSTGRES_USER=mktauto_test\nPOSTGRES_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  containerId = docker([
    'run',
    '-d',
    '--pull=never',
    '--name',
    name,
    '--label',
    `mktauto.test.owner=${marker}`,
    '--network',
    network,
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql:rw',
    '--env-file',
    envFile,
    image,
  ]).stdout.trim();
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const check = docker(
      [
        'exec',
        containerId,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'mktauto_test',
        '-d',
        'mktauto',
      ],
      { mayFail: true },
    );
    if (check.status === 0) {
      ready = true;
      break;
    }
    await delay(250);
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  docker([
    'exec',
    containerId,
    'psql',
    '-U',
    'mktauto_test',
    '-d',
    'mktauto',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `COMMENT ON DATABASE mktauto IS '${marker}';`,
  ]);
  const published = docker(['port', containerId, '5432/tcp']).stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(published) || published.endsWith(':5432'))
    throw new Error('Unexpected fixture port');
  const version = docker([
    'exec',
    containerId,
    'postgres',
    '--version',
  ]).stdout.trim();
  console.log(
    `Disposable database: ${version}; mktauto; private credentials; dedicated network + loopback ephemeral port`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(repository, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'test/postgres/vitest.config.ts',
      ...process.argv.slice(2),
    ],
    {
      cwd: repository,
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        MKTAUTO_POSTGRES_TEST_URL: `postgresql://mktauto_test:${password}@${published}/mktauto`,
        MKTAUTO_POSTGRES_TEST_MARKER: marker,
      },
    },
  );
  exitCode = result.error ? 1 : (result.status ?? 1);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Disposable fixture failed',
  );
  if (containerId) {
    const diagnostic = docker(['inspect', containerId], { mayFail: true });
    if (diagnostic.status === 0) {
      const fixture = JSON.parse(diagnostic.stdout)[0];
      console.error(
        JSON.stringify({
          fixtureStatus: fixture.State.Status,
          running: fixture.State.Running,
          exitCode: fixture.State.ExitCode,
          requestedPorts: fixture.HostConfig.PortBindings,
          publishedPorts: fixture.NetworkSettings.Ports,
        }),
      );
    }
  }
} finally {
  try {
    cleanupFixture();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Disposable cleanup failed',
    );
    exitCode = 1;
  }
}
process.exitCode = exitCode;
