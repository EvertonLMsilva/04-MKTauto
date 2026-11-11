import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
type RaceInput =
  | { kind: 'bind'; briefingId: string; key: string }
  | { kind: 'reserve'; hash: string };
interface Result {
  ok: boolean;
  code?: string;
  briefingHash?: string | null;
}
export async function raceRunContext(
  database: string,
  inputs: RaceInput[],
): Promise<Result[]> {
  const directory = dirname(database);
  const common = pathToFileURL(
    createRequire(import.meta.url).resolve('@nestjs/common'),
  ).href;
  for (const [folder, name] of [
    ['domain', 'affiliate.errors'],
    ['domain', 'affiliate-contracts'],
    ['domain', 'affiliate-campaign-source'],
    ['domain', 'shopee-link-url'],
    ['domain', 'affiliate-run-context'],
    ['application', 'affiliate-commands.dto'],
    ['application/ports', 'affiliate-run-context.port'],
    ['application', 'affiliate-run-context.service'],
    ['infrastructure', 'sqlite-affiliate.repository'],
    ['infrastructure', 'sqlite-pipeline-context.reader'],
    ['infrastructure', 'sqlite-affiliate-run-context.repository'],
  ]) {
    const source = readFileSync(
      new URL(`../../src/modules/affiliate/${folder}/${name}.ts`, import.meta.url),
      'utf8',
    )
      .replace(/\.\.\/(?:domain|application)\//g, './')
      .replace(/\.\/ports\//g, './')
      .replace(/'@nestjs\/common'/g, `'${common}'`);
    writeFileSync(
      join(directory, `${name}.js`),
      transpileModule(source, {
        compilerOptions: {
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2023,
          experimentalDecorators: true,
        },
      }).outputText,
    );
  }
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const path = join(directory, 'run-race.mjs');
  writeFileSync(
    path,
    `
    import { parentPort, workerData } from 'node:worker_threads';
    import { SqliteAffiliateRunContextRepository } from './sqlite-affiliate-run-context.repository.js';
    import { AffiliateRunContextService } from './affiliate-run-context.service.js';
    const repo = new SqliteAffiliateRunContextRepository(workerData.database);
    const service = new AffiliateRunContextService({open:()=>repo});
    const barrier = new Int32Array(workerData.barrier);
    parentPort.postMessage('ready'); Atomics.wait(barrier,0,0);
    let result;
    try {
      const input = workerData.input;
      if(input.kind==='bind') service.bindRun({pipelineRunId:'run_001',briefingId:input.briefingId},input.key);
      else {
        const briefing = service.prepareScriptGeneration({generationRequestId:'generation:race',contentHash:input.hash},'run_001');
        result = {briefingHash:briefing?.contentHash??null};
      }
      result={...result,ok:true};
    } catch(error) { result={ok:false,code:error.code}; }
    finally { if(repo.db.isOpen) repo.close(); }
    parentPort.postMessage(result);
  `,
  );
  const barrier = new SharedArrayBuffer(4),
    workers: Worker[] = [];
  let ready = 0;
  try {
    return await Promise.all(
      inputs.map(
        (input) =>
          new Promise<Result>((resolve, reject) => {
            const worker = new Worker(pathToFileURL(path), {
              workerData: { database, input, barrier },
            });
            workers.push(worker);
            const timer = setTimeout(
              () => reject(new Error('Run context race timed out')),
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
                reject(new Error(`Run worker exited ${code}`));
              }
            });
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
