import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { openNotificationStore } from '../../../test/support/operational-notifications.fixture.js';
import {
  collectOperationalNotifications,
  OperationalAlertsService,
} from './application/operational-alerts.service.js';
import { FakeOperationalNotificationAdapter } from './infrastructure/operational-notification.adapter.js';
import type {
  OperationalPackage,
  PublishingOperationsPort,
} from '../publishing/application/publishing-operations.port.js';

const now = '2026-11-08T13:00:00.000Z';
const attempt = {
  executionId: '',
  key: 'historical-key',
  kind: 'RENDER_READY_FOR_REVIEW',
  sourceIdentity: 'historical-source',
  destinationId: 'telegram:fixture',
  messageHash: 'historical-message',
};

test('Content Operations owns the atomic claim, rolls back errors and preserves historical receipts', () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const repository = new CampaignRepository(f.base.db);
  try {
    expect(f.base.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(
      1,
    );
    const execution = repository.schedule(
      {
        campaignId: 'camp_001',
        campaignRevision: 1,
        runId: 'atomic_run',
        scheduledAt: now,
      },
      {},
      now,
    );
    const intent = { ...attempt, executionId: execution.execution_id };
    const trace = vi.spyOn(f.base.db, 'exec');
    expect(() =>
      repository.claimNotification(
        intent,
        () => {
          expect(f.base.db.isTransaction).toBe(true);
          throw new Error('FACTS_UNAVAILABLE');
        },
        now,
      ),
    ).toThrow('FACTS_UNAVAILABLE');
    expect(repository.hasNotificationAttempt(intent.key)).toBe(false);
    expect(repository.claimNotification(intent, () => true, now)).toBe(true);
    expect(trace.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN IMMEDIATE',
      'ROLLBACK',
      'BEGIN IMMEDIATE',
      'COMMIT',
    ]);
    expect(f.base.db.isTransaction).toBe(false);
    repository.finishNotification(
      intent,
      { status: 'DELIVERED', messageId: '123' },
      now,
    );
    const history = repository.history(execution.execution_id);
    expect(history.at(-2)?.evidence).toEqual({
      key: intent.key,
      kind: intent.kind,
      sourceIdentity: intent.sourceIdentity,
      destinationId: intent.destinationId,
      status: 'ATTEMPTED',
      messageHash: intent.messageHash,
    });
    expect(history.at(-1)?.evidence.messageId).toBe('123');
    expect(
      repository.claimNotification(
        intent,
        () => {
          throw new Error('MUST_NOT_REVALIDATE');
        },
        now,
      ),
    ).toBe(false);
    repository.finishNotification(
      intent,
      { status: 'FAILED', errorCode: 'IGNORED_REPLAY' },
      now,
    );
    expect(repository.history(execution.execution_id)).toEqual(history);
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test('Notifications production code only accesses other BCs through public contracts', () => {
  const root = join(import.meta.dirname);
  const production = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? production(join(path, entry.name))
        : entry.name.endsWith('.ts') &&
            !entry.name.includes('spec') &&
            !entry.name.includes('fixture')
          ? [join(path, entry.name)]
          : [],
    );
  for (const path of production(root)) {
    const source = readFileSync(path, 'utf8');
    expect(source, path).not.toMatch(
      /(?:content-operations|publishing|affiliate)\/(?:infrastructure|domain)\//,
    );
    expect(source, path).not.toMatch(
      /campaign_execution_events|manual_distribution_records|social_publication_operations|node:sqlite/,
    );
  }
  const application = readFileSync(
    join(root, 'application/operational-alerts.service.ts'),
    'utf8',
  );
  expect(application).not.toContain('infrastructure/');
});

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function waiting(repository: CampaignRepository) {
  const e = repository.schedule(
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'architecture_run',
      scheduledAt: now,
    },
    { briefingId: 'brief_001' },
    now,
  );
  const owned = repository.claim(e.execution_id, now, 60000)!;
  for (const [step, result] of [
    [
      'BURN',
      { videoRenderId: 'historical_render', contentHash: 'a'.repeat(64) },
    ],
    ['QC', { reportId: 'historical_qc' }],
    ['PREVIEW', { ready: true }],
  ])
    repository.ownedEvent(
      e.execution_id,
      owned.claim_token!,
      now,
      'STEP_DONE',
      { step, result },
    );
  repository.ownedEvent(
    e.execution_id,
    owned.claim_token!,
    now,
    'PAUSED',
    { step: 'HANDOFF', code: 'EXACT_HUMAN_APPROVAL_REQUIRED' },
    'WAITING_INPUT',
  );
  return e;
}

