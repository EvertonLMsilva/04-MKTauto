import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { AffiliateService } from './application/affiliate.service.js';
import { AffiliateReviewRegistrationService } from './application/affiliate-review-registration.service.js';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { ShopeeCatalogCommit } from './infrastructure/shopee-catalog-commit.js';
import { affiliateHash } from './domain/affiliate-contracts.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import { freezeCatalogRequest } from '../content-operations/domain/product-rotation.js';
import { AffiliateController } from './affiliate.controller.js';
import { AffiliateRunContextService } from './application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from './infrastructure/sqlite-affiliate-run-context.persistence.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-11T12:00:00Z';
let f: ReturnType<typeof p2EditorialFixture>,
  root: string,
  feeds: FeedQualificationService,
  previews: QualificationPreviewService,
  service: AffiliateService,
  review: AffiliateReviewRegistrationService,
  principal: unknown,
  factory: SqliteAffiliatePersistence,
  projects: { get: (id: string, version?: number) => Promise<any> };

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('EXTERNAL_NETWORK_FORBIDDEN'),
  );
  f = p2EditorialFixture();
  root = mkdtempSync(join(tmpdir(), 'affiliate-reviewed-catalog-'));
  writeFileSync(
    join(root, 'feed.csv'),
    'itemid,title,price,product_link\n1001,Fixture A,45.9,https://shopee.com.br/product/7/1001\n1002,Fixture B,50.1,https://shopee.com.br/product/7/1002\n',
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
  const secret = randomBytes(32).toString('base64url'),
    salt = randomBytes(16).toString('hex'),
    identity = join(root, 'test-identity.json');
  writeFileSync(
    identity,
    JSON.stringify({
      version: 1,
      identities: [
        {
          id: 'catalog_reviewer',
          salt,
          hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 67108864,
          }).toString('hex'),
          roles: ['QC_REVIEWER'],
          revoked: false,
        },
      ],
    }),
    { mode: 0o600 },
  );
  vi.stubEnv('QC_IDENTITIES_FILE', identity);
  principal = await operationalQcIdentity.authenticate(
    `Bearer catalog_reviewer.${secret}`,
    '127.0.0.1',
  );
  factory = new SqliteAffiliatePersistence(f.database);
  projects = { get: async (id, version) => f.base.get(id, version) };
  service = new AffiliateService(
    factory,
    projects,
    new ShopeeCatalogCommit(f.database),
  );
  feeds = new FeedQualificationService();
  previews = new QualificationPreviewService(feeds, factory, projects);
  review = new AffiliateReviewRegistrationService(previews, service);
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  f?.cleanup();
  if (root) rmSync(root, { recursive: true, force: true });
});

async function register(id = '1001') {
  const input = {
    reportId: (await feeds.analyze()).reportId,
    externalProductId: id,
    projectId: 'project_001',
    recordedAt: at,
  };
  const draft = await previews.preview(input),
    product = structuredClone(draft.productDraft.product) as any,
    campaign = {
      ...(draft.offerDraft.campaign as any),
      affiliateUrl: `https://s.shopee.com.br/fixture_${id}`,
    };
  const bytes = png(),
    hash = createHash('sha256').update(bytes).digest('hex'),
    dir = join(root, 'media', 'sha256', hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, hash + '.png'), bytes);
  const grant = {
    id: 'ev_reusable',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'FICTITIOUS_TEST_ONLY:documented-reusable-rights',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: `media:fixture_${id}`,
      contentHash: hash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: [],
    },
  };
  product.media = [
    { mediaRef: grant.mediaAuthorization.mediaRef, evidenceRef: grant.id },
  ];
  product.evidence.push(grant);
  product.localImage = {
    mediaReference: grant.mediaAuthorization.mediaRef,
    contentHash: hash,
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: {
      usageBasis: 'OWNED',
      commercialUseAllowed: true,
      evidence: [grant],
    },
  };
  const affiliateEvidence = {
    sourceRef: 'FICTITIOUS_TEST_ONLY:association-declaration',
    recordedAt: at,
    subjectHash: affiliateHash({
      externalProductId: id,
      affiliateUrl: campaign.affiliateUrl,
    }),
  };
  const preview = await previews.preview({
    ...input,
    product,
    campaign,
    affiliateEvidence,
  });
  expect(preview.status).toBe('READY_FOR_OPERATOR_REVIEW');
  const command = {
    idempotencyKey: `review_${id}`,
    confirmed: true,
    decision: 'REGISTER',
    expectedPackageHash: preview.packageHash,
    preview,
  };
  const receipt = await review.register(command, principal);
  return { preview, command, receipt, product, campaign };
}
const counts = () =>
  [
    'affiliate_product_revisions',
    'affiliate_campaign_revisions',
    'affiliate_briefings',
    'affiliate_commands',
  ].map(
    (table) => f.base.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
  );
