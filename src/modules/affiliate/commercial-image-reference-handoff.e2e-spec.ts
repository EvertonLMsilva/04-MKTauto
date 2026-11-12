import { CommercialImageReferenceHandoffService } from './application/commercial-image-reference-handoff.service.js';
let handoff: CommercialImageReferenceHandoffService;
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
  directory = mkdtempSync(join(tmpdir(), 'mktauto-reference-handoff-018-'));
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
      externalProviders: ['openai'],
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
  handoff = new CommercialImageReferenceHandoffService(service);
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

const request = () => ({
  schemaVersion: 'commercial-image-reference-handoff/1.0.0' as const,
  reference: input,
});

test('Nest C-017, actual SQLite and PNG prepare an immutable handoff without writes, copies, URLs or uploads', async () => {
  source('SHOPEE_LIVE');
  const dbBefore = readFileSync(database),
    imageBefore = readFileSync(imagePath);
  const canonical = vi.spyOn(service, 'evaluate');
  const one = await handoff.prepare(request());
  const replay = await handoff.revalidate(
    one.revalidationRequest,
    one.preparationHash,
  );
  expect(replay).toEqual(one);
  expect(canonical).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledTimes(2);
  expect(one.status).toBe('PREPARED_DOCUMENTARY_ONLY');
  expect(one.reference.source).toMatchObject({
    status: 'DOCUMENTARILY_BOUND',
    shopId: '717003',
  });
  expect(one.physicalEvidence).toMatchObject({
    status: 'VERIFIED',
    contentHash: input.media.contentHash,
  });
  expect(JSON.stringify(one)).not.toContain('https://');
  expect(JSON.stringify(one)).not.toContain(directory);
  expect(JSON.stringify(one)).not.toContain('base64');
  expect(one.uploadAuthorized).toBe(false);
  expect(one.visualReviewRequired).toBe(true);
  expect(readFileSync(database)).toEqual(dbBefore);
  expect(readFileSync(imagePath)).toEqual(imageBefore);
});

test.each(['corrupt', 'missing'])(
  'fresh canonical validation refuses a %s image and detects conflict with the reviewed preparation',
  async (kind) => {
    const one = await handoff.prepare(request());
    if (kind === 'corrupt')
      writeFileSync(imagePath, 'FICTITIOUS_TEST_ONLY_CHANGED_BYTES');
    else rmSync(imagePath);
    await expect(
      handoff.revalidate(one.revalidationRequest, one.preparationHash),
    ).rejects.toThrow('COMMERCIAL_IMAGE_REFERENCE_CONFLICT');
    const blocked = await handoff.prepare(request());
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.uploadAuthorized).toBe(false);
    expect(blocked.blockers).toContain(
      kind === 'corrupt'
        ? 'LOCAL_IMAGE_HASH_MISMATCH'
        : 'LOCAL_IMAGE_UNAVAILABLE_OR_INVALID',
    );
  },
);

test('a newer product/offer revision invalidates the old package and revoked external rights remain blocked', async () => {
  const one = await handoff.prepare(request()),
    next = structuredClone(product);
  next.revision = 2;
  next.evidence.find(
    (e) => e.kind === 'MEDIA_USAGE_RIGHT',
  )!.mediaAuthorization!.externalProviders = [];
  next.localImage!.rights.evidence![0].mediaAuthorization!.externalProviders =
    [];
  writer((repo) => {
    repo.registerProduct(next, 'product_two');
    repo.registerCampaign(
      { ...structuredClone(campaign), revision: 2, productRevision: 2 },
      'campaign_two',
      true,
    );
  });
  await expect(
    handoff.revalidate(request(), one.preparationHash),
  ).rejects.toThrow('COMMERCIAL_IMAGE_REFERENCE_CONFLICT');
  expect((await handoff.prepare(request())).blockers).toContain(
    'PRODUCT_REVISION_STALE',
  );
  const updated = await handoff.prepare({
    ...request(),
    reference: {
      ...input,
      product: { productId: product.productId, revision: 2 },
      campaign: { campaignId: campaign.campaignId, revision: 2 },
    },
  });
  expect(updated.referenceHash).not.toBe(one.referenceHash);
  expect(updated.status).toBe('BLOCKED');
  expect(updated.rights.openaiProcessing).toBe('MISSING');
});

test('recorded FAKE provenance stays FAKE-only and never becomes real upload or generation permission', async () => {
  source('FAKE');
  const one = await handoff.prepare(request());
  expect(one.status).toBe('FAKE_ONLY');
  expect(one.reference.source.provenance?.source).toBe('FAKE');
  expect(one.uploadAuthorized).toBe(false);
  expect(one.generationAuthorized).toBe(false);
});

test('a source bound to another campaign remains blocked and its shop/offer are not exported as known', async () => {
  source('SHOPEE_LIVE');
  writer((repo) =>
    repo.registerCampaign(
      { ...structuredClone(campaign), campaignId: 'other_campaign' },
      'other_campaign',
      true,
    ),
  );
  const one = await handoff.prepare({
    ...request(),
    reference: {
      ...input,
      campaign: { campaignId: 'other_campaign', revision: 1 },
    },
  });
  expect(one.status).toBe('BLOCKED');
  expect(one.blockers).toContain('SOURCE_BINDING_MISMATCH');
  expect(one.reference.source).toMatchObject({
    status: 'UNKNOWN',
    offerId: null,
    shopId: null,
  });
});

test('OpenAI documentary permission does not grant Kairogen rights or either operational upload', async () => {
  const openai = await handoff.prepare(request());
  const kairogen = await handoff.prepare({
    ...request(),
    reference: { ...input, provider: 'kairogen', purpose: 'VIDEO_REFERENCE' },
  });
  expect(openai.status).toBe('PREPARED_DOCUMENTARY_ONLY');
  expect(kairogen.status).toBe('BLOCKED');
  expect(kairogen.rights.openaiProcessing).toBe('DOCUMENTED');
  expect(kairogen.rights.kairogenProcessing).toBe('MISSING');
  expect(kairogen.referenceHash).not.toBe(openai.referenceHash);
  expect(openai.uploadAuthorized).toBe(false);
  expect(kairogen.uploadAuthorized).toBe(false);
});
