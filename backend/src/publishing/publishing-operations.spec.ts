import { PublishingOperationsService } from './application/publishing-operations.service.js';
import type { PublishingOperationsSession } from './application/publishing-operations.port.js';

function fixture(history: any[], review: any = null, revoked = false) {
  const close = vi.fn();
  const session: PublishingOperationsSession = {
    checkpoint: () => ({ social: 10, manual: 3 }),
    packages: () => [
      {
        cursor: 1,
        value: {
          platform: 'instagram',
          account: 'creator',
          contentHash: 'package_hash',
          identity: { videoRenderId: 'render', videoRenderRevision: 2 },
        },
        review,
        revoked,
      },
    ],
    publications: () => [],
    operations: () => [
      {
        value: history.at(-1),
        mode: 'fake',
        history: history.map((value, index) => ({ cursor: index + 1, value })),
      },
    ],
    close,
  };
  return {
    session,
    close,
    service: new PublishingOperationsService({ open: () => session }),
  };
}
const op = (version: number, state: string, extra = {}) => ({
  operationId: 'operation',
  accountId: '12345',
  mediaId: 'media',
  version,
  state,
  ...extra,
});

test('Publishing requires a matching receipt and resolved reconciliation to expose confirmed publication', () => {
  for (const extra of [
    {},
    { remoteReceipt: { mediaId: 'other' } },
    { remoteReceipt: { mediaId: 'media' }, requiresReconciliation: true },
  ]) {
    const { service } = fixture([op(1, 'PUBLISHED', extra)]);
    expect(service.packages('run')[0].publications[0].confirmed).toBe(false);
  }
  const receipt = {
    remoteReceipt: {
      mediaId: 'media',
      permalink: 'https://www.instagram.com/reel/fixture/',
    },
  };
  const { service, close } = fixture([
    op(1, 'PUBLISHING'),
    op(2, 'PUBLISHED', receipt),
    op(3, 'PUBLISHED', receipt),
  ]);
  expect(service.packages('run')[0].publications[0]).toMatchObject({
    confirmed: true,
    requiresReconciliation: false,
    destination: { network: 'instagram', account: 'creator' },
    transition: { stream: 'social', cursor: 2, version: 2 },
    receipt: {
      publicationId: 'media',
      accountId: '12345',
      permalink: receipt.remoteReceipt.permalink,
    },
  });
  expect(close).toHaveBeenCalledOnce();
});

test('Publishing exposes the start of each uncertain episode and the original failure transition', () => {
  const first = fixture([
    op(1, 'READY'),
    op(2, 'UNCERTAIN'),
    op(3, 'UNCERTAIN'),
  ]);
  expect(first.service.packages('run')[0].publications[0]).toMatchObject({
    confirmed: false,
    requiresReconciliation: true,
    transition: { cursor: 2, version: 2 },
  });
  const next = fixture([
    op(1, 'UNCERTAIN'),
    op(2, 'READY'),
    op(3, 'PUBLISHED', { requiresReconciliation: true }),
    op(4, 'PUBLISHED', { requiresReconciliation: true }),
  ]);
  expect(next.service.packages('run')[0].publications[0]).toMatchObject({
    requiresReconciliation: true,
    transition: { cursor: 3, version: 3 },
  });
  const failed = fixture([
    op(1, 'UNCERTAIN'),
    op(2, 'FAILED', { errorCode: 'SOCIAL_AUTH_REQUIRED' }),
  ]);
  expect(failed.service.packages('run')[0].publications[0]).toMatchObject({
    failed: true,
    errorCode: 'SOCIAL_AUTH_REQUIRED',
    transition: { cursor: 2, version: 2 },
  });
});

test.each([
  ['APPROVED', false, true],
  ['APPROVED', true, false],
  ['REJECTED', false, false],
] as const)(
  'Publishing exposes package revision and current approval for %s revoked=%s',
  (decision, revoked, currentApproval) => {
    const { service, session } = fixture(
      [],
      { contentHash: 'review_hash', mediaDecision: { decision } },
      revoked,
    );
    session.operations = () => [];
    const p = service.packages('run')[0];
    expect(p.identity.videoRenderRevision).toBe(2);
    expect(p.review).toEqual({
      hash: 'review_hash',
      decision,
      revoked,
      currentApproval,
    });
  },
);

test('Publishing keeps manual receipt identity and cursor without assuming Instagram', () => {
  const { service, session } = fixture([]);
  session.operations = () => [];
  session.packages = () => [
    {
      cursor: 1,
      value: {
        platform: 'fixture-video',
        account: 'creator',
        contentHash: 'package_hash',
        identity: { videoRenderRevision: 1 },
      },
      review: null,
      revoked: false,
    },
  ];
  session.publications = () => [
    {
      cursor: 7,
      value: {
        state: 'PUBLISHED',
        publicationId: 'manual_1',
        externalId: 'external_1',
        externalUrl: 'https://video.example/clip/1',
      },
    },
  ];
  expect(service.packages('run')[0].publications[0]).toMatchObject({
    confirmed: true,
    destination: { network: 'fixture-video', label: 'fixture-video creator' },
    receipt: {
      publicationId: 'external_1',
      accountId: 'creator',
      permalink: 'https://video.example/clip/1',
    },
    transition: { stream: 'manual', cursor: 7 },
  });
});
