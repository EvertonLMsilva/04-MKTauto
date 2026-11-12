import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  ManualImageQcService,
  type ImageQcDecoder,
} from './application/manual-image-qc.service.js';
import {
  ManualImagePackageService,
  type ManualImageReaders,
} from './application/manual-image-package.service.js';
import {
  ManualImageReviewService,
  type ManualImageReviewRequest,
} from './application/manual-image-review.service.js';
import { ManualImageReviewRepository } from './infrastructure/manual-image-review.repository.js';
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const migration = readFileSync(
  new URL(
    '../../infrastructure/database/migrations/manual_image_review_v1.sql',
    import.meta.url,
  ),
  'utf8',
);
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

async function fixture(decoder?: ImageQcDecoder) {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('EXTERNAL_EFFECT_FORBIDDEN'));
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(migration);
  const repository = new ManualImageReviewRepository(db);
  const bytes = png() as Buffer,
    imageContentHash = createHash('sha256').update(bytes).digest('hex'),
    mediaReference = 'media:sha256_' + imageContentHash;
  const rights = {
    id: 'fixture_image_right',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'fixture:original-synthetic-image',
    recordedAt: '2026-11-12T12:00:00Z',
    mediaAuthorization: {
      mediaRef: mediaReference,
      contentHash: imageContentHash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: [],
    },
  };
  const product = fixtures.product({
    media: [{ mediaRef: mediaReference, evidenceRef: rights.id }],
    evidence: [...fixtures.product().evidence, rights],
  });
  const campaign = fixtures.campaign();
  const identity = {
    imageArtifactId: 'fixture_image',
    imageContentHash,
    productId: product.productId as string,
    productRevision: 1,
    mediaReference,
    format: 'png' as const,
    widthPixels: 90,
    heightPixels: 160,
  };
  const provenance = {
    ...identity,
    schemaVersion: 'manual-image-provenance/1.0.0',
    sourceId: 'fixture_owned_images',
    contentHash: '',
  };
  provenance.contentHash = affiliateHash(provenance);
  const artifact = {
    ...identity,
    provenanceReference: 'image-provenance:sha256:' + provenance.contentHash,
  };
  const qc = new ManualImageQcService(
    {
      getArtifact: () => artifact,
      getProvenance: () => provenance,
      readBytes: () => bytes,
    },
    {
      trustedSourceIds: ['fixture_owned_images'],
      decoder: decoder ?? {
        id: 'fixture_decoder',
        version: 'test-only/1',
        decode: () => ({
          ...identity,
          fullyDecoded: true,
          frameCount: 1,
          rgba: new Uint8Array(90 * 160 * 4),
        }),
      },
    },
  );
  const qcRequest = {
    imageArtifactId: identity.imageArtifactId,
    imageContentHash,
    productId: identity.productId,
    productRevision: 1,
  };
  const qcResult = await qc.inspect(qcRequest);
  expect(qcResult.status).toBe('PASS');
  const readers: ManualImageReaders = {
    getCampaign: () => campaign,
    getProduct: () => product,
    getProject: () => ({ id: campaign.projectId as string, version: 1 }),
    getRun: () => null,
    getImage: () => ({
      ...identity,
      projectId: campaign.projectId as string,
      projectVersion: 1,
      rightsEvidence: [rights],
    }),
    readImageBytes: () => bytes,
    inspectImage: () => ({ ...identity, fullyDecoded: true }),
    getDestination: () => ({
      destination: 'instagram',
      account: '123456789',
      projectId: campaign.projectId as string,
      enabled: true,
    }),
    getImageQc: async () => (await qc.inspect(qcRequest)).bundle?.report,
    getImageApproval: (hash) => repository.getImageApproval(hash),
  };
  const packages = new ManualImagePackageService(readers);
  const input = {
    ...identity,
    campaignId: campaign.campaignId as string,
    campaignRevision: 1,
    campaignHash: affiliateHash(campaign),
    productHash: affiliateHash(product),
    projectId: campaign.projectId as string,
    projectVersion: 1,
    pipelineRunId: null,
    destination: 'instagram' as const,
    account: '123456789',
    caption: 'Fixture sintética. Sem autorização de publicação.',
    externalProvider: null,
  };
  const prepared = await packages.prepare(input);
  expect(prepared.package?.qualityControl.status).toBe('PASS');
  const request: ManualImageReviewRequest = {
    idempotencyKey: 'fixture_decision',
    input,
    expectedPackageHash: prepared.package!.packageHash,
    expectedReviewRevision: 0,
    decision: 'APPROVED',
    reason: null,
  };
  const principal = Object.freeze({}),
    principals = new WeakMap<object, string>([[principal, 'fixture_reviewer']]);
  const authorize = vi.fn((p: unknown, _scope: unknown) => {
    const actorId =
      typeof p === 'object' && p !== null ? principals.get(p) : undefined;
    if (!actorId) throw Error('NOT_AUTHENTICATED');
    return { actorId, authenticated: true as const, authorized: true as const };
  });
  const now = vi.fn(() => '2026-11-12T12:00:00Z');
  const deps = { repository, packages, qc, authority: { authorize }, now };
  const service = new ManualImageReviewService(deps);
  return {
    db,
    repository,
    bytes,
    product,
    campaign,
    artifact,
    provenance,
    identity,
    readers,
    qc,
    qcResult,
    packages,
    request,
    principal,
    principals,
    authorize,
    now,
    deps,
    service,
    network,
  };
}
test('legitimate QC -> explicit authenticated decision -> A-007 -> immutable revocation; never publishing or finance', async () => {
  const f = await fixture(),
    before = Buffer.from(f.bytes),
    sourceHash = affiliateHash(f.product);
  expect(
    (await f.packages.prepare(f.request.input)).package?.review.status,
  ).toBe('HUMAN_APPROVAL_REQUIRED');
  const approved = await f.service.decide(f.request, f.principal);
  expect(approved.review.decision).toBe('APPROVED');
  expect(approved.publicationAuthorized).toBe(false);
  expect(f.authorize).toHaveBeenCalledWith(f.principal, {
    action: 'REVIEW',
    projectId: f.request.input.projectId,
    projectVersion: 1,
    packageHash: f.request.expectedPackageHash,
    decisionId: null,
  });
  const after = await f.packages.prepare(f.request.input);
  expect(after.package?.packageHash).toBe(f.request.expectedPackageHash);
  expect(after.package?.review.status).toBe('APPROVED');
  expect(after.publicationAuthorized).toBe(false);
  expect(await f.service.decide(f.request, f.principal)).toEqual(approved);
  expect(f.now).toHaveBeenCalledTimes(1);
  const revoke = {
    idempotencyKey: 'revoke_fixture',
    decisionId: approved.review.decisionId,
    decisionHash: approved.record.review.contentHash,
    reason: 'Fixture: decisão retirada pelo operador',
  };
  const revoked = await f.service.revoke(revoke, f.principal);
  expect(revoked.review.revoked).toBe(true);
  expect(revoked.review.contentHash).toBe(affiliateHash(revoked.review));
  expect(revoked.review.contentHash).not.toBe(approved.review.contentHash);
  expect(f.repository.getRecord(approved.review.decisionId)?.review).toEqual(
    approved.record.review,
  );
  expect(
    (await f.packages.prepare(f.request.input)).package?.review.status,
  ).toBe('HUMAN_APPROVAL_REQUIRED');
  expect(await f.service.revoke(revoke, f.principal)).toEqual(revoked);
  expect((await f.service.decide(f.request, f.principal)).review.revoked).toBe(
    true,
  );
  await expect(
    f.service.revoke(
      { ...revoke, idempotencyKey: 'another_revoke' },
      f.principal,
    ),
  ).rejects.toThrow('IMAGE_REVIEW_ALREADY_REVOKED');
  for (const action of ['DELETE FROM', 'UPDATE']) {
    const sql =
      action === 'UPDATE'
        ? 'UPDATE manual_image_review_revocations_v1 SET event_hash=event_hash'
        : 'DELETE FROM manual_image_review_revocations_v1';
    expect(() => f.db.exec(sql)).toThrow('IMAGE_REVIEW_IMMUTABLE');
  }
  expect(
    f.db
      .prepare('SELECT count(*) AS n FROM manual_image_review_revocations_v1')
      .get()?.n,
  ).toBe(1);
  expect(f.bytes).toEqual(before);
  expect(affiliateHash(f.product)).toBe(sourceHash);
  expect(f.network).not.toHaveBeenCalled();
  expect(
    f.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual([
    'manual_image_review_commands_v1',
    'manual_image_review_decisions_v1',
    'manual_image_review_packages_v1',
    'manual_image_review_revocations_v1',
  ]);
});
test('explicit rejection requires reason, persists and supersedes approval at a new revision', async () => {
  const f = await fixture(),
    approved = await f.service.decide(f.request, f.principal);
  await expect(
    f.service.decide({ ...f.request, decision: 'REJECTED' }, f.principal),
  ).rejects.toThrow();
  const request = {
    ...f.request,
    idempotencyKey: 'reject',
    expectedReviewRevision: 1,
    decision: 'REJECTED' as const,
    reason: 'Fixture: aparência não aprovada',
  };
  const rejected = await f.service.decide(request, f.principal);
  expect(rejected.record.revision).toBe(2);
  expect(rejected.review.decision).toBe('REJECTED');
  expect(rejected.record.reason).toBe(request.reason);
  expect(
    (await f.packages.prepare(f.request.input)).package?.review.status,
  ).toBe('HUMAN_APPROVAL_REQUIRED');
  expect((await f.service.decide(f.request, f.principal)).review.decision).toBe(
    'REJECTED',
  );
  expect(
    f.repository.getRecord(approved.review.decisionId)?.review.revoked,
  ).toBe(false);
});
test.each([
  'projectId',
  'projectVersion',
  'campaignId',
  'campaignRevision',
  'productId',
  'productRevision',
  'productHash',
  'imageArtifactId',
  'imageContentHash',
  'destination',
  'account',
  'caption',
] as const)('does not approve mutated package field %s', async (field) => {
  const f = await fixture(),
    input = { ...f.request.input };
  if (
    field === 'projectVersion' ||
    field === 'campaignRevision' ||
    field === 'productRevision'
  )
    input[field] = 2;
  else if (field === 'destination') input.destination = 'facebook';
  else if (field === 'account') input.account = '987654321';
  else input[field] = 'changed';
  await expect(
    f.service.decide({ ...f.request, input }, f.principal),
  ).rejects.toThrow();
  expect(
    f.db
      .prepare('SELECT count(*) AS n FROM manual_image_review_decisions_v1')
      .get()?.n,
  ).toBe(0);
});
test.each([
  'packageHash',
  'missingQc',
  'packageQcMissing',
  'otherImageQc',
  'invalidQc',
  'selfDeclared',
  'unauthorized',
  'payloadActor',
  'rights',
  'disclosure',
])('fails closed for %s', async (kind) => {
  const f = await fixture();
  let request = { ...f.request },
    service = f.service,
    principal: unknown = f.principal;
  if (kind === 'packageHash') request.expectedPackageHash = '0'.repeat(64);
  if (kind === 'missingQc')
    service = new ManualImageReviewService({
      ...f.deps,
      qc: {
        inspect: vi.fn(async () => ({
          ...f.qcResult,
          status: 'QC_REQUIRED' as const,
          bundle: null,
        })),
      },
    });
  if (kind === 'packageQcMissing') f.readers.getImageQc = () => null;
  if (kind === 'invalidQc') {
    const bundle = structuredClone(f.qcResult.bundle!);
    bundle.report.imageArtifactId = 'other_image';
    service = new ManualImageReviewService({
      ...f.deps,
      qc: { inspect: vi.fn(async () => ({ ...f.qcResult, bundle })) },
    });
  }
  if (kind === 'otherImageQc') {
    const previous = structuredClone(f.provenance),
      oldReference = f.artifact.provenanceReference;
    f.artifact.imageArtifactId = f.provenance.imageArtifactId = 'other_image';
    f.provenance.contentHash = affiliateHash(f.provenance);
    f.artifact.provenanceReference =
      'image-provenance:sha256:' + f.provenance.contentHash;
    const other = await f.qc.inspect({
      imageArtifactId: 'other_image',
      imageContentHash: f.identity.imageContentHash,
      productId: f.identity.productId,
      productRevision: 1,
    });
    expect(other.status).toBe('PASS');
    Object.assign(f.provenance, previous);
    f.artifact.imageArtifactId = f.identity.imageArtifactId;
    f.artifact.provenanceReference = oldReference;
    service = new ManualImageReviewService({
      ...f.deps,
      qc: { inspect: vi.fn(async () => other) },
    });
  }
  if (kind === 'selfDeclared')
    principal = {
      actorId: 'fixture_reviewer',
      authenticated: true,
      authorized: true,
    };
  if (kind === 'unauthorized')
    f.authorize.mockImplementation(() => {
      throw Error('PERMISSION_DENIED');
    });
  if (kind === 'payloadActor')
    request = {
      ...request,
      actorId: 'fixture_reviewer',
    } as ManualImageReviewRequest;
  if (kind === 'rights') f.product.evidence = [];
  if (kind === 'disclosure') f.campaign.disclosure = 'Different disclosure';
  await expect(service.decide(request, principal)).rejects.toThrow();
  expect(
    f.db
      .prepare('SELECT count(*) AS n FROM manual_image_review_decisions_v1')
      .get()?.n,
  ).toBe(0);
});
test('actor and payload idempotency conflicts; untrusted revocation and missing reasons cannot change state', async () => {
  const f = await fixture(),
    approved = await f.service.decide(f.request, f.principal),
    another = Object.freeze({});
  f.principals.set(another, 'other_reviewer');
  await expect(f.service.decide(f.request, another)).rejects.toThrow(
    'IMAGE_REVIEW_IDEMPOTENCY_CONFLICT',
  );
  await expect(
    f.service.decide({ ...f.request, reason: 'changed' }, f.principal),
  ).rejects.toThrow('IMAGE_REVIEW_IDEMPOTENCY_CONFLICT');
  const revoke = {
    idempotencyKey: 'revoke',
    decisionId: approved.review.decisionId,
    decisionHash: approved.review.contentHash,
    reason: 'Fixture: retirada da decisão',
  };
  await expect(
    f.service.revoke(revoke, { actorId: 'fixture_reviewer' }),
  ).rejects.toThrow('HUMAN_REVIEW_AUTHORITY_REQUIRED');
  await expect(
    f.service.revoke({ ...revoke, reason: '' }, f.principal),
  ).rejects.toThrow();
  await expect(
    f.service.revoke({ ...revoke, decisionHash: 'a'.repeat(64) }, f.principal),
  ).rejects.toThrow('IMAGE_REVIEW_DECISION_MISMATCH');
  expect(
    f.repository.getImageApproval(f.request.expectedPackageHash)?.revoked,
  ).toBe(false);
});
test('approval for another exact package cannot release A-007', async () => {
  const f = await fixture(),
    approved = await f.service.decide(f.request, f.principal);
  f.readers.getImageApproval = () => approved.review;
  const different = await f.packages.prepare({
    ...f.request.input,
    caption: 'Outra legenda explicitamente distinta',
  });
  expect(different.package?.packageHash).not.toBe(approved.review.packageHash);
  expect(different.package?.review.status).toBe('HUMAN_APPROVAL_REQUIRED');
  expect(different.publicationAuthorized).toBe(false);
});
test.skipIf(!process.env.MKTAUTO_TEST_FFMPEG)(
  'actual local full PNG decode through A-008 and A-007 permits only offline human decision',
  async () => {
    const decoder: ImageQcDecoder = {
      id: 'fixture_ffmpeg',
      version: 'local-test/1',
      decode: (bytes) => ({
        format: 'png',
        widthPixels: 90,
        heightPixels: 160,
        fullyDecoded: true,
        frameCount: 1,
        rgba: execFileSync(
          process.env.MKTAUTO_TEST_FFMPEG!,
          [
            '-v',
            'error',
            '-xerror',
            '-err_detect',
            'explode',
            '-i',
            'pipe:0',
            '-pix_fmt',
            'rgba',
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          {
            input: bytes,
            maxBuffer: 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        ),
      }),
    };
    const f = await fixture(decoder),
      approved = await f.service.decide(f.request, f.principal);
    expect(approved.review.decision).toBe('APPROVED');
    expect(approved.record.snapshot.qc.inspection.decoderId).toBe(
      'fixture_ffmpeg',
    );
    expect(
      (await f.packages.prepare(f.request.input)).package?.review.status,
    ).toBe('APPROVED');
    expect(approved.publicationAuthorized).toBe(false);
    expect(f.network).not.toHaveBeenCalled();
  },
);
