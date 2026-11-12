import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as contracts from './domain/affiliate-contracts.js';
import * as catalog from './domain/affiliate-catalog.js';
import * as projects from '../project/domain/project-contracts.js';
import * as images from './infrastructure/qualification-image.reader.js';
const scriptUrl = new URL(
  '../../../scripts/ops-local/first-commercial-product.mjs',
  import.meta.url,
);
const { inspectFirstCommercialProduct, runFirstCommercialProduct } =
  await import(scriptUrl.href);
const runtime = { ...contracts, ...catalog, ...projects, ...images };
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'mktauto-c019-unit-'));
  directories.push(path);
  return path;
}

test('no candidate reports the precise missing real evidence without importing runtime or reading storage', async () => {
  const report = await inspectFirstCommercialProduct();
  expect(report).toMatchObject({
    technicalStatus: 'BLOCKED',
    realProductAuthorized: false,
    realProductStatus: 'MISSING',
    firstBlocker: 'OPERATOR_PROVIDED_INPUT_REQUIRED',
    databaseChanged: false,
    registrationAuthorized: false,
  });
  expect(report.requiredFields).toContain('product.localImage.contentHash');
  expect(report.endpoints.registerProduct).toBe('POST /affiliate/products');
});
test.each([
  null,
  [],
  {},
  {
    dataOrigin: 'OPERATOR_PROVIDED',
    product: {},
    campaign: {},
    project: {},
    actorId: 'self_declared',
  },
])('invalid candidate envelope is sanitized', async (candidate) => {
  const report = await inspectFirstCommercialProduct(candidate, runtime);
  expect(report.technicalStatus).toBe('BLOCKED');
  expect(report.realProductAuthorized).toBe(false);
  expect(report.firstBlocker).toBe('CANDIDATE_ENVELOPE_INVALID');
});
test.each(
  [
    [],
    ['--execute'],
    ['--dry-run', '--database', 'LIVE.sqlite'],
    ['--dry-run', '--input'],
    ['--dry-run', '--input', 'relative.json'],
    ['--dry-run', '--dry-run'],
    ['--dry-run', '--output', 'relative.json'],
  ].map((args) => ({ args })),
)('rejects unsafe or ambiguous arguments $args', async ({ args }) => {
  await expect(runFirstCommercialProduct(args, runtime)).rejects.toThrow(
    'FIRST_COMMERCIAL_PRODUCT_ARGUMENTS_INVALID',
  );
});
test('explicit local input is read only; report output is exclusive and never overwrites an existing file', async () => {
  const root = directory(),
    input = join(root, 'candidate.json'),
    output = join(root, 'pending.json');
  writeFileSync(input, '{}');
  const before = readFileSync(input),
    result = await runFirstCommercialProduct(
      ['--dry-run', '--input', input, '--output', output],
      runtime,
    );
  expect(result.firstBlocker).toBe('CANDIDATE_ENVELOPE_INVALID');
  expect(readFileSync(input)).toEqual(before);
  const reportBytes = readFileSync(output);
  await expect(
    runFirstCommercialProduct(
      ['--dry-run', '--input', input, '--output', output],
      runtime,
    ),
  ).rejects.toThrow('FIRST_COMMERCIAL_PRODUCT_OUTPUT_UNAVAILABLE');
  expect(readFileSync(output)).toEqual(reportBytes);
  expect(readdirSync(root).sort()).toEqual(['candidate.json', 'pending.json']);
});
test.each(['{invalid', 'x'.repeat(1048577)])(
  'invalid or oversized input never leaks its contents',
  async (text) => {
    const root = directory(),
      input = join(root, 'candidate.json');
    writeFileSync(input, text);
    await expect(
      runFirstCommercialProduct(['--dry-run', '--input', input], runtime),
    ).rejects.toThrow('FIRST_COMMERCIAL_PRODUCT_INPUT_INVALID');
  },
);
test('CLI without a candidate works without build, reports blocked and has no writes', () => {
  const root = directory(),
    result = spawnSync(
      process.execPath,
      [fileURLToPath(scriptUrl), '--dry-run'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_API_DATABASE: join(root, 'forbidden.sqlite'),
        },
      },
    );
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout).firstBlocker).toBe(
    'OPERATOR_PROVIDED_INPUT_REQUIRED',
  );
  expect(readdirSync(root)).toEqual([]);
});
