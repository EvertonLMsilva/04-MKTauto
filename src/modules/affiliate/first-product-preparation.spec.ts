import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { AffiliateService } from './application/affiliate.service.js';
import { AffiliateReviewRegistrationService } from './application/affiliate-review-registration.service.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { ShopeeCatalogCommit } from './infrastructure/shopee-catalog-commit.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import { affiliateHash } from './domain/affiliate-contracts.js';
import { runFirstProductPreparation } from './prepare-first-product.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-12T12:00:00Z';
let root: string,
  f: ReturnType<typeof p2EditorialFixture>,
  feeds: FeedQualificationService,
  preview: QualificationPreviewService,
  affiliate: AffiliateService,
  factory: SqliteAffiliatePersistence,
  projects: any,
  allowFixtureRegistration: boolean,
  before: unknown;
const counts = () =>
  [
    'affiliate_product_revisions',
    'affiliate_campaign_revisions',
    'affiliate_briefings',
    'affiliate_commands',
  ].map(
    (table) => f.base.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
  );
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'affiliate-first-product-'));
  f = p2EditorialFixture();
  allowFixtureRegistration = false;
  before = counts();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('EXTERNAL_CALL_FORBIDDEN'),
  );
  writeFileSync(
    join(root, 'feed.csv'),
    'itemid,title,price,product_link\n1001,Fixture piloto,45.9,https://shopee.com.br/product/7/1001\n',
  );
  writeFileSync(
    join(root, 'feeds.json'),
    JSON.stringify({
      feeds: [
        {
          feedId: 'fixture',
          provider: 'shopee',
          sourcePath: 'feed.csv',
          columns: { externalId: 'itemid', name: 'title' },
          delimiter: ',',
          maxRecordChars: 1048576,
        },
      ],
    }),
  );
  vi.stubEnv('AFFILIATE_DISCOVERY_CONFIG', join(root, 'feeds.json'));
  vi.stubEnv('FFMPEG_MEDIA_ROOT', join(root, 'media'));
  feeds = new FeedQualificationService();
  factory = new SqliteAffiliatePersistence(f.database);
  projects = {
    get: async (id: string, version?: number) => f.base.get(id, version),
  };
  preview = new QualificationPreviewService(feeds, factory, projects);
  affiliate = new AffiliateService(
    factory,
    projects,
    new ShopeeCatalogCommit(f.database),
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  if (!allowFixtureRegistration) expect(counts()).toEqual(before);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  f.cleanup();
  rmSync(root, { recursive: true, force: true });
});
async function input(complete = true) {
  const request: any = {
    reportId: (await feeds.analyze()).reportId,
    externalProductId: '1001',
    projectId: 'project_001',
    recordedAt: at,
  };
  if (complete) {
    const initial = await preview.preview(request),
      product = structuredClone(initial.productDraft.product) as any,
      campaign = {
        ...(initial.offerDraft.campaign as any),
        affiliateUrl: 'https://s.shopee.com.br/fixture_pilot',
      };
    const bytes = png(),
      hash = createHash('sha256').update(bytes).digest('hex'),
      dir = join(root, 'media', 'sha256', hash.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, hash + '.png'), bytes);
    const grant = {
      id: 'ev_fixture_rights',
      kind: 'MEDIA_USAGE_RIGHT',
      sourceRef: 'FICTITIOUS_TEST_ONLY:documented-reusable-permission',
      recordedAt: at,
      mediaAuthorization: {
        mediaRef: 'media:pilot_fixture',
        contentHash: hash,
        commercialUse: 'GRANTED',
        processing: 'GRANTED',
        localProcessing: true,
        externalProviders: [],
      },
    };
    product.media = [
      { mediaRef: 'media:pilot_fixture', evidenceRef: grant.id },
    ];
    product.evidence.push(grant);
    product.localImage = {
      mediaReference: 'media:pilot_fixture',
      contentHash: hash,
      origin: 'OPERATOR_OWNED',
      provider: null,
      rights: {
        usageBasis: 'OWNED',
        commercialUseAllowed: true,
        evidence: [grant],
      },
    };
    Object.assign(request, {
      product,
      campaign,
      affiliateEvidence: {
        sourceRef: 'FICTITIOUS_TEST_ONLY:association-declaration',
        recordedAt: at,
        subjectHash: affiliateHash({
          externalProductId: '1001',
          affiliateUrl: campaign.affiliateUrl,
        }),
      },
    });
  }
  return {
    schemaVersion: 'affiliate-first-product-input/1.0.0',
    dataOrigin: 'SYNTHETIC_FIXTURE',
    projectVersion: 1,
    previewRequest: request,
  };
}

