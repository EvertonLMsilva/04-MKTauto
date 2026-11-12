import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  physicalHash,
  explicitLocalPath,
  readExplicitFile,
  verifyPhysicalMedia,
} from './application/physical-verification.js';

// node dist/modules/media/verify-physical-media.js --manifest ABS.json --manifest-sha256 HASH
//   --mp4 ABS.mp4 --output NEW_ABS.json --ffprobe ABS.exe [--ffmpeg ABS.exe --decode]
export async function runPhysicalVerificationCommand(args: string[]) {
  const values: Record<string, string> = {};
  let decode = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--decode') {
      if (decode) throw Error('INVALID_ARGUMENTS');
      decode = true;
      continue;
    }
    if (
      ![
        '--manifest',
        '--manifest-sha256',
        '--mp4',
        '--output',
        '--ffprobe',
        '--ffmpeg',
      ].includes(flag) ||
      values[flag] ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw Error('INVALID_ARGUMENTS');
    values[flag] = args[++i];
  }
  for (const flag of ['--manifest', '--mp4', '--output'])
    if (!values[flag] || !explicitLocalPath(values[flag]))
      throw Error('EXPLICIT_ABSOLUTE_PATH_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(values['--manifest-sha256'] ?? ''))
    throw Error('MANIFEST_HASH_REQUIRED');
  if (
    [
      values['--manifest'],
      values['--mp4'],
      values['--ffprobe'],
      values['--ffmpeg'],
    ].some((p) => p && resolve(p) === resolve(values['--output']))
  )
    throw Error('OUTPUT_MUST_BE_NEW');
  const bytes = readExplicitFile(values['--manifest'], 2097152);
  if (physicalHash(bytes) !== values['--manifest-sha256'])
    throw Error('MANIFEST_HASH_MISMATCH');
  const report = await verifyPhysicalMedia(JSON.parse(bytes.toString('utf8')), {
    mp4Path: values['--mp4'],
    ffprobePath: values['--ffprobe'],
    ffmpegPath: values['--ffmpeg'],
    decode,
  });
  writeFileSync(
    values['--output'],
    JSON.stringify(
      { ...report, inputManifestSha256: physicalHash(bytes) },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return report.status === 'TECHNICAL_VALIDATED' ? 0 : 2;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await runPhysicalVerificationCommand(
      process.argv.slice(2),
    );
  } catch {
    process.stderr.write('PHYSICAL_VERIFICATION_COMMAND_FAILED\n');
    process.exitCode = 1;
  }
}
