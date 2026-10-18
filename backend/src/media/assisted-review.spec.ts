import { Script, createContext } from 'node:vm';
import { operationsScript } from '../operations/operations-page.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '../../test/support/temporal-qc-fixture.js';
import { MediaService } from './application/media.service.js';
import { MediaPersistence } from './infrastructure/media.persistence.js';
import { OfflineTemporalValidator } from './infrastructure/offline-temporal.validator.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { SqliteAffiliateRunContextRepository } from '../affiliate/infrastructure/sqlite-affiliate-run-context.repository.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { SqliteOperationsRepository } from '../content-operations/infrastructure/sqlite-operations.repository.js';
import {
  operationalQcIdentity,
  provisionQcReviewer,
} from '../publishing/application/local-qc-identity.js';

// Isolated contract tests use real per-test credentials and real local test media.
// Their decisions are not evidence of an operator reviewing a commercial product.
let f: ReturnType<typeof fixture>,
  root: string,
  media: MediaService,
  asset: any,
  reference: any,
  automatic: any,
  principal: unknown,
  input: any;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'assisted-qc-'));
  const binary = (name: string) =>
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  const ffmpegPath = binary('ffmpeg'),
    ffprobePath = binary('ffprobe');
  const mediaRoot = join(root, 'media'),
    evidenceRoot = join(root, 'evidence');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', mediaRoot);
  vi.stubEnv('LOCAL_MEDIA_EVIDENCE_ROOT', evidenceRoot);
  vi.stubEnv('QC_IDENTITIES_FILE', join(root, 'identities.json'));
  const credentialFile = join(root, 'credential');
  await provisionQcReviewer(
    process.env.QC_IDENTITIES_FILE!,
    'reviewer_integration',
    credentialFile,
  );
  principal = await operationalQcIdentity.authenticate(
    'Bearer ' + (await readFile(credentialFile, 'utf8')),
    '127.0.0.1',
  );
  const video = join(root, 'subject.mp4'),
    png = join(root, 'reference.png');
  await runProcess(
    ffmpegPath,
    [
      '-v',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=64x64:r=8:d=6',
      '-an',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      video,
    ],
    { timeoutMs: 15000, maxLogBytes: 8192 },
  );
  await runProcess(
    ffmpegPath,
    ['-v', 'error', '-nostdin', '-i', video, '-frames:v', '1', png],
    { timeoutMs: 15000, maxLogBytes: 8192 },
  );
  const storage = new LocalEvidenceStorage(mediaRoot),
    hash = storage.put(await readFile(video), 'mp4'),
    refHash = storage.put(await readFile(png), 'png');
  f = fixture(
    true,
    ({ database, projectId, pipelineRunId }) => {
      const catalog = new SqliteAffiliateRepository(database);
      const product = {
        schemaVersion: 'affiliate-product/1.0.0',
        productId: 'campaign_product',
        revision: 1,
        name: 'Isolated test product',
        brand: 'Test',
        attributes: [
          { name: 'shape', value: 'Test pattern', evidenceRef: 'spec' },
        ],
        media: [{ mediaRef: 'test-reference', evidenceRef: 'rights' }],
        evidence: [
          {
            id: 'spec',
            kind: 'PRODUCT_SPECIFICATION',
            sourceRef: 'fixture:spec',
            recordedAt: '2026-10-17T00:00:00Z',
          },
          {
            id: 'rights',
            kind: 'MEDIA_USAGE_RIGHT',
            sourceRef: 'fixture:rights',
            recordedAt: '2026-10-17T00:00:00Z',
          },
        ],
      };
      try {
        catalog.registerProduct(product, 'seed_product');
        catalog.registerCampaign(
          {
            schemaVersion: 'affiliate-campaign/1.0.0',
            campaignId: 'campaign_rights_test',
            revision: 1,
            projectId,
            productId: product.productId,
            productRevision: 1,
            affiliateUrl: 'https://example.com/test-product',
            cta: 'Contract test',
            disclosure: 'Isolated fixture',
          },
          'seed_campaign',
          true,
        );
        const briefing = catalog.createBriefing(
          {
            briefingId: 'campaign_seed_briefing',
            campaignId: 'campaign_rights_test',
            campaignRevision: 1,
          },
          'seed_briefing',
          true,
        );
        const bindings = new SqliteAffiliateRunContextRepository(database);
        try {
          bindings.insertRunBinding({
            pipelineRunId,
            briefingId: briefing.briefingId,
            briefingHash: briefing.contentHash,
            campaignId: briefing.campaignId,
            campaignRevision: 1,
            productId: product.productId,
            productRevision: 1,
          });
        } finally {
          bindings.close();
        }
      } finally {
        catalog.close();
      }
    },
    {
      operationId: 'campaign_review_operation',
      contentHash: hash,
      width: 64,
      height: 64,
    },
  );

  const rights = (contentHash: string, externalProviders = ['fal_ai']) => ({
    usageBasis: 'OWNED',
    commercialUseAllowed: true,
    evidence: [
      {
        id: 'owned_fixture_right',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:locally-generated',
        recordedAt: '2026-10-17T00:00:00Z',
        mediaAuthorization: {
          mediaRef: 'media:sha256_' + contentHash,
          contentHash,
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders,
        },
      },
    ],
  });
  media = new MediaService(
    new MediaPersistence(
      f.path,
      { get: (id) => f.repository.getRun(id)! },
      { getScript: () => f.script as any },
      null,
      new OfflineTemporalValidator({
        ffmpegPath,
        ffprobePath,
        mediaRoot,
        evidenceRoot,
      }),
    ),
  );
  asset = media.register({
    ...f.assets[1],
    mediaAssetId: 'review_video',
    contentHash: hash,
    mediaReference: 'media:sha256_' + hash,
    rights: rights(hash),
    revision: 2,
    supersedesMediaAssetId: f.assets[1].mediaAssetId,
    technicalProperties: {
      format: 'mp4',
      widthPixels: 64,
      heightPixels: 64,
      durationMilliseconds: 6000,
    },
  });
  reference = media.register({
    ...f.assets[0],
    mediaAssetId: 'review_reference',
    contentHash: refHash,
    mediaReference: 'media:sha256_' + refHash,
    rights: rights(refHash),
    revision: 2,
    supersedesMediaAssetId: f.assets[0].mediaAssetId,
    technicalProperties: {
      format: 'png',
      widthPixels: 64,
      heightPixels: 64,
      durationMilliseconds: null,
    },
  });
  automatic = await media.evaluateTemporalMedia(asset.mediaAssetId);
  const criterion = {
    startSeconds: 0,
    endSeconds: 6,
    observation:
      'Contract test attestation on the exact isolated technical fixture.',
  };
  input = {
    schemaVersion: 'human-temporal-review-request/1.0.0',
    mediaAssetId: asset.mediaAssetId,
    mediaContentHash: hash,
    mediaRevision: asset.revision,
    automaticReportHash: automatic.contentHash,
    referenceImage: {
      mediaAssetId: reference.mediaAssetId,
      contentHash: refHash,
      revision: reference.revision,
    },
    decision: 'APPROVED',
    criteria: { motion: criterion, continuity: criterion, fidelity: criterion },
  };
}, 30000);
afterEach(async () => {
  f?.close();
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function campaignReview(change: Record<string, unknown> = {}) {
  const campaignId = 'campaign_rights_test',
    operationScope = 'campaign_review_operation';
  const scopedRights = (candidate: any, id: string) => {
    const rights = structuredClone(candidate.rights);
    rights.evidence[0].id = id;
    Object.assign(rights.evidence[0].mediaAuthorization, {
      campaignId,
      operationScope,
      purpose: 'HUMAN_QC_REVIEW',
      ...change,
    });
    return rights;
  };
  const videoRights = scopedRights(asset, 'campaign_video_right');
  const referenceRights = scopedRights(reference, 'campaign_reference_right');
  const catalog = new AffiliateService(new SqliteAffiliatePersistence(f.path), {
    get: async (id: string) => {
      const r = new SqliteOperationsRepository(f.path);
      try {
        return r.get(id);
      } finally {
        r.close();
      }
    },
  });
  const product = {
    schemaVersion: 'affiliate-product/1.0.0',
    productId: 'campaign_product',
    revision: 2,
    name: 'Contract test product',
    brand: 'Test',
    attributes: [{ name: 'shape', value: 'Test pattern', evidenceRef: 'spec' }],
    media: [
      {
        mediaRef: reference.mediaReference,
        evidenceRef: 'campaign_reference_right',
      },
    ],
    evidence: [
      {
        id: 'spec',
        kind: 'PRODUCT_SPECIFICATION',
        sourceRef: 'fixture:spec',
        recordedAt: '2026-10-17T00:00:00Z',
      },
      ...videoRights.evidence,
      ...referenceRights.evidence,
    ],
  };
  expect(
    await catalog.registerProduct({
      idempotencyKey: 'scoped_product',
      product,
    }),
  ).toEqual(
    await catalog.registerProduct({
      idempotencyKey: 'scoped_product',
      product,
    }),
  );
  await catalog.registerCampaign({
    idempotencyKey: 'scoped_campaign',
    campaign: {
      schemaVersion: 'affiliate-campaign/1.0.0',
      campaignId,
      revision: 2,
      projectId: f.script.projectId,
      productId: product.productId,
      productRevision: 2,
      affiliateUrl: 'https://example.com/test-product',
      cta: 'Contract test',
      disclosure: 'Isolated fixture',
    },
  });
  await catalog.createBriefing({
    idempotencyKey: 'scoped_briefing',
    briefingId: 'campaign_review_briefing',
    campaignId,
    campaignRevision: 2,
  });
  asset = media.register({
    ...asset,
    mediaAssetId: 'campaign_review_video',
    rights: videoRights,
    revision: 3,
    supersedesMediaAssetId: asset.mediaAssetId,
  });
  reference = media.register({
    ...reference,
    mediaAssetId: 'campaign_reference',
    rights: referenceRights,
    revision: 3,
    supersedesMediaAssetId: reference.mediaAssetId,
  });
  automatic = await media.evaluateTemporalMedia(asset.mediaAssetId);
  input = {
    ...input,
    mediaAssetId: asset.mediaAssetId,
    mediaRevision: asset.revision,
    automaticReportHash: automatic.contentHash,
    referenceImage: {
      mediaAssetId: reference.mediaAssetId,
      contentHash: reference.contentHash,
      revision: reference.revision,
    },
  };
  return { campaignId, operationScope, catalog, product };
}

it('accepts campaign rights through AffiliateService and binds concurrent review replay to authoritative scope', async () => {
  const scope = await campaignReview();
  expect(
    (await scope.catalog.getProduct('campaign_product', 1))!.evidence.every(
      (e) => e.mediaAuthorization?.campaignId === undefined,
    ),
  ).toBe(true);
  await expect(
    media.reviewTemporalMedia(
      asset.mediaAssetId,
      { ...input, campaignId: 'client_selected_campaign' },
      principal,
    ),
  ).rejects.toThrow('HUMAN_APPROVAL_REVIEW_INVALID');
  const [a, b] = (await Promise.all([
    media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
    media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
  ])) as any[];
  expect(a).toEqual(b);
  expect(a.evidence.provenance.parameters.humanReview.rightsScope).toEqual({
    campaignId: scope.campaignId,
    operationScope: scope.operationScope,
    purpose: 'HUMAN_QC_REVIEW',
  });
  expect(await media.evaluateTemporalMedia(asset.mediaAssetId)).toEqual(a);
  const denial = structuredClone(reference.rights);
  denial.evidence[0].mediaAuthorization.processing = 'DENIED';
  media.register({
    ...reference,
    mediaAssetId: 'revoked_campaign_reference',
    rights: denial,
    revision: 4,
    supersedesMediaAssetId: reference.mediaAssetId,
  });
  await expect(media.evaluateTemporalMedia(asset.mediaAssetId)).rejects.toThrow(
    'HUMAN_APPROVAL_REVIEW_STALE',
  );
});

it.each([
  { campaignId: 'another_campaign' },
  { operationScope: 'another_operation' },
  { processing: 'DENIED' },
  { commercialUse: 'DENIED' },
  { localProcessing: false },
  { externalProviders: [] },
])(
  'rejects mismatched or denied campaign authorization: %j',
  async (change) => {
    await campaignReview(change);
    await expect(
      media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
    ).rejects.toThrow();
    expect(
      ((await media.evaluateTemporalMedia(asset.mediaAssetId)) as any).result,
    ).toBe('NOT_VALIDATED');
  },
);
it('binds authorized review to automatic evidence and exact media, replays concurrently and unlocks V2 only afterward', async () => {
  const plan = structuredClone(f.value);
  plan.segments[0].mediaAssetId = reference.mediaAssetId;
  plan.segments[0].mediaAssetContentHash = reference.contentHash;
  plan.segments[1].mediaAssetId = asset.mediaAssetId;
  plan.segments[1].mediaAssetContentHash = asset.contentHash;
  plan.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
  plan.contentHash = compositionPlanContentHash(plan);
  expect(() => media.registerCompositionPlan(plan)).toThrow(
    'TEMPORAL_QC_REQUIRED',
  );
  const [a, b] = (await Promise.all([
    media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
    media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
  ])) as any[];
  expect(a).toEqual(b);
  expect(a.result).toBe('PASS');
  expect(a.evidence.provenance.parameters.humanReview.actor).toBe(
    'reviewer_integration',
  );
  expect(await media.evaluateTemporalMedia(asset.mediaAssetId)).toEqual(a);
  expect(media.registerCompositionPlan(plan)).toBeTruthy();
});
it('rejects missing authentication, client actor, wrong hash and stale revision', async () => {
  await expect(
    media.reviewTemporalMedia(asset.mediaAssetId, input, {
      id: 'reviewer_integration',
    }),
  ).rejects.toThrow();
  for (const patch of [
    { actor: 'forged_actor' },
    { mediaContentHash: 'a'.repeat(64) },
    { mediaRevision: 99 },
    { automaticReportHash: 'a'.repeat(64) },
  ])
    await expect(
      media.reviewTemporalMedia(
        asset.mediaAssetId,
        { ...input, ...patch },
        principal,
      ),
    ).rejects.toThrow();
  expect(
    ((await media.evaluateTemporalMedia(asset.mediaAssetId)) as any).result,
  ).toBe('NOT_VALIDATED');
});
it('records rejection and refuses conflicting reuse, credential revocation and altered files', async () => {
  const result = (await media.reviewTemporalMedia(
    asset.mediaAssetId,
    { ...input, decision: 'REJECTED' },
    principal,
  )) as any;
  expect(result.result).toBe('FAIL');
  await expect(
    media.reviewTemporalMedia(asset.mediaAssetId, input, principal),
  ).rejects.toThrow('HUMAN_APPROVAL_DECISION_CONFLICT');
  const config = JSON.parse(
    await readFile(process.env.QC_IDENTITIES_FILE!, 'utf8'),
  );
  config.identities[0].revoked = true;
  await writeFile(process.env.QC_IDENTITIES_FILE!, JSON.stringify(config));
  await expect(media.evaluateTemporalMedia(asset.mediaAssetId)).rejects.toThrow(
    'HUMAN_APPROVAL_REVIEW_INVALID',
  );
});

it('enforces real local credentials at HTTP boundaries and rejects actor forgery and repeated unauthenticated attempts', async () => {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { MediaController } = await import('./media.controller.js');
  const module = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [{ provide: MediaService, useValue: media }],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    const token = await readFile(join(root, 'credential'), 'utf8');
    await request(app.getHttpServer())
      .post('/media/assets/' + asset.mediaAssetId + '/temporal-analysis')
      .expect(401);
    await request(app.getHttpServer())
      .post('/media/assets/' + asset.mediaAssetId + '/temporal-reviews')
      .set('Authorization', 'Bearer ' + token)
      .send({ ...input, actor: 'client_actor' })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post('/media/assets/' + asset.mediaAssetId + '/temporal-analysis')
      .set('Authorization', 'Bearer ' + token)
      .expect(201);
    expect(response.body.result).toBe('NOT_VALIDATED');
    const reviewed = await request(app.getHttpServer())
      .post('/media/assets/' + asset.mediaAssetId + '/temporal-reviews')
      .set('Authorization', 'Bearer ' + token)
      .send(input)
      .expect(201);
    expect(reviewed.body.evidence.provenance.parameters.humanReview.actor).toBe(
      'reviewer_integration',
    );
    expect(reviewed.body.result).toBe('PASS');
    for (let i = 0; i < 4; i++)
      await request(app.getHttpServer())
        .post('/media/assets/' + asset.mediaAssetId + '/temporal-analysis')
        .expect(401);
    await request(app.getHttpServer())
      .post('/media/assets/' + asset.mediaAssetId + '/temporal-analysis')
      .set('Authorization', 'Bearer ' + token)
      .expect(429);
  } finally {
    await app.close();
  }
});
it('refuses a real static-video technical FAIL even for an authenticated reviewer', async () => {
  const binary = execFileSync(
    process.platform === 'win32' ? 'where.exe' : 'which',
    ['ffmpeg'],
    { encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split(/\r?\n/)[0];
  const path = join(root, 'static.mp4');
  await runProcess(
    binary,
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=blue:s=64x64:r=8:d=6',
      '-an',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'ultrafast',
      path,
    ],
    { timeoutMs: 15000, maxLogBytes: 8192 },
  );
  const hash = new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).put(
    await readFile(path),
    'mp4',
  );
  const rights = structuredClone(asset.rights);
  rights.evidence[0].mediaAuthorization.contentHash = hash;
  rights.evidence[0].mediaAuthorization.mediaRef = 'media:sha256_' + hash;
  const still = media.register({
    ...asset,
    mediaAssetId: 'static_review',
    revision: 3,
    supersedesMediaAssetId: asset.mediaAssetId,
    contentHash: hash,
    mediaReference: 'media:sha256_' + hash,
    rights,
  });
  const analysis: any = await media.evaluateTemporalMedia(still.mediaAssetId);
  expect(analysis.evidence.motion).toBe('FAIL');
  await expect(
    media.reviewTemporalMedia(
      still.mediaAssetId,
      {
        ...input,
        mediaAssetId: still.mediaAssetId,
        mediaContentHash: hash,
        mediaRevision: 3,
        automaticReportHash: analysis.contentHash,
      },
      principal,
    ),
  ).rejects.toThrow('HUMAN_APPROVAL_QC_FAILED');
});
it('does not interpret a public image or a generic commercial assertion as permission for external processing', async () => {
  const missing = media.register({
    ...reference,
    mediaAssetId: 'public_reference',
    revision: 3,
    supersedesMediaAssetId: reference.mediaAssetId,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
  });
  await expect(
    media.reviewTemporalMedia(
      asset.mediaAssetId,
      {
        ...input,
        referenceImage: {
          mediaAssetId: missing.mediaAssetId,
          contentHash: missing.contentHash,
          revision: missing.revision,
        },
      },
      principal,
    ),
  ).rejects.toThrow('MEDIA_PROCESSING_RIGHTS_REQUIRED');
});

it('invalidates a signed decision if the exact reference bytes change', async () => {
  await media.reviewTemporalMedia(asset.mediaAssetId, input, principal);
  await writeFile(
    new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).path(
      reference.contentHash,
      'png',
    ),
    'altered fixture bytes',
  );
  await expect(media.evaluateTemporalMedia(asset.mediaAssetId)).rejects.toThrow(
    'LOCAL_FILE_HASH_MISMATCH',
  );
});

