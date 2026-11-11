import { DatabaseSync, backup } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';

async function fixture() {
  const f = await facebookPublicationFixture(true, 'v27.0');
  f.approve(f.facebookPackage);
  f.fail('create');
  try {
    await f.execute();
  } catch {}
  const db = f.f.base.db;
  const old = db
    .prepare(
      "SELECT * FROM social_publication_operations WHERE account_id='facebook_reels:1355505384315575'",
    )
    .get()!;
  const snapshot = () =>
    Object.fromEntries(
      [
        'social_publication_operations',
        'social_publication_events',
        'social_publication_commands',
        'multi_network_publication_reservations',
        'instagram_publication_reservations',
      ].map((t) => [
        t,
        db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all(),
      ]),
    );
  const before = snapshot(),
    objects = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE tbl_name='social_publication_operations' AND sql IS NOT NULL AND type IN ('index','trigger') ORDER BY name",
      )
      .all();
  const insert = (
    d: any = db,
    revision = 1,
    predecessor = String(old.operation_id),
  ) => {
    const id =
      String(old.operation_id) +
      ':supersession:' +
      revision +
      ':' +
      old.request_hash;
    // Match prepare/#seal: revision zero is a valid initial optimistic-lock
    // version. Hash exactly the body that will be serialized, not the old seal.
    const {
      contentHash: _oldContentHash,
      uploadStage: _oldUploadStage,
      ...original
    } = JSON.parse(String(old.payload_json));
    const body = {
      ...original,
      operationId: id,
      state: 'PREPARED',
      containerId: null,
      mediaId: null,
      uncertainStage: null,
      errorCode: null,
      providerStatus: null,
      confirmationSource: null,
      transferEvidence: null,
      version: 0,
      updatedAt: f.at,
    };
    const payload = { ...body, contentHash: affiliateHash(body) };
    d.prepare(
      'INSERT INTO social_publication_operations(operation_id,package_hash,account_id,request_hash,payload_json,version,supersession_revision,root_operation_id,predecessor_id,supersession_id) VALUES(?,?,?,?,?,0,?,?,?,?)',
    ).run(
      id,
      old.package_hash,
      old.account_id,
      old.request_hash,
      JSON.stringify(payload),
      revision,
      old.operation_id,
      predecessor,
      id,
    );
    return id;
  };
  const link = (
    id: string,
    d: any = db,
    revision = 1,
    predecessor = String(old.operation_id),
  ) =>
    d
      .prepare('INSERT INTO publication_supersessions VALUES(?,?,?,?,?,?,?)')
      .run(
        id,
        old.operation_id,
        predecessor,
        revision,
        'UNKNOWN_PROGRESS',
        'human:fixture',
        '2026-11-09T12:00:00Z',
      );
  return {
    f,
    db,
    old,
    before,
    objects,
    snapshot,
    insert,
    link,
    cleanup: () => f.cleanup(),
  };
}
test('real provisioner migrates 43 to 44 preserving rows, objects, FKs and old reads; repeat is idempotent', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    for (const [t, rows] of Object.entries(x.before)) {
      const columns = Object.keys((rows as any[])[0] ?? {});
      if (columns.length)
        expect(
          x.db
            .prepare(
              'SELECT ' + columns.join(',') + ' FROM ' + t + ' ORDER BY rowid',
            )
            .all(),
        ).toEqual(rows);
    }
    for (const o of x.objects)
      expect(
        x.db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(o.name!)
          ?.sql,
      ).toBe(o.sql);
    expect(
      x.db
        .prepare(
          'SELECT supersession_revision FROM social_publication_operations WHERE operation_id=?',
        )
        .get(x.old.operation_id!)?.supersession_revision,
    ).toBe(0);
    const schema = x.db
      .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
      .all();
    provisionSchema(x.db, 44);
    expect(
      x.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
    ).toEqual(schema);
    expect(x.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(x.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
    expect(x.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  } finally {
    x.cleanup();
  }
});
test('valid deterministic successor transfers ownership atomically without modifying the original reservation or history', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    x.db.exec('BEGIN IMMEDIATE');
    const id = x.insert();
    expect(
      x.db
        .prepare(
          'SELECT active_operation_id FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!)?.active_operation_id,
    ).toBe(x.old.operation_id);
    x.link(id);
    x.db.exec('COMMIT');
    expect(
      x.db
        .prepare(
          'SELECT active_operation_id,revision FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!),
    ).toEqual({ active_operation_id: id, revision: 1 });
    expect(
      x.db
        .prepare(
          'SELECT * FROM multi_network_publication_reservations ORDER BY rowid',
        )
        .all(),
    ).toEqual(x.before.multi_network_publication_reservations);
    expect(
      x.db
        .prepare('SELECT * FROM social_publication_events ORDER BY rowid')
        .all(),
    ).toEqual(x.before.social_publication_events);
    expect(() =>
      x.db
        .prepare(
          'UPDATE social_publication_operations SET version=version+1 WHERE operation_id=?',
        )
        .run(x.old.operation_id!),
    ).toThrow('IMMUTABLE_PUBLICATION_LINEAGE');
    // Repeated structural identity never produces another row; Application will
    // recover this deterministic identity rather than issuing a second INSERT.
    expect(() => x.insert()).toThrow();
    expect(
      x.db.prepare('SELECT count(*) n FROM publication_supersessions').get()?.n,
    ).toBe(1);
    expect(x.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    x.cleanup();
  }
});
test('deferred link rejects an orphan successor and rollback restores ownership', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    x.db.exec('BEGIN IMMEDIATE');
    x.insert();
    expect(() => x.db.exec('COMMIT')).toThrow();
    x.db.exec('ROLLBACK');
    expect(
      x.db.prepare('SELECT count(*) n FROM publication_supersessions').get()?.n,
    ).toBe(0);
    expect(
      x.db
        .prepare(
          'SELECT active_operation_id FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!)?.active_operation_id,
    ).toBe(x.old.operation_id);
  } finally {
    x.cleanup();
  }
});
test('transaction failure after transfer rolls back successor, decision and ownership', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    x.db.exec('BEGIN IMMEDIATE');
    const id = x.insert();
    x.link(id);
    expect(() =>
      x.db.exec('INSERT INTO table_not_existing VALUES(1)'),
    ).toThrow();
    x.db.exec('ROLLBACK');
    expect(
      x.db.prepare('SELECT * FROM publication_supersessions').all(),
    ).toEqual([]);
    expect(
      x.db
        .prepare(
          'SELECT active_operation_id FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!)?.active_operation_id,
    ).toBe(x.old.operation_id);
  } finally {
    x.cleanup();
  }
});
test('normal duplicate, wrong revision, missing origin and duplicate ownership are rejected', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    expect(() =>
      x.db
        .prepare(
          'INSERT INTO social_publication_operations(operation_id,package_hash,account_id,request_hash,payload_json,version) VALUES(?,?,?,?,?,0)',
        )
        .run(
          'different',
          x.old.package_hash!,
          x.old.account_id!,
          x.old.request_hash!,
          x.old.payload_json!,
        ),
    ).toThrow();
    expect(() => x.insert(x.db, 2)).toThrow(
      'PUBLICATION_SUCCESSOR_BINDING_INVALID',
    );
    expect(() => x.insert(x.db, 1, 'missing')).toThrow();
    expect(() =>
      x.db.exec(
        'INSERT INTO publication_active_ownership SELECT * FROM publication_active_ownership',
      ),
    ).toThrow();
    expect(() =>
      x.db
        .prepare(
          "UPDATE publication_active_ownership SET active_operation_id='arbitrary' WHERE reservation_operation_id=?",
        )
        .run(x.old.operation_id!),
    ).toThrow();
  } finally {
    x.cleanup();
  }
});
test('two SQLite connections cannot acquire simultaneous successor ownership', async () => {
  const x = await fixture();
  let second: DatabaseSync | undefined;
  try {
    provisionSchema(x.db, 44);
    const path = x.db
      .prepare('PRAGMA database_list')
      .all()
      .find((r: any) => r.name === 'main')!.file;
    second = new DatabaseSync(String(path));
    second.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=1');
    x.db.exec('BEGIN IMMEDIATE');
    const id = x.insert();
    x.link(id);
    expect(() => second!.exec('BEGIN IMMEDIATE')).toThrow();
    x.db.exec('COMMIT');
    second.exec('BEGIN IMMEDIATE');
    expect(() => x.insert(second)).toThrow();
    second.exec('ROLLBACK');
    expect(
      second
        .prepare(
          'SELECT active_operation_id FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!)?.active_operation_id,
    ).toBe(id);
  } finally {
    if (second?.isTransaction) second.exec('ROLLBACK');
    second?.close();
    x.cleanup();
  }
});
test('failed real migration rolls back reconstruction and restores FK mode', async () => {
  const x = await fixture();
  try {
    x.db.exec('CREATE TABLE publication_active_ownership(collision TEXT)');
    const before = x.snapshot();
    expect(() => provisionSchema(x.db, 44)).toThrow();
    expect(x.snapshot()).toEqual(before);
    expect(x.db.prepare('PRAGMA user_version').get()?.user_version).toBe(43);
    expect(x.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(
      x.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='social_publication_operations_v44'",
        )
        .get(),
    ).toBeUndefined();
    expect(x.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    x.cleanup();
  }
});
test('empty schema provisions through 44 and new normal Facebook and Instagram publication remain compatible', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    provisionSchema(db, 44);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(44);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    expect(
      x.db.prepare('SELECT count(*) n FROM publication_active_ownership').get()
        ?.n,
    ).toBe(
      x.before.multi_network_publication_reservations.length +
        x.before.instagram_publication_reservations.length,
    );
  } finally {
    x.cleanup();
  }
});

