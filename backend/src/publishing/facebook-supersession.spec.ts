import { DatabaseSync } from 'node:sqlite';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import type { FacebookCreateAcknowledgement } from './domain/facebook-upload-session.js';
async function fixture(activeClaim = false) {
  const f = await facebookPublicationFixture(true, 'v27.0', true);
  provisionSchema(f.f.base.db, 44);
  f.approve(f.facebookPackage);
  if (!activeClaim)
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'WORKFLOW_FINISHED',
      {},
      'SUCCEEDED',
    );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(f.at);
  await f.ports.localBytes(
    f.facebookPackage.contentHash,
    f.render.videoRenderId,
    f.hash,
  );
  const store = f.store.openDestination('fake');
  let original: any;
  try {
    const engine = new SocialPublicationService({
      repository: store.social,
      manual: store.manual,
      publisher: f.ports.publisher,
      media: f.ports.media,
      transferVerifier: f.ports.verifier,
      now: () => f.at,
      authorize: (op: any) => store.reservations.authorize(op, f.at),
    });
    original = await engine.prepare(
      {
        packageHash: f.facebookPackage.contentHash,
        accountId: f.ports.publisher.accountId,
      },
      'supersession_original',
      'local',
    );
    store.reservations.reserve(
      f.execution.execution_id,
      original,
      f.facebookPackage,
      f.publishing.packageReview(f.facebookPackage.contentHash).contentHash,
      f.at,
    );
    original = await engine.createContainer(original.operationId);
  } finally {
    store.close();
  }
  const observation = await f.ports.publisher.inspectUploadSession!(
    original.containerId,
  );
  const request = {
    originalOperationId: original.operationId,
    revision: 1,
    decisionId: 'human_decision_001',
    actor: 'operator_fixture',
    reason: 'Unknown remote progress explicitly accepted',
    remoteObservation: observation,
    acceptResidualRisk: true as const,
    expectedVersion: original.version,
  };
  const prepare = (r: any = request) =>
    (f.reopen() as any).prepareFacebookSupersession(
      f.execution.execution_id,
      '1355505384315575',
      r,
    );
  return {
    f,
    original,
    request,
    prepare,
    cleanup: () => {
      vi.useRealTimers();
      f.cleanup();
    },
  };
}
test('prepares one sealed successor with no remote POST and replays the same decision', async () => {
  const x = await fixture();
  try {
    const before = x.f.posts.slice();
    const successor = await x.prepare();
    expect(x.f.posts).toEqual(before);
    expect(successor).toMatchObject({
      state: 'PREPARED',
      version: 0,
      containerId: null,
      packageHash: x.original.packageHash,
      requestHash: x.original.requestHash,
    });
    expect(successor.contentHash).toBe(affiliateHash(successor));
    expect(await x.prepare()).toEqual(successor);
    expect(x.f.posts).toEqual(['create']);
    const store = x.f.store.openDestination('fake');
    try {
      expect(store.social.get(successor.operationId)).toEqual(successor);
      expect(store.social.get(x.original.operationId)).toEqual(x.original);
    } finally {
      store.close();
    }
  } finally {
    x.cleanup();
  }
});

