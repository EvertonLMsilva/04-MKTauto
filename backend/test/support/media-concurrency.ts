import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { EditorialScript } from '../../src/content/domain/content.types.js';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

export async function raceMedia(
  database: string,
  method: string,
  values: unknown[],
  scriptValue: EditorialScript,
) {
  // Keep WAL initialized while read-only Operations sessions open, as in the
  // existing integration fixtures that retain their provisioning connection.
  const anchor = new DatabaseSync(database);
  anchor.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const directory = dirname(database),
    visited = new Set<string>();
  function compile(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const output = transpileModule(
      readFileSync(new URL(`../../src/${name}.ts`, import.meta.url), 'utf8'),
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
  compile('media/infrastructure/media-asset.repository');

  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const worker = join(directory, 'media-race.mjs');
  writeFileSync(
    worker,
    `
import {parentPort,workerData} from 'node:worker_threads';
import {MediaAssetRepository} from './media/infrastructure/media-asset.repository.js';


const script=workerData.scriptValue;const run={pipelineRunId:script.pipelineRunId,projectId:script.projectId,projectVersion:script.projectVersion};
const repo=new MediaAssetRepository(workerData.database,{get:id=>id===run.pipelineRunId?run:null},{getScript:id=>id===script.scriptId?script:null});
const barrier=new Int32Array(workerData.barrier);
parentPort.postMessage('ready');Atomics.wait(barrier,0,0);
try{repo[workerData.method](workerData.value);parentPort.postMessage({ok:true});}
catch(error){parentPort.postMessage({ok:false,code:error.code});}
finally{repo.close();}
`,
  );
  const barrier = new SharedArrayBuffer(4),
    workers: Worker[] = [];
  let ready = 0;
  try {
    return await Promise.all(
      values.map(
        (value) =>
          new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
            const w = new Worker(pathToFileURL(worker), {
              workerData: { database, method, value, barrier, scriptValue },
            });
            workers.push(w);
            w.on('message', (message) => {
              if (message === 'ready') {
                if (++ready === values.length) {
                  Atomics.store(new Int32Array(barrier), 0, 1);
                  Atomics.notify(new Int32Array(barrier), 0);
                }
              } else resolve(message as { ok: boolean; code?: string });
            });
            w.on('error', reject);
            w.on('exit', (code) => {
              if (code !== 0) reject(new Error(`worker exit ${code}`));
            });
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    anchor.close();
  }
}
