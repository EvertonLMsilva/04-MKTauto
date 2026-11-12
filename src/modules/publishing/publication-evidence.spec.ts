import { projectPublicationEvidence } from './application/publication-evidence.js';
import { DestinationPublicationService } from './application/destination-publication.service.js';
const now = '2026-11-08T13:00:00.000Z';
const hash = 'a'.repeat(64);
function fixture(state = 'PUBLISHED', network = 'FACEBOOK_REELS') {
  const pkg = {
    contentHash: hash,
    platform: network === 'INSTAGRAM' ? 'instagram' : 'facebook',
    account: '123456789',
    identity: { videoRenderRevision: 2 },
  };
  const op = {
    operationId: 'op_active',
    packageHash: hash,
    version: 8,
    network,
    state,
    executionMode: 'fake',
    mediaId: '12345',
    updatedAt: now,
    remoteReceipt: {
      mediaId: '12345',
      publishedAt: now,
      permalink:
        network === 'INSTAGRAM'
          ? 'https://www.instagram.com/reel/12345/'
          : 'https://www.facebook.com/reel/12345/',
      rawToken: 'PRIVATE_SECRET',
    },
    uploadUri: 'https://private.invalid?token=PRIVATE_SECRET',
    caption: 'PRIVATE_SECRET',
    executionAuthorization: {
      operationId: 'op_active',
      packageHash: hash,
      authorizedAt: '2026-11-08T12:00:00Z',
      expiresAt: '2026-11-08T12:01:00Z',
      actor: 'PRIVATE_SECRET',
    },
  };
  const row = {
    network,
    accountId: pkg.account,
    originalOperationId: op.operationId,
    operation: op,
  };
  const item = {
    execution: {
      execution_id: 'execution_001',
      campaign_id: 'campaign_001',
      campaign_revision: 1,
      run_id: 'run_001',
      production_date: '2026-11-08',
      status: 'SUCCEEDED',
      project_id: 'project_001',
    },
    request: {},
    packages: [
      {
        value: pkg,
        review: { packageHash: hash, mediaDecision: { decision: 'APPROVED' } },
        revoked: false,
      },
    ],
    operations: [row],
    latestCampaignEvent: null,
    blockingEvent: null,
  };
  return { item, op, row, rows: [{ ...row, operationId: op.operationId }] };
}
test.each(['INSTAGRAM', 'FACEBOOK_REELS'])(
  'sanitized %s evidence retains confirmed receipt after expiry without mutating input',
  (network) => {
    const f = fixture('PUBLISHED', network),
      before = structuredClone(f);
    const result = projectPublicationEvidence(f.item, f.rows, now);
    expect(result.schemaVersion).toBe('publication-evidence/1.0.0');
    expect(result.publicationComplete).toBe(true);
    expect(result.destinations[0]).toMatchObject({
      publicationStatus: 'CONFIRMED',
      executionMode: 'fake',
      authorization: { status: 'EXPIRED' },
    });
    expect(result.destinations[0].receipt?.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
    expect(projectPublicationEvidence(f.item, f.rows, now)).toEqual(result);
    expect(f).toEqual(before);
  },
);
test.each(['PREPARED', 'PROCESSING', 'UNCERTAIN', 'FAILED', 'BLOCKED'])(
  'evidence never confirms %s even when a receipt is present',
  (state) => {
    const f = fixture(state);
    expect(
      projectPublicationEvidence(f.item, f.rows, now).publicationComplete,
    ).toBe(false);
  },
);
test.each(['media', 'timestamp', 'permalink', 'package', 'reconciliation'])(
  'invalid %s prevents receipt confirmation',
  (kind) => {
    const f = fixture();
    if (kind === 'media') f.op.remoteReceipt.mediaId = '99999';
    if (kind === 'timestamp') f.op.remoteReceipt.publishedAt = 'invalid';
    if (kind === 'permalink')
      f.op.remoteReceipt.permalink =
        'https://private.invalid/?token=PRIVATE_SECRET';
    if (kind === 'package') f.op.packageHash = 'b'.repeat(64);
    if (kind === 'reconciliation')
      Object.assign(f.op, { requiresReconciliation: true });
    const r = projectPublicationEvidence(f.item, f.rows, now);
    expect(r.publicationComplete).toBe(false);
    expect(r.destinations[0].receipt).toBeNull();
  },
);
test('two required destinations need two receipts; absent approval and unprepared targets stay explicit', () => {
  const a = fixture('PUBLISHED', 'INSTAGRAM'),
    b = fixture('PREPARED');
  a.item.packages.push(...b.item.packages);
  a.item.operations.push(...b.item.operations);
  const rows = [...a.rows, ...b.rows];
  const r = projectPublicationEvidence(a.item, rows, now);
  expect(r.destinations).toHaveLength(2);
  expect(r.publicationComplete).toBe(false);
  b.item.packages[0].review.mediaDecision.decision = 'REJECTED';
  expect(
    projectPublicationEvidence(b.item, b.rows, now).destinations[0].approval
      .pending,
  ).toBe(true);
  b.item.operations = [];
  expect(
    projectPublicationEvidence(b.item, [], now).destinations[0]
      .publicationStatus,
  ).toBe('NOT_PREPARED');
});
test('supersession retains sanitized original snapshot without selecting its receipt as active', () => {
  const f = fixture();
  f.row.originalOperationId = 'op_original';
  const original = {
    ...f.rows[0],
    operationId: 'op_original',
    operation: {
      ...f.op,
      operationId: 'op_original',
      state: 'PROCESSING',
      remoteReceipt: null,
    },
  };
  const r = projectPublicationEvidence(f.item, [original, ...f.rows], now)
    .destinations[0];
  expect(r.originalOperation?.operationId).toBe('op_original');
  expect(r.activeOperation?.operationId).toBe('op_active');
  expect(r.originalOperation?.state).toBe('PROCESSING');
  expect(r.receipt).not.toBeNull();
});
test('inconsistent snapshots require another GET instead of publishing or inventing evidence', () => {
  const f = fixture();
  expect(() =>
    projectPublicationEvidence(
      f.item,
      [{ ...f.rows[0], operation: { ...f.op, version: 9 } }],
      now,
    ),
  ).toThrow('SOCIAL_EVIDENCE_CHANGED');
});

test('persisted LIVE mode is reported without inferring it from current configuration', () => {
  const f = fixture();
  Object.assign(f.op, { executionMode: 'live' });
  const d = projectPublicationEvidence(f.item, f.rows, now).destinations[0];
  expect(d.executionMode).toBe('live');
  expect(d.simulated).toBe(false);
  expect(d.receipt?.executionMode).toBe('live');
});
test('unprepared Facebook reports required authority; approval binding cannot be inferred', () => {
  const f = fixture();
  f.item.operations = [];
  expect(
    projectPublicationEvidence(f.item, [], now).destinations[0].authorization
      .status,
  ).toBe('REQUIRED');
  f.item.packages[0].review.packageHash = 'b'.repeat(64);
  const result = projectPublicationEvidence(f.item, [], now);
  expect(result.destinations[0].pendingCode).toBe(
    'DISTRIBUTION_APPROVAL_BINDING_MISMATCH',
  );
  expect(result.publicationComplete).toBe(false);
});
test('receipt URL capabilities and extra remote fields are never exposed', () => {
  const f = fixture();
  f.op.remoteReceipt.permalink += '?access_token=PRIVATE_SECRET#PRIVATE_SECRET';
  const result = projectPublicationEvidence(f.item, f.rows, now);
  expect(result.publicationComplete).toBe(true);
  expect(result.destinations[0].receipt?.permalink).toBe(
    'https://www.facebook.com/reel/12345/',
  );
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});
test('evidence service finds older occurrences through the existing paginated read surface', () => {
  const f = fixture();
  const readOperationalQueue = vi.fn((_limit: number, offset: number) =>
    offset === 0
      ? {
          total: 101,
          items: Array.from({ length: 100 }, (_, n) => ({
            ...f.item,
            execution: { ...f.item.execution, execution_id: `other_${n}` },
          })),
        }
      : { total: 101, items: [f.item] },
  );
  const readDestinations = vi.fn(() => f.rows);
  const service = new DestinationPublicationService(
    { readOperationalQueue, readDestinations } as any,
    {} as any,
    null,
    {} as any,
    undefined,
    () => now,
  );
  expect(service.evidence('execution_001').publicationComplete).toBe(true);
  expect(readOperationalQueue.mock.calls).toEqual([
    [100, 0],
    [100, 100],
  ]);
  expect(readDestinations).toHaveBeenCalledExactlyOnceWith('execution_001');
});
