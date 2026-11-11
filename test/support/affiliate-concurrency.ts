import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

interface Result {
  ok: boolean;
  code?: string;
}
export function raceProducts(
  database: string,
  inputs: { product: unknown; key: string }[],
) {
  return raceAffiliate(database, inputs, 'product');
}
export function raceCampaignSources(
  database: string,
  inputs: { source: unknown; key: string; refs: string[] }[],
) {
  return raceAffiliate(database, inputs, 'source');
}
async function raceAffiliate(
  database: string,
  inputs: unknown[],
  operation: 'product' | 'source',
): Promise<Result[]> {
  const directory = dirname(database);
  // Execute the actual TS implementation in separate native workers. Transpile
  // only into the disposable fixture; no compiled artifacts enter the workspace.
  for (const [folder, name] of [
    ['domain', 'affiliate.errors'],
    ['domain', 'affiliate-contracts'],
    ['domain', 'affiliate-campaign-source'],
    ['domain', 'shopee-link-url'],
    ['application', 'affiliate-commands.dto'],
    ['infrastructure', 'sqlite-affiliate.repository'],
  ]) {
    const source = readFileSync(
      new URL(`../../src/modules/affiliate/${folder}/${name}.ts`, import.meta.url),
      'utf8',
    ).replace(/\.\.\/(?:domain|application)\//g, './');
    const output = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2023,
      },
    }).outputText;
    writeFileSync(join(directory, `${name}.js`), output);
  }
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const workerPath = join(directory, 'race.mjs');
  writeFileSync(
    workerPath,
    `
    import { parentPort, workerData } from 'node:worker_threads';
    import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
    const repository = new SqliteAffiliateRepository(workerData.database);
    const barrier = new Int32Array(workerData.barrier);
    parentPort.postMessage('ready');
    Atomics.wait(barrier, 0, 0);
    let result;
    try {
      if (workerData.operation === 'source') repository.associateCampaignSource(workerData.input.source, workerData.input.key, workerData.input.refs);
      else repository.registerProduct(workerData.input.product, workerData.input.key);
      result = {ok:true};
    }
    catch(error) { result = {ok:false,code:error.code}; }
    finally { repository.close(); }
    parentPort.postMessage(result);
  `,
  );
  const barrier = new SharedArrayBuffer(4);
  let ready = 0;
  const workers: Worker[] = [];
  try {
    return await Promise.all(
      inputs.map(
        (input) =>
          new Promise<Result>((resolve, reject) => {
            const worker = new Worker(pathToFileURL(workerPath), {
              workerData: { database, input, barrier, operation },
            });
            workers.push(worker);
            const timer = setTimeout(
              () => reject(new Error('SQLite race timed out')),
              10000,
            );
            worker.on('message', (message: 'ready' | Result) => {
              if (message === 'ready') {
                if (++ready === inputs.length) {
                  Atomics.store(new Int32Array(barrier), 0, 1);
                  Atomics.notify(new Int32Array(barrier), 0);
                }
              } else {
                clearTimeout(timer);
                resolve(message);
              }
            });
            worker.on('error', (error) => {
              clearTimeout(timer);
              reject(error);
            });
            worker.on('exit', (code) => {
              if (code !== 0) {
                clearTimeout(timer);
                reject(new Error(`SQLite worker exited ${code}`));
              }
            });
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