test('legacy keys, baselines, receipts and interrupted attempts survive the new public contracts unchanged', async () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const repository = new CampaignRepository(f.base.db);
  const adapter = new FakeOperationalNotificationAdapter('telegram:historical');
  const discord = new FakeOperationalNotificationAdapter('discord:historical');
  const alerts = new OperationalAlertsService(
    () => openNotificationStore(f.database),
    [adapter, discord],
    () => '2026-11-08T13:01:00.000Z',
  );
  try {
    const e = waiting(repository);
    const sourceIdentity = digest({
      render: {
        videoRenderId: 'historical_render',
        contentHash: 'a'.repeat(64),
      },
      qc: { reportId: 'historical_qc' },
    });
    const baseline = { campaign: 0, social: 0, manual: 0 };
    const seed = (type: string, evidence: unknown) =>
      f.base.db
        .prepare(
          'INSERT INTO campaign_execution_events VALUES(?,(SELECT MAX(sequence)+1 FROM campaign_execution_events WHERE execution_id=?),?,?,?,?,?)',
        )
        .run(
          e.execution_id,
          e.execution_id,
          type,
          e.status,
          e.status,
          now,
          JSON.stringify(evidence),
        );
    for (const channel of [adapter, discord]) {
      const key = digest({
        executionId: e.execution_id,
        kind: attempt.kind,
        sourceIdentity,
        destinationId: channel.destinationId,
      });
      seed('OPERATIONAL_NOTIFICATION_BASELINE', {
        destinationId: channel.destinationId,
        baseline,
      });
      seed('OPERATIONAL_NOTIFICATION_ATTEMPTED', {
        key,
        kind: attempt.kind,
        sourceIdentity,
        destinationId: channel.destinationId,
        status: 'ATTEMPTED',
        messageHash: 'legacy-hash',
      });
      if (channel === adapter)
        seed('OPERATIONAL_NOTIFICATION_DELIVERED', {
          key,
          kind: attempt.kind,
          destinationId: channel.destinationId,
          status: 'DELIVERED',
          messageId: '987654321',
        });
    }
    const before = repository.history(e.execution_id);
    alerts.onModuleInit();
    await alerts.scan();
    expect(adapter.messages).toEqual([]);
    expect(discord.messages).toEqual([]);
    expect(repository.history(e.execution_id).slice(0, before.length)).toEqual(
      before,
    );
    expect(repository.history(e.execution_id).at(-1)?.evidence).toMatchObject({
      destinationId: discord.destinationId,
      status: 'UNCERTAIN',
      errorCode: 'NOTIFICATION_PROCESS_INTERRUPTED',
    });
    const store = openNotificationStore(f.database);
    try {
      expect(store.baseline(adapter.destinationId, undefined, now)).toEqual(
        baseline,
      );
      expect(
        collectOperationalNotifications(store, adapter.destinationId, baseline),
      ).toEqual([]);
    } finally {
      store.close();
    }
  } finally {
    await alerts.onModuleDestroy();
    f.cleanup();
  }
});

