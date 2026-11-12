import { createHash } from 'node:crypto';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  ManualImageQcService,
  type ManualImageQcReaders,
} from './application/manual-image-qc.service.js';
import { IMAGE_TECHNICAL_QC_POLICY } from './domain/manual-image-qc-contracts.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

// Test-only trusted source and decoder. Physical decoder acceptance is exercised
// separately by manual-image-qc.physical.spec.ts; this fixture never reaches runtime.
function qcFixture() {
  let bytes: Buffer = png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const provenance = {
    schemaVersion: 'manual-image-provenance/1.0.0',
    sourceId: 'fixture_owned_images',
    imageArtifactId: 'image_fixture',
    imageContentHash: hash,
    productId: 'product_fixture',
    productRevision: 1,
    mediaReference: 'media:fixture_image',
    format: 'png',
    widthPixels: 90,
    heightPixels: 160,
    contentHash: '',
  };
  provenance.contentHash = affiliateHash(provenance);
  const artifact = {
    imageArtifactId: provenance.imageArtifactId,
    imageContentHash: hash,
    productId: provenance.productId,
    productRevision: 1,
    mediaReference: provenance.mediaReference,
    format: 'png',
    widthPixels: 90,
    heightPixels: 160,
    provenanceReference: 'image-provenance:sha256:' + provenance.contentHash,
  };
  const request = {
    imageArtifactId: artifact.imageArtifactId,
    imageContentHash: hash,
    productId: artifact.productId,
    productRevision: 1,
  };
  const decoded = {
    format: 'png' as const,
    widthPixels: 90,
    heightPixels: 160,
    fullyDecoded: true,
    frameCount: 1,
    rgba: new Uint8Array(90 * 160 * 4),
  };
  const readers: ManualImageQcReaders = {
    getArtifact: vi.fn(() => artifact),
    getProvenance: vi.fn(() => provenance),
    readBytes: vi.fn(() => bytes),
  };
  const decoder = {
    id: 'fixture_rgba_decoder',
    version: 'test-only/1',
    decode: vi.fn(() => decoded),
  };
  const service = new ManualImageQcService(readers, {
    trustedSourceIds: ['fixture_owned_images'],
    decoder,
  });
  const updateBytes = (replacement: Buffer) => {
    bytes = replacement;
    const newHash = createHash('sha256').update(bytes).digest('hex');
    request.imageContentHash =
      artifact.imageContentHash =
      provenance.imageContentHash =
        newHash;
    provenance.contentHash = affiliateHash(provenance);
    artifact.provenanceReference =
      'image-provenance:sha256:' + provenance.contentHash;
  };
  return {
    service,
    readers,
    decoder,
    artifact,
    provenance,
    request,
    decoded,
    updateBytes,
    bytes,
  };
}

test('trusted PNG returns technical QC only; replay and caller mutation preserve identity', async () => {
  const f = qcFixture();
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NETWORK_FORBIDDEN'));
  try {
    const result = await f.service.inspect(f.request);
    expect(result.status).toBe('PASS');
    expect(result.bundle!.report.result).toBe('PASS');
    expect(result.humanApproval).toBe('HUMAN_APPROVAL_REQUIRED');
    expect(result.commercialApproval).toBe('NOT_ASSESSED');
    expect(result.publicationAuthorized).toBe(false);
    expect(await f.service.inspect(f.request)).toEqual(result);
    f.artifact.widthPixels = 1;
    expect(result.bundle!.report.widthPixels).toBe(90);
    expect(Object.isFrozen(result.bundle!.report)).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(Object.keys(f.readers).sort()).toEqual([
      'getArtifact',
      'getProvenance',
      'readBytes',
    ]);
  } finally {
    network.mockRestore();
  }
});

