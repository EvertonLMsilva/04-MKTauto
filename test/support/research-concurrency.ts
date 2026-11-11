import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

export async function raceResearch(
  database: string,
  inputs: any[],
): Promise<{ ok: boolean; code?: string }[]> {
  const directory = dirname(database);
  const compiled = new Set<string>();
  function compile(path: string) {
    if (compiled.has(path)) return;
    compiled.add(path);
    const source = readFileSync(path, 'utf8');
    const output = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2023,
      },
    }).outputText.replace(
      /(from\s+['"])(\.[^'"]+)(['"])/g,
      (_match, prefix: string, relative: string, suffix: string) => {
        compile(
          fileURLToPath(
            new URL(relative.replace(/\.js$/, '.ts'), pathToFileURL(path)),
          ),
        );
        return `${prefix}./${basename(relative)}${suffix}`;
      },
    );
    writeFileSync(
      join(directory, basename(path).replace(/\.ts$/, '.js')),
      output,
    );
  }
  compile(
    fileURLToPath(
      new URL(
        '../../src/modules/research/infrastructure/sqlite-research.repository.ts',
        import.meta.url,
      ),
    ),
  );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const workerPath = join(directory, 'research-worker.mjs');
  writeFileSync(
    workerPath,
    `
    import {parentPort,workerData} from 'node:worker_threads';
    import {SqliteResearchRepository} from './sqlite-research.repository.js';
    const store=new SqliteResearchRepository(workerData.database);
    const barrier=new Int32Array(workerData.barrier);
    parentPort.postMessage('ready'); Atomics.wait(barrier,0,0);
    try {store.recordOperation(workerData.input);parentPort.postMessage({ok:true});}
    catch(error){parentPort.postMessage({ok:false,code:error.code});}
    finally{store.close();}
  `,
  );
  const barrier = new SharedArrayBuffer(4),
    workers: Worker[] = [];
  let ready = 0;
  try {
    return await Promise.all(
      inputs.map(
        (input) =>
          new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
            const worker = new Worker(pathToFileURL(workerPath), {
              workerData: { database, input, barrier },
            });
            workers.push(worker);
            const timer = setTimeout(
              () => reject(new Error('Research race timed out')),
              10000,
            );
            worker.on('message', (message) => {
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
                reject(new Error(`Research worker exited ${code}`));
              }
            });
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
