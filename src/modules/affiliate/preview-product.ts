import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { errorCode } from './infrastructure/discovery-error.js';

// Offline preview intentionally has no operational repository/project reader.
export async function runQualificationPreview(args: string[]) {
  if (
    args.length !== 4 ||
    args[0] !== '--input' ||
    args[2] !== '--output' ||
    !args[1] ||
    !args[3]
  )
    throw new Error('PREVIEW_ARGUMENTS_REQUIRED');
  const input = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  const result = await new QualificationPreviewService(
    new FeedQualificationService(),
  ).preview(input);
  await writeFile(resolve(args[3]), JSON.stringify(result, null, 2) + '\n', {
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
