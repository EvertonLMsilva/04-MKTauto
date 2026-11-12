import { Test, type TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../content-operations/infrastructure/sqlite-operations.repository.js';
import { CommercialImageReadinessService } from './application/commercial-image-readiness.service.js';
import type { CommercialImageReadinessInput } from './domain/commercial-image-readiness.js';
import type {
  AffiliateCampaign,
  AffiliateProduct,
} from './domain/affiliate-contracts.js';
import { SqliteAffiliateRepository } from './infrastructure/sqlite-affiliate.repository.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';

const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-12T12:00:00Z';
let directory: string, database: string, imagePath: string;
let product: AffiliateProduct,
  campaign: AffiliateCampaign,
  input: CommercialImageReadinessInput;
let module: TestingModule, service: CommercialImageReadinessService;
let open: ReturnType<
  typeof vi.fn<(readOnly?: boolean) => SqliteAffiliateRepository>
>;
function writer(work: (repo: SqliteAffiliateRepository) => void) {
  const repo = new SqliteAffiliateRepository(database);
  try {
    work(repo);
  } finally {
    repo.close();
  }
}
function source(mode: 'FAKE' | 'SHOPEE_LIVE') {
  // Synthetic contract provenance only; never observed through Shopee HTTP.
  writer((repo) =>
    repo.associateCampaignSource(
      {
        schemaVersion: 'affiliate-campaign-source/1.0.0',
        sourceId: 'source_017',
        revision: 1,
        source: 'SHOPEE_AFFILIATE_API',
        offer: {
          offerId: 'offer_117002',
          productId: '117002',
          shopId: '717003',
          provenance:
            mode === 'FAKE'
              ? {
                  source: 'FAKE',
                  fixtureVersion: 'shopee-affiliate-fake/1',
                  observedAt: null,
                }
              : { source: 'SHOPEE_LIVE', fixtureVersion: null, observedAt: at },
        },
        productId: product.productId,
        productRevision: 1,
        campaignId: campaign.campaignId,
        campaignRevision: 1,
        briefingId: null,
        affiliateUrl: campaign.affiliateUrl,
      },
      'source_fixture',
      [input.media.mediaRef],
    ),
  );
  input.source = { sourceId: 'source_017', revision: 1 };
}
beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('NETWORK_FORBIDDEN');
    }),
  );
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  directory = mkdtempSync(join(tmpdir(), 'mktauto-commercial-image-017-'));
  database = join(directory, 'disposable.sqlite');
  const db = new DatabaseSync(database);
  try {
    provisionSchema(db, 43);
  } finally {
    db.close();
  }
  const projects = new SqliteOperationsRepository(database);
  try {
    projects.create(
      {
        id: 'project_017',
        name: 'FICTITIOUS_TEST_ONLY',
        version: 1,
        niche: 'Tecnologia',
        subniches: ['Fones'],
        audience: { profile: 'Adultos', language: 'pt-BR' },
        references: [],
        channel: {
          publishing: {
            contentsPerDay: 1,
            networks: ['instagram'],
            timezone: 'America/Sao_Paulo',
            times: ['10:00'],
          },
        },
      },
      { createdAt: at },
    );
  } finally {
    projects.db.close();
  }
  const bytes = png(),
    hash = createHash('sha256').update(bytes).digest('hex'),
    mediaRef = 'media:product_017';
  const root = join(directory, 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', root);
  imagePath = join(root, 'sha256', hash.slice(0, 2), `${hash}.png`);
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, bytes);
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
    recordedAt: at,
  };
  const grant = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:licensed-physical-reference',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef,
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: ['openai', 'kairogen'],
    },
  };
  product = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: 'shopee_117002',
    revision: 1,
    name: 'FICTITIOUS_TEST_ONLY Product',
    brand: {
      status: 'KNOWN',
      name: 'FICTITIOUS_TEST_ONLY Brand',
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'color', value: 'blue', evidenceRef: spec.id }],
    media: [{ mediaRef, evidenceRef: grant.id }],
    evidence: [spec, structuredClone(grant)],
    localImage: {
      mediaReference: mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY',
      provider: null,
      rights: {
        usageBasis: 'LICENSED',
        commercialUseAllowed: true,
        evidence: [structuredClone(grant)],
      },
    },
  };
  campaign = {
    schemaVersion: 'affiliate-campaign/1.0.0',
    campaignId: 'campaign_017',
    revision: 1,
    projectId: 'project_017',
    productId: product.productId,
    productRevision: 1,
    affiliateUrl: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
    cta: 'Veja os detalhes.',
    disclosure: 'Publicidade. Posso receber comissão.',
  };
  writer((repo) => {
    repo.registerProduct(structuredClone(product), 'product_fixture');
    repo.registerCampaign(structuredClone(campaign), 'campaign_fixture', true);
  });
  input = {
    schemaVersion: 'commercial-image-readiness/1.0.0',
    product: { productId: product.productId, revision: 1 },
    campaign: { campaignId: campaign.campaignId, revision: 1 },
    source: null,
    media: { mediaRef, contentHash: hash },
    provider: 'openai',
    purpose: 'GENERATION_REFERENCE',
    evidenceRefs: ['ev_spec', 'ev_rights'],
  };
  const persistence = new SqliteAffiliatePersistence(database);
  open = vi.fn((readOnly) => {
    expect(readOnly).toBe(true);
    return persistence.open(readOnly);
  });
  module = await Test.createTestingModule({
    providers: [
      {
        provide: CommercialImageReadinessService,
        useFactory: () => new CommercialImageReadinessService({ open }),
      },
    ],
  }).compile();
  service = module.get(CommercialImageReadinessService);
});
afterEach(async () => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(process.env.SHOPEE_AFFILIATE_MODE).toBe('fake');
  } finally {
    await module?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test('Nest → existing read-only repository → physical PNG/hash → documentary assessment is deterministic and non-destructive', async () => {
  source('SHOPEE_LIVE');
  const before = readFileSync(database),
    imageBefore = readFileSync(imagePath);
  const one = await service.evaluate(input),
    two = await service.evaluate(input);
  expect(one).toEqual(two);
  expect(one.eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  expect(one.physicalImage).toMatchObject({
    status: 'VERIFIED',
    contentHash: input.media.contentHash,
    sizeBytes: imageBefore.length,
  });
  expect(one.binding.shopId).toBe('717003');
  expect(one.fidelity.originalImage?.mediaReference).toBe(input.media.mediaRef);
  expect(one.processingAuthorized).toBe(false);
  expect(one.publicationAuthorized).toBe(false);
  expect(one.visualReviewRequired).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(readFileSync(database)).toEqual(before);
  expect(readFileSync(imagePath)).toEqual(imageBefore);
});

test.each(['missing', 'corrupt'])(
  'rejects a %s physical image without downloading or writing one',
  async (kind) => {
    if (kind === 'missing') rmSync(imagePath);
    else writeFileSync(imagePath, 'FICTITIOUS_TEST_ONLY_CHANGED_BYTES');
    const before = readFileSync(database),
      result = await service.evaluate(input);
    expect(result.eligibility).toBe('BLOCKED');
    expect(result.blockers).toContain(
      kind === 'missing'
        ? 'LOCAL_IMAGE_UNAVAILABLE_OR_INVALID'
        : 'LOCAL_IMAGE_HASH_MISMATCH',
    );
    expect(readFileSync(database)).toEqual(before);
  },
);

test('detects superseded product and offer revisions using the existing contiguous revision rules', async () => {
  writer((repo) => {
    repo.registerProduct(
      { ...structuredClone(product), revision: 2 },
      'product_two',
    );
    repo.registerCampaign(
      { ...structuredClone(campaign), revision: 2, productRevision: 2 },
      'campaign_two',
      true,
    );
  });
  const result = await service.evaluate(input);
  expect(result.eligibility).toBe('BLOCKED');
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      'PRODUCT_REVISION_STALE',
      'CAMPAIGN_REVISION_STALE',
    ]),
  );
  expect(result.binding.productRevision).toBe(1);
  expect(result.binding.campaignRevision).toBe(1);
});

