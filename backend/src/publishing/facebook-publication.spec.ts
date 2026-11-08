import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { assertFacebookReelsProfile } from './domain/facebook-reels-profile.js';
import { DestinationReservationsRepository } from './infrastructure/destination-reservations.repository.js';
import { openNotificationStore } from '../../test/support/operational-notifications.fixture.js';
import { collectOperationalNotifications } from '../notifications/application/operational-alerts.service.js';
import { Worker } from 'node:worker_threads';

test('independent Facebook approval is mandatory; two destinations retain distinct receipts and historical identities', async () => {
  const f = await facebookPublicationFixture();
  try {
    await expect(f.execute()).rejects.toMatchObject({
      code: 'DISTRIBUTION_APPROVAL_REQUIRED',
    });
    expect(f.posts).toEqual([]);
    f.approve(f.facebookPackage);
    const fb = await f.execute();
    expect(fb.mediaId).not.toBe(f.ig.mediaId);
    expect(fb.receipt.permalink).toBe(
      'https://www.facebook.com/reel/987654321/',
    );
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    expect(await f.execute(f.reopen())).toEqual(fb);
    expect(f.posts).toHaveLength(3);
    expect(
      f.f.base.db
        .prepare('SELECT * FROM instagram_publication_reservations')
        .all(),
    ).toEqual(f.legacy.reservations);
    expect(
      f.f.base.db
        .prepare(
          'SELECT * FROM social_publication_operations WHERE operation_id=?',
        )
        .all(f.ig.operationId),
    ).toEqual(f.legacy.operations);
    expect(
      f.f.base.db
        .prepare(
          'SELECT * FROM social_publication_events WHERE operation_id=? ORDER BY version',
        )
        .all(f.ig.operationId),
    ).toEqual(f.legacy.events);
    expect(
      f
        .reopen()
        .status(f.execution.execution_id)
        .map((r) => r.network)
        .sort(),
    ).toEqual(['FACEBOOK_REELS', 'INSTAGRAM']);
    const store = openNotificationStore(f.f.database);
    try {
      expect(
        collectOperationalNotifications(store, 'telegram:offline', {
          campaign: 0,
          manual: 0,
          social: 0,
        }).filter((x) => x.kind === 'PUBLICATION_SUCCEEDED'),
      ).toHaveLength(2);
      expect(
        collectOperationalNotifications(store, 'telegram:offline', {
          campaign: 0,
          manual: 0,
          social: 0,
        }).some(
          (x) =>
            x.text.includes('Facebook Reels') &&
            x.text.includes(fb.receipt.permalink),
        ),
      ).toBe(true);
    } finally {
      store.close();
    }
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test.each(['create', 'upload', 'publish'] as const)(
  '%s timeout never repeats the uncertain POST after restart',
  async (stage) => {
    const f = await facebookPublicationFixture();
    try {
      f.approve(f.facebookPackage);
      f.fail(stage);
      await expect(f.execute()).rejects.toMatchObject({
        code: 'SOCIAL_RECONCILIATION_REQUIRED',
      });
      f.fail(undefined);
      if (stage === 'create')
        await expect(f.execute(f.reopen())).rejects.toMatchObject({
          code: 'SOCIAL_RECONCILIATION_REQUIRED',
        });
      else
        expect((await f.execute(f.reopen())).receipt.mediaId).toBe('987654321');
      expect(f.posts.filter((s) => s === stage)).toHaveLength(1);
      expect(
        f
          .reopen()
          .status(f.execution.execution_id)
          .find((r) => r.network === 'INSTAGRAM')?.operation.remoteReceipt,
      ).toEqual(f.ig.receipt);
    } finally {
      f.cleanup();
    }
  },
);

test('processing wait reuses session after restart; concurrent dispatch cannot duplicate submissions', async () => {
  const f = await facebookPublicationFixture();
  try {
    f.approve(f.facebookPackage);
    f.setProcessing(false);
    await expect(f.execute()).rejects.toMatchObject({
      code: 'SOCIAL_PROCESSING_REQUIRED',
    });
    expect(f.posts).toEqual(['create', 'upload']);
    f.setProcessing(true);
    await Promise.allSettled([f.execute(), f.execute(f.reopen())]);
    expect((await f.execute()).receipt.mediaId).toBe('987654321');
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
  } finally {
    f.cleanup();
  }
});

test('alternate revision and new reservation cannot duplicate the same destination or historical Instagram', async () => {
  const f = await facebookPublicationFixture();
  try {
    f.approve(f.facebookPackage);
    await f.execute();
    const session = f.store.openDestination('fake');
    try {
      const repository = new DestinationReservationsRepository(
          session.social.db,
        ),
        ig = session.social.get(f.ig.operationId);
      expect(
        repository.forExecution(
          f.execution.execution_id,
          'INSTAGRAM',
          '123456789',
        )?.operationId,
      ).toBe(f.ig.operationId);
      const fb = f
        .reopen()
        .status(f.execution.execution_id)
        .find((x) => x.network === 'FACEBOOK_REELS')!.operation;
      expect(() =>
        repository.reserve(
          f.execution.execution_id,
          { ...fb, operationId: 'different_operation' },
          f.facebookPackage,
          f.publishing.packageReview(f.facebookPackage.contentHash).contentHash,
          f.at,
        ),
      ).toThrow('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
      expect(() =>
        session.social.db
          .prepare(
            'INSERT INTO multi_network_publication_reservations VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            f.execution.execution_id,
            'INSTAGRAM',
            '123456789',
            'instagram:123456789',
            'camp_001',
            f.hash,
            ig.operationId,
            f.instagramPackage.contentHash,
            f.publishing.packageReview(f.instagramPackage.contentHash)
              .contentHash,
            f.at,
          ),
      ).toThrow('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
    } finally {
      session.close();
    }
    const revised = f.prepare(
      'facebook',
      '1355505384315575',
      'Legenda revisada.',
    );
    f.approve(revised);
    expect((await f.execute()).mediaId).toBe('987654321');
    expect(f.posts.filter((x) => x === 'publish')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

test('invalid media and account are blocked before any Facebook POST', async () => {
  const f = await facebookPublicationFixture();
  try {
    f.approve(f.facebookPackage);
    await expect(
      f
        .reopen()
        .execute(f.execution.execution_id, 'FACEBOOK_REELS', '999999999'),
    ).rejects.toMatchObject({ code: 'SOCIAL_DESTINATION_INVALID' });
    f.ports.localBytes = async () => {
      throw Object.assign(Error('bad MP4'), {
        code: 'SOCIAL_MEDIA_INCOMPATIBLE',
      });
    };
    await expect(f.execute()).rejects.toMatchObject({
      code: 'SOCIAL_MEDIA_INCOMPATIBLE',
    });
    expect(f.posts).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test.each([
  {},
  {
    format: { format_name: 'mp4', duration: 12 },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30/1',
      },
    ],
  },
])('physical Facebook profile rejects malformed or horizontal media', (probe) =>
  expect(() => assertFacebookReelsProfile(probe)).toThrow(
    'SOCIAL_MEDIA_INCOMPATIBLE',
  ),
);
test('physical Facebook profile accepts a compatible authorized MP4 profile', () =>
  expect(() =>
    assertFacebookReelsProfile({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: 12 },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1080,
          height: 1920,
          avg_frame_rate: '30/1',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    }),
  ).not.toThrow());

test('UNKNOWN financial operation and revoked Facebook review block before any POST', async () => {
  const f = await facebookPublicationFixture();
  try {
    f.approve(f.facebookPackage);
    f.f.base.db
      .prepare(
        "INSERT INTO global_paid_operations(operation_id,request_hash,provider,maximum_usd,proof_json,created_at,state) VALUES(?,?,?,?,?,?,'UNKNOWN')",
      )
      .run(
        'multi_finance_fixture',
        'f'.repeat(64),
        'fixture',
        '0.01',
        '{}',
        f.at,
      );
    await expect(f.execute()).rejects.toMatchObject({
      code: 'SOCIAL_FINANCE_RECONCILIATION_REQUIRED',
    });
    expect(f.posts).toEqual([]);
    f.publishing.revokeApproval({
      packageHash: f.facebookPackage.contentHash,
      reviewHash: f.publishing.packageReview(f.facebookPackage.contentHash)
        .contentHash,
      actor: 'operator_fixture',
      reason: 'offline revocation',
    });
    await expect(f.execute()).rejects.toMatchObject({
      code: 'DISTRIBUTION_APPROVAL_REVOKED',
    });
    expect(f.posts).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test('finish acknowledgement alone is not a confirmed publication or notification', async () => {
  const f = await facebookPublicationFixture();
  try {
    f.approve(f.facebookPackage);
    f.setReceiptVisible(false);
    await expect(f.execute()).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    const store = openNotificationStore(f.f.database);
    try {
      expect(
        store
          .facts(f.execution.execution_id)[0]
          .packages.find((p) => p.hash === f.facebookPackage.contentHash)
          ?.publications[0].confirmed,
      ).toBe(false);
    } finally {
      store.close();
    }
    f.setReceiptVisible(true);
    expect((await f.execute()).receipt.mediaId).toBe('987654321');
    expect(f.posts.filter((x) => x === 'publish')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

test('two native SQLite workers cannot reserve the same execution/network/account twice', async () => {
  const f = await facebookPublicationFixture(),
    workers: Worker[] = [];
  try {
    f.approve(f.facebookPackage);
    const session = f.store.openDestination('fake');
    let op: any;
    try {
      op = session.social.prepare(
        {
          packageHash: f.facebookPackage.contentHash,
          network: 'FACEBOOK_REELS',
          accountId: 'facebook_reels:1355505384315575',
          mediaHash: f.hash,
          caption: 'Fixture',
        },
        'worker_reservation',
        f.at,
      );
    } finally {
      session.close();
    }
    const params = [
      f.execution.execution_id,
      'FACEBOOK_REELS',
      '1355505384315575',
      'facebook_reels:1355505384315575',
      'camp_001',
      f.hash,
      op.operationId,
      f.facebookPackage.contentHash,
      f.publishing.packageReview(f.facebookPackage.contentHash).contentHash,
      f.at,
    ];
    const barrier = new SharedArrayBuffer(4),
      ready: Promise<void>[] = [];
    const outputs = Array.from({ length: 2 }, () => {
      let signal!: () => void, failed!: (e: Error) => void;
      ready.push(
        new Promise<void>((resolve, reject) => {
          signal = resolve;
          failed = reject;
        }),
      );
      const w = new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.barrier),0,0);try{db.prepare('INSERT INTO multi_network_publication_reservations VALUES(?,?,?,?,?,?,?,?,?,?)').run(...workerData.params);parentPort.postMessage({reserved:true});}catch(error){parentPort.postMessage({reserved:false,unique:error.message.includes('UNIQUE constraint failed')});}finally{db.close();}`,
        { eval: true, workerData: { file: f.f.database, barrier, params } },
      );
      workers.push(w);
      return new Promise<{ reserved: boolean; unique?: boolean }>(
        (resolve, reject) => {
          w.on('error', (e) => {
            failed(e);
            reject(e);
          });
          w.on('message', (m) => (m === 'ready' ? signal() : resolve(m)));
        },
      );
    });
    await Promise.all(ready);
    Atomics.store(new Int32Array(barrier), 0, 1);
    Atomics.notify(new Int32Array(barrier), 0, 2);
    const results = await Promise.all(outputs);
    expect(results.filter((r) => r.reserved)).toHaveLength(1);
    expect(results.filter((r) => r.unique)).toHaveLength(1);
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    f.cleanup();
  }
});
