import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';

test.each(['FIXED', 'CATALOG'])(
  'two native SQLite workers schedule and claim one %s campaign/day atomically',
  async (mode) => {
    const f = p2EditorialFixture(),
      directory = dirname(f.database);
    const db = new DatabaseSync(f.database);
    try {
      provisionSchema(db);
      for (const [source, target] of [
        ['domain/campaign', 'campaign'],
        ['domain/campaign-schedule', 'campaign-schedule'],
        ['infrastructure/campaign.repository', 'campaign.repository'],
      ]) {
        const code = readFileSync(
          new URL(`./${source}.ts`, import.meta.url),
          'utf8',
        )
          .replace('../domain/campaign.js', './campaign.js')
          .replace('../domain/campaign-schedule.js', './campaign-schedule.mjs');
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
    const now='2026-10-15T00:30:00.000Z';
    const input={campaignId:'camp_001',campaignRevision:1,scheduledAt:now,runId:'run_campaign_workers'};
    const e=workerData.mode==='CATALOG'
      ? r.scheduleCatalog({...input,selectionMode:'CATALOG'},now,()=>({...input,selectionMode:'CATALOG',catalogSelection:{productId:workerData.productId}}))
      : r.schedule(input, {...input,schedule:{schemaVersion:'campaign-daily-schedule/1.0.0',time:'09:30',timeZone:'Asia/Tokyo'}},now);
    parentPort.postMessage({id:e.execution_id,claimed:!!r.claim(e.execution_id,now,60000)});
   }finally{db.close();}
  `,
      );
      const barrier = new SharedArrayBuffer(4),
        workers: Worker[] = [];
      const ready: Promise<void>[] = [];
      const results = Array.from({ length: 2 }, (_, index) => {
        let markReady: () => void = () => {};
        ready.push(
          new Promise<void>((resolve) => {
            markReady = resolve;
          }),
        );
        const worker = new Worker(workerPath, {
          workerData: {
            database: f.database,
            barrier,
            mode,
            productId: `product_${index}`,
          },
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
        if (mode === 'FIXED')
          expect(
            db.prepare('SELECT production_date FROM campaign_executions').get()
              ?.production_date,
          ).toBe('2026-10-15');
        if (mode === 'CATALOG')
          expect(
            db
              .prepare(
                "SELECT count(*) n FROM campaign_execution_events WHERE event_type='PRODUCT_SELECTED'",
              )
              .get()?.n,
          ).toBe(1);
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
  },
);