it('rejects undecodable reference bytes even when their SHA-256 and declared rights match', async () => {
  const hash = new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).put(
    Buffer.from('not a PNG image'),
    'png',
  );
  const rights = structuredClone(reference.rights);
  rights.evidence[0].mediaAuthorization.contentHash = hash;
  rights.evidence[0].mediaAuthorization.mediaRef = 'media:sha256_' + hash;
  const invalid = media.register({
    ...reference,
    mediaAssetId: 'invalid_reference',
    revision: 3,
    supersedesMediaAssetId: reference.mediaAssetId,
    contentHash: hash,
    mediaReference: 'media:sha256_' + hash,
    rights,
  });
  await expect(
    media.reviewTemporalMedia(
      asset.mediaAssetId,
      {
        ...input,
        referenceImage: {
          mediaAssetId: invalid.mediaAssetId,
          contentHash: hash,
          revision: 3,
        },
      },
      principal,
    ),
  ).rejects.toThrow();
});

it.each(['APPROVED', 'REJECTED'])(
  'submits browser textarea observations through HTTP and reconsults persisted %s',
  async (decision) => {
    const { Test } = await import('@nestjs/testing');
    const { default: request } = await import('supertest');
    const { MediaController } = await import('./media.controller.js');
    const module = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: media }],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const token = await readFile(join(root, 'credential'), 'utf8');
      const url = '/media/assets/' + asset.mediaAssetId + '/temporal-reviews';
      const observation =
        '  Movimento observado.\nContinuidade verificada.\t  ';
      const raw = structuredClone(input);
      raw.decision = decision;
      for (const criterion of Object.values(raw.criteria) as any[])
        criterion.observation = observation;
      const rejected = await request(app.getHttpServer())
        .post(url)
        .set('Authorization', 'Bearer ' + token)
        .send(raw)
        .expect(400);
      expect(rejected.body).toMatchObject({
        code: 'HUMAN_APPROVAL_REQUEST_INVALID',
        field: 'observation',
      });
      const sandbox: any = {};
      const context = createContext(sandbox);
      const start = operationsScript.indexOf('  function buildReviewCriteria('),
        end = operationsScript.indexOf(
          '  $("review-form").addEventListener("submit"',
          start,
        );
      new Script(
        operationsScript.slice(start, end) +
          ';globalThis.build=buildReviewCriteria;',
      ).runInContext(context);
      raw.criteria = sandbox.build(
        { asset: { durationMilliseconds: 6000 } },
        new Map(
          ['motion', 'continuity', 'fidelity'].map((k) => [k, observation]),
        ),
      );
      const reviewed = await request(app.getHttpServer())
        .post(url)
        .set('Authorization', 'Bearer ' + token)
        .send(raw)
        .expect(201);
      expect(reviewed.body.result).toBe(
        decision === 'APPROVED' ? 'PASS' : 'FAIL',
      );
      const reconsulted = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', 'Bearer ' + token)
        .expect(200);
      expect(reconsulted.body).toEqual(reviewed.body);
      expect(
        reconsulted.body.evidence.provenance.parameters.humanReview.criteria
          .continuity,
      ).toEqual({
        startSeconds: 0,
        endSeconds: 6,
        observation: 'Movimento observado. Continuidade verificada.',
      });
    } finally {
      await app.close();
    }
  },
);
