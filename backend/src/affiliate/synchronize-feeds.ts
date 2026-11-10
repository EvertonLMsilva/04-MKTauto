import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFeedSnapshot,
  compareFeedSnapshots,
} from './application/feed-synchronization.service.js';
import { errorCode } from './infrastructure/discovery-error.js';

// No application initialization, operational database, registration or network.
export async function runFeedSynchronization(args: string[]) {
  if (
    args.length !== 5 ||
    !['snapshot', 'compare'].includes(args[0]) ||
    args[1] !== '--input' ||
    args[3] !== '--output' ||
    !args[2] ||
    !args[4]
  )
    throw Error(
      'Usage: synchronize-feeds snapshot|compare --input REQUEST.json --output NEW_ARTIFACT.json',
    );
  const inputPath = resolve(args[2]);
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const local = (p: string) => resolve(dirname(inputPath), p);
  const result =
    args[0] === 'snapshot'
      ? await createFeedSnapshot({
          ...input,
          configPath: local(input.configPath),
        })
      : compareFeedSnapshots(
          JSON.parse(await readFile(local(input.before), 'utf8')),
          JSON.parse(await readFile(local(input.after), 'utf8')),
          input.evaluatedAt,
          input.registeredCatalog
            ? JSON.parse(await readFile(local(input.registeredCatalog), 'utf8'))
            : [],
        );
  await writeFile(resolve(args[4]), JSON.stringify(result, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFeedSynchronization(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${errorCode(error) ?? 'FEED_SYNCHRONIZATION_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
