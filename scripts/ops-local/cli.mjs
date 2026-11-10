import { parseArguments, initialize, start, status, stop, backup, errorCode } from './lib.mjs';

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  const result = command === 'init' ? await initialize(options) : await ({ start, status, stop, backup })[command](options.root);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  // Configuration, credentials and arbitrary dependency error messages never reach output.
  process.stderr.write(JSON.stringify({ status: 'FAILED', code: errorCode(error) }) + '\n');
  process.exitCode = 1;
}