test('claim revalidates current facts, rolls back insert failure and forbids asynchronous eligibility', () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const repository = new CampaignRepository(f.base.db);
  const e = waiting(repository);
  const store = openNotificationStore(f.database);
  try {
    const baseline = { campaign: 0, social: 0, manual: 0 };
    const intent = collectOperationalNotifications(
      store,
      'telegram:stale',
      baseline,
    )[0];
    expect(intent.key).toBe(
      digest({
        executionId: e.execution_id,
        kind: intent.kind,
        sourceIdentity: digest({
          render: {
            videoRenderId: 'historical_render',
            contentHash: 'a'.repeat(64),
          },
          qc: { reportId: 'historical_qc' },
        }),
        destinationId: 'telegram:stale',
      }),
    );
    f.base.db.exec(
      "CREATE TEMP TRIGGER reject_notification BEFORE INSERT ON campaign_execution_events WHEN NEW.event_type='OPERATIONAL_NOTIFICATION_ATTEMPTED' BEGIN SELECT RAISE(ABORT,'INSERT_INTERRUPTED'); END",
    );
    expect(() =>
      repository.claimNotification(
        { ...attempt, executionId: e.execution_id },
        () => true,
        now,
      ),
    ).toThrow('INSERT_INTERRUPTED');
    expect(repository.hasNotificationAttempt(attempt.key)).toBe(false);
    f.base.db.exec('DROP TRIGGER reject_notification');
    expect(() =>
      repository.claimNotification(
        { ...attempt, executionId: e.execution_id },
        (() => Promise.resolve(true)) as unknown as () => boolean,
        now,
      ),
    ).toThrow('SYNCHRONOUS_NOTIFICATION_VALIDATION_REQUIRED');
    repository.cancel(e.execution_id, now);
    expect(
      store.claim(
        intent,
        () =>
          collectOperationalNotifications(
            store,
            intent.destinationId,
            baseline,
          ).some((value) => value.key === intent.key),
        now,
      ),
    ).toBe(false);
    expect(store.attempted(intent.key)).toBe(false);
  } finally {
    store.close();
    f.cleanup();
  }
});

