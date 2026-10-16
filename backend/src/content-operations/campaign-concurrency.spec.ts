import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';

test('two native SQLite workers schedule and claim one campaign/day atomically', async () => {
  const f = p2EditorialFixture(),
    directory = dirname(f.database);
  const db = new DatabaseSync(f.database);
  try {
    provisionSchema(db);
    for (const [source, target] of [
      ['domain/campaign', 'campaign'],
      ['infrastructure/campaign.repository', 'campaign.repository'],
    ]) {
      const code = readFileSync(
        new URL(`./${source}.ts`, import.meta.url),
        'utf8',
      ).replace('../domain/campaign.js', './campaign.js');
      writeFileSync(
        join(directory, `${target}.mjs`),
        transpileModule(code, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2023,
          },
        }).outputText.replace('./campaign.js', './campaign.mjs'),
      );
    }
    const workerPath = join(directory, 'campaign-worker.mjs');
    writeFileSync(
      workerPath,
      `
   import { parentPort,workerData } from 'node:worker_threads';
   import { DatabaseSync } from 'node:sqlite';
   import { CampaignRepository } from './campaign.repository.mjs';
   const db=new DatabaseSync(workerData.database),r=new CampaignRepository(db);
   const barrier=new Int32Array(workerData.barrier);
   parentPort.postMessage({ready:true});Atomics.wait(barrier,0,0);
   try {
    const now='2026-10-15T12:00:00.000Z';
    const e=r.schedule({campaignId:'camp_001',campaignRevision:1,scheduledAt:now,runId:'run_campaign_workers'}, {},now);
    parentPort.postMessage({id:e.execution_id,claimed:!!r.claim(e.execution_id,now,60000)});
   }finally{db.close();}
  `,
    );
    const barrier = new SharedArrayBuffer(4),
      workers: Worker[] = [];
    const ready: Promise<void>[] = [];
    const results = Array.from({ length: 2 }, () => {
      let markReady: () => void = () => {};
      ready.push(
        new Promise<void>((resolve) => {
          markReady = resolve;
        }),
      );
      const worker = new Worker(workerPath, {
        workerData: { database: f.database, barrier },
      });
      workers.push(worker);
      return new Promise<{ id: string; claimed: boolean }>(
        (resolve, reject) => {
          worker.on('error', reject);
          worker.on(
            'message',
            (m: { ready?: boolean; id: string; claimed: boolean }) => {
              if (m.ready) markReady();
              else resolve(m);
            },
          );
        },
      );
    });
    try {
      await Promise.all(ready);
      Atomics.store(new Int32Array(barrier), 0, 1);
      Atomics.notify(new Int32Array(barrier), 0, 2);
      const output = await Promise.all(results);
      expect(new Set(output.map((o) => o.id)).size).toBe(1);
      expect(output.filter((o) => o.claimed)).toHaveLength(1);
      expect(
        db.prepare('SELECT COUNT(*) n FROM campaign_executions').get()?.n,
      ).toBe(1);
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  } finally {
    db.close();
    f.cleanup();
  }
});