test('reads recorded FAKE provenance without promoting it to real commercial acceptance', async () => {
  source('FAKE');
  const result = await service.evaluate(input);
  expect(result.eligibility).toBe('FAKE_ONLY');
  expect(result.provenance?.source).toBe('FAKE');
  expect(result.externalRightsVerified).toBe(false);
  expect(result.publicationAuthorized).toBe(false);
});

test('a declaration without bound processing authorization does not become permission', async () => {
  const next = structuredClone(product);
  next.revision = 2;
  delete next.evidence.find((e) => e.kind === 'MEDIA_USAGE_RIGHT')!
    .mediaAuthorization;
  delete next.localImage!.rights.evidence![0].mediaAuthorization;
  writer((repo) => {
    repo.registerProduct(next, 'product_declaration');
    repo.registerCampaign(
      { ...structuredClone(campaign), revision: 2, productRevision: 2 },
      'campaign_declaration',
      true,
    );
  });
  const result = await service.evaluate({
    ...input,
    product: { ...input.product, revision: 2 },
    campaign: { campaignId: campaign.campaignId, revision: 2 },
  });
  expect(result.eligibility).toBe('BLOCKED');
  expect(result.rights.openaiProcessing).toBe('MISSING');
  expect(result.rights.commercialSourceUse).toBe('MISSING');
});

test('captures the request before asynchronous reads and closes a session even on a failed read', async () => {
  const pending = service.evaluate(input);
  input.provider = 'kairogen';
  expect((await pending).binding.provider).toBe('openai');
  const repo = new SqliteAffiliateRepository(database, { readOnly: true });
  const close = vi.spyOn(repo, 'close');
  vi.spyOn(repo, 'getProduct').mockImplementation(() => {
    throw new Error('FICTITIOUS_TEST_ONLY_READ_FAILURE');
  });
  const failing = new CommercialImageReadinessService({ open: () => repo });
  await expect(failing.evaluate(input)).rejects.toThrow(
    'FICTITIOUS_TEST_ONLY_READ_FAILURE',
  );
  expect(close).toHaveBeenCalledTimes(1);
});