const frozen = (briefingId: string, previous: string | null = null) =>
  freezeCatalogRequest(
    {
      briefingId,
      selectionMode: 'CATALOG',
      run: { projectId: 'project_001', projectVersion: 1 },
    },
    service.catalogCandidates('project_001'),
    previous,
  ) as any;

test('confirmed registration feeds the existing catalog with exact hashes, provenance and unknown commercial facts', async () => {
  const r = await register(),
    before = counts(),
    status = await service.catalogReadiness('project_001', 1);
  const item = status.items.find(
    (i) => i.product.productId === r.product.productId,
  )!;
  expect(item).toMatchObject({
    product: r.product,
    campaign: r.campaign,
    productHash: r.receipt.productHash,
    campaignHash: r.receipt.campaignHash,
    eligibility: {
      technicalEligibility: 'ELIGIBLE',
      associationVerified: false,
      commercialApprovalVerified: false,
      externalRightsVerified: false,
      operationallyAuthorized: false,
    },
  });
  expect(item.product.evidence).toEqual(r.receipt.product.evidence);
  expect(r.receipt.previewPackageHash).toBe(r.preview.packageHash);
  expect(r.receipt.provenance).toEqual(r.preview.provenance);
  expect(item.product.evidence[0].sourceRef).toContain(
    r.preview.provenance.sourceHash,
  );
  expect(item.eligibility.currentCommercialData).toEqual({
    price: null,
    availability: null,
    commission: null,
  });
  const { snapshotHash, ...body } = status;
  expect(snapshotHash).toBe(affiliateHash(body));
  expect(status.projectHash).toBe(
    affiliateHash(await projects.get('project_001', 1)),
  );
  expect(await review.register(r.command, principal)).toEqual(r.receipt);
  expect(counts()).toEqual(before);
});

test('official rotation is deterministic for multiple reviewed candidates and preserves project version, link and media identity', async () => {
  const a = await register('1001');
  await register('1002');
  const first = frozen('brief_catalog_first'),
    second = frozen('brief_catalog_second', first.catalogSelection.productId),
    third = frozen('brief_catalog_third', second.catalogSelection.productId);
  expect([
    first.catalogSelection.productId,
    second.catalogSelection.productId,
    third.catalogSelection.productId,
  ]).toEqual(['prod_shopee_1001', 'prod_shopee_1002', 'prod_shopee_1001']);
  expect(first.run).toEqual({ projectId: 'project_001', projectVersion: 1 });
  expect(first.localImage).toEqual(a.product.localImage);
  expect(first.catalogSelection).toMatchObject({
    method: 'ROUND_ROBIN_ID_V1',
    productRevision: 1,
    sourceCampaignId: a.campaign.campaignId,
    sourceCampaignRevision: 1,
    affiliateUrl: a.campaign.affiliateUrl,
  });
  const reversed = freezeCatalogRequest(
    {
      briefingId: 'brief_catalog_first',
      selectionMode: 'CATALOG',
      run: first.run,
    },
    [...service.catalogCandidates('project_001')].reverse(),
    null,
  );
  expect(reversed).toEqual(first);
});

test('frozen briefing survives offer updates, obsolete revisions, archiving, concurrent replay and restart', async () => {
  const r = await register(),
    selection = frozen('brief_catalog_frozen').catalogSelection;
  const input = {
    briefingId: selection.briefingId,
    campaignId: selection.sourceCampaignId,
    campaignRevision: selection.sourceCampaignRevision,
  };
  const [a, b] = await Promise.all([
    service.createCatalogBriefing(input, selection.briefingHash),
    service.createCatalogBriefing(input, selection.briefingHash),
  ]);
  expect(a).toEqual(b);
  expect(a).toEqual(selection.briefing);
  const binding = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  expect(
    binding.bindRun(
      { pipelineRunId: 'run_001', briefingId: a.briefingId },
      'bind_catalog',
    ),
  ).toMatchObject({
    productId: r.product.productId,
    productRevision: 1,
    campaignId: r.campaign.campaignId,
    campaignRevision: 1,
    briefingHash: a.contentHash,
  });
  await service.registerCampaign({
    idempotencyKey: 'updated_offer',
    campaign: {
      ...r.campaign,
      revision: 2,
      affiliateUrl: 'https://s.shopee.com.br/fixture_updated',
      cta: 'Veja detalhes atualizados',
    },
  });
  expect(frozen('brief_catalog_next').catalogSelection).toMatchObject({
    sourceCampaignRevision: 2,
    affiliateUrl: 'https://s.shopee.com.br/fixture_updated',
  });
  await service.registerProduct({
    idempotencyKey: 'product_revision_two',
    product: { ...r.product, revision: 2 },
  });
  expect(frozen('brief_no_current_offer').catalogSelection).toBeNull();
  await service.registerProduct({
    idempotencyKey: 'product_archive',
    product: { ...r.product, revision: 3, status: 'ARCHIVED' },
  });
  await service.registerCampaign({
    idempotencyKey: 'archived_offer',
    campaign: { ...r.campaign, revision: 3, productRevision: 3 },
  });
  const entry = (await service.catalogReadiness('project_001', 1)).items.find(
    (i) => i.product.productId === r.product.productId,
  )!;
  expect(entry.eligibility.technicalBlockers).toContain('PRODUCT_ARCHIVED');
  expect(frozen('brief_after_archive').catalogSelection).toBeNull();
  const restart = new AffiliateService(
      new SqliteAffiliatePersistence(f.database),
      projects,
      new ShopeeCatalogCommit(f.database),
    ),
    before = counts();
  expect(
    await restart.createCatalogBriefing(input, selection.briefingHash),
  ).toEqual(a);
  expect(await restart.getBriefing(a.briefingId)).toEqual(a);
  const restartedBinding = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  expect(restartedBinding.resolveRunBriefing('run_001')).toEqual(a);
  expect(await restart.resolveBriefingSource(a.briefingId)).toBeNull(); // Local feed is not official-API provenance.
  expect(counts()).toEqual(before);
  expect(a.contentHash).toBe(affiliateHash(a));
  expect(
    f.base.db
      .prepare('SELECT COUNT(*) n FROM affiliate_briefings WHERE briefing_id=?')
      .get(a.briefingId)?.n,
  ).toBe(1);
}, 15000);

