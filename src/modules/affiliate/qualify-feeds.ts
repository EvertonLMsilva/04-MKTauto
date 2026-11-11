import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { errorCode } from './infrastructure/discovery-error.js';

// Explicit local entry point only. It never initializes the operational app/DB.
export async function runFeedQualification(args: string[]) {
  if (
    args.length !== 0 &&
    (args.length !== 2 || args[0] !== '--output' || !args[1])
  )
    throw new Error('Usage: qualify-feeds [--output NEW_REPORT.json]');
  const report = await new FeedQualificationService().analyze();
  const json = JSON.stringify(report) + '\n';
  if (args.length) {
    // Never replace a feed, configuration, prior report or other existing file.
    await writeFile(resolve(args[1]), json, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  process.stdout.write(json);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runFeedQualification(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${errorCode(error) ?? 'FEED_QUALIFICATION_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
