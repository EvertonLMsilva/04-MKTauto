import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { errorCode } from './infrastructure/discovery-error.js';

// Offline preview intentionally has no operational repository/project reader.
export async function runQualificationPreview(args: string[]) {
  const batch = args[0] === '--batch';
  const options = batch ? args.slice(1) : args;
  if (
    options.length !== 4 ||
    options[0] !== '--input' ||
    options[2] !== '--output' ||
    !options[1] ||
    !options[3]
  )
    throw new Error('PREVIEW_ARGUMENTS_REQUIRED');
  const input = JSON.parse(await readFile(resolve(options[1]), 'utf8'));
  const service = new QualificationPreviewService(
    new FeedQualificationService(),
  );
  const result = batch
    ? await service.previewBatch(input)
    : await service.preview(input);
  await writeFile(resolve(options[3]), JSON.stringify(result, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runQualificationPreview(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${errorCode(error) ?? 'QUALIFICATION_PREVIEW_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
