import { projectOperationalQueue } from './application/operational-queue.js';

const now = '2026-11-10T13:00:00.000Z';
const facebookPackage = {
  contentHash: 'a'.repeat(64),
  platform: 'facebook',
  account: '1355505384315575',
  identity: { projectId: 'project_001', videoRenderRevision: 2 },
};
const instagramPackage = {
  contentHash: 'b'.repeat(64),
  platform: 'instagram',
  account: '123456789',
  identity: { projectId: 'project_001', videoRenderRevision: 2 },
};
const approved = { mediaDecision: { decision: 'APPROVED' } };

function snapshot(
  operation?: Record<string, unknown>,
  options: {
    review?: unknown;
    instagram?: Record<string, unknown>;
    instagramOnly?: boolean;
  } = {},
) {
  const packages = [
    {
      value: facebookPackage,
      review: options.review === undefined ? approved : options.review,
      revoked: false,
    },
    ...(options.instagram
      ? [{ value: instagramPackage, review: approved, revoked: false }]
      : []),
  ];
  const operations = [
    ...(operation
      ? [
          {
            network: 'FACEBOOK_REELS',
            accountId: facebookPackage.account,
            originalOperationId: 'fb_001',
            operation: {
              operationId: 'fb_001',
              packageHash: facebookPackage.contentHash,
              version: 3,
              updatedAt: now,
              errorCode: null,
              requiresReconciliation: false,
              ...operation,
            },
          },
        ]
      : []),
    ...(options.instagram
      ? [
          {
            network: 'INSTAGRAM',
            accountId: instagramPackage.account,
            originalOperationId: 'ig_001',
            operation: {
              operationId: 'ig_001',
              packageHash: instagramPackage.contentHash,
              version: 2,
              updatedAt: now,
              requiresReconciliation: false,
              ...options.instagram,
            },
          },
        ]
      : []),
  ];
  return {
    total: 1,
    items: [
      {
        execution: {
          execution_id: 'execution_001',
          campaign_id: 'campaign_001',
          campaign_revision: 1,
          project_id: 'project_001',
          production_date: '2026-11-10',
          run_id: 'run_001',
          status: 'SUCCEEDED',
        },
        request: {
          publication: [
            ...(!options.instagramOnly
              ? [
                  {
                    network: 'FACEBOOK_REELS',
                    accountId: facebookPackage.account,
                    packageHash: facebookPackage.contentHash,
                  },
                ]
              : []),
            ...(options.instagram
              ? [
                  {
                    network: 'INSTAGRAM',
                    accountId: instagramPackage.account,
                    packageHash: instagramPackage.contentHash,
                  },
                ]
              : []),
          ],
        },
        latestCampaignEvent: {
          type: 'PAUSED',
          at: now,
          evidence: {
            code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
            step: 'PUBLICATION',
          },
        },
        blockingEvent: null as any,
        packages,
        operations,
      },
    ],
  };
}

function destination(operation?: Record<string, unknown>, options = {}) {
  return projectOperationalQueue(
    snapshot(operation, options),
    25,
    0,
    now,
  ).items[0].destinations.find((row) => row.network === 'FACEBOOK_REELS')!;
}

test.each([
  [
    'PREPARED',
    {},
    'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
    'AUTHORIZE_FACEBOOK',
  ],
  ['PROCESSING', {}, 'SOCIAL_PROCESSING_REQUIRED', 'CHECK_PROCESSING'],
  [
    'UNCERTAIN',
    { uncertainStage: 'PUBLISH' },
    'SOCIAL_RECONCILIATION_REQUIRED',
    'AUTHORIZE_RECOVERY_AND_RECONCILE',
  ],
  [
    'READY',
    { requiresReconciliation: true },
    'SOCIAL_RECONCILIATION_REQUIRED',
    'AUTHORIZE_RECOVERY_AND_RECONCILE',
  ],
  [
    'PUBLISHED',
    { mediaId: 'video_001' },
    'SOCIAL_RECONCILIATION_REQUIRED',
    'VERIFY_RECEIPT',
  ],
  [
    'FAILED',
    { errorCode: 'SOCIAL_REMOTE_REJECTED' },
    'SOCIAL_REMOTE_REJECTED',
    'REVIEW_FAILURE',
  ],
] as const)(
  'queue classifies %s without changing operation state',
  (state, extra, code, nextAction) => {
    const row = destination({ state, ...extra });
    expect(row.state).toBe(state);
    expect(row.pendingCode).toBe(code);
    expect(row.nextAction).toBe(nextAction);
    expect(row.receipt).toBeNull();
  },
);