test('normalized fictitious network facts fan out once; no HTTP transaction or cross-channel receipt failure', async () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const repository = new CampaignRepository(f.base.db);
  const packages: OperationalPackage[] = [];
  const publishing: PublishingOperationsPort = {
    checkpoint: () => ({ social: 0, manual: 0 }),
    packages: () => packages,
  };
  const telegram = new FakeOperationalNotificationAdapter('telegram:ports');
  const discord = new FakeOperationalNotificationAdapter('discord:ports');
  const open = () => {
    const store = openNotificationStore(f.database, publishing);
    const finish = store.finish.bind(store);
    store.finish = (intent, result, at) => {
      if (intent.destinationId === telegram.destinationId)
        throw new Error('RECEIPT_STORAGE_INTERRUPTED');
      finish(intent, result, at);
    };
    return store;
  };
  const alerts = new OperationalAlertsService(
    open,
    [telegram, discord],
    () => now,
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NO_EXTERNAL_CALLS'));
  let restarted: OperationalAlertsService | undefined;
  try {
    alerts.onModuleInit();
    const e = waiting(repository);
    const destination = {
      network: 'fixture-video',
      account: 'creator',
      label: 'Fixture Video creator',
    };
    packages.push({
      hash: 'b'.repeat(64),
      cursor: 1,
      destination,
      identity: {
        videoRenderId: 'other_render',
        videoRenderRevision: 1,
        videoRenderContentHash: 'a'.repeat(64),
        qualityControlReportId: 'other_qc',
        qualityControlReportContentHash: 'c'.repeat(64),
      },
      review: null,
      publications: [
        {
          operationId: 'fixture-video:op',
          destination,
          confirmed: true,
          requiresReconciliation: false,
          failed: false,
          simulated: true,
          transition: { stream: 'social', cursor: 1, version: 4 },
          receipt: {
            publicationId: 'fixture-video:published',
            accountId: 'fixture-video:creator',
            permalink:
              'https://video.example/clip/confirmed?token=removed#removed',
          },
        },
      ],
    });
    for (const channel of [telegram, discord]) {
      const send = channel.send.bind(channel);
      vi.spyOn(channel, 'send').mockImplementation(async (message) => {
        const probe = new DatabaseSync(f.database);
        try {
          probe.exec(
            'PRAGMA busy_timeout=0;PRAGMA foreign_keys=ON;BEGIN IMMEDIATE',
          );
          expect(
            probe
              .prepare(
                "SELECT 1 FROM campaign_execution_events WHERE event_type='OPERATIONAL_NOTIFICATION_ATTEMPTED' AND json_extract(evidence_json,'$.destinationId')=?",
              )
              .get(channel.destinationId),
          ).toBeTruthy();
          probe.exec('ROLLBACK');
        } finally {
          probe.close();
        }
        return send(message);
      });
    }
    await alerts.scan();
    expect(telegram.messages).toHaveLength(1);
    expect(discord.messages).toEqual(telegram.messages);
    expect(discord.messages[0]).toMatchObject({
      kind: 'PUBLICATION_SUCCEEDED',
      text: expect.stringContaining('Destino: Fixture Video creator'),
    });
    expect(discord.messages[0].text).not.toContain('Instagram');
    expect(discord.messages[0].text).toContain(
      'https://video.example/clip/confirmed',
    );
    expect(discord.messages[0].text).not.toContain('removed');
    restarted = new OperationalAlertsService(
      () => openNotificationStore(f.database, publishing),
      [telegram, discord],
      () => '2026-11-08T13:01:00.000Z',
    );
    restarted.onModuleInit();
    await restarted.scan();
    expect(discord.messages).toHaveLength(1);
    expect(telegram.messages).toHaveLength(1);
    expect(repository.history(e.execution_id).at(-1)?.evidence).toMatchObject({
      destinationId: telegram.destinationId,
      status: 'UNCERTAIN',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await alerts.onModuleDestroy();
    await restarted?.onModuleDestroy();
    fetch.mockRestore();
    f.cleanup();
  }
});

test('two SQLite workers contend for the same notification identity under BEGIN IMMEDIATE', async () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const e = waiting(new CampaignRepository(f.base.db));
  const directory = dirname(f.database),
    workers: Worker[] = [];
  try {
    for (const [source, target] of [
      ['domain/campaign', 'campaign'],
      ['domain/campaign-schedule', 'campaign-schedule'],
      ['infrastructure/campaign.repository', 'campaign.repository'],
    ]) {
      const sourceText = readFileSync(
        new URL(`../content-operations/${source}.ts`, import.meta.url),
        'utf8',
      )
        .replace('../domain/campaign.js', './campaign.mjs')
        .replace('../domain/campaign-schedule.js', './campaign-schedule.mjs')
        .replace('./campaign.js', './campaign.mjs');
      writeFileSync(
        join(directory, `${target}.mjs`),
        transpileModule(sourceText, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2023,
          },
        }).outputText,
      );
    }
    const path = join(directory, 'notification-worker.mjs');
    writeFileSync(
      path,
      `import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { CampaignRepository } from './campaign.repository.mjs';
const db=new DatabaseSync(workerData.database); db.exec('PRAGMA foreign_keys=ON');
const repository=new CampaignRepository(db), barrier=new Int32Array(workerData.barrier);
parentPort.postMessage('ready'); Atomics.wait(barrier,0,0);
try { parentPort.postMessage(repository.claimNotification(workerData.intent,()=>{
  if (!db.isTransaction) throw new Error('NO_TRANSACTION');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  return true;
},workerData.now)); } finally { db.close(); }`,
    );
    const barrier = new SharedArrayBuffer(4),
      ready: Promise<void>[] = [];
    const results = Array.from({ length: 2 }, () => {
      let signal!: () => void;
      let failReady!: (error: Error) => void;
      ready.push(
        new Promise<void>((resolve, reject) => {
          signal = resolve;
          failReady = reject;
        }),
      );
      const worker = new Worker(path, {
        workerData: {
          database: f.database,
          barrier,
          intent: { ...attempt, executionId: e.execution_id },
          now,
        },
      });
      workers.push(worker);
      return new Promise<boolean>((resolve, reject) => {
        worker.on('error', (error) => {
          failReady(error);
          reject(error);
        });
        worker.on('message', (value) => {
          if (value === 'ready') signal();
          else resolve(value);
        });
      });
    });
    // Observe result failures during startup too, before opening the barrier.
    const completed = Promise.all(results);
    await Promise.race([Promise.all(ready), completed]);
    Atomics.store(new Int32Array(barrier), 0, 1);
    Atomics.notify(new Int32Array(barrier), 0, 2);
    expect(
      (await completed).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([false, true]);
    expect(
      new CampaignRepository(f.base.db)
        .history(e.execution_id)
        .filter((h) => h.event_type === 'OPERATIONAL_NOTIFICATION_ATTEMPTED'),
    ).toHaveLength(1);
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    f.cleanup();
  }
});
