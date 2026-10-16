import { validateAffiliateEvidence } from '../affiliate/domain/affiliate-contracts.js';
import { assertMediaProcessingRights } from './domain/media-processing-rights.js';
import { validateMediaProviderOutput } from './domain/media-acquisition-contracts.js';
import { validateMediaAsset } from './domain/media-asset-contracts.js';

const identity = {
  mediaRef: 'authorized-image-001',
  contentHash: 'c'.repeat(64),
};
const evidence = () => ({
  id: 'ev_rights',
  kind: 'MEDIA_USAGE_RIGHT',
  sourceRef: 'fixture:authorization',
  recordedAt: '2026-10-16T12:00:00Z',
  mediaAuthorization: {
    ...identity,
    commercialUse: 'GRANTED',
    processing: 'GRANTED',
    localProcessing: true,
    externalProviders: ['fal_ai'],
  },
});

describe('explicit media processing rights', () => {
  const output = () => ({
    assetType: 'IMAGE',
    technicalProperties: {
      format: 'png',
      widthPixels: 100,
      heightPixels: 100,
      durationMilliseconds: null,
    },
    contentHash: identity.contentHash,
    mediaReference: 'media:authorized_image',
    origin: 'AUTHORIZED_THIRD_PARTY',
    provider: null,
    rights: { usageBasis: 'EXPLICIT_PERMISSION', commercialUseAllowed: true },
  });
  const asset = () => ({
    ...output(),
    schemaVersion: 'media-asset/1.0.0',
    mediaAssetId: 'asset_001',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    visualDirectionPosition: 1,
    createdAt: '2026-10-16T12:00:00Z',
    revision: 1,
    supersedesMediaAssetId: null,
  });
  it.each([validateMediaProviderOutput, validateMediaAsset])(
    'preserves old Media payloads and validates optional evidence binding',
    (validate) => {
      const legacy = validate === validateMediaAsset ? asset() : output();
      expect(validate(legacy)).toEqual(legacy);
      expect(() =>
        assertMediaProcessingRights(
          [],
          { mediaRef: legacy.mediaReference, contentHash: legacy.contentHash },
          'fal_ai',
        ),
      ).toThrow();
      const e = evidence();
      e.mediaAuthorization.mediaRef = legacy.mediaReference;
      const extended = {
        ...legacy,
        rights: { ...legacy.rights, evidence: [e] },
      };
      expect(validate(extended)).toEqual(extended);
      e.mediaAuthorization.contentHash = 'd'.repeat(64);
      expect(() => validate(extended)).toThrow(
        'MEDIA_RIGHTS_IDENTITY_MISMATCH',
      );
    },
  );
  it('accepts independent grants bound to exact media and provider', () => {
    expect(() =>
      assertMediaProcessingRights([evidence()], identity, 'fal_ai'),
    ).not.toThrow();
    expect(validateAffiliateEvidence(evidence())).toEqual(evidence());
  });
  it.each(['commercialUse', 'processing'] as const)(
    'blocks missing, denied or unknown %s independently',
    (permission) => {
      for (const status of [undefined, 'DENIED', 'UNCONFIRMED']) {
        const item = evidence();
        if (status === undefined)
          delete (item.mediaAuthorization as any)[permission];
        else item.mediaAuthorization[permission] = status;
        expect(() =>
          assertMediaProcessingRights([item], identity, 'fal_ai'),
        ).toThrow();
      }
    },
  );
  it('does not infer third-party permission from local processing', () => {
    const item = evidence();
    item.mediaAuthorization.externalProviders = [];
    expect(() =>
      assertMediaProcessingRights([item], identity, 'fal_ai'),
    ).toThrow('MEDIA_PROCESSING_RIGHTS_UNCONFIRMED');
    expect(() =>
      assertMediaProcessingRights([evidence()], identity, 'other_provider'),
    ).toThrow();
  });
  it.each(['mediaRef', 'contentHash'] as const)(
    'blocks divergent %s',
    (field) => {
      const item = evidence();
      item.mediaAuthorization[field] =
        field === 'contentHash' ? 'd'.repeat(64) : 'other-image';
      expect(() =>
        assertMediaProcessingRights([item], identity, 'fal_ai'),
      ).toThrow();
    },
  );
  it('preserves legacy evidence without granting either permission', () => {
    const { mediaAuthorization: _authorization, ...legacy } = evidence();
    expect(validateAffiliateEvidence(legacy)).toEqual(legacy);
    expect(() =>
      assertMediaProcessingRights([legacy], identity, 'fal_ai'),
    ).toThrow();
    expect(() => assertMediaProcessingRights([], identity, 'fal_ai')).toThrow();
  });
  it('rejects malformed or unrelated authorization evidence', () => {
    for (const item of [
      { ...evidence(), kind: 'PRODUCT_SPECIFICATION' },
      { ...evidence(), sourceRef: '' },
      { ...evidence(), recordedAt: 'invalid' },
      {
        ...evidence(),
        mediaAuthorization: {
          ...evidence().mediaAuthorization,
          contentHash: 'invalid',
        },
      },
    ])
      expect(() =>
        assertMediaProcessingRights([item], identity, 'fal_ai'),
      ).toThrow();
  });
  it('requires a scalar physical hash rather than a coercible value', () => {
    const item = evidence();
    (item.mediaAuthorization as any).contentHash = [identity.contentHash];
    expect(() => validateAffiliateEvidence(item)).toThrow();
  });
  it('does not let another grant override an explicit denial', () => {
    const denied = evidence();
    denied.id = 'ev_denied';
    denied.mediaAuthorization.processing = 'DENIED';
    expect(() =>
      assertMediaProcessingRights([evidence(), denied], identity, 'fal_ai'),
    ).toThrow();
  });
});