test('queue distinguishes missing approval and expired grants', () => {
  expect(destination({ state: 'PREPARED' }, { review: null }).pendingCode).toBe(
    'DISTRIBUTION_APPROVAL_REQUIRED',
  );
  const expired = destination({
    state: 'PROCESSING',
    executionAuthorization: { expiresAt: '2026-11-10T12:59:00.000Z' },
  });
  expect(expired.authorizationExpired).toBe(true);
  expect(expired.nextAction).toBe('REQUEST_NEW_AUTHORIZATION');
  expect(
    destination({
      state: 'UNCERTAIN',
      supersession: { revision: 1 },
    }).nextAction,
  ).toBe('REVIEW_SUPERSESSION_RECOVERY');
});

test('queue retains the campaign human approval blocker before a package exists', () => {
  const source = snapshot();
  source.items[0].packages = [];
  source.items[0].execution.status = 'WAITING_INPUT';
  source.items[0].blockingEvent = {
    evidence: { code: 'EXACT_HUMAN_APPROVAL_REQUIRED' },
  };
  const item = projectOperationalQueue(source, 25, 0, now).items[0];
  expect(item.blockingCode).toBe('EXACT_HUMAN_APPROVAL_REQUIRED');
  expect(item.destinations[0].pendingCode).toBe(
    'EXACT_HUMAN_APPROVAL_REQUIRED',
  );
  expect(item.destinations[0].nextAction).toBe('REVIEW_HUMAN_APPROVAL');
});

test('confirmed receipts remain complete after grant expiry and never mix destinations', () => {
  const instagram = {
    state: 'PUBLISHED',
    mediaId: 'ig_media',
    remoteReceipt: { mediaId: 'ig_media' },
  };
  const incomplete = projectOperationalQueue(
    snapshot({ state: 'UNCERTAIN', uncertainStage: 'PUBLISH' }, { instagram }),
    25,
    0,
    now,
  ).items[0];
  expect(incomplete.campaignStatus).toBe('SUCCEEDED');
  expect(incomplete.publicationComplete).toBe(false);
  expect(
    incomplete.destinations.find((row) => row.network === 'INSTAGRAM')?.receipt
      ?.mediaId,
  ).toBe('ig_media');
  expect(
    incomplete.destinations.find((row) => row.network === 'FACEBOOK_REELS')
      ?.receipt,
  ).toBeNull();

  const complete = projectOperationalQueue(
    snapshot(
      {
        state: 'PUBLISHED',
        mediaId: 'fb_media',
        remoteReceipt: { mediaId: 'fb_media' },
        executionAuthorization: { expiresAt: '2026-11-10T12:00:00.000Z' },
      },
      { instagram },
    ),
    25,
    0,
    now,
  ).items[0];
  expect(complete.publicationComplete).toBe(true);
  expect(
    complete.destinations.find((row) => row.network === 'FACEBOOK_REELS')
      ?.pendingCode,
  ).toBeNull();
  expect(
    complete.destinations.find((row) => row.network === 'FACEBOOK_REELS')
      ?.receipt?.mediaId,
  ).toBe('fb_media');
  expect(
    complete.destinations.find((row) => row.network === 'INSTAGRAM')?.receipt
      ?.mediaId,
  ).toBe('ig_media');

  const instagramOnly = projectOperationalQueue(
    snapshot(undefined, { instagram, instagramOnly: true }),
    25,
    0,
    now,
  ).items[0];
  expect(instagramOnly.publicationComplete).toBe(true);
  expect(instagramOnly.destinations.map((row) => row.network)).toEqual([
    'INSTAGRAM',
  ]);
});

test('queue replay is deterministic and does not mutate its source', () => {
  const source = snapshot({ state: 'UNCERTAIN', requiresReconciliation: true });
  const before = structuredClone(source);
  expect(projectOperationalQueue(source, 10, 0, now)).toEqual(
    projectOperationalQueue(source, 10, 0, now),
  );
  expect(source).toEqual(before);
});
