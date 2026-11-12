import { createHash } from 'node:crypto';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { ManualImagePackageService } from './application/manual-image-package.service.js';
import { manualImagePackageHash } from './domain/manual-image-package-contracts.js';
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

function imageFixture() {
  const bytes: Buffer = png();
  const hash = createHash('sha256').update(bytes).digest('hex'),
    reference = `media:sha256_${hash}`;
  const rights = {
    id: 'image_right_001',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'fixture:owned-image',
    recordedAt: '2026-11-12T12:00:00Z',
    mediaAuthorization: {
      mediaRef: reference,
      contentHash: hash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: [] as string[],
    },
  };
  const product = fixtures.product({
    media: [{ mediaRef: reference, evidenceRef: rights.id }],
    evidence: [...fixtures.product().evidence, rights],
  });
  const campaign = fixtures.campaign({
    affiliateUrl:
      'https://example.com/item?sub_id1=camp%2B001&sub_id2=image_001',
  });
  const image = {
    imageArtifactId: 'image_001',
    imageContentHash: hash,
    mediaReference: reference,
    productId: product.productId,
    productRevision: product.revision,
    projectId: campaign.projectId,
    projectVersion: 1,
    format: 'png',
    widthPixels: 90,
    heightPixels: 160,
    rightsEvidence: [rights],
  };
  const input = {
    campaignId: campaign.campaignId,
    campaignRevision: campaign.revision,
    campaignHash: affiliateHash(campaign),
    productId: product.productId,
    productRevision: product.revision,
    productHash: affiliateHash(product),
    projectId: campaign.projectId,
    projectVersion: 1,
    pipelineRunId: null,
    imageArtifactId: image.imageArtifactId,
    imageContentHash: hash,
    mediaReference: reference,
    format: 'png',
    widthPixels: 90,
    heightPixels: 160,
    destination: 'instagram',
    account: '123456789',
    caption: 'Imagem autorizada.\nVeja os detalhes.',
    externalProvider: null,
  };
  let qc: any = null,
    approval: any = null;
  const readers = {
    getCampaign: vi.fn(() => campaign),
    getProduct: vi.fn(() => product),
    getProject: vi.fn(() => ({ id: campaign.projectId, version: 1 })),
    getRun: vi.fn(() => null),
    getImage: vi.fn(() => image),
    readImageBytes: vi.fn(() => bytes),
    inspectImage: vi.fn(() => ({
      format: 'png',
      widthPixels: 90,
      heightPixels: 160,
      fullyDecoded: true,
    })),
    getDestination: vi.fn(() => ({
      destination: 'instagram',
      account: '123456789',
      projectId: campaign.projectId,
      enabled: true,
    })),
    getImageQc: vi.fn(() => qc),
    getImageApproval: vi.fn(() => approval),
  };
  const service = new ManualImagePackageService(readers as any);
  const supplyQc = () => {
    const report = {
      schemaVersion: 'manual-image-qc/1.0.0',
      reportId: 'image_qc_001',
      imageArtifactId: image.imageArtifactId,
      imageContentHash: hash,
      productId: product.productId,
      productRevision: product.revision,
      format: 'png',
      widthPixels: 90,
      heightPixels: 160,
      result: 'PASS',
      policyVersion: 'fixture-image-qc/1',
      evidenceReference: 'fixture:inspection',
    };
    qc = { ...report, contentHash: affiliateHash(report) };
    return qc;
  };
  const supplyApproval = (packageHash: string) => {
    const review = {
      schemaVersion: 'manual-image-review/1.0.0',
      decisionId: 'image_review_001',
      actor: 'fixture_human_reviewer',
      packageHash,
      imageArtifactId: image.imageArtifactId,
      imageContentHash: hash,
      qualityControlHash: qc.contentHash,
      decision: 'APPROVED',
      reviewedAt: '2026-11-12T12:30:00Z',
      revoked: false,
    };
    approval = { ...review, contentHash: affiliateHash(review) };
    return approval;
  };
  return {
    bytes,
    hash,
    rights,
    product,
    campaign,
    image,
    input,
    readers,
    service,
    supplyQc,
    supplyApproval,
  };
}

