import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

interface Result {
  ok: boolean;
  code?: string;
  selected?: boolean;
}
export async function raceDiscovery(
  database: string,
  inputs: { id: string; hash: string; candidate: unknown }[],
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
    ['domain', 'discovery-media-evidence'],
    ['domain', 'affiliate-discovery'],
    ['infrastructure', 'sqlite-discovery.repository'],
  ]) {
    const source = readFileSync(
      new URL(`../../src/affiliate/${folder}/${name}.ts`, import.meta.url),
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
    import { SqliteDiscoveryRepository } from './sqlite-discovery.repository.js';
    import { rankAffiliateDiscovery, DEFAULT_AFFILIATE_DISCOVERY_POLICY as policy } from './affiliate-discovery.js';
    const repository = new SqliteDiscoveryRepository(workerData.database);
    const barrier = new Int32Array(workerData.barrier);
    parentPort.postMessage('ready');
    Atomics.wait(barrier, 0, 0);
    let result;
    try {
      const {id,hash,candidate}=workerData.input,at='2026-10-13T12:00:00Z';
      const decision=repository.reserve(id,hash,()=>{
        const ranking=rankAffiliateDiscovery([candidate],policy,at,repository.used([candidate]));
        const chosen=ranking.ranked[0],selection=chosen?{...chosen,externalProductId:candidate.externalProductId,sourceId:candidate.sourceId,actor:{type:'AUTOMATION',id:'kate_mkt_discovery'}}:null;
        return {discoveryRunId:id,selection,ranking,candidates:[candidate],source:{},errors:[],policy,evaluatedAt:at};
      },at);
      result = {ok:true,selected:decision.selection!==null};
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
              workerData: { database, input, barrier },
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
