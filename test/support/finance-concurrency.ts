import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

export async function raceFinance(
  database: string,
  commands: { method: string; args: unknown[] }[],
) {
  const directory = dirname(database),
    visited = new Set<string>();
  // Compile the actual TS dependency graph into the disposable fixture directory.
  // These are test builds, never replacement adapters or runtime JS bridges.
  function compile(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const output = transpileModule(
      readFileSync(new URL(`../../src/modules/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ModuleKind.ESNext,
          target: ScriptTarget.ES2023,
        },
      },
    ).outputText;
    const target = join(directory, `${name}.js`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
    for (const match of output.matchAll(/from ['"](\.[^'"]+)\.js['"]/g))
      compile(posix.normalize(posix.join(posix.dirname(name), match[1])));
  }
  compile('finance/infrastructure/finance.session');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const entry = join(directory, 'finance-race.mjs');
  writeFileSync(
    entry,
    `
import {parentPort,workerData as w,threadId} from 'node:worker_threads';
import {FinanceSession} from './finance/infrastructure/finance.session.js';
const repository=new FinanceSession(w.database);
parentPort.postMessage('ready');Atomics.wait(new Int32Array(w.barrier),0,0);
try{const value=repository[w.method](...w.args);parentPort.postMessage({ok:true,value,workerThreadId:threadId});}
catch(e){parentPort.postMessage({ok:false,code:e.code,message:e.message,workerThreadId:threadId});}
finally{repository.close();}
`,
  );
  const barrier = new SharedArrayBuffer(4),
    workers: Worker[] = [];
  let ready = 0;
  try {
    return await Promise.all(
      commands.map(
        (command) =>
          new Promise<{
            ok: boolean;
            workerThreadId: number;
            code?: string;
            value?: any;
          }>((resolve, reject) => {
            const worker = new Worker(pathToFileURL(entry), {
              workerData: {
                ...command,
                database,
                barrier,
              },
            });
            workers.push(worker);
            let result:
              | {
                  ok: boolean;
                  workerThreadId: number;
                  code?: string;
                  value?: any;
                }
              | undefined;
            worker.on('message', (message) => {
              if (message === 'ready') {
                if (++ready === commands.length) {
                  Atomics.store(new Int32Array(barrier), 0, 1);
                  Atomics.notify(new Int32Array(barrier), 0);
                }
              } else result = message;
            });
            worker.on('error', reject);
            worker.on('exit', (code) =>
              code === 0 && result
                ? resolve(result)
                : reject(new Error(`finance worker exit ${code}`)),
            );
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
