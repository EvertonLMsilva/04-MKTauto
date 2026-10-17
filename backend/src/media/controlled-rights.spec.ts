import { assertMediaProcessingRights } from './domain/media-processing-rights.js';
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