function snapshot(db: any) {
  return Object.fromEntries(
    [
      'social_publication_operations',
      'social_publication_events',
      'social_publication_commands',
      'multi_network_publication_reservations',
      'publication_supersessions',
      'publication_active_ownership',
    ].map((t) => [
      t,
      db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all(),
    ]),
  );
}
function grantFor(x: any, successor: any) {
  const time = new Date(Date.parse(x.f.at) + 1000).toISOString();
  vi.setSystemTime(time);
  return {
    operationId: successor.operationId,
    packageHash: successor.packageHash,
    preparationDecisionId: x.request.decisionId,
    authorizationId: 'execution_decision_002',
    actor: 'operator_fixture',
    authorizedAt: time,
    expiresAt: new Date(Date.parse(time) + 60000).toISOString(),
    acceptResidualRisk: true as const,
  };
}
function engineFor(x: any, authorization?: any) {
  const store = x.f.store.openDestination('fake');
  return {
    store,
    engine: new SocialPublicationService({
      repository: store.social,
      manual: store.manual,
      publisher: x.f.ports.publisher,
      media: x.f.ports.media,
      transferVerifier: x.f.ports.verifier,
      now: () => new Date().toISOString(),
      operationalAuthorization: authorization,
      authorize: (op: any) =>
        store.reservations.authorize(op, new Date().toISOString()),
    }),
  };
}
test('conflicting decisions do not branch or change history', async () => {
  const x = await fixture();
  try {
    const s = await x.prepare(),
      before = snapshot(x.f.f.base.db);
    await expect(
      x.prepare({ ...x.request, decisionId: 'different_decision' }),
    ).rejects.toMatchObject({ code: 'SOCIAL_SUPERSESSION_CONFLICT' });
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect((await x.prepare()).operationId).toBe(s.operationId);
  } finally {
    x.cleanup();
  }
});
test('two concurrent workers replay one successor', async () => {
  const x = await fixture();
  try {
    const [a, b] = await Promise.all([x.prepare(), x.prepare()]);
    expect(a).toEqual(b);
    expect(
      x.f.f.base.db
        .prepare('SELECT count(*) n FROM publication_supersessions')
        .get()?.n,
    ).toBe(1);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});
test('writer lock excludes a second SQLite connection; retry recovers the same identity', async () => {
  const x = await fixture();
  let second: DatabaseSync | undefined;
  try {
    const db = x.f.f.base.db,
      path = String(
        db
          .prepare('PRAGMA database_list')
          .all()
          .find((r: any) => r.name === 'main')!.file,
      );
    second = new DatabaseSync(path);
    second.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=1');
    const repo = new SocialPublicationRepository(
      { db: second },
      { mode: 'fake' },
    );
    db.exec('BEGIN IMMEDIATE');
    expect(() =>
      repo.prepareSupersession(x.request, x.f.at, () => {}),
    ).toThrow();
    db.exec('ROLLBACK');
    const a = await x.prepare();
    expect(repo.supersessionReplay(x.request)).toEqual(a);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    second?.close();
    x.cleanup();
  }
});
test('late transaction failure rolls back ledger, decision, event, idempotency and ownership', async () => {
  const x = await fixture();
  try {
    const db = x.f.f.base.db;
    db.exec(
      "CREATE TRIGGER fail_supersession_command BEFORE INSERT ON social_publication_commands WHEN NEW.idempotency_key LIKE 'facebook_supersession:%' BEGIN SELECT RAISE(ABORT,'SIMULATED_STORAGE_FAILURE');END;",
    );
    const before = snapshot(db);
    await expect(x.prepare()).rejects.toThrow('SIMULATED_STORAGE_FAILURE');
    expect(snapshot(db)).toEqual(before);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});
test('ownership transfers but original reservation and original events remain immutable', async () => {
  const x = await fixture();
  try {
    const before = x.f.f.base.db
      .prepare('SELECT * FROM multi_network_publication_reservations')
      .all();
    const worker = engineFor(x),
      history = worker.store.social.history(x.original.operationId);
    worker.store.close();
    const s = await x.prepare();
    const reopened = engineFor(x);
    try {
      expect(
        reopened.store.reservations.activeForExecution!(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
        )!.operationId,
      ).toBe(s.operationId);
      expect(
        reopened.store.reservations.forExecution(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
        )!.operationId,
      ).toBe(x.original.operationId);
      expect(reopened.store.social.history(x.original.operationId)).toEqual(
        history,
      );
      expect(reopened.store.social.history(s.operationId)).toHaveLength(1);
      expect(reopened.store.social.get(s.operationId).contentHash).toBe(
        affiliateHash(s),
      );
    } finally {
      reopened.store.close();
    }
    expect(
      x.f.f.base.db
        .prepare('SELECT * FROM multi_network_publication_reservations')
        .all(),
    ).toEqual(before);
  } finally {
    x.cleanup();
  }
});
test.each(['create', 'upload', 'finish', 'recover', 'reconcile'])(
  'original stays blocked after restart before %s',
  async (stage) => {
    const x = await fixture();
    try {
      await x.prepare();
      const w = engineFor(x);
      try {
        const id = x.original.operationId;
        const action =
          stage === 'create'
            ? () => w.engine.createContainer(id)
            : stage === 'upload'
              ? async () =>
                  w.engine.upload(
                    id,
                    await x.f.ports.localBytes(
                      x.f.facebookPackage.contentHash,
                      x.f.render.videoRenderId,
                      x.f.hash,
                    ),
                  )
              : stage === 'finish'
                ? () => w.engine.publish(id)
                : stage === 'recover'
                  ? () => w.engine.recoverUploadSession(id, {} as any)
                  : () => w.engine.reconcile(id);
        await expect(action()).rejects.toMatchObject({
          code: 'SOCIAL_OPERATION_SUPERSEDED',
        });
        expect(x.f.posts).toEqual(['create']);
        expect(w.store.social.get(id)).toEqual(x.original);
      } finally {
        w.store.close();
      }
    } finally {
      x.cleanup();
    }
  },
);
test('superseded ownership is revalidated inside the external-intent transaction', async () => {
  const x = await fixture();
  try {
    await x.prepare();
    const w = engineFor(x);
    try {
      expect(() =>
        w.store.social.transition(
          x.original.operationId,
          x.original.version,
          ['PROCESSING'],
          { uploadStage: 'UPLOADING' },
          x.f.at,
        ),
      ).toThrow('SOCIAL_OPERATION_SUPERSEDED');
      expect(x.f.posts).toEqual(['create']);
    } finally {
      w.store.close();
    }
  } finally {
    x.cleanup();
  }
});
test('a prepared successor cannot execute with a global allow flag or without its separate authorization', async () => {
  const x = await fixture();
  try {
    const s = await x.prepare();
    await expect(x.f.execute(x.f.reopen())).rejects.toMatchObject({
      code: 'SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED',
    });
    const w = engineFor(x);
    try {
      await expect(
        w.engine.createContainer(s.operationId),
      ).rejects.toMatchObject({
        code: 'SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED',
      });
    } finally {
      w.store.close();
    }
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});
test('a later scoped authorization publishes only the successor through the existing engine', async () => {
  const x = await fixture();
  try {
    const s = await x.prepare(),
      grant = grantFor(x, s),
      service = x.f.reopen(() => new Date().toISOString());
    await service.execute(
      x.f.execution.execution_id,
      'FACEBOOK_REELS',
      '1355505384315575',
      grant,
    );
    await service.execute(
      x.f.execution.execution_id,
      'FACEBOOK_REELS',
      '1355505384315575',
      grant,
    );
    expect(x.f.posts).toEqual(['create', 'create', 'upload', 'publish']);
    const w = engineFor(x);
    try {
      const current = w.store.social.get(s.operationId);
      expect(current.state).toBe('PUBLISHED');
      expect(current.containerId).not.toBe(x.original.containerId);
      expect(current.remoteReceipt).toBeTruthy();
      expect(current.executionAuthorization).toEqual(grant);
      expect(w.store.social.get(x.original.operationId)).toEqual(x.original);
    } finally {
      w.store.close();
    }
    expect(x.f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    x.cleanup();
  }
});
test.each([
  'wrong_operation',
  'wrong_package',
  'wrong_decision',
  'same_authorization',
  'not_later',
  'expired',
  'no_risk',
])('rejects successor authorization %s', async (variant) => {
  const x = await fixture();
  try {
    const s = await x.prepare(),
      grant = grantFor(x, s) as any;
    if (variant === 'wrong_operation')
      grant.operationId = x.original.operationId;
    if (variant === 'wrong_package') grant.packageHash = '0'.repeat(64);
    if (variant === 'wrong_decision') grant.preparationDecisionId = 'other';
    if (variant === 'same_authorization')
      grant.authorizationId = x.request.decisionId;
    if (variant === 'not_later') grant.authorizedAt = x.f.at;
    if (variant === 'expired') grant.expiresAt = grant.authorizedAt;
    if (variant === 'no_risk') grant.acceptResidualRisk = false;
    await expect(
      x.f
        .reopen(() => new Date().toISOString())
        .execute(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          grant,
        ),
    ).rejects.toThrow();
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});
test('active claim prevents supersession', async () => {
  const x = await fixture(true);
  try {
    const before = snapshot(x.f.f.base.db);
    await expect(x.prepare()).rejects.toMatchObject({
      code: 'SOCIAL_SUPERSESSION_ACTIVE_CLAIM',
    });
    expect(snapshot(x.f.f.base.db)).toEqual(before);
  } finally {
    x.cleanup();
  }
});
test('published operation cannot be superseded', async () => {
  const x = await fixture();
  try {
    await x.f.execute();
    const before = snapshot(x.f.f.base.db);
    await expect(x.prepare()).rejects.toThrow();
    expect(snapshot(x.f.f.base.db)).toEqual(before);
  } finally {
    x.cleanup();
  }
});
test.each([
  'no_risk',
  'stale',
  'future',
  'conflict',
  'positive_bytes',
  'processing',
  'published',
  'missing_phase',
])('blocks unsafe observation or decision: %s', async (variant) => {
  const x = await fixture();
  try {
    const request = JSON.parse(JSON.stringify(x.request));
    if (variant === 'no_risk') request.acceptResidualRisk = false;
    if (variant === 'stale')
      request.remoteObservation.observedAt = new Date(
        Date.parse(x.f.at) - 61000,
      ).toISOString();
    if (variant === 'future')
      request.remoteObservation.observedAt = new Date(
        Date.parse(x.f.at) + 1000,
      ).toISOString();
    if (variant === 'conflict') request.remoteObservation.progress = 'CONFLICT';
    if (variant === 'positive_bytes') {
      request.remoteObservation.progress = 'CONSISTENT';
      request.remoteObservation.bytesTransferred = 1;
    }
    if (variant === 'processing')
      request.remoteObservation.processingStatus = 'in_progress';
    if (variant === 'published')
      request.remoteObservation.publicationStatus = 'complete';
    if (variant === 'missing_phase')
      delete request.remoteObservation.uploadStatus;
    const before = snapshot(x.f.f.base.db);
    await expect(x.prepare(request)).rejects.toThrow();
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});
test('fresh provider evidence is checked again, without trusting the supplied snapshot', async () => {
  const x = await fixture();
  try {
    vi.spyOn(x.f.ports.publisher, 'inspectUploadSession').mockResolvedValue({
      ...x.request.remoteObservation,
      processingStatus: 'in_progress',
    });
    await expect(x.prepare()).rejects.toThrow();
    expect(x.f.posts).toEqual(['create']);
  } finally {
    x.cleanup();
  }
});

test('two execution workers cannot duplicate successor CREATE, UPLOAD or FINISH', async () => {
  const x = await fixture();
  let a: ReturnType<typeof engineFor> | undefined;
  let b: ReturnType<typeof engineFor> | undefined;
  try {
    const s = await x.prepare(),
      grant = grantFor(x, s);
    a = engineFor(x, grant);
    b = engineFor(x, grant);
    await Promise.all([
      a.engine.createContainer(s.operationId),
      b.engine.createContainer(s.operationId),
    ]);
    const bytes = await x.f.ports.localBytes(
      s.packageHash,
      x.f.render.videoRenderId,
      x.f.hash,
    );
    await Promise.all([
      a.engine.upload(s.operationId, bytes),
      b.engine.upload(s.operationId, bytes),
    ]);
    await a.engine.process(s.operationId);
    await Promise.all([
      a.engine.publish(s.operationId),
      b.engine.publish(s.operationId),
    ]);
    expect(x.f.posts).toEqual(['create', 'create', 'upload', 'publish']);
  } finally {
    a?.store.close();
    b?.store.close();
    x.cleanup();
  }
});

test.each(['create', 'upload', 'publish'] as const)(
  'lost %s response never permits blind resubmission after restart',
  async (stage) => {
    const x = await fixture();
    try {
      const s = await x.prepare(),
        grant = grantFor(x, s);
      x.f.fail(stage);
      if (stage === 'upload') x.f.setProcessing(false);
      if (stage === 'publish') x.f.setReceiptVisible(false);
      const execute = () =>
        x.f
          .reopen(() => new Date().toISOString())
          .execute(
            x.f.execution.execution_id,
            'FACEBOOK_REELS',
            '1355505384315575',
            grant,
          );
      await expect(execute()).rejects.toThrow();
      const before = x.f.posts.slice();
      await expect(execute()).rejects.toThrow();
      expect(x.f.posts).toEqual(before);
      expect(x.f.posts.filter((p) => p === stage)).toHaveLength(
        stage === 'create' ? 2 : 1,
      );
    } finally {
      x.cleanup();
    }
  },
);

test('incomplete original history blocks supersession without mutating the ledger', async () => {
  const x = await fixture();
  const spy = vi
    .spyOn(SocialPublicationRepository.prototype, 'history')
    .mockReturnValue([]);
  try {
    const before = snapshot(x.f.f.base.db);
    await expect(x.prepare()).rejects.toThrow();
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    spy.mockRestore();
    x.cleanup();
  }
});

test('a claim appearing during remote inspection is rejected by transactional revalidation', async () => {
  const x = await fixture();
  const open = x.f.campaignPort.open.bind(x.f.campaignPort);
  let reads = 0;
  const spy = vi.spyOn(x.f.campaignPort, 'open').mockImplementation(() => {
    const session = open();
    const facts = session.facts.bind(session);
    session.facts = (id) =>
      facts(id).map((e) => (++reads > 1 ? { ...e, status: 'RUNNING' } : e));
    return session;
  });
  try {
    const before = snapshot(x.f.f.base.db);
    await expect(x.prepare()).rejects.toMatchObject({
      code: 'SOCIAL_SUPERSESSION_ACTIVE_CLAIM',
    });
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect(x.f.posts).toEqual(['create']);
  } finally {
    spy.mockRestore();
    x.cleanup();
  }
});

async function lineageFixture(revisions = 2) {
  const x = await fixture();
  const ancestors = [x.original];
  const authorize = (successor: any) => {
    const time = new Date(Date.now() + 1000).toISOString();
    const base = grantFor(x, successor);
    vi.setSystemTime(time);
    return {
      ...base,
      preparationDecisionId: successor.supersession.decisionId,
      authorizedAt: time,
      expiresAt: new Date(Date.parse(time) + 60000).toISOString(),
    };
  };
  const prepareRevision = async (prior: any, revision: number) =>
    x.f
      .reopen(() => new Date().toISOString())
      .prepareFacebookSupersession(
        x.f.execution.execution_id,
        '1355505384315575',
        {
          ...x.request,
          originalOperationId: prior.operationId,
          revision,
          decisionId: `lineage_decision_${revision}`,
          expectedVersion: prior.version,
          remoteObservation: await x.f.ports.publisher.inspectUploadSession!(
            prior.containerId,
          ),
        },
      );
  try {
    let successor = await x.prepare();
    for (let revision = 2; revision <= revisions; revision++) {
      const w = engineFor(x, authorize(successor));
      try {
        const prior = await w.engine.createContainer(successor.operationId);
        ancestors.push(prior);
        successor = await prepareRevision(prior, revision);
      } finally {
        w.store.close();
      }
    }
    return { ...x, successor, ancestors, authorize, prepareRevision };
  } catch (error) {
    x.cleanup();
    throw error;
  }
}

function remoteProgress(
  x: Awaited<ReturnType<typeof lineageFixture>>,
  index: number,
  patch: any,
) {
  const inspect = x.f.ports.publisher.inspectUploadSession!.bind(
    x.f.ports.publisher,
  );
  return vi
    .spyOn(x.f.ports.publisher, 'inspectUploadSession')
    .mockImplementation(async (id) => {
      const observation = await inspect(id);
      if (id !== x.ancestors[index].containerId) return observation;
      const fields = { ...observation.fields };
      for (const key of [
        'videoStatus',
        'uploadStatus',
        'processingStatus',
        'publicationStatus',
        'bytesTransferred',
      ])
        if (patch[key] !== undefined)
          fields[key] = { present: true, value: patch[key] };
      return {
        ...observation,
        ...patch,
        fields: { ...fields, ...patch.fields },
      };
    });
}

const unsafeAncestors = [
  {
    name: 'published root',
    index: 0,
    patch: { publicationStatus: 'complete' },
  },
  {
    name: 'root FINISH in progress',
    index: 0,
    patch: { publicationStatus: 'in_progress' },
  },
  {
    name: 'root upload progress',
    index: 0,
    patch: { progress: 'CONSISTENT', bytesTransferred: 1 },
  },
  {
    name: 'intermediate progress',
    index: 1,
    patch: { processingStatus: 'in_progress' },
  },
  {
    name: 'UNKNOWN with positive raw bytes',
    index: 0,
    patch: {
      progress: 'UNKNOWN',
      fields: { bytesTransferred: { present: true, value: 1 } },
    },
  },
];

test.each(unsafeAncestors)(
  'complete lineage blocks preparation: $name',
  async ({ index, patch }) => {
    const x = await lineageFixture(3);
    const w = engineFor(x, x.authorize(x.successor));
    let spy: ReturnType<typeof remoteProgress> | undefined;
    try {
      const prior = await w.engine.createContainer(x.successor.operationId);
      spy = remoteProgress(x, index, patch);
      const before = snapshot(x.f.f.base.db),
        posts = x.f.posts.slice();
      await expect(x.prepareRevision(prior, 4)).rejects.toThrow();
      expect(snapshot(x.f.f.base.db)).toEqual(before);
      expect(x.f.posts).toEqual(posts);
    } finally {
      spy?.mockRestore();
      w.store.close();
      x.cleanup();
    }
  },
);

for (const stage of ['CREATE', 'UPLOAD', 'FINISH'] as const) {
  test.each(unsafeAncestors)(
    `complete lineage blocks ${stage}: $name`,
    async ({ index, patch }) => {
      const x = await lineageFixture();
      const w = engineFor(x, x.authorize(x.successor));
      let spy: ReturnType<typeof remoteProgress> | undefined;
      try {
        const id = x.successor.operationId;
        const bytes = await x.f.ports.localBytes(
          x.successor.packageHash,
          x.f.render.videoRenderId,
          x.f.hash,
        );
        if (stage !== 'CREATE') await w.engine.createContainer(id);
        if (stage === 'FINISH') {
          await w.engine.upload(id, bytes);
          await w.engine.process(id);
        }
        spy = remoteProgress(x, index, patch);
        const before = snapshot(x.f.f.base.db),
          posts = x.f.posts.slice();
        const action =
          stage === 'CREATE'
            ? () => w.engine.createContainer(id)
            : stage === 'UPLOAD'
              ? () => w.engine.upload(id, bytes)
              : () => w.engine.publish(id);
        await expect(action()).rejects.toThrow();
        expect(x.f.posts).toEqual(posts);
        expect(snapshot(x.f.f.base.db)).toEqual(before);
      } finally {
        spy?.mockRestore();
        w.store.close();
        x.cleanup();
      }
    },
  );
}

test('complete lineage reconstructs after restart, replays and publishes once with two workers', async () => {
  const x = await lineageFixture(3);
  const grant = x.authorize(x.successor);
  const a = engineFor(x, grant),
    b = engineFor(x, grant);
  const inspect = x.f.ports.publisher.inspectUploadSession!.bind(
    x.f.ports.publisher,
  );
  const spy = vi
    .spyOn(x.f.ports.publisher, 'inspectUploadSession')
    .mockImplementation(async (id) => {
      // A separate connection can still acquire a writer lock during remote I/O.
      x.f.f.base.db.exec('BEGIN IMMEDIATE');
      x.f.f.base.db.exec('ROLLBACK');
      return inspect(id);
    });
  try {
    const id = x.successor.operationId,
      s = x.successor.supersession;
    expect(
      a.store.social
        .resolveSupersessionLineage(id)
        .map((n: any) => n.operation.operationId),
    ).toEqual([...x.ancestors.map((n) => n.operationId), id]);
    const replay = await x.f
      .reopen()
      .prepareFacebookSupersession(
        x.f.execution.execution_id,
        '1355505384315575',
        {
          originalOperationId: s.predecessorId,
          revision: s.revision,
          decisionId: s.decisionId,
          actor: s.actor,
          reason: s.reason,
          remoteObservation: s.remoteObservation,
          acceptResidualRisk: true,
          expectedVersion: x.ancestors.at(-1).version,
        },
      );
    expect(replay).toEqual(x.successor);
    await Promise.all([
      a.engine.createContainer(id),
      b.engine.createContainer(id),
    ]);
    const bytes = await x.f.ports.localBytes(
      x.successor.packageHash,
      x.f.render.videoRenderId,
      x.f.hash,
    );
    await Promise.all([a.engine.upload(id, bytes), b.engine.upload(id, bytes)]);
    await a.engine.process(id);
    await Promise.all([a.engine.publish(id), b.engine.publish(id)]);
    const service = x.f.reopen(() => new Date().toISOString());
    await service.execute(
      x.f.execution.execution_id,
      'FACEBOOK_REELS',
      '1355505384315575',
      grant,
    );
    await service.execute(
      x.f.execution.execution_id,
      'FACEBOOK_REELS',
      '1355505384315575',
      grant,
    );
    expect(x.f.posts).toEqual([
      'create',
      'create',
      'create',
      'create',
      'upload',
      'publish',
    ]);
    for (const ancestor of x.ancestors)
      expect(a.store.social.get(ancestor.operationId)).toEqual(ancestor);
    expect(x.f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    spy.mockRestore();
    a.store.close();
    b.store.close();
    x.cleanup();
  }
});

test.each([
  'cycle',
  'revision_gap',
  'wrong_root',
  'branch',
  'payload_hash',
  'history',
  'ledger',
])('complete lineage rejects corrupt %s without POST', async (variant) => {
  const x = await lineageFixture();
  const w = engineFor(x, x.authorize(x.successor));
  const db = w.store.social.db,
    prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: any) => {
    const statement = prepare(sql);
    if (
      sql.startsWith(
        'SELECT root_operation_id,predecessor_id,supersession_revision,supersession_id',
      )
    )
      return {
        get: (id: string) => {
          const row = statement.get(id);
          if (id !== x.ancestors[0].operationId) return row;
          if (variant === 'cycle')
            return { ...row, predecessor_id: x.successor.operationId };
          if (variant === 'revision_gap')
            return { ...row, supersession_revision: 5 };
          if (variant === 'wrong_root')
            return { ...row, root_operation_id: x.successor.operationId };
          return row;
        },
      } as any;
    if (
      variant === 'branch' &&
      sql ===
        'SELECT operation_id FROM social_publication_operations WHERE predecessor_id=?'
    )
      return {
        all: (id: string) => [
          ...statement.all(id),
          { operation_id: 'unexpected_branch' },
        ],
      } as any;
    if (
      variant === 'payload_hash' &&
      sql === 'SELECT * FROM social_publication_operations WHERE operation_id=?'
    )
      return {
        get: (id: string) => {
          const row = statement.get(id);
          return {
            ...row,
            payload_json: JSON.stringify({
              ...JSON.parse(row.payload_json),
              caption: 'tampered',
            }),
          };
        },
      } as any;
    if (
      variant === 'history' &&
      sql ===
        'SELECT version,payload_json FROM social_publication_events WHERE operation_id=? ORDER BY version'
    )
      return { all: (id: string) => statement.all(id).slice(1) } as any;
    if (
      variant === 'ledger' &&
      sql === 'SELECT * FROM publication_supersessions WHERE successor_id=?'
    )
      return {
        get: (id: string) => ({ ...statement.get(id), predecessor_id: id }),
      } as any;
    return statement;
  });
  try {
    const posts = x.f.posts.slice();
    await expect(
      w.engine.createContainer(x.successor.operationId),
    ).rejects.toThrow();
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy.mockRestore();
    w.store.close();
    x.cleanup();
  }
});

test('complete lineage keeps positive local upload history despite current UNKNOWN', async () => {
  const x = await lineageFixture();
  const w = engineFor(x, x.authorize(x.successor));
  const history = w.store.social.history.bind(w.store.social);
  const spy = vi
    .spyOn(w.store.social, 'history')
    .mockImplementation((id: unknown) =>
      history(id).map((event: any, i: number) => {
        if (id !== x.original.operationId || i !== 1) return event;
        const body = { ...event, uploadStage: 'UPLOADING' };
        return { ...body, contentHash: affiliateHash(body) };
      }),
    );
  try {
    const posts = x.f.posts.slice();
    await expect(
      w.engine.createContainer(x.successor.operationId),
    ).rejects.toMatchObject({ code: 'SOCIAL_SUPERSESSION_INELIGIBLE' });
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy.mockRestore();
    w.store.close();
    x.cleanup();
  }
});

test.each(['version', 'stale', 'missing'])(
  'complete lineage revalidates %s evidence inside BEGIN IMMEDIATE',
  async (variant) => {
    const x = await lineageFixture();
    const grant = x.authorize(x.successor);
    grant.expiresAt = new Date(Date.now() + 600000).toISOString();
    const w = engineFor(x, grant);
    try {
      const evidence = JSON.parse(
        JSON.stringify(
          await w.engine.inspectSupersessionLineage(x.successor.operationId),
        ),
      );
      if (variant === 'version') evidence[0].version++;
      if (variant === 'stale') vi.setSystemTime(Date.now() + 61000);
      const before = snapshot(x.f.f.base.db),
        posts = x.f.posts.slice();
      const validate = w.store.social.validateSupersessionLineage.bind(
        w.store.social,
      );
      const spy = vi
        .spyOn(w.store.social, 'validateSupersessionLineage')
        .mockImplementation((...args: any[]) => {
          expect(w.store.social.db.isTransaction).toBe(true);
          return validate(...args);
        });
      try {
        expect(() =>
          w.store.social.transition(
            x.successor.operationId,
            x.successor.version,
            ['PREPARED'],
            { state: 'CREATING_CONTAINER' },
            new Date().toISOString(),
            grant,
            variant === 'missing' ? undefined : evidence,
          ),
        ).toThrow();
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
      expect(snapshot(x.f.f.base.db)).toEqual(before);
      expect(x.f.posts).toEqual(posts);
    } finally {
      w.store.close();
      x.cleanup();
    }
  },
);

test('complete lineage blocks FINISH reached through upload reconciliation', async () => {
  const x = await lineageFixture();
  const grant = x.authorize(x.successor),
    w = engineFor(x, grant);
  let spy: ReturnType<typeof remoteProgress> | undefined;
  try {
    const id = x.successor.operationId;
    await w.engine.createContainer(id);
    x.f.fail('upload');
    x.f.setProcessing(false);
    const bytes = await x.f.ports.localBytes(
      x.successor.packageHash,
      x.f.render.videoRenderId,
      x.f.hash,
    );
    expect((await w.engine.upload(id, bytes)).state).toBe('UNCERTAIN');
    x.f.fail(undefined);
    x.f.setProcessing(true);
    spy = remoteProgress(x, 0, { publicationStatus: 'complete' });
    const posts = x.f.posts.slice();
    await expect(
      x.f
        .reopen(() => new Date().toISOString())
        .execute(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          grant,
        ),
    ).rejects.toMatchObject({
      code: 'SOCIAL_SUPERSESSION_OBSERVATION_INVALID',
    });
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy?.mockRestore();
    w.store.close();
    x.cleanup();
  }
});

test('complete lineage checks freshness after acquiring the intent writer lock', async () => {
  const x = await lineageFixture();
  const grant = x.authorize(x.successor);
  grant.expiresAt = new Date(Date.now() + 600000).toISOString();
  const w = engineFor(x, grant),
    db = w.store.social.db;
  const exec = db.exec.bind(db);
  const spy = vi.spyOn(db, 'exec').mockImplementation((sql: unknown) => {
    if (sql === 'BEGIN IMMEDIATE') vi.setSystemTime(Date.now() + 61000);
    return exec(sql);
  });
  try {
    const posts = x.f.posts.slice();
    await expect(
      w.engine.createContainer(x.successor.operationId),
    ).rejects.toMatchObject({
      code: 'SOCIAL_SUPERSESSION_OBSERVATION_INVALID',
    });
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy.mockRestore();
    w.store.close();
    x.cleanup();
  }
});

async function acknowledgedSuccessorVersionEight() {
  const x = await fixture();
  try {
    const successor = await x.prepare(),
      grant = grantFor(x, successor),
      worker = engineFor(x, grant);
    try {
      await worker.engine.createContainer(successor.operationId);
      const bytes = await x.f.ports.localBytes(
        successor.packageHash,
        x.f.render.videoRenderId,
        x.f.hash,
      );
      const uploaded = await worker.engine.upload(successor.operationId, bytes);
      expect(uploaded.version).toBe(7);
      expect(uploaded.uploadStage).toBe('ACKNOWLEDGED');
      const status = worker.store.social.transition(
        successor.operationId,
        uploaded.version,
        ['PROCESSING'],
        { state: 'PROCESSING', providerStatus: 'IN_PROGRESS' },
        () => new Date().toISOString(),
        grant,
      );
      expect(status.claimed).toBe(true);
      expect(status.value.version).toBe(8);
      expect(status.value.state).toBe('PROCESSING');
    } finally {
      worker.store.close();
    }
    x.f.setProcessing(false);
    return { ...x, successor, grant };
  } catch (error) {
    x.cleanup();
    throw error;
  }
}

test('version 8 successor resumes FINISH on its acknowledged session without another CREATE or UPLOAD', async () => {
  const x = await acknowledgedSuccessorVersionEight();
  try {
    const before = x.f.posts.slice();
    expect(before).toEqual(['create', 'create', 'upload']);
    expect(() => {
      const store = x.f.store.openDestination('fake');
      try {
        store.social.assertNotSuperseded(x.original.operationId);
      } finally {
        store.close();
      }
    }).toThrow('SOCIAL_OPERATION_SUPERSEDED');
    const execute = () =>
      x.f
        .reopen(() => new Date().toISOString())
        .execute(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          x.grant,
          8,
        );
    await Promise.allSettled([execute(), execute()]);
    expect(x.f.posts).toEqual([...before, 'publish']);
    const store = x.f.store.openDestination('fake');
    const current = store.social.get(x.successor.operationId);
    store.close();
    expect(current.state).toBe('PUBLISHED');
    expect(current.containerId).not.toBe(x.original.containerId);
    expect(current.mediaId).toBe(current.containerId);
    expect(current.remoteReceipt).toBeUndefined();
    x.f.setProcessing(true);
    const receipt = await x.f
      .reopen(() => new Date().toISOString())
      .execute(
        x.f.execution.execution_id,
        'FACEBOOK_REELS',
        '1355505384315575',
        x.grant,
        current.version,
      );
    expect(receipt.receipt.mediaId).toBe(current.containerId);
    expect(await execute()).toEqual(receipt);
    expect(x.f.posts).toEqual([...before, 'publish']);
  } finally {
    x.cleanup();
  }
});

test('version 8 successor rejects expired grant and never repeats an uncertain FINISH', async () => {
  const expired = await acknowledgedSuccessorVersionEight();
  try {
    const before = expired.f.posts.slice();
    vi.setSystemTime(new Date(Date.parse(expired.grant.expiresAt) + 1));
    await expect(
      expired.f
        .reopen(() => new Date().toISOString())
        .execute(
          expired.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          expired.grant,
          8,
        ),
    ).rejects.toThrow();
    expect(expired.f.posts).toEqual(before);
  } finally {
    expired.cleanup();
  }
  const uncertain = await acknowledgedSuccessorVersionEight();
  try {
    uncertain.f.fail('publish');
    uncertain.f.setReceiptVisible(false);
    const execute = () =>
      uncertain.f
        .reopen(() => new Date().toISOString())
        .execute(
          uncertain.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          uncertain.grant,
        );
    await expect(execute()).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    const posts = uncertain.f.posts.slice();
    expect(posts).toEqual(['create', 'create', 'upload', 'publish']);
    uncertain.f.fail(undefined);
    await expect(execute()).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    expect(uncertain.f.posts).toEqual(posts);
    const store = uncertain.f.store.openDestination('fake');
    const current = store.social.get(uncertain.successor.operationId);
    store.close();
    expect(current.state).toBe('UNCERTAIN');
    expect(current.uncertainStage).toBe('PUBLISH');
  } finally {
    uncertain.cleanup();
  }
});

test('published successor without remote receipt can renew a grant for GET-only receipt recovery', async () => {
  const x = await acknowledgedSuccessorVersionEight();
  try {
    const execute = (grant: any, expectedVersion: number) =>
      x.f
        .reopen(() => new Date().toISOString())
        .execute(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          '1355505384315575',
          grant,
          expectedVersion,
        );
    await expect(execute(x.grant, 8)).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    const store = x.f.store.openDestination('fake');
    const pending = store.social.get(x.successor.operationId);
    store.close();
    expect(pending.state).toBe('PUBLISHED');
    expect(pending.remoteReceipt).toBeUndefined();
    const posts = x.f.posts.slice();
    expect(posts).toEqual(['create', 'create', 'upload', 'publish']);
    const authorizedAt = new Date(
      Date.parse(x.grant.expiresAt) + 1000,
    ).toISOString();
    vi.setSystemTime(authorizedAt);
    const renewal = {
      ...x.grant,
      authorizationId: 'receipt_recovery_decision_003',
      authorizedAt,
      expiresAt: new Date(Date.parse(authorizedAt) + 60000).toISOString(),
    };
    const issued = await x.f
      .reopen(() => new Date().toISOString())
      .authorizeFacebookSuccessor(
        x.f.execution.execution_id,
        '1355505384315575',
        pending.version,
        renewal,
      );
    expect(issued.authorization).toEqual(renewal);
    x.f.setProcessing(true);
    const recovered = await execute(renewal, pending.version);
    expect(recovered.receipt.mediaId).toBe(pending.containerId);
    expect(x.f.posts).toEqual(posts);
    const completedStore = x.f.store.openDestination('fake');
    const completed = completedStore.social.get(x.successor.operationId);
    completedStore.close();
    await expect(
      x.f
        .reopen(() => new Date().toISOString())
        .authorizeFacebookSuccessor(
          x.f.execution.execution_id,
          '1355505384315575',
          completed.version,
          { ...renewal, authorizationId: 'unneeded_decision_004' },
        ),
    ).rejects.toMatchObject({ code: 'SOCIAL_SUPERSESSION_INELIGIBLE' });
  } finally {
    x.cleanup();
  }
});

async function interruptedSuccessor() {
  const x = await lineageFixture();
  const grant = x.authorize(x.successor);
  const w = engineFor(x, grant);
  try {
    x.f.fail('create');
    expect(
      (await w.engine.createContainer(x.successor.operationId)).state,
    ).toBe('UNCERTAIN');
    x.f.fail(undefined);
    const ack: FacebookCreateAcknowledgement = {
      operationId: x.successor.operationId,
      packageHash: x.successor.packageHash,
      pageId: '1355505384315575',
      videoId: String(Number(x.original.containerId) + x.ancestors.length),
      uploadVersion: 'v27.0',
      startedAt: grant.authorizedAt,
      acknowledgedAt: grant.authorizedAt,
      createSubmissions: 1,
      uploadSubmissions: 0,
      publicationSubmissions: 0,
      httpStatus: 200,
      evidenceHash: 'a'.repeat(64),
    };
    return { ...x, grant, ack };
  } catch (error) {
    x.cleanup();
    throw error;
  } finally {
    w.store.close();
  }
}

test.each([0, 1])(
  'successor recovery rejects ancestor %s session before persisting an ACK',
  async (index) => {
    const x = await interruptedSuccessor();
    const w = engineFor(x, x.grant);
    try {
      const before = snapshot(x.f.f.base.db),
        posts = x.f.posts.slice();
      await expect(
        w.engine.recoverUploadSession(x.ack.operationId, {
          ...x.ack,
          videoId: x.ancestors[index].containerId,
        }),
      ).rejects.toMatchObject({ code: 'SOCIAL_SESSION_ID_CONFLICT' });
      expect(snapshot(x.f.f.base.db)).toEqual(before);
      expect(x.f.posts).toEqual(posts);
    } finally {
      w.store.close();
      x.cleanup();
    }
  },
);

test('successor recovery rechecks ancestor collision inside its writer transaction', async () => {
  const x = await interruptedSuccessor();
  const w = engineFor(x, x.grant);
  try {
    const op = w.store.social.get(x.ack.operationId),
      videoId = x.original.containerId,
      before = snapshot(x.f.f.base.db);
    expect(() =>
      w.store.social.transition(
        op.operationId,
        op.version,
        ['UNCERTAIN'],
        {
          state: 'PROCESSING',
          containerId: videoId,
          uploadUri: `https://rupload.facebook.com/video-upload/v27.0/${videoId}`,
          uploadStage: 'PENDING',
          sessionEvidence: {
            source: 'DOCUMENTED_RECOVERY',
            originalUrlRecovered: false,
            videoId,
            pageId: x.ack.pageId,
          },
        },
        () => new Date().toISOString(),
      ),
    ).toThrow('SOCIAL_SESSION_ID_CONFLICT');
    expect(snapshot(x.f.f.base.db)).toEqual(before);
  } finally {
    w.store.close();
    x.cleanup();
  }
});

test('successor recovery accepts a valid ACK after restart, replays across two workers and publishes once', async () => {
  const x = await interruptedSuccessor();
  const recover = () =>
    x.f
      .reopen(() => new Date().toISOString())
      .reconcileFacebookSession(
        x.f.execution.execution_id,
        x.ack.pageId,
        x.ack,
      );
  let spy: { mockRestore(): void } | undefined;
  try {
    const before = snapshot(x.f.f.base.db),
      posts = x.f.posts.slice();
    const [a, b] = await Promise.all([recover(), recover()]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      state: 'PROCESSING',
      uploadStage: 'PENDING',
      operationId: x.successor.operationId,
      containerId: x.ack.videoId,
      sessionEvidence: { source: 'DOCUMENTED_RECOVERY' },
    });
    expect(a.contentHash).toBe(affiliateHash(a));
    expect(await recover()).toEqual(a);
    expect(x.f.posts).toEqual(posts);
    const after = snapshot(x.f.f.base.db);
    expect(after.multi_network_publication_reservations).toEqual(
      before.multi_network_publication_reservations,
    );
    expect(after.publication_active_ownership).toEqual(
      before.publication_active_ownership,
    );
    expect(after.social_publication_events.length).toBe(
      before.social_publication_events.length + 1,
    );
    const execute = () =>
      x.f
        .reopen(() => new Date().toISOString())
        .execute(
          x.f.execution.execution_id,
          'FACEBOOK_REELS',
          x.ack.pageId,
          x.grant,
        );
    // Recovery can preserve an UNKNOWN observation; it cannot authorize upload.
    await expect(execute()).rejects.toMatchObject({
      code: 'SOCIAL_RECONCILIATION_REQUIRED',
    });
    expect(x.f.posts).toEqual(posts);
    const inspect = x.f.ports.publisher.inspectUploadSession!.bind(
      x.f.ports.publisher,
    );
    spy = vi
      .spyOn(x.f.ports.publisher, 'inspectUploadSession')
      .mockImplementation(async (id) => {
        const o = await inspect(id);
        return id === x.ack.videoId
          ? {
              ...o,
              progress: 'CONSISTENT' as const,
              bytesTransferred: 0,
              fields: {
                ...o.fields,
                bytesTransferred: { present: true as const, value: 0 },
              },
            }
          : o;
      });
    await execute();
    await execute();
    expect(x.f.posts).toEqual([...posts, 'upload', 'publish']);
    for (const ancestor of x.ancestors) {
      const w = engineFor(x, x.grant);
      try {
        expect(w.store.social.get(ancestor.operationId)).toEqual(ancestor);
      } finally {
        w.store.close();
      }
    }
    expect(x.f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    spy?.mockRestore();
    x.cleanup();
  }
});

test.each(['UPLOAD', 'FINISH'] as const)(
  'persisted ancestor collision blocks %s in the engine and intent transaction',
  async (stage) => {
    const x = await lineageFixture();
    const grant = x.authorize(x.successor),
      w = engineFor(x, grant);
    try {
      const id = x.successor.operationId,
        bytes = await x.f.ports.localBytes(
          x.successor.packageHash,
          x.f.render.videoRenderId,
          x.f.hash,
        );
      await w.engine.createContainer(id);
      if (stage === 'FINISH') {
        await w.engine.upload(id, bytes);
        await w.engine.process(id);
      }
      const evidence = await w.engine.inspectSupersessionLineage(id);
      const current = w.store.social.get(id),
        videoId = x.original.containerId;
      const { evidenceHash: _oldEvidenceHash, ...originalProof } =
        current.transferEvidence ?? {};
      const proof = { ...originalProof, containerId: videoId };
      const corrupt = {
        ...current,
        containerId: videoId,
        uploadUri: `https://rupload.facebook.com/video-upload/v27.0/${videoId}`,
        sessionEvidence: { ...current.sessionEvidence, videoId },
        ...(stage === 'FINISH'
          ? {
              transferEvidence: {
                ...proof,
                evidenceHash: affiliateHash(proof),
              },
            }
          : {}),
        version: current.version + 1,
      };
      const saved = { ...corrupt, contentHash: affiliateHash(corrupt) };
      // Model a collision persisted by the former recovery path, with valid hashes.
      w.store.social.db
        .prepare(
          'UPDATE social_publication_operations SET payload_json=?,version=? WHERE operation_id=?',
        )
        .run(JSON.stringify(saved), saved.version, id);
      w.store.social.db
        .prepare('INSERT INTO social_publication_events VALUES(?,?,?)')
        .run(id, saved.version, JSON.stringify(saved));
      const before = snapshot(x.f.f.base.db),
        posts = x.f.posts.slice();
      await expect(
        stage === 'UPLOAD' ? w.engine.upload(id, bytes) : w.engine.publish(id),
      ).rejects.toMatchObject({ code: 'SOCIAL_SESSION_ID_CONFLICT' });
      expect(() =>
        w.store.social.transition(
          id,
          saved.version,
          [saved.state],
          stage === 'UPLOAD'
            ? { uploadStage: 'UPLOADING' }
            : { state: 'PUBLISHING' },
          () => new Date().toISOString(),
          grant,
          evidence,
        ),
      ).toThrow('SOCIAL_SESSION_ID_CONFLICT');
      expect(x.f.posts).toEqual(posts);
      expect(snapshot(x.f.f.base.db)).toEqual(before);
    } finally {
      w.store.close();
      x.cleanup();
    }
  },
);

test.each([
  'missing',
  'historical_owner',
  'wrong_root',
  'wrong_execution',
  'wrong_campaign',
  'wrong_artifact',
  'wrong_network',
  'wrong_account',
  'wrong_revision',
  'wrong_package',
])('successor recovery rejects %s active ownership', async (variant) => {
  const x = await interruptedSuccessor();
  const open = x.f.store.openDestination.bind(x.f.store);
  const spy = vi
    .spyOn(x.f.store, 'openDestination')
    .mockImplementation((mode) => {
      const session = open(mode),
        db = session.social.db,
        prepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: any) => {
        const statement = prepare(sql);
        if (sql.includes('FROM publication_active_ownership'))
          return {
            get: (...args: any[]) => {
              const row = statement.get(...args);
              if (!row || variant === 'missing') return undefined;
              const fields: Record<string, object> = {
                historical_owner: {
                  active_operation_id: x.original.operationId,
                },
                wrong_root: {
                  reservation_operation_id: x.successor.operationId,
                },
                wrong_execution: { execution_id: 'different_execution' },
                wrong_campaign: { campaign_id: 'different_campaign' },
                wrong_artifact: { artifact_hash: '0'.repeat(64) },
                wrong_network: { network: 'INSTAGRAM' },
                wrong_account: { account_id: '999999999' },
                wrong_revision: { revision: 0 },
              };
              return { ...row, ...fields[variant] };
            },
          } as any;
        if (
          variant === 'wrong_package' &&
          sql ===
            'SELECT * FROM multi_network_publication_reservations WHERE operation_id=?'
        )
          return {
            get: (...args: any[]) => ({
              ...statement.get(...args),
              package_hash: '0'.repeat(64),
            }),
          } as any;
        return statement;
      });
      return session;
    });
  try {
    const before = snapshot(x.f.f.base.db),
      posts = x.f.posts.slice();
    await expect(
      x.f
        .reopen(() => new Date().toISOString())
        .reconcileFacebookSession(
          x.f.execution.execution_id,
          x.ack.pageId,
          x.ack,
        ),
    ).rejects.toMatchObject({
      code:
        variant === 'historical_owner'
          ? 'SOCIAL_SESSION_EVIDENCE_INVALID'
          : 'SOCIAL_RESERVATION_CONFLICT',
    });
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy.mockRestore();
    x.cleanup();
  }
});

test('successor recovery rechecks active ownership after remote inspection inside BEGIN IMMEDIATE', async () => {
  const x = await interruptedSuccessor();
  const open = x.f.store.openDestination.bind(x.f.store);
  let rejectedInTransaction = false;
  const spy = vi
    .spyOn(x.f.store, 'openDestination')
    .mockImplementation((mode) => {
      const session = open(mode),
        db = session.social.db,
        prepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: any) => {
        const statement = prepare(sql);
        if (sql.includes('FROM publication_active_ownership'))
          return {
            get: (...args: any[]) => {
              if (db.isTransaction) {
                rejectedInTransaction = true;
                return undefined;
              }
              return statement.get(...args);
            },
          } as any;
        return statement;
      });
      return session;
    });
  try {
    const before = snapshot(x.f.f.base.db),
      posts = x.f.posts.slice();
    await expect(
      x.f
        .reopen(() => new Date().toISOString())
        .reconcileFacebookSession(
          x.f.execution.execution_id,
          x.ack.pageId,
          x.ack,
        ),
    ).rejects.toMatchObject({ code: 'SOCIAL_RESERVATION_CONFLICT' });
    expect(rejectedInTransaction).toBe(true);
    expect(snapshot(x.f.f.base.db)).toEqual(before);
    expect(x.f.posts).toEqual(posts);
  } finally {
    spy.mockRestore();
    x.cleanup();
  }
});

test('successor recovery rejects an operation superseded after its valid recovery', async () => {
  const x = await interruptedSuccessor();
  try {
    const service = x.f.reopen(() => new Date().toISOString());
    const recovered = await service.reconcileFacebookSession(
      x.f.execution.execution_id,
      x.ack.pageId,
      x.ack,
    );
    await x.prepareRevision(recovered, 3);
    const before = snapshot(x.f.f.base.db),
      posts = x.f.posts.slice(),
      w = engineFor(x, x.grant);
    try {
      await expect(
        service.reconcileFacebookSession(
          x.f.execution.execution_id,
          x.ack.pageId,
          x.ack,
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_SESSION_EVIDENCE_INVALID' });
      await expect(
        w.engine.recoverUploadSession(x.ack.operationId, x.ack),
      ).rejects.toMatchObject({ code: 'SOCIAL_OPERATION_SUPERSEDED' });
      expect(snapshot(x.f.f.base.db)).toEqual(before);
      expect(x.f.posts).toEqual(posts);
    } finally {
      w.store.close();
    }
  } finally {
    x.cleanup();
  }
});
