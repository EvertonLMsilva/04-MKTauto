import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { AffiliateController } from './affiliate.controller.js';
import { AffiliateService } from './application/affiliate.service.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { SqliteProjectRepository } from '../project/infrastructure/sqlite-project.repository.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import * as contracts from './domain/affiliate-contracts.js';
import * as catalog from './domain/affiliate-catalog.js';
import * as projects from '../project/domain/project-contracts.js';
import * as images from './infrastructure/qualification-image.reader.js';
const scriptUrl = new URL(
  '../../../scripts/ops-local/first-commercial-product.mjs',
  import.meta.url,
);
const { inspectFirstCommercialProduct, runFirstCommercialProduct } =
  await import(scriptUrl.href);
const runtime = { ...contracts, ...catalog, ...projects, ...images };
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
let directory: string,
  database: string,
  imagePath: string,
  app: INestApplication;
let candidate: any;
const at = '2026-11-12T12:00:00Z';
async function openApp() {
  const affiliate = new AffiliateService(
    new SqliteAffiliatePersistence(database),
    {
      get: async (id, version) => {
        const repo = new SqliteProjectRepository(database, { readOnly: true });
        try {
          return repo.get(id, version);
        } finally {
          repo.close();
        }
      },
    },
  );
  const module = await Test.createTestingModule({
    controllers: [AffiliateController],
    providers: [{ provide: AffiliateService, useValue: affiliate }],
  }).compile();
  app = module.createNestApplication();
  await app.init();
}
function counts() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return [
      'affiliate_product_revisions',
      'affiliate_campaign_revisions',
      'affiliate_briefings',
      'affiliate_commands',
    ].map((table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
  } finally {
    db.close();
  }
}
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    Error('EXTERNAL_NETWORK_FORBIDDEN'),
  );
  directory = mkdtempSync(join(tmpdir(), 'mktauto-c019-e2e-'));
  database = join(directory, 'fixture.sqlite');
  const db = new DatabaseSync(database);
  try {
    provisionSchema(db, 40);
  } finally {
    db.close();
  }
  const repo = new SqliteProjectRepository(database);
  let project;
  try {
    project = repo.create(
      {
        id: 'project_c019',
        version: 1,
        name: 'FICTITIOUS_TEST_ONLY',
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
    repo.close();
  }
  const bytes = png() as Buffer,
    hash = createHash('sha256').update(bytes).digest('hex'),
    mediaRef = 'media:c019_fixture';
  imagePath = join(
    directory,
    'media',
    'sha256',
    hash.slice(0, 2),
    hash + '.png',
  );
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, bytes);
  vi.stubEnv('FFMPEG_MEDIA_ROOT', join(directory, 'media'));
  const grant = {
    id: 'ev_image',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'FICTITIOUS_TEST_ONLY:owned-image',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef,
      contentHash: hash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: [],
    },
  };
  candidate = {
    dataOrigin: 'FICTITIOUS_TEST_ONLY',
    project,
    product: {
      schemaVersion: 'affiliate-product/2.0.0',
      productId: 'product_c019',
      revision: 1,
      name: 'FICTITIOUS_TEST_ONLY — fone sintético',
      brand: {
        status: 'KNOWN',
        name: 'Marca fictícia',
        evidenceRef: 'ev_spec',
      },
      attributes: [
        {
          name: 'descricao',
          value: 'Fone sintético exclusivo para teste',
          evidenceRef: 'ev_spec',
        },
        { name: 'cor', value: 'azul', evidenceRef: 'ev_spec' },
      ],
      media: [{ mediaRef, evidenceRef: grant.id }],
      evidence: [
        {
          id: 'ev_spec',
          kind: 'PRODUCT_SPECIFICATION',
          sourceRef: 'FICTITIOUS_TEST_ONLY:product-specification',
          recordedAt: at,
        },
        grant,
      ],
      localImage: {
        mediaReference: mediaRef,
        contentHash: hash,
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [grant],
        },
      },
    },
    campaign: {
      schemaVersion: 'affiliate-campaign/1.0.0',
      campaignId: 'campaign_c019',
      revision: 1,
      projectId: 'project_c019',
      productId: 'product_c019',
      productRevision: 1,
      affiliateUrl:
        'https://example.com/FICTITIOUS_TEST_ONLY?affiliate=fixture',
      cta: 'Confira os detalhes no link',
      disclosure: 'Publicidade | Link de afiliado',
    },
  };
  await openApp();
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
});

