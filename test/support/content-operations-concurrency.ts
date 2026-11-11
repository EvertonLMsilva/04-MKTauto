import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
type RaceInput = {
  kind: 'start' | 'transition' | 'stage' | 'resume';
  state?: string;
};
interface Result {
  ok: boolean;
  code?: string;
}
export async function raceOperations(
  database: string,
  inputs: RaceInput[],
): Promise<Result[]> {
  const directory = dirname(database);
  // Compile only this repository's dependency closure into the disposable fixture.
  for (const name of [
    'project/domain/project-contracts',
    'project/domain/project.errors',
    'project/domain/project-rules',
    'project/infrastructure/sqlite-project.repository',
    'content-operations/domain/operations-contracts',
    'content-operations/domain/stage-contracts',
    'content-operations/infrastructure/sqlite-operations.repository',
    'content-operations/infrastructure/stage-recovery.repository',
  ]) {
    const target = join(directory, `${name}.js`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      transpileModule(
        readFileSync(new URL(`../../src/modules/${name}.ts`, import.meta.url), 'utf8'),
        {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2023,
          },
        },
      ).outputText,
    );
  }
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  const path = join(directory, 'operations-race.mjs');
  writeFileSync(
    path,
    `
    import { parentPort,workerData } from 'node:worker_threads';
    import { SqliteOperationsRepository } from './content-operations/infrastructure/sqlite-operations.repository.js';
    import { StageRecoveryRepository } from './content-operations/infrastructure/stage-recovery.repository.js';
    const repo = new SqliteOperationsRepository(workerData.database);
    const barrier = new Int32Array(workerData.barrier);
    parentPort.postMessage('ready'); Atomics.wait(barrier,0,0);
    let result;
    try {
      const input = workerData.input;
      if(input.kind === 'start') repo.startRun({ execution:{pipelineRunId:'run_race',projectId:'project_001',projectVersion:1,startedAt:'2026-10-14T12:00:00Z'},projectSnapshot:repo.get('project_001',1) });
      if(input.kind === 'transition') repo.transitionRun({pipelineRunId:'run_001',nextState:input.state,completedAt:'2026-10-14T12:01:00Z'});
      if(input.kind === 'resume') repo.resumeRun({pipelineRunId:'run_001',resumedAt:'2026-10-14T12:02:00Z'});
      if(input.kind === 'stage') new StageRecoveryRepository(repo).startAttempt({schemaVersion:'stage-recovery/1.0.0',pipelineRunId:'run_001',stage:'RESEARCH',requestHash:'a'.repeat(64),inputs:[],policyVersions:{},providerConfigHash:null},{trigger:'INITIAL',startedAt:'2026-10-14T12:00:00Z'});
      result = {ok:true};
    } catch(error) {result = {ok:false,code:error.code};}
    finally {repo.close();}
    parentPort.postMessage(result);
  `,
  );
  const barrier = new SharedArrayBuffer(4);
  const workers: Worker[] = [];
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
              () => reject(new Error('Operations race timed out')),
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
                reject(new Error(`Operations worker exited ${code}`));
              }
            });
          }),
      ),
    );
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