test('without an explicitly supplied input the report lists missing real evidence without opening any source', async () => {
  const analyze = vi.fn(),
    open = vi.fn(),
    get = vi.fn(),
    service = new QualificationPreviewService(
      { analyze } as any,
      { open },
      { get },
    );
  const report = await service.prepareFirstProduct();
  expect(report).toMatchObject({
    technicalPreparationStatus: 'BLOCKED',
    realProductEvidenceStatus: 'MISSING',
    operationalApprovalStatus: 'BLOCKED_EXTERNAL_EVIDENCE',
    registrationAuthorized: false,
    operationallyRegistered: false,
    candidate: null,
    handoff: null,
  });
  expect(report.technicalBlockers).toContain(
    'OPERATOR_PROVIDED_INPUT_REQUIRED',
  );
  expect(report.operationalBlockers).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(analyze).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

test('complete synthetic preparation binds identity, project, physical SHA, rights, URL, provenance and exact preview without granting approval', async () => {
  const source = await input(),
    report = await preview.prepareFirstProduct(source);
  expect(report).toMatchObject({
    technicalPreparationStatus: 'READY_FOR_OPERATOR_REVIEW',
    realProductEvidenceStatus: 'SYNTHETIC_ONLY',
    operationalApprovalStatus: 'BLOCKED_EXTERNAL_EVIDENCE',
    registrationAuthorized: false,
    operationallyRegistered: false,
  });
  expect(report.candidate).toMatchObject({
    externalProductId: '1001',
    shopId: '7',
    offerId: null,
  });
  expect(report.project).toMatchObject({
    projectId: 'project_001',
    projectVersion: 1,
    niche: 'tecnologia',
  });
  expect(report.media.physical.status).toBe('VERIFIED');
  expect(report.media.source!.contentHash).toBe(
    source.previewRequest.product.localImage.contentHash,
  );
  expect(report.catalog).toMatchObject({
    registrationStatus: 'NOT_REGISTERED',
    draftEligibility: {
      technicalEligibility: 'ELIGIBLE',
      associationVerified: false,
    },
  });
  expect(report.commercial.current).toEqual({
    price: null,
    currency: null,
    availability: null,
    commission: null,
  });
  expect(report.commercial.historicalPrice).not.toBeNull();
  expect(report.handoff!.request).toEqual({
    expectedPackageHash: report.preview!.packageHash,
    preview: report.preview,
  });
  expect(report.handoff!.request).not.toHaveProperty('confirmed');
  expect(report.handoff!.request).not.toHaveProperty('decision');
  expect(report.handoff!.request).not.toHaveProperty('actorId');
  const { preparationHash, ...body } = report;
  expect(preparationHash).toBe(affiliateHash(body));
  expect(await preview.prepareFirstProduct(source)).toEqual(report);
});

test.each([
  'missing-image',
  'no-rights',
  'wrong-hash',
  'archived',
  'revision-conflict',
  'missing-link',
  'missing-association',
  'wrong-project',
  'wrong-project-version',
])(
  'preparation identifies %s without changing operational records',
  async (kind) => {
    const source = await input(kind !== 'missing-image');
    const request = source.previewRequest;
    if (kind === 'no-rights') request.product.localImage.rights.evidence = [];
    if (kind === 'wrong-hash') {
      const hash = request.product.localImage.contentHash;
      writeFileSync(
        join(root, 'media', 'sha256', hash.slice(0, 2), hash + '.png'),
        'CORRUPT',
      );
    }
    if (kind === 'archived') request.product.status = 'ARCHIVED';
    if (kind === 'revision-conflict') request.campaign.productRevision = 2;
    if (kind === 'missing-link') request.campaign.affiliateUrl = null;
    if (kind === 'missing-association') delete request.affiliateEvidence;
    if (kind === 'wrong-project') request.projectId = 'other_project';
    if (kind === 'wrong-project-version') source.projectVersion = 2;
    const report = await preview.prepareFirstProduct(source);
    expect(report.technicalPreparationStatus).toBe('BLOCKED');
    expect(report.handoff).toBeNull();
    expect(report.technicalBlockers.length).toBeGreaterThan(0);
    const expected: Record<string, string> = {
      'missing-image': 'LOCAL_IMAGE_REQUIRED',
      'no-rights': 'REUSABLE_MEDIA_RIGHTS_REQUIRED',
      'wrong-hash': 'LOCAL_IMAGE_HASH_MISMATCH',
      archived: 'PRODUCT_ARCHIVED',
      'revision-conflict': 'QUALIFICATION_PREVIEW_SCOPE_MISMATCH',
      'missing-link': 'AFFILIATE_LINK_REQUIRED',
      'missing-association': 'AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED',
      'wrong-project': 'QUALIFICATION_PREVIEW_SCOPE_MISMATCH',
      'wrong-project-version': 'PROJECT_VERSION_UNAVAILABLE',
    };
    expect(report.technicalBlockers).toContain(expected[kind]);
    expect(report.operationalApprovalStatus).toBe('BLOCKED_EXTERNAL_EVIDENCE');
  },
);

test('a prepared package can enter existing reviewed registration only after a separate explicit fixture decision; preparation remains read-only', async () => {
  const source = await input(),
    report = await preview.prepareFirstProduct(source),
    review = new AffiliateReviewRegistrationService(preview, affiliate);
  // Existing authentication is mocked only for this isolated synthetic command test.
  vi.spyOn(operationalQcIdentity, 'assertActive').mockReturnValue({
    id: 'fixture_operator',
  } as any);
  await expect(review.register(report.handoff!.request, {})).rejects.toThrow(
    'AFFILIATE_REVIEW_CONFIRMATION_REQUIRED',
  );
  expect(counts()).toEqual(before);
  allowFixtureRegistration = true;
  const receipt = await review.register(
    {
      ...report.handoff!.request,
      idempotencyKey: 'fixture_review_decision',
      confirmed: true,
      decision: 'REGISTER',
    },
    {},
  );
  expect(receipt.previewPackageHash).toBe(report.preview!.packageHash);
  const after = counts(),
    registered = await preview.prepareFirstProduct(source);
  expect(registered.catalog).toMatchObject({
    registrationStatus: 'EXACT_REGISTERED_REVISIONS',
    persistedEntry: {
      productHash: receipt.productHash,
      campaignHash: receipt.campaignHash,
    },
  });
  expect(registered.operationalApprovalStatus).toBe(
    'BLOCKED_EXTERNAL_EVIDENCE',
  );
  expect(registered.registrationAuthorized).toBe(false);
  expect(counts()).toEqual(after);
});

test('CLI accepts only explicit input and read-only database paths and never overwrites its report', async () => {
  const source = await input(),
    path = join(root, 'input.json'),
    output = join(root, 'report.json');
  writeFileSync(path, JSON.stringify(source));
  const report = await runFirstProductPreparation([
    '--input',
    path,
    '--database',
    f.database,
    '--output',
    output,
  ]);
  expect(report.technicalPreparationStatus).toBe('READY_FOR_OPERATOR_REVIEW');
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(report);
  const bytes = readFileSync(output);
  await expect(
    runFirstProductPreparation([
      '--input',
      path,
      '--database',
      f.database,
      '--output',
      output,
    ]),
  ).rejects.toThrow();
  expect(readFileSync(output)).toEqual(bytes);
});

test('CLI without input produces a pending report without consulting configured feeds or runtime databases', async () => {
  vi.stubEnv('AFFILIATE_DISCOVERY_CONFIG', join(root, 'must_not_read.json'));
  vi.stubEnv('PROJECT_API_DATABASE', join(root, 'must_not_open.sqlite'));
  const output = join(root, 'pending.json'),
    report = await runFirstProductPreparation(['--output', output]);
  expect(report.realProductEvidenceStatus).toBe('MISSING');
  expect(report.catalog.registrationStatus).toBe('UNVERIFIED');
  expect(existsSync(join(root, 'must_not_open.sqlite'))).toBe(false);
});

test.each(['not-json', 'unknown-fields', 'invalid-version'])(
  'invalid input %s fails before report creation',
  async (kind) => {
    const path = join(root, 'invalid.json'),
      output = join(root, 'no-report.json');
    writeFileSync(
      path,
      kind === 'not-json'
        ? 'INVALID_JSON'
        : JSON.stringify(
            kind === 'unknown-fields'
              ? { secret: 'DO_NOT_PRINT' }
              : { ...(await input(false)), schemaVersion: 'unsupported' },
          ),
    );
    await expect(
      runFirstProductPreparation(['--input', path, '--output', output]),
    ).rejects.toMatchObject({ code: 'FIRST_PRODUCT_INPUT_INVALID' });
    expect(existsSync(output)).toBe(false);
  },
);

test('required input fields are identified precisely without reading a source', async () => {
  const source = await input(false);
  delete (source as any).projectVersion;
  await expect(preview.prepareFirstProduct(source)).rejects.toMatchObject({
    code: 'FIRST_PRODUCT_INPUT_INVALID',
    field: 'projectVersion',
  });
  source.projectVersion = 1;
  delete source.previewRequest.projectId;
  await expect(preview.prepareFirstProduct(source)).rejects.toMatchObject({
    code: 'FIRST_PRODUCT_INPUT_INVALID',
    field: 'previewRequest.projectId',
  });
});

test('operator-provided declaration alone remains unverified and cannot authorize the pilot', async () => {
  const source = await input();
  source.dataOrigin = 'OPERATOR_PROVIDED';
  const report = await preview.prepareFirstProduct(source);
  expect(report.realProductEvidenceStatus).toBe('OPERATOR_PROVIDED_UNVERIFIED');
  expect(report.operationalApprovalStatus).toBe('BLOCKED_EXTERNAL_EVIDENCE');
  expect(report.affiliate.associationVerified).toBe(false);
});

test('a newer persisted revision blocks the old candidate without another catalog or registration', async () => {
  const source = await input();
  allowFixtureRegistration = true;
  await affiliate.registerProduct({
    idempotencyKey: 'fixture_prior_one',
    product: source.previewRequest.product,
  });
  await affiliate.registerProduct({
    idempotencyKey: 'fixture_prior_two',
    product: { ...source.previewRequest.product, revision: 2 },
  });
  const prior = counts(),
    report = await preview.prepareFirstProduct(source);
  expect(report.technicalBlockers).toContain('PRODUCT_REVISION_STALE');
  expect(report.handoff).toBeNull();
  expect(counts()).toEqual(prior);
});

test('CLI with input never falls back to the runtime database when explicit context is absent', async () => {
  const source = await input(),
    path = join(root, 'input-no-db.json');
  writeFileSync(path, JSON.stringify(source));
  vi.stubEnv(
    'PROJECT_API_DATABASE',
    join(root, 'runtime-must-not-open.sqlite'),
  );
  const report = await runFirstProductPreparation([
    '--input',
    path,
    '--output',
    join(root, 'context-pending.json'),
  ]);
  expect(report.technicalBlockers).toContain('PROJECT_SCOPE_UNVERIFIED');
  expect(report.catalog.registrationStatus).toBe('UNVERIFIED');
  expect(report.handoff).toBeNull();
  expect(existsSync(join(root, 'runtime-must-not-open.sqlite'))).toBe(false);
});

test('changed feed produces a deterministic stale-report blocker with no output payload for registration', async () => {
  const source = await input();
  writeFileSync(
    join(root, 'feed.csv'),
    readFileSync(join(root, 'feed.csv'), 'utf8').replace('45.9', '46.9'),
  );
  const report = await preview.prepareFirstProduct(source);
  expect(report.technicalBlockers).toContain(
    'FEED_QUALIFICATION_REPORT_CHANGED',
  );
  expect(report.handoff).toBeNull();
});
