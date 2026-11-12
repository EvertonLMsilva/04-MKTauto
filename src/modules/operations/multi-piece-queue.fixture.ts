import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { multiPiecePlanFixture } from './multi-piece-plan.fixture.js';
import { MultiPieceQueueRepository } from './multi-piece-queue.repository.js';
import { MultiPieceQueueService } from './multi-piece-queue.service.js';
import {
  MultiPieceQueueError,
  type OfflineWorkerIdentity,
} from './multi-piece-queue.contract.js';

export async function multiPieceQueueFixture() {
  const f = await multiPiecePlanFixture();
  try {
    const principals = new WeakMap<object, OfflineWorkerIdentity>();
    const worker = (
      workerId = 'fixture_worker_1',
      sessionId = 'fixture_session_1',
    ) => {
      const principal = Object.freeze({ fixture: true });
      principals.set(principal, { workerId, sessionId });
      return principal;
    };
    const workers = {
      assertActive: async (principal: unknown) => {
        const identity =
          principal && typeof principal === 'object'
            ? principals.get(principal)
            : null;
        if (!identity)
          throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_WORKER_REQUIRED');
        return { ...identity };
      },
    };
    const open = () =>
      new MultiPieceQueueRepository(f.database, {
        projects: f.identities.projects,
        workers,
        now: () => '2026-11-12T12:00:00.000Z',
      });
    const repository = open();
    const installQueue = () =>
      f.base.db.exec(
        readFileSync(
          new URL(
            '../../infrastructure/database/migrations/operations_multi_piece_queue_v1.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    const register = async (count = 1) => {
      const command = f.command(count);
      const receipt = await f.service.registerPlan(command);
      return receipt;
    };
    const counts = () =>
      Object.fromEntries(
        ['plans', 'entries', 'events'].map((table) => [
          table,
          f.base.db
            .prepare(
              `SELECT count(*) AS n FROM operations_multi_piece_queue_${table}_v1`,
            )
            .get()!.n,
        ]),
      );
    return {
      ...f,
      servicePlanRegister: f.service.registerPlan.bind(f.service),
      planRepository: f.repository,
      repository,
      service: new MultiPieceQueueService(repository),
      worker,
      workers,
      open,
      installQueue,
      register,
      counts,
    };
  } catch (error) {
    f.cleanup();
    throw error;
  }
}

// Test-only subprocess loader: transpiles the existing TS graph in memory, so
// concurrency tests do not depend on dist/ or create a second checkout/build.
export function queueChildProcess(
  database: string,
  command: unknown,
  workerId: string,
  sessionId: string,
  loseAcknowledgement = false,
) {
  const typescript = createRequire(import.meta.url).resolve('typescript');
  const repository = fileURLToPath(
    new URL('./multi-piece-queue.repository.ts', import.meta.url),
  );
  const source = `const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
    const data=JSON.parse(process.argv[1]),ts=require(data.typescript),original=Module._resolveFilename;
    Module._resolveFilename=function(request,parent,...rest){
      if(parent && request.startsWith('.') && request.endsWith('.js')){
        const candidate=path.resolve(path.dirname(parent.filename),request.slice(0,-3)+'.ts');
        if(fs.existsSync(candidate)) return candidate;
      }
      return original.call(this,request,parent,...rest);
    };
    require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),
      {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023,esModuleInterop:true}}).outputText,filename);
    const {MultiPieceQueueRepository}=require(data.repository);
    const repo=new MultiPieceQueueRepository(data.database,{workers:{assertActive:async principal=>{
      if(principal!=='FICTITIOUS_TEST_ONLY') throw new Error('AUTH_REQUIRED');
      return {workerId:data.workerId,sessionId:data.sessionId};
    }},now:()=> '2026-11-12T12:00:00.000Z'});
    process.stdout.write('READY\\n');
    process.stdin.once('data',async()=>{
      try {
        const entry=await repo.claimForOfflineReview(data.command,'FICTITIOUS_TEST_ONLY');
        if(data.loseAcknowledgement) process.exit(23);
        process.stdout.write(JSON.stringify({ok:true,entry})+'\\n');
      } catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code||error.message})+'\\n');}
      process.stdin.destroy();
    });`;
  const child = spawn(
    process.execPath,
    [
      '-e',
      source,
      JSON.stringify({
        database,
        command,
        workerId,
        sessionId,
        loseAcknowledgement,
        typescript,
        repository,
      }),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let stdout = '',
    stderr = '';
  let resolveReady!: () => void;
  let readySeen = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    child.once('error', reject);
    child.once('close', () => {
      if (!readySeen) reject(new Error(`QUEUE_CHILD_START_FAILED: ${stderr}`));
    });
  });
  child.stdout.on('data', (data) => {
    stdout += String(data);
    if (stdout.includes('READY\n')) {
      readySeen = true;
      resolveReady();
    }
  });
  child.stderr.on('data', (data) => {
    stderr += String(data);
  });
  const done = new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  return { child, ready, done, go: () => child.stdin.write('GO\n') };
}