test('authorized normal Facebook execution works after structural upgrade without changing Instagram history', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  try {
    const before = f.f.base.db
      .prepare('SELECT * FROM instagram_publication_reservations')
      .all();
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const prepared = await f
      .reopen()
      .prepareFacebookOccurrence(f.execution.execution_id, '1355505384315575');
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
      },
      'WAITING_INPUT',
    );
    const grant = {
      executionId: f.execution.execution_id,
      operationId: prepared.operationId,
      accountId: '1355505384315575',
      packageHash: f.facebookPackage.contentHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: prepared.version,
      authorizationId: 'schema44_occurrence_grant_001',
      actor: 'reviewer_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 600000).toISOString(),
    };
    await f
      .reopen()
      .authorizeFacebookOccurrence(
        f.execution.execution_id,
        grant.accountId,
        0,
        grant,
      );
    await f
      .reopen()
      .execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        grant.accountId,
        grant,
        0,
      );
    await f.execute(f.reopen());
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    expect(
      f.f.base.db
        .prepare('SELECT * FROM instagram_publication_reservations')
        .all(),
    ).toEqual(before);
    expect(
      f.f.base.db
        .prepare('SELECT count(*) n FROM publication_active_ownership')
        .get()?.n,
    ).toBe(before.length + 1);
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.cleanup();
  }
});
test('a second revision follows the active head and cannot branch or rewrite decisions', async () => {
  const x = await fixture();
  try {
    provisionSchema(x.db, 44);
    x.db.exec('BEGIN IMMEDIATE');
    const first = x.insert();
    x.link(first);
    x.db.exec('COMMIT');
    expect(() =>
      x.db.exec("UPDATE publication_supersessions SET reason='changed'"),
    ).toThrow('IMMUTABLE_PUBLICATION_SUPERSESSION');
    x.db.exec('BEGIN IMMEDIATE');
    const second = x.insert(x.db, 2, first);
    x.link(second, x.db, 2, first);
    x.db.exec('COMMIT');
    expect(
      x.db
        .prepare(
          'SELECT active_operation_id,revision FROM publication_active_ownership WHERE reservation_operation_id=?',
        )
        .get(x.old.operation_id!),
    ).toEqual({ active_operation_id: second, revision: 2 });
    expect(() => x.insert(x.db, 2, first)).toThrow();
    expect(() =>
      x.db
        .prepare('DELETE FROM publication_supersessions WHERE successor_id=?')
        .run(first),
    ).toThrow();
    expect(x.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    x.cleanup();
  }
});

test('committed successor is readable by the real repository before and after all database connections reopen', async () => {
  const x = await fixture();
  let db: DatabaseSync | undefined;
  try {
    const source = String(
      x.db
        .prepare('PRAGMA database_list')
        .all()
        .find((r: any) => r.name === 'main')!.file,
    );
    const path = join(dirname(source), 'successor-reopen.sqlite');
    await backup(x.db, path);
    db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys=ON');
    let repository = new SocialPublicationRepository({ db }, { mode: 'fake' });
    const original = repository.get(x.old.operation_id),
      history = repository.history(String(x.old.operation_id));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(43);
    provisionSchema(db, 44);
    db.exec('BEGIN IMMEDIATE');
    const id = x.insert(db);
    x.link(id, db);
    db.exec('COMMIT');
    const saved = repository.get(id),
      row = db
        .prepare(
          'SELECT * FROM social_publication_operations WHERE operation_id=?',
        )
        .get(id)!;
    expect(saved).toMatchObject({
      operationId: id,
      packageHash: original.packageHash,
      accountId: original.accountId,
      requestHash: original.requestHash,
      version: 0,
      state: 'PREPARED',
    });
    expect(row.version).toBe(saved.version);
    expect(saved.contentHash).toBe(affiliateHash(saved));
    expect(row).toMatchObject({
      supersession_revision: 1,
      root_operation_id: x.old.operation_id,
      predecessor_id: x.old.operation_id,
      supersession_id: id,
    });
    expect(repository.get(x.old.operation_id)).toEqual(original);
    expect(repository.history(String(x.old.operation_id))).toEqual(history);
    db.close();
    db = undefined;
    db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys=ON');
    repository = new SocialPublicationRepository({ db }, { mode: 'fake' });
    expect(repository.get(id)).toEqual(saved);
    expect(
      db
        .prepare(
          'SELECT root_operation_id,predecessor_id,supersession_revision FROM social_publication_operations WHERE operation_id=?',
        )
        .get(id),
    ).toEqual({
      root_operation_id: x.old.operation_id,
      predecessor_id: x.old.operation_id,
      supersession_revision: 1,
    });
    expect(repository.get(x.old.operation_id)).toEqual(original);
    expect(repository.history(String(x.old.operation_id))).toEqual(history);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
  } finally {
    db?.close();
    x.cleanup();
  }
});
test.each(['tampered_payload', 'mismatched_version', 'incompatible_hash'])(
  'repository rejects successor integrity violation: %s',
  async (scenario) => {
    const x = await fixture();
    try {
      provisionSchema(x.db, 44);
      x.db.exec('BEGIN IMMEDIATE');
      const id = x.insert();
      x.link(id);
      x.db.exec('COMMIT');
      const repository = new SocialPublicationRepository(
          { db: x.db },
          { mode: 'fake' },
        ),
        original = repository.get(x.old.operation_id),
        history = repository.history(String(x.old.operation_id));
      const payload = { ...repository.get(id) };
      if (scenario === 'tampered_payload')
        payload.caption += ' modified after sealing';
      if (scenario === 'mismatched_version') {
        payload.version = 1;
        payload.contentHash = affiliateHash(payload);
      }
      if (scenario === 'incompatible_hash')
        payload.contentHash = '0'.repeat(64);
      x.db
        .prepare(
          'UPDATE social_publication_operations SET payload_json=? WHERE operation_id=?',
        )
        .run(JSON.stringify(payload), id);
      expect(() => repository.get(id)).toThrow('SOCIAL_PERSISTED_INTEGRITY');
      expect(repository.get(x.old.operation_id)).toEqual(original);
      expect(repository.history(String(x.old.operation_id))).toEqual(history);
    } finally {
      x.cleanup();
    }
  },
);
