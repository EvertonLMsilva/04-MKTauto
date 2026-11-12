import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { SqliteAffiliateRepository } from './infrastructure/sqlite-affiliate.repository.js';
import { SqliteProjectRepository } from '../project/infrastructure/sqlite-project.repository.js';
import { catalogError, errorCode } from './infrastructure/discovery-error.js';
import { validateFirstProductInput } from './domain/first-product-preparation.js';

// node dist/modules/affiliate/prepare-first-product.js --output pending.json
// With explicit input: --input candidate.json [--database readonly-context.sqlite]
// Uses only the existing AFFILIATE_DISCOVERY_CONFIG / FFMPEG_MEDIA_ROOT sources.
// SQLite handles are read-only; only the requested report is written. There is
// no PROJECT_API_DATABASE fallback or Nest server bootstrap.
export async function runFirstProductPreparation(args: string[]) {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !['--input', '--output', '--database'].includes(key) ||
      options.has(key) ||
      !value ||
      value.startsWith('--')
    )
      throw catalogError('FIRST_PRODUCT_ARGUMENTS_INVALID');
    options.set(key, value);
  }
  if (
    !options.has('--output') ||
    (options.has('--database') && !options.has('--input'))
  )
    throw catalogError('FIRST_PRODUCT_ARGUMENTS_INVALID');
  let input: unknown;
  if (options.has('--input')) {
    const path = resolve(options.get('--input')!),
      metadata = await stat(path);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 1048576)
      throw catalogError('FIRST_PRODUCT_INPUT_INVALID');
    const bytes = await readFile(path);
    if (bytes.length > 1048576)
      throw catalogError('FIRST_PRODUCT_INPUT_INVALID');
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw catalogError('FIRST_PRODUCT_INPUT_INVALID');
    }
    input = validateFirstProductInput(input);
  }
  const path = options.has('--database')
    ? resolve(options.get('--database')!)
    : null;
  const persistence = path
    ? { open: () => new SqliteAffiliateRepository(path, { readOnly: true }) }
    : undefined;
  const projects = path
    ? {
        get: async (id: string, version?: number) => {
          const repository = new SqliteProjectRepository(path, {
            readOnly: true,
          });
          try {
            return repository.get(id, version);
          } finally {
            repository.close();
          }
        },
      }
    : undefined;
  const report = await new QualificationPreviewService(
    new FeedQualificationService(),
    persistence,
    projects,
  ).prepareFirstProduct(input);
  await writeFile(
    resolve(options.get('--output')!),
    JSON.stringify(report, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFirstProductPreparation(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${errorCode(error) ?? 'FIRST_PRODUCT_PREPARATION_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