test('briefing hash mismatch rolls back and an incompatible replay cannot replace the frozen product', async () => {
  await register();
  const selection = frozen('brief_catalog_hash').catalogSelection;
  const input = {
      briefingId: selection.briefingId,
      campaignId: selection.sourceCampaignId,
      campaignRevision: 1,
    },
    before = counts();
  await expect(
    service.createCatalogBriefing(input, 'b'.repeat(64)),
  ).rejects.toMatchObject({ code: 'AFFILIATE_HASH_MISMATCH' });
  expect(counts()).toEqual(before);
  const briefing = await service.createCatalogBriefing(
      input,
      selection.briefingHash,
    ),
    committed = counts();
  await expect(
    service.createCatalogBriefing(input, 'c'.repeat(64)),
  ).rejects.toMatchObject({ code: 'AFFILIATE_IDEMPOTENCY_CONFLICT' });
  expect(await service.getBriefing(input.briefingId)).toEqual(briefing);
  expect(counts()).toEqual(committed);
});

test('registered product with denied reusable rights remains outside technical rotation', async () => {
  const r = await register(),
    product = structuredClone(r.product);
  product.revision = 2;
  product.localImage.rights.commercialUseAllowed = false;
  for (const grant of [
    ...product.evidence,
    ...product.localImage.rights.evidence,
  ])
    if (grant.mediaAuthorization)
      grant.mediaAuthorization.commercialUse = 'DENIED';
  await service.registerProduct({
    idempotencyKey: 'rights_denied_revision',
    product,
  });
  await service.registerCampaign({
    idempotencyKey: 'rights_denied_offer',
    campaign: { ...r.campaign, revision: 2, productRevision: 2 },
  });
  const entry = (await service.catalogReadiness('project_001', 1)).items.find(
    (i) => i.product.productId === product.productId,
  )!;
  expect(entry.eligibility).toMatchObject({
    productValid: true,
    offerValid: true,
    reusableMediaRights: false,
    technicalEligibility: 'BLOCKED',
    associationVerified: false,
  });
  expect(entry.eligibility.technicalBlockers).toContain(
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  );
  expect(frozen('brief_denied_rights').catalogSelection).toBeNull();
});

test('read-only HTTP catalog reports technical eligibility and unverified external gates without registering or authorizing anything', async () => {
  const r = await register(),
    before = counts();
  const module = await Test.createTestingModule({
      controllers: [AffiliateController],
      providers: [{ provide: AffiliateService, useValue: service }],
    }).compile(),
    app = module.createNestApplication();
  try {
    await app.init();
    const response = await request(app.getHttpServer())
      .get('/affiliate/projects/project_001/catalog?projectVersion=1')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(
      response.body.items.find(
        (i: any) => i.product.productId === r.product.productId,
      ).eligibility,
    ).toMatchObject({
      technicalEligibility: 'ELIGIBLE',
      liveAuthorized: false,
      publicationAuthorized: false,
    });
    await request(app.getHttpServer())
      .get('/affiliate/projects/project_001/catalog?projectVersion=0')
      .expect(400);
    await request(app.getHttpServer())
      .get('/affiliate/projects/project_001/catalog?projectVersion=999')
      .expect(404);
    await request(app.getHttpServer())
      .get('/affiliate/projects/project_missing/catalog')
      .expect(404);
    expect(counts()).toEqual(before);
  } finally {
    await app.close();
  }
});