test('image identity is independent of VideoRender; absent QC and approval stay explicit and immutable', async () => {
  const f = imageFixture();
  const result = await f.service.prepare(f.input);
  expect(result.package?.schemaVersion).toBe('manual-image-package/1.0.0');
  expect(result.blockers.map((b) => b.code)).toEqual([
    'IMAGE_QC_REQUIRED',
    'HUMAN_APPROVAL_REQUIRED',
  ]);
  expect(result.package?.imageContentHash).toBe(f.hash);
  expect(result.package?.affiliateUrl).toBe(f.campaign.affiliateUrl);
  expect(result.package?.caption).toBe(f.input.caption);
  expect(result.publicationAuthorized).toBe(false);
  expect(JSON.stringify(result)).not.toContain('videoRender');
  expect(Object.isFrozen(result.package)).toBe(true);
  expect(await f.service.prepare(f.input)).toEqual(result);
});
test('rights and external-provider permission are checked before any byte read or decoding', async () => {
  for (const external of [false, true]) {
    const f = imageFixture();
    if (external) f.input.externalProvider = 'unapproved_provider' as any;
    else {
      f.rights.mediaAuthorization.commercialUse = 'DENIED';
      f.input.productHash = affiliateHash(f.product);
    }
    const result = await f.service.prepare(f.input);
    expect(result.blockers[0].code).toBe('IMAGE_RIGHTS_REQUIRED');
    expect(f.readers.readImageBytes).not.toHaveBeenCalled();
    expect(f.readers.inspectImage).not.toHaveBeenCalled();
  }
});
test('unavailable QC/review readers and incorrect QC identity never invent evidence', async () => {
  const f = imageFixture();
  f.readers.getImageQc.mockImplementation(() => {
    throw Error('PRIVATE_SECRET');
  });
  const missing = await f.service.prepare(f.input);
  expect(missing.blockers.map((b) => b.code)).toContain('IMAGE_QC_REQUIRED');
  const qc = f.supplyQc();
  f.readers.getImageQc.mockImplementation(() => qc);
  qc.imageContentHash = 'f'.repeat(64);
  qc.contentHash = affiliateHash(qc);
  expect(
    (await f.service.prepare(f.input)).blockers.map((b) => b.code),
  ).toContain('IMAGE_QC_REQUIRED');
  qc.imageContentHash = f.hash;
  qc.contentHash = affiliateHash(qc);
  f.readers.getImageApproval.mockImplementation(() => {
    throw Error('PRIVATE_SECRET');
  });
  const result = await f.service.prepare(f.input);
  expect(result.blockers.map((b) => b.code)).toContain(
    'HUMAN_APPROVAL_REQUIRED',
  );
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});
test('only exact externally supplied image QC and review may be reported; preparation never publishes', async () => {
  const f = imageFixture();
  f.supplyQc();
  const draft = await f.service.prepare(f.input);
  expect(draft.blockers.map((b) => b.code)).toEqual([
    'HUMAN_APPROVAL_REQUIRED',
  ]);
  f.supplyApproval(draft.package!.packageHash);
  const result = await f.service.prepare(f.input);
  expect(result.blockers).toEqual([]);
  expect(result.package?.review.status).toBe('APPROVED');
  expect(result.package?.packageHash).toBe(draft.package?.packageHash);
  expect(manualImagePackageHash(result.package!)).toBe(
    result.package?.packageHash,
  );
  expect(result.publicationAuthorized).toBe(false);
  expect(() => {
    result.package!.caption = 'mutated';
  }).toThrow();
});
test.each([
  'missing',
  'hash',
  'dimensions',
  'format',
  'rights',
  'product',
  'campaign',
  'destination',
  'account',
  'caption',
  'price',
  'disclosure',
  'provider',
])('blocks %s before constructing an eligible package', async (kind) => {
  const f = imageFixture();
  if (kind === 'missing') f.readers.getImage.mockReturnValue(null as any);
  if (kind === 'hash')
    f.readers.readImageBytes.mockReturnValue(Buffer.from('wrong'));
  if (kind === 'dimensions') f.input.widthPixels++;
  if (kind === 'format') f.input.format = 'webp';
  if (kind === 'rights') f.rights.mediaAuthorization.commercialUse = 'DENIED';
  if (kind === 'product') f.product.name = 'Changed product';
  if (kind === 'campaign')
    f.campaign.affiliateUrl = 'https://example.com/changed';
  if (kind === 'destination') f.input.destination = 'FACEBOOK_REELS';
  if (kind === 'account') f.input.account = '999999999';
  if (kind === 'caption') f.input.caption = '';
  if (kind === 'price') f.input.caption = 'Custa R$ 9,90';
  if (kind === 'disclosure') f.campaign.disclosure = '';
  if (kind === 'provider')
    f.input.externalProvider = 'unapproved_provider' as any;
  const result = await f.service.prepare(f.input);
  expect(result.package).toBeNull();
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(result.publicationAuthorized).toBe(false);
});
test('an approval for another artifact and a video decision cannot satisfy image approval', async () => {
  const f = imageFixture();
  f.supplyQc();
  const draft = await f.service.prepare(f.input);
  const review = f.supplyApproval(draft.package!.packageHash);
  review.imageArtifactId = 'other_image';
  expect(
    (await f.service.prepare(f.input)).blockers.map((b) => b.code),
  ).toContain('HUMAN_APPROVAL_REQUIRED');
  f.readers.getImageApproval.mockReturnValue({
    ...review,
    schemaVersion: 'human-approval/1.0.0',
    contentHash: affiliateHash(review),
  });
  expect(
    (await f.service.prepare(f.input)).blockers.map((b) => b.code),
  ).toContain('HUMAN_APPROVAL_REQUIRED');
});