test('existing public HTTP contracts register exactly ONE fictional product and campaign, replay and survive restart', async () => {
  const original = structuredClone(candidate),
    bytes = readFileSync(imagePath),
    before = counts();
  const inspection = await inspectFirstCommercialProduct(candidate, runtime);
  expect(inspection).toMatchObject({
    technicalStatus: 'TECHNICAL_ONBOARDING_PASS',
    realProductStatus: 'FICTITIOUS_TEST_ONLY',
    realProductAuthorized: false,
    registrationAuthorized: false,
    physicalImage: {
      status: 'VERIFIED',
      contentHash: candidate.product.localImage.contentHash,
    },
    documentary: {
      imageRights: 'DOCUMENTED_NOT_EXTERNALLY_VERIFIED',
      affiliateLink: 'URL_PRESENT_ASSOCIATION_UNVERIFIED',
      affiliateAssociation: 'NOT_VERIFIED',
      projectPersistence: 'NOT_VERIFIED',
    },
  });
  expect(inspection.operationalBlockers).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(counts()).toEqual(before);
  const productCommand = {
      idempotencyKey: 'c019_product',
      product: candidate.product,
    },
    campaignCommand = {
      idempotencyKey: 'c019_campaign',
      campaign: candidate.campaign,
    };
  await request(app.getHttpServer())
    .post('/affiliate/products')
    .send(productCommand)
    .expect(201)
    .expect(candidate.product);
  await request(app.getHttpServer())
    .post('/affiliate/campaigns')
    .send(campaignCommand)
    .expect(201)
    .expect(candidate.campaign);
  await request(app.getHttpServer())
    .post('/affiliate/products')
    .send(productCommand)
    .expect(201);
  await request(app.getHttpServer())
    .post('/affiliate/campaigns')
    .send(campaignCommand)
    .expect(201);
  expect(counts()).toEqual([1, 1, 0, 2]);
  const catalogBefore = await request(app.getHttpServer())
    .get('/affiliate/projects/project_c019/catalog?projectVersion=1')
    .expect(200);
  expect(catalogBefore.body.items).toHaveLength(1);
  expect(catalogBefore.body.items[0].eligibility).toMatchObject({
    technicalEligibility: 'ELIGIBLE',
    associationVerified: false,
    commercialApprovalVerified: false,
    externalRightsVerified: false,
    liveAuthorized: false,
    publicationAuthorized: false,
    operationallyAuthorized: false,
  });
  await app.close();
  await openApp();
  await request(app.getHttpServer())
    .get('/affiliate/products/product_c019/revisions/1')
    .expect(200)
    .expect(candidate.product);
  await request(app.getHttpServer())
    .get('/affiliate/campaigns/campaign_c019/revisions/1')
    .expect(200)
    .expect(candidate.campaign);
  const after = await request(app.getHttpServer())
    .get('/affiliate/projects/project_c019/catalog?projectVersion=1')
    .expect(200);
  expect(after.body).toEqual(catalogBefore.body);
  expect(await inspectFirstCommercialProduct(candidate, runtime)).toEqual(
    inspection,
  );
  expect(counts()).toEqual([1, 1, 0, 2]);
  await request(app.getHttpServer())
    .post('/affiliate/products')
    .send({
      ...productCommand,
      product: { ...candidate.product, name: 'Changed' },
    })
    .expect(409);
  expect(counts()).toEqual([1, 1, 0, 2]);
  expect(candidate).toEqual(original);
  expect(readFileSync(imagePath)).toEqual(bytes);
});
test.each([
  'rights',
  'commercialPermission',
  'localPermission',
  'qcOnly',
  'physicalImage',
  'imageMetadata',
  'hash',
  'link',
  'project',
  'productRevision',
  'archived',
  'attributeEvidence',
  'brandEvidence',
])('dry-run blocks %s and never registers anything', async (kind) => {
  const input = structuredClone(candidate);
  if (kind === 'rights') {
    input.product.evidence = input.product.evidence.filter(
      (e: any) => e.kind !== 'MEDIA_USAGE_RIGHT',
    );
  }
  if (kind === 'commercialPermission')
    input.product.localImage.rights.commercialUseAllowed = false;
  if (kind === 'localPermission')
    for (const evidence of [
      input.product.evidence[1],
      input.product.localImage.rights.evidence[0],
    ])
      evidence.mediaAuthorization.localProcessing = false;
  if (kind === 'qcOnly')
    for (const evidence of [
      input.product.evidence[1],
      input.product.localImage.rights.evidence[0],
    ])
      evidence.mediaAuthorization.operationScope = 'qc_fixture';
  if (kind === 'physicalImage') rmSync(imagePath);
  if (kind === 'imageMetadata') delete input.product.localImage;
  if (kind === 'hash') writeFileSync(imagePath, 'CORRUPT_FICTITIOUS_TEST_ONLY');
  if (kind === 'link') input.campaign.affiliateUrl = null;
  if (kind === 'project') input.campaign.projectId = 'other_project';
  if (kind === 'productRevision') input.campaign.productRevision = 2;
  if (kind === 'archived') input.product.status = 'ARCHIVED';
  if (kind === 'attributeEvidence')
    input.product.attributes[0].evidenceRef = 'ev_missing';
  if (kind === 'brandEvidence') input.product.brand.evidenceRef = 'ev_missing';
  const before = counts(),
    report = await inspectFirstCommercialProduct(input, runtime);
  expect(report.technicalStatus).toBe('BLOCKED');
  expect(report.technicalBlockers.length).toBeGreaterThan(0);
  expect(report.realProductAuthorized).toBe(false);
  expect(counts()).toEqual(before);
  if (kind === 'rights')
    await request(app.getHttpServer())
      .post('/affiliate/products')
      .send({ idempotencyKey: 'blocked_product', product: input.product })
      .expect(400);
  if (kind === 'link')
    await request(app.getHttpServer())
      .post('/affiliate/campaigns')
      .send({ idempotencyKey: 'blocked_campaign', campaign: input.campaign })
      .expect(400);
  expect(counts()).toEqual(before);
});
test('operator-provided declaration never becomes real authorization, even with complete documentary and physical input', async () => {
  const input = { ...candidate, dataOrigin: 'OPERATOR_PROVIDED' },
    report = await inspectFirstCommercialProduct(input, runtime);
  expect(report.technicalStatus).toBe('TECHNICAL_ONBOARDING_PASS');
  expect(report.realProductStatus).toBe('OPERATOR_PROVIDED_UNVERIFIED');
  expect(report.realProductAuthorized).toBe(false);
  expect(report.documentary.externalRights).toBe('NOT_VERIFIED');
  expect(report.currentCommercialData).toEqual({
    price: 'UNKNOWN',
    stock: 'UNKNOWN',
    commission: 'UNKNOWN',
  });
  expect(counts()).toEqual([0, 0, 0, 0]);
});
test('explicit file dry-run is deterministic, sanitized and produces only the requested exclusive report', async () => {
  const input = join(directory, 'candidate.json'),
    output = join(directory, 'report.json');
  writeFileSync(input, JSON.stringify(candidate));
  const before = readFileSync(input),
    files = readdirSync(directory),
    report = await runFirstCommercialProduct(
      ['--dry-run', '--input', input, '--output', output],
      runtime,
    );
  expect(report.technicalStatus).toBe('TECHNICAL_ONBOARDING_PASS');
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(report);
  expect(readFileSync(input)).toEqual(before);
  const text = JSON.stringify(report);
  expect(text).not.toContain(candidate.campaign.affiliateUrl);
  expect(text).not.toContain(directory);
  expect(text).not.toContain('FICTITIOUS_TEST_ONLY:owned-image');
  expect(
    readdirSync(directory).filter((file) => !files.includes(file)),
  ).toEqual(['report.json']);
  expect(counts()).toEqual([0, 0, 0, 0]);
});
test.skipIf(process.env.MKTAUTO_C019_COMPILED_SMOKE !== '1')(
  'actual CLI loads existing compiled contracts and reads only the explicit fictitious candidate and image',
  () => {
    const input = join(directory, 'candidate.json'),
      output = join(directory, 'compiled-report.json'),
      forbidden = join(directory, 'forbidden.sqlite');
    writeFileSync(input, JSON.stringify(candidate));
    const before = counts(),
      files = readdirSync(directory);
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(scriptUrl),
        '--dry-run',
        '--input',
        input,
        '--output',
        output,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, PROJECT_API_DATABASE: forbidden },
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.technicalStatus).toBe('TECHNICAL_ONBOARDING_PASS');
    expect(report.realProductAuthorized).toBe(false);
    expect(report.databaseChanged).toBe(false);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(report);
    expect(counts()).toEqual(before);
    expect(
      readdirSync(directory).filter((file) => !files.includes(file)),
    ).toEqual(['compiled-report.json']);
  },
);
