import { assertMediaProcessingRights } from './domain/media-processing-rights.js';
import { validateAffiliateEvidence } from '../affiliate/domain/affiliate-contracts.js';
const identity = { mediaRef: 'operator-image', contentHash: 'a'.repeat(64) };
const evidence = (commercialUse = 'GRANTED', scope = 'p77_first_live_i2v') => [
  {
    id: 'operator_grant',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'operator-declaration',
    recordedAt: '2026-10-17T00:00:00Z',
    mediaAuthorization: {
      ...identity,
      commercialUse,
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: ['fal_ai'],
      operationScope: scope,
    },
  },
];
it('keeps campaign grants bound to campaign, operation, purpose, exact image and each permission', () => {
  const grant = evidence();
  Object.assign(grant[0].mediaAuthorization, {
    campaignId: 'p77_campaign',
    purpose: 'HUMAN_QC_REVIEW',
  });
  expect(() => validateAffiliateEvidence(grant[0])).not.toThrow();
  const context = { campaignId: 'p77_campaign', purpose: 'HUMAN_QC_REVIEW' };
  expect(() =>
    assertMediaProcessingRights(
      grant,
      identity,
      'fal_ai',
      'p77_first_live_i2v',
      context,
    ),
  ).not.toThrow();
  expect(() =>
    assertMediaProcessingRights(
      grant,
      identity,
      null,
      'p77_first_live_i2v',
      context,
    ),
  ).not.toThrow();
  for (const change of [{ campaignId: 'other' }, { purpose: 'PUBLISHING' }])
    expect(() =>
      assertMediaProcessingRights(
        grant,
        identity,
        'fal_ai',
        'p77_first_live_i2v',
        { ...context, ...change },
      ),
    ).toThrow();
  expect(() =>
    assertMediaProcessingRights(
      grant,
      identity,
      'fal_ai',
      'p77_first_live_i2v',
    ),
  ).toThrow();
  for (const other of [
    { ...identity, contentHash: 'd'.repeat(64) },
    { ...identity, mediaRef: 'other_reference' },
  ])
    expect(() =>
      assertMediaProcessingRights(
        grant,
        other,
        'fal_ai',
        'p77_first_live_i2v',
        context,
      ),
    ).toThrow();
  for (const change of [
    { processing: 'DENIED' },
    { commercialUse: 'DENIED' },
    { localProcessing: false },
    { operationScope: 'other' },
  ]) {
    const denied = structuredClone(grant);
    Object.assign(denied[0].mediaAuthorization, change);
    expect(() =>
      assertMediaProcessingRights(
        denied,
        identity,
        null,
        'p77_first_live_i2v',
        context,
      ),
    ).toThrow();
  }
  const local = structuredClone(grant);
  local[0].mediaAuthorization.externalProviders = [];
  expect(() =>
    assertMediaProcessingRights(
      local,
      identity,
      null,
      'p77_first_live_i2v',
      context,
    ),
  ).not.toThrow();
  expect(() =>
    assertMediaProcessingRights(
      local,
      identity,
      'fal_ai',
      'p77_first_live_i2v',
      context,
    ),
  ).toThrow();
  const malformed = structuredClone(grant);
  delete (malformed[0].mediaAuthorization as any).operationScope;
  expect(() => validateAffiliateEvidence(malformed[0])).toThrow();
});
it('permits the operator grant only for the exact test, provider and image', () => {
  expect(() =>
    assertMediaProcessingRights(
      evidence(),
      identity,
      'fal_ai',
      'p77_first_live_i2v',
    ),
  ).not.toThrow();
  for (const scope of [undefined, 'other_operation'])
    expect(() =>
      assertMediaProcessingRights(evidence(), identity, 'fal_ai', scope),
    ).toThrow();
  expect(() =>
    assertMediaProcessingRights(
      evidence('UNCONFIRMED'),
      identity,
      'fal_ai',
      'p77_first_live_i2v',
    ),
  ).toThrow();
  expect(() =>
    assertMediaProcessingRights(
      evidence(),
      { ...identity, contentHash: 'b'.repeat(64) },
      'fal_ai',
      'p77_first_live_i2v',
    ),
  ).toThrow();
  expect(() =>
    assertMediaProcessingRights(
      evidence(),
      identity,
      'other',
      'p77_first_live_i2v',
    ),
  ).toThrow();
});