test.each([
  ['missing', 'QC_REQUIRED'],
  ['unknownSource', 'QC_REQUIRED'],
  ['provenance', 'QC_REQUIRED'],
  ['product', 'IMAGE_IDENTITY_MISMATCH'],
  ['revision', 'IMAGE_IDENTITY_MISMATCH'],
  ['hash', 'IMAGE_HASH_MISMATCH'],
  ['oversize', 'IMAGE_SIZE_EXCEEDED'],
  ['truncated', 'IMAGE_PHYSICAL_INVALID'],
  ['malformed', 'IMAGE_PHYSICAL_INVALID'],
  ['dimensions', 'IMAGE_PHYSICAL_INVALID'],
  ['partial', 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED'],
  ['noPixels', 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED'],
  ['unavailable', 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED'],
  ['format', 'IMAGE_FORMAT_UNSUPPORTED'],
])('blocks %s with %s and no report', async (kind, code) => {
  const f = qcFixture();
  if (kind === 'missing')
    vi.mocked(f.readers.getArtifact).mockReturnValue(null);
  if (kind === 'unknownSource') {
    f.provenance.sourceId = 'unknown_source';
    f.provenance.contentHash = affiliateHash(f.provenance);
    f.artifact.provenanceReference =
      'image-provenance:sha256:' + f.provenance.contentHash;
  }
  if (kind === 'provenance')
    f.artifact.provenanceReference = 'fixture:unverifiable';
  if (kind === 'product') f.request.productId = 'other_product';
  if (kind === 'revision') f.request.productRevision++;
  if (kind === 'hash')
    vi.mocked(f.readers.readBytes).mockReturnValue(Buffer.from('changed'));
  if (kind === 'oversize')
    vi.mocked(f.readers.readBytes).mockReturnValue(
      Buffer.alloc(IMAGE_TECHNICAL_QC_POLICY.maxBytes + 1),
    );
  if (kind === 'truncated')
    f.updateBytes(f.bytes.subarray(0, f.bytes.length - 8));
  if (kind === 'malformed') f.updateBytes(Buffer.alloc(80));
  if (kind === 'dimensions') f.decoded.widthPixels++;
  if (kind === 'partial') f.decoded.fullyDecoded = false;
  if (kind === 'noPixels') f.decoded.rgba = new Uint8Array(4);
  if (kind === 'unavailable')
    f.decoder.decode.mockImplementation(() => {
      throw Error('PRIVATE_PATH');
    });
  if (kind === 'format') f.artifact.format = 'webp';
  const result = await f.service.inspect(f.request);
  expect(result.blockers).toContain(code);
  expect(result.bundle).toBeNull();
  expect(result.publicationAuthorized).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PATH');
});

test('no configured source or decoder fails closed, including signature-only JPEG', async () => {
  const f = qcFixture();
  expect(
    (
      await new ManualImageQcService(f.readers, {
        trustedSourceIds: [],
      }).inspect(f.request)
    ).status,
  ).toBe('QC_REQUIRED');
  f.updateBytes(Buffer.from([255, 216, 255, 217]));
  f.artifact.format = f.provenance.format = 'jpeg';
  f.provenance.contentHash = affiliateHash(f.provenance);
  f.artifact.provenanceReference =
    'image-provenance:sha256:' + f.provenance.contentHash;
  const result = await new ManualImageQcService(f.readers, {
    trustedSourceIds: ['fixture_owned_images'],
  }).inspect(f.request);
  expect(result.status).toBe('BLOCKED_PHYSICAL_INSPECTION_REQUIRED');
  expect(result.bundle).toBeNull();
});

test('host trust cannot be expanded by request metadata or later configuration mutation', async () => {
  const f = qcFixture();
  const sources: string[] = [];
  const service = new ManualImageQcService(f.readers, {
    trustedSourceIds: sources,
    decoder: f.decoder,
  });
  sources.push('fixture_owned_images');
  expect((await service.inspect(f.request)).status).toBe('QC_REQUIRED');
  const injected = await f.service.inspect({
    ...f.request,
    trustedSourceIds: sources,
    widthPixels: 90,
  });
  expect(injected.status).toBe('QC_REQUIRED');
  expect(injected.bundle).toBeNull();
});

test('invalid decoder configuration is unavailable, and unknown sources are rejected before reading bytes', async () => {
  const f = qcFixture();
  const result = await new ManualImageQcService(f.readers, {
    trustedSourceIds: ['fixture_owned_images'],
    decoder: {
      id: 'invalid',
      version: 'test/1',
    } as unknown as import('./application/manual-image-qc.service.js').ImageQcDecoder,
  }).inspect(f.request);
  expect(result.status).toBe('BLOCKED_PHYSICAL_INSPECTION_REQUIRED');
  vi.mocked(f.readers.readBytes).mockClear();
  await new ManualImageQcService(f.readers, {
    trustedSourceIds: [],
    decoder: f.decoder,
  }).inspect(f.request);
  expect(f.readers.readBytes).not.toHaveBeenCalled();
});
