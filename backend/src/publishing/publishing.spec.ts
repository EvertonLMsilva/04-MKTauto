import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ManualDistributionService } from './application/manual-distribution.service.js';
import { ManualDistributionRepository } from './infrastructure/manual-distribution.repository.js';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { LocalRenderIntegrity } from '../media/infrastructure/local-render-integrity.js';
const legacy = await import(
  new URL('../../../src/human-approval-repository.js', import.meta.url).href
);
const affiliate = await import(
  new URL('../../../src/affiliate-repository.js', import.meta.url).href
);
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const manual = await import(
  new URL('../../../src/manual-distribution-service.js', import.meta.url).href
);
const manualRepo = await import(
  new URL('../../../src/manual-distribution-repository.js', import.meta.url)
    .href
);
const social = await import(
  new URL('../../../src/social-publication-repository.js', import.meta.url).href
);
const at = '2026-10-12T18:00:00Z';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'publishing-ts-'));
  const path = join(root, 'fixture.sqlite');
  const base = new legacy.HumanApprovalRepository(path);
  base.create(fixtures.project());
  const catalog = new affiliate.AffiliateRepository(base);
  catalog.registerProduct(fixtures.product(), 'product');
  catalog.registerCampaign(fixtures.campaign(), 'campaign');
  fixtures.startRun(base);
  catalog.createBriefing(
    { briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 },
    'brief',
  );
  catalog.bindRun(
    { pipelineRunId: 'run_001', briefingId: 'brief_001' },
    'bind',
  );
  const bytes = Buffer.from('fixture-media');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const folder = join(root, 'sha256', hash.slice(0, 2));
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${hash}.mp4`);
  writeFileSync(file, bytes);
  const render = {
    videoRenderId: 'render_001',
    revision: 1,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    origin: { rights: { commercialUseAuthorized: true } },
  };
  const qc = {
    qualityControlReportId: 'qc_001',
    contentHash: 'b'.repeat(64),
    videoRenderId: render.videoRenderId,
    videoRenderContentHash: hash,
    projectId: render.projectId,
    projectVersion: 1,
    pipelineRunId: 'run_001',
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'COMMERCIAL_RIGHTS',
      'PROCESSING_RIGHTS',
      'NARRATION_RIGHTS',
    ].map((code) => ({ code, status: 'PASS' })),
  };
  const integrity = new LocalRenderIntegrity(root);
  const evidence = {
    getVideoRender: (id: string) =>
      id === render.videoRenderId ? render : null,
    getQualityControlReport: () => qc,
    verifyMedia: (ref: string) => integrity.verifyMedia(ref),
  };
  const repository = new ManualDistributionRepository(base, catalog);
  const service = new ManualDistributionService({
    repository,
    evidence,
    now: () => at,
  });
  const js = new manual.ManualDistributionService({
    repository: new manualRepo.ManualDistributionRepository(base),
    evidence,
    now: () => at,
  });
  const input = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    videoRenderId: 'render_001',
    qualityControlReportId: 'qc_001',
    platform: 'instagram',
    account: '123456789',
    caption: 'Produto autorizado',
  };
  return {
    root,
    path,
    base,
    catalog,
    render,
    qc,
    evidence,
    repository,
    service,
    js,
    input,
    file,
    hash,
    cleanup() {
      base.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
describe('Publishing persistence and exact-media gates', () => {
  it('matches legacy package, approval, manual receipt, history and replay', () => {
    const f = fixture();
    try {
      const p = f.service.prepare(f.input, 'package');
      expect(p).toEqual(f.js.prepare(f.input, 'package'));
      const review = {
        packageHash: p.contentHash,
        decision: 'APPROVED',
        actor: 'operator',
        justification: null,
      };
      expect(f.service.review(review, 'review')).toEqual(
        f.js.review(review, 'review'),
      );
      const receipt = {
        packageHash: p.contentHash,
        actor: 'operator',
        publishedAt: at,
        externalId: 'post_001',
        externalUrl: 'https://instagram.com/p/example',
        evidenceReference: 'manual/receipt',
        state: 'PUBLISHED',
      };
      const pub = f.service.recordPublication(receipt, 'publication');
      expect(pub).toEqual(f.js.recordPublication(receipt, 'publication'));
      expect(f.service.listPublications(p.contentHash)).toEqual([pub]);
      const results = {
        publicationId: pub.publicationId,
        periodStart: '2026-10-12T00:00:00Z',
        periodEnd: '2026-10-13T00:00:00Z',
        sourceReference: 'manual/results',
        attribution: 'DIRECT_PUBLICATION',
        clicks: { status: 'KNOWN', value: 0 },
        sales: { status: 'UNKNOWN', reason: 'not_reported' },
        revenue: { status: 'UNKNOWN', reason: 'not_reported' },
        commissions: { status: 'KNOWN', amount: '0', currency: 'BRL' },
      };
      expect(f.service.recordResults(results, 'results')).toEqual(
        f.js.recordResults(results, 'results'),
      );
      expect(f.service.listResults(pub.publicationId)).toEqual(
        f.js.listResults(pub.publicationId),
      );
      expect(() =>
        f.service.prepare({ ...f.input, caption: 'Changed' }, 'package'),
      ).toThrowError(
        expect.objectContaining({ code: 'AFFILIATE_IDEMPOTENCY_CONFLICT' }),
      );
      writeFileSync(f.file, 'tampered');
      expect(() => f.service.review(review, 'review')).toThrowError(
        expect.objectContaining({ code: 'DISTRIBUTION_MEDIA_CHANGED' }),
      );
      expect(() =>
        f.service.recordPublication(receipt, 'publication'),
      ).toThrowError(
        expect.objectContaining({ code: 'DISTRIBUTION_MEDIA_CHANGED' }),
      );
    } finally {
      f.cleanup();
    }
  });
  it('rejects missing render and invalid media reference without receipts', () => {
    const f = fixture();
    try {
      expect(() =>
        f.service.prepare({ ...f.input, videoRenderId: 'absent' }, 'missing'),
      ).toThrowError(
        expect.objectContaining({ code: 'DISTRIBUTION_ARTIFACT_NOT_FOUND' }),
      );
      expect(
        f.base.db
          .prepare(
            "SELECT 1 FROM affiliate_commands WHERE idempotency_key='missing'",
          )
          .get(),
      ).toBeUndefined();
      expect(() =>
        f.evidence.verifyMedia('render:sha256_invalid'),
      ).toThrowError(
        expect.objectContaining({
          code: 'DISTRIBUTION_MEDIA_REFERENCE_INVALID',
        }),
      );
    } finally {
      f.cleanup();
    }
  });
  it('rolls back a record when receipt persistence fails', () => {
    const f = fixture();
    try {
      f.base.db.exec(
        "CREATE TRIGGER fail_receipt BEFORE INSERT ON affiliate_commands WHEN NEW.idempotency_key='rollback' BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END;",
      );
      expect(() => f.service.prepare(f.input, 'rollback')).toThrow(
        'FIXTURE_FAILURE',
      );
      expect(f.repository.list('PACKAGE')).toEqual([]);
    } finally {
      f.cleanup();
    }
  });
  it('preserves social versions, optimistic claims, receipts and atomic history', () => {
    const f = fixture();
    try {
      const js = new social.SocialPublicationRepository(f.base);
      const r = new SocialPublicationRepository(f.base);
      const input = {
        packageHash: f.hash,
        accountId: '123456789',
        mediaHash: f.hash,
        caption: 'Caption',
      };
      const op = r.prepare(input, 'social_prepare', at);
      expect(op).toEqual(js.prepare(input, 'social_prepare', at));
      const claimed = r.transition(
        op.operationId,
        0,
        ['PREPARED'],
        { state: 'CREATING_CONTAINER' },
        at,
      );
      expect(claimed.claimed).toBe(true);
      expect(
        js.transition(
          op.operationId,
          0,
          ['PREPARED'],
          { state: 'CREATING_CONTAINER' },
          at,
        ),
      ).toEqual({ claimed: false, value: claimed.value });
      f.base.db.exec(
        "CREATE TRIGGER fail_event BEFORE INSERT ON social_publication_events WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'FIXTURE_HISTORY_FAILURE'); END;",
      );
      expect(() =>
        r.transition(
          op.operationId,
          1,
          ['CREATING_CONTAINER'],
          { state: 'PROCESSING', containerId: '234567890' },
          at,
        ),
      ).toThrow('FIXTURE_HISTORY_FAILURE');
      expect(r.get(op.operationId)).toEqual(claimed.value);
      expect(
        f.base.db
          .prepare('SELECT count(*) AS n FROM social_publication_events')
          .get().n,
      ).toBe(2);
    } finally {
      f.cleanup();
    }
  });
});
