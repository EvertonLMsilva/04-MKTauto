import { operationalQcSessions } from '../publishing/application/local-qc-session.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CampaignController } from './campaign.controller.js';
import { LocalQcGuard } from '../publishing/application/local-qc.guard.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { prepareOneShotMedia } from './domain/one-shot-media-binding.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { LocalFlowRuntime } from '../media/infrastructure/local-flow.runtime.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { LocalEvidenceStorage } from '../media/infrastructure/local-evidence-storage.js';
import { validateMediaAsset } from '../media/domain/media-asset-contracts.js';
import { eligibleCatalogCandidate } from '../affiliate/domain/affiliate-catalog.js';
import {
  operationalQcIdentity,
  provisionQcReviewer,
} from '../publishing/application/local-qc-identity.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
let db: DatabaseSync, repo: CampaignRepository, root: string, path: string;
const at = '2026-11-13T12:00:00Z';
function seed(
  run = 'run_one',
  campaign = 'campaign_one',
  day = at,
  catalog = false,
) {
  const hash = new LocalEvidenceStorage(root).put(png(), 'png');
  const source: any = {
    contentHash: hash,
    mediaReference: `media:sha256_${hash}`,
    origin: 'PROVIDER_GENERATED',
    provider: 'synthetic_provider',
    rights: {
      usageBasis: 'PROVIDER_TERMS',
      commercialUseAllowed: true,
      evidence: [
        {
          id: 'ev_one',
          kind: 'MEDIA_USAGE_RIGHT',
          sourceRef: 'fixture:one_shot',
          recordedAt: at,
          mediaAuthorization: {
            mediaRef: `media:sha256_${hash}`,
            contentHash: hash,
            commercialUse: 'GRANTED',
            processing: 'GRANTED',
            localProcessing: true,
            externalProviders: [],
            operationScope: 'synthetic_first_pilot',
          },
        },
      ],
    },
  };
  const r = {
    campaignId: campaign,
    campaignRevision: 1,
    runId: run,
    scheduledAt: day,
    briefingId: 'brief_' + run,
    selectionMode: catalog ? 'CATALOG' : 'FIXED',
    localImage: source,
  };
  const e = repo.schedule(
    { campaignId: campaign, campaignRevision: 1, runId: run, scheduledAt: day },
    r,
    at,
  );
  const brief: any = {
    briefingId: r.briefingId,
    contentHash: 'a'.repeat(64),
    campaignId: campaign,
    campaignRevision: 1,
    productId: 'product_one',
    productRevision: 1,
    mediaRefs: [source.mediaReference],
  };
  db.prepare(
    'INSERT OR IGNORE INTO affiliate_campaign_revisions VALUES(?,?,?,?,?,?,?)',
  ).run(campaign, 1, 'project_one', 'product_one', 1, 'a'.repeat(64), '{}');
  db.prepare('INSERT INTO affiliate_briefings VALUES(?,?,?,?,?)').run(
    brief.briefingId,
    campaign,
    1,
    brief.contentHash,
    JSON.stringify(brief),
  );
  db.prepare(
    "INSERT INTO pipeline_runs(pipeline_run_id,schema_version,identity_hash,project_id,project_version,project_snapshot_json,state,started_at) VALUES(?,?,?,?,?,?,'RUNNING',?)",
  ).run(
    run,
    'pipeline-handoff/1.0.0',
    'a'.repeat(64),
    'project_one',
    1,
    '{}',
    at,
  );
  db.prepare('INSERT INTO affiliate_run_bindings VALUES(?,?,?,?,?,?,?)').run(
    run,
    brief.briefingId,
    brief.contentHash,
    campaign,
    1,
    'product_one',
    1,
  );
  const prepared = prepareOneShotMedia(
    {
      executionId: e.execution_id,
      pipelineRunId: run,
      campaignId: campaign,
      campaignRevision: 1,
      productId: 'product_one',
      productRevision: 1,
      briefingId: brief.briefingId,
      briefingHash: brief.contentHash,
      mediaReference: source.mediaReference,
      imageContentHash: source.contentHash,
    },
    source,
  );
  return { source, r, e, brief, prepared };
}
const decision = (p: any) => ({
  authorizationId: 'test_human_act',
  scopeHash: p.scopeHash,
  acceptsProcessing: true as const,
  sourceRef: 'fixture:human_decision',
  statement: 'TEST ONLY exact one-shot processing decision',
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'one-shot-binding-'));
  path = join(root, 'test.sqlite');
  db = new DatabaseSync(path);
  provisionSchema(db, 44);
  db.exec('PRAGMA foreign_keys=OFF');
  repo = new CampaignRepository(db);
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});
test('exclusive bind, replay and database reopen retain the same event and scope', () => {
  const f = seed();
  const first = repo.oneShotMedia.bind(
    f.prepared,
    decision(f.prepared),
    'test_reviewer',
    at,
  );
  expect(
    repo.oneShotMedia.bind(
      f.prepared,
      decision(f.prepared),
      'test_reviewer',
      at,
    ),
  ).toEqual(first);
  db.close();
  db = new DatabaseSync(path);
  repo = new CampaignRepository(db);
  expect(repo.oneShotMedia.get(f.e.execution_id)).toEqual(first);
  expect(
    repo
      .history(f.e.execution_id)
      .filter((e) => e.event_type === 'ONE_SHOT_MEDIA_BOUND'),
  ).toHaveLength(1);
  expect(
    repo
      .history(f.e.execution_id)
      .some((e) =>
        /APPROVAL|COMPOSITION|FINANCE|PUBLICATION/.test(e.event_type),
      ),
  ).toBe(false);
});
test.each([
  'pipelineRunId',
  'executionId',
  'campaignId',
  'productId',
  'briefingId',
  'campaignRevision',
  'productRevision',
  'briefingHash',
  'mediaReference',
  'imageContentHash',
])('changed %s conflicts', (field) => {
  const f = seed();
  const bad = structuredClone(f.prepared) as any;
  bad.identity[field] =
    typeof bad.identity[field] === 'number' ? 2 : 'different_identity';
  expect(() =>
    repo.oneShotMedia.bind(bad, decision(bad), 'test_reviewer', at),
  ).toThrow();
});
test('another run/execution/campaign cannot consume the declaration again', () => {
  const first = seed();
  repo.oneShotMedia.bind(
    first.prepared,
    decision(first.prepared),
    'test_reviewer',
    at,
  );
  for (const [run, camp, day] of [
    ['run_two', 'campaign_one', '2026-11-14T12:00:00Z'],
    ['run_three', 'campaign_two', at],
  ]) {
    const next = seed(run, camp, day);
    expect(() =>
      repo.oneShotMedia.bind(
        next.prepared,
        { ...decision(next.prepared), authorizationId: run },
        'test_reviewer',
        at,
      ),
    ).toThrow('ONE_SHOT_MEDIA_ALREADY_BOUND');
  }
});
test('a human decision must accept the exact prepared scope', () => {
  const f = seed();
  expect(() =>
    repo.oneShotMedia.bind(
      f.prepared,
      { ...decision(f.prepared), acceptsProcessing: false } as any,
      'test_reviewer',
      at,
    ),
  ).toThrow('ONE_SHOT_MEDIA_HUMAN_AUTHORIZATION_REQUIRED');
  expect(() =>
    repo.oneShotMedia.bind(
      f.prepared,
      { ...decision(f.prepared), scopeHash: 'a'.repeat(64) },
      'test_reviewer',
      at,
    ),
  ).toThrow('ONE_SHOT_MEDIA_HUMAN_AUTHORIZATION_REQUIRED');
});
test('unpersisted identity, changed replay, denied processing, recurring requests are blocked', () => {
  const f = seed();
  expect(() =>
    repo.oneShotMedia.bind(
      {
        ...f.prepared,
        identity: { ...f.prepared.identity, executionId: 'not_registered' },
      },
      decision(f.prepared),
      'test_reviewer',
      at,
    ),
  ).toThrow();
  repo.oneShotMedia.bind(f.prepared, decision(f.prepared), 'test_reviewer', at);
  expect(() =>
    repo.oneShotMedia.bind(
      f.prepared,
      { ...decision(f.prepared), statement: 'A different human decision' },
      'test_reviewer',
      at,
    ),
  ).toThrow('ONE_SHOT_MEDIA_BINDING_CONFLICT');
  const denied = structuredClone(f.source);
  denied.rights.evidence[0].mediaAuthorization.processing = 'DENIED';
  expect(() => prepareOneShotMedia(f.prepared.identity, denied)).toThrow();
  const recurring = seed('run_rec', 'campaign_rec', at, true);
  expect(() =>
    repo.oneShotMedia.bind(
      recurring.prepared,
      decision(recurring.prepared),
      'test_reviewer',
      at,
    ),
  ).toThrow('ONE_SHOT_MEDIA_NATIVE_CONTEXT_REQUIRED');
});
test('authenticated administrative decision enables native physical image; no decision/forged token cannot', async () => {
  const f = seed();
  const script = {
    scriptId: 'script_one',
    pipelineRunId: f.e.run_id,
    projectId: 'project_one',
    projectVersion: 1,
    contentHash: 'b'.repeat(64),
    visualDirections: [{ position: 1 }],
  };
  const runtime = new LocalFlowRuntime(
    () => ({ getScript: () => script, close() {} }) as any,
    { register: validateMediaAsset } as any,
    { FFMPEG_MEDIA_ROOT: root },
  );
  const local = new LocalFlowService(runtime);
  const workflow = new NativeCampaignWorkflow(
    {} as any,
    {
      resolveRunBriefing: () => f.brief,
      getRunBinding: () => ({ briefingHash: f.brief.contentHash }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    local,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const admin = new CampaignAdministration(path, workflow, false, () => at);
  expect(() =>
    admin.authorizeOneShotMediaBinding(f.e.execution_id, decision(f.prepared), {
      id: 'test_reviewer',
    }),
  ).toThrow();
  expect(() => (workflow as any).prepareImage(f.e, f.r, script)).toThrow(
    'ONE_SHOT_MEDIA_BINDING_REQUIRED',
  );
  const credentials = join(root, 'credential');
  vi.stubEnv('QC_IDENTITIES_FILE', join(root, 'identities.json'));
  await provisionQcReviewer(
    process.env.QC_IDENTITIES_FILE!,
    'test_reviewer',
    credentials,
  );
  const principal = await operationalQcIdentity.authenticate(
    'Bearer ' + readFileSync(credentials, 'utf8'),
    '127.0.0.1',
  );
  const prepared = admin.prepareOneShotMediaBinding(f.e.execution_id);
  expect(prepared).toEqual(f.prepared);
  admin.authorizeOneShotMediaBinding(
    f.e.execution_id,
    decision(prepared),
    principal,
  );
  const image = (workflow as any).prepareImage(f.e, f.r, script);
  expect(image.contentHash).toBe(f.source.contentHash);
  expect(image.origin).toBe('PROVIDER_GENERATED');
  expect((workflow as any).prepareImage(f.e, f.r, script)).toEqual(image);
  expect(() =>
    runtime.prepareImage(
      {
        pipelineRunId: f.e.run_id,
        scriptId: script.scriptId,
        scriptContentHash: script.contentHash,
        createdAt: at,
        processingAuthorization: { kind: 'VERIFIED_LOCAL_PROCESSING' },
      },
      prepared.boundSource,
    ),
  ).toThrow('ONE_SHOT_MEDIA_BINDING_REQUIRED');
  const product: any = {
    schemaVersion: 'affiliate-product/1.0.0',
    productId: 'product_one',
    revision: 1,
    name: 'Synthetic product',
    brand: 'Synthetic',
    attributes: [],
    media: [{ mediaRef: f.source.mediaReference, evidenceRef: 'ev_one' }],
    evidence: f.source.rights.evidence,
    localImage: f.source,
  };
  expect(
    eligibleCatalogCandidate({
      product,
      campaign: {
        schemaVersion: 'affiliate-campaign/1.0.0',
        campaignId: 'campaign_one',
        revision: 1,
        projectId: 'project_one',
        productId: 'product_one',
        productRevision: 1,
        affiliateUrl: 'https://example.com/product',
        cta: 'See product details',
        disclosure: 'Affiliate advertisement',
      },
    }),
  ).toBe(false);
  await admin.onModuleDestroy();
  const restarted = new CampaignAdministration(path, workflow, false, () => at);
  expect(
    restarted.authorizeOneShotMediaBinding(
      f.e.execution_id,
      decision(prepared),
      principal,
    ).scopeHash,
  ).toBe(prepared.scopeHash);
  expect((workflow as any).prepareImage(f.e, f.r, script)).toEqual(image);
  await restarted.onModuleDestroy();
});

async function bindingHttpFixture() {
  const f = seed();
  const workflow = new NativeCampaignWorkflow(
    {} as any,
    {
      resolveRunBriefing: (run: string) => {
        const row = db
          .prepare(
            'SELECT b.content_json FROM affiliate_briefings b JOIN affiliate_run_bindings r ON r.briefing_id=b.briefing_id WHERE r.pipeline_run_id=?',
          )
          .get(run);
        return row ? JSON.parse(String(row.content_json)) : null;
      },
      getRunBinding: (run: string) => {
        const row = db
          .prepare(
            'SELECT briefing_hash FROM affiliate_run_bindings WHERE pipeline_run_id=?',
          )
          .get(run);
        return row ? { briefingHash: row.briefing_hash } : null;
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const admin = new CampaignAdministration(path, workflow, false, () => at);
  const module = await Test.createTestingModule({
    controllers: [CampaignController],
    providers: [
      LocalQcGuard,
      { provide: CampaignAdministration, useValue: admin },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  vi.stubEnv('QC_IDENTITIES_FILE', join(root, 'http-identities.json'));
  const credentialPath = join(root, 'http-credential');
  await provisionQcReviewer(
    process.env.QC_IDENTITIES_FILE!,
    'http_test_reviewer',
    credentialPath,
  );
  return {
    f,
    app,
    token: 'Bearer ' + readFileSync(credentialPath, 'utf8'),
    endpoint:
      '/content-operations/campaign-executions/' +
      f.e.execution_id +
      '/one-shot-media-binding',
  };
}
test('one-shot HTTP endpoints reject anonymous requests and forged body identities without writes', async () => {
  const { f, app, endpoint } = await bindingHttpFixture();
  try {
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .send({
        ...decision(f.prepared),
        principal: { id: 'http_test_reviewer' },
      })
      .expect(401);
    expect(repo.oneShotMedia.get(f.e.execution_id)).toBeNull();
  } finally {
    await app.close();
  }
});
test('one-shot HTTP preview is authenticated, exact and read-only; malformed decisions fail closed', async () => {
  const { f, app, token, endpoint } = await bindingHttpFixture();
  try {
    const first = await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', token)
      .expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toEqual(f.prepared);
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', token)
      .expect(200, first.body);
    for (const input of [
      { ...decision(f.prepared), acceptsProcessing: false },
      { ...decision(f.prepared), scopeHash: 'a'.repeat(64) },
      { ...decision(f.prepared), actor: 'forged_actor' },
    ]) {
      await request(app.getHttpServer())
        .post(endpoint + '/authorizations')
        .set('Authorization', token)
        .send(input)
        .expect(400);
    }
    expect(repo.oneShotMedia.get(f.e.execution_id)).toBeNull();
  } finally {
    await app.close();
  }
});
test('one-shot HTTP authorization records server principal, replays and rejects cross-execution reuse with409', async () => {
  const { f, app, token, endpoint } = await bindingHttpFixture();
  try {
    const body = decision(f.prepared);
    const first = await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .set('Authorization', token)
      .send(body)
      .expect(201);
    expect(first.body.actorId).toBe('http_test_reviewer');
    expect(first.body.scopeHash).toBe(f.prepared.scopeHash);
    await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .set('Authorization', token)
      .send(body)
      .expect(201, first.body);
    const next = seed('http_run_other', 'http_campaign_other');
    await request(app.getHttpServer())
      .post(
        '/content-operations/campaign-executions/' +
          next.e.execution_id +
          '/one-shot-media-binding/authorizations',
      )
      .set('Authorization', token)
      .send({
        ...decision(next.prepared),
        authorizationId: 'different_human_act',
      })
      .expect(409);
    expect(
      repo
        .history(f.e.execution_id)
        .filter((e) => e.event_type === 'ONE_SHOT_MEDIA_BOUND'),
    ).toHaveLength(1);
    expect(
      repo
        .history(f.e.execution_id)
        .some((e) =>
          /PUBLICATION|HUMAN_APPROVAL|COMPOSITION_AUTHORIZATION|FINANCE/.test(
            e.event_type,
          ),
        ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});

test('one-shot HTTP session transport preserves origin and CSRF guards', async () => {
  const { f, app, token, endpoint } = await bindingHttpFixture();
  try {
    const [operatorId, secret] = token.slice(7).split('.');
    const session = await operationalQcSessions.login(
      { operatorId, secret },
      {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost' },
        socket: { remoteAddress: '127.0.0.1' },
      },
    );
    const cookie = session.cookie.split(';')[0];
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Host', 'localhost')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .send(decision(f.prepared))
      .expect(403);
    await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .set('Host', 'localhost')
      .set('Origin', 'http://malicious.invalid')
      .set('Cookie', cookie)
      .set('X-QC-CSRF', session.csrfToken)
      .send(decision(f.prepared))
      .expect(403);
    await request(app.getHttpServer())
      .post(endpoint + '/authorizations')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .set('Cookie', cookie)
      .set('X-QC-CSRF', session.csrfToken)
      .send({ ...decision(f.prepared), acceptsProcessing: false })
      .expect(400);
    expect(repo.oneShotMedia.get(f.e.execution_id)).toBeNull();
  } finally {
    await app.close();
  }
});
