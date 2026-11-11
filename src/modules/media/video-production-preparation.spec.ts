import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { contentStore } from '../../../test/support/content-store.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { ContentService } from '../content/application/content.service.js';
import { scriptContentHash } from '../content/domain/script-contracts.js';
import { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../content-operations/infrastructure/operations.persistence.js';
import { VideoProductionPreparationService } from './application/video-production-preparation.service.js';

describe('offline video production preparation', () => {
  let f: ReturnType<typeof p2EditorialFixture>;
  let content: ContentService;
  let operations: ContentOperationsService;
  let catalog: AffiliateService;
  let service: VideoProductionPreparationService;
  let request: {
    scriptId: string;
    scriptContentHash: string;
    scriptRevision: number;
    scenes: {
      visualDirectionPosition: number;
      sceneMediaType: string;
      movementRequirement: string;
    }[];
    expectedPreparationHash?: string;
  };
  beforeEach(() => {
    f = p2EditorialFixture({
      mediaAuthorization: {
        mediaRef: 'authorized-image-001',
        contentHash: 'c'.repeat(64),
        commercialUse: 'GRANTED',
        processing: 'GRANTED',
        localProcessing: true,
        externalProviders: ['fal_ai'],
        operationScope: 'p77_first_live_i2v',
      },
    });
    provisionSchema(f.base.db, 42);
    const persistence = new SqliteAffiliatePersistence(f.database);
    const repo = persistence.open();
    try {
      repo.registerCampaign(
        {
          ...repo.getCampaign('camp_001', 1)!,
          revision: 2,
          affiliateUrl: 'https://s.shopee.com.br/offline',
        },
        'campaign_shopee',
        true,
      );
      repo.associateCampaignSource(
        {
          schemaVersion: 'affiliate-campaign-source/1.0.0',
          sourceId: 'source_001',
          revision: 1,
          source: 'SHOPEE_AFFILIATE_API',
          offer: {
            offerId: 'offer-001',
            productId: 'external-001',
            shopId: null,
            provenance: {
              source: 'FAKE',
              fixtureVersion: 'offline/1',
              observedAt: null,
            },
          },
          campaignId: 'camp_001',
          campaignRevision: 2,
          productId: 'prod_001',
          productRevision: 1,
          briefingId: 'brief_shopee',
          affiliateUrl: 'https://s.shopee.com.br/offline',
        },
        'source_shopee',
        ['authorized-image-001'],
      );
    } finally {
      repo.close();
    }
    const affiliate = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    affiliate.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_shopee' },
      'bind_shopee',
    );
    const briefing = affiliate.resolveRunBriefing('run_001')!;
    content = new ContentService(contentStore(f.database));
    const body = {
      schemaVersion: 'affiliate-editorial-selection/1.0.0',
      selectionId: 'selection_001',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      briefingId: briefing.briefingId,
      briefingHash: briefing.contentHash,
      evidenceRefs: briefing.evidence.map((e) => e.id),
      title: 'Fone autorizado',
      editorialAngle: 'Uso cotidiano',
      decision: 'SELECTED',
      actor: { type: 'HUMAN', id: 'operator_001' },
      decidedAt: '2026-10-14T12:01:00Z',
    };
    const selection = content.selectAffiliate({
      ...body,
      contentHash: affiliateHash(body),
    });
    const value = {
      schemaVersion: 'script/2.0.0',
      scriptId: 'script_001',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      language: 'pt-BR',
      contentFormat: 'short_video',
      hook: 'Conheça o fone autorizado.',
      narrativeBlocks: [
        {
          position: 1,
          purpose: 'EXPLANATION',
          narration: 'Publicidade | Link de afiliado',
        },
      ],
      fullNarration: `Conheça o fone autorizado.\n\nPublicidade | Link de afiliado\n\n${briefing.cta}`,
      estimatedDurationSeconds: 30,
      sensitiveClaims: [],
      reviewFlags: [],
      origin: 'OPERATOR',
      createdAt: '2026-10-14T12:02:00Z',
      revision: 1,
      supersedesScriptId: null,
      contentHash: '',
      editorialSelectionId: selection.selectionId,
      editorialSelectionContentHash: selection.contentHash,
      cta: briefing.cta,
      visualDirections: [
        {
          position: 1,
          blockPosition: 1,
          description: 'Produto em uso, movimento real.',
        },
        {
          position: 2,
          blockPosition: 1,
          description: 'Imagem autorizada do produto.',
        },
      ],
    };
    value.contentHash = scriptContentHash(value);
    const saved = content.registerScript(value);
    const projects = { get: vi.fn(async () => f.base.get('project_001')) };
    operations = new ContentOperationsService(
      new OperationsPersistence(f.database),
      projects,
      affiliate,
    );
    catalog = new AffiliateService(persistence, projects);
    service = new VideoProductionPreparationService(
      content,
      operations,
      catalog,
    );
    request = {
      scriptId: saved.scriptId,
      scriptContentHash: saved.contentHash,
      scriptRevision: 1,
      scenes: [
        {
          visualDirectionPosition: 2,
          sceneMediaType: 'STATIC_IMAGE',
          movementRequirement: 'STATIC_ALLOWED',
        },
        {
          visualDirectionPosition: 1,
          sceneMediaType: 'GENERATED_VIDEO',
          movementRequirement: 'REAL_MOTION_REQUIRED',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('NETWORK_FORBIDDEN');
      }),
    );
  });
  afterEach(() => {
    f.cleanup();
    vi.unstubAllGlobals();
  });

  it('derives the official fal request from pinned Content and briefing without consent or financial writes', async () => {
    const options = {
      scenePosition: 1,
      mediaAcquisitionRequestId: 'p77_first_live_i2v',
      requestedAt: '2026-10-17T12:00:00Z',
      mediaRef: 'authorized-image-001',
      imageHash: 'c'.repeat(64),
    };
    const before = f.base.db
      .prepare('SELECT count(*) n FROM fal_generations')
      .get()?.n;
    const result = await service.prepareFalRequest(request, options);
    expect(await service.prepareFalRequest(request, options)).toEqual(result);
    expect(result.preparation.commercial).toMatchObject({
      productId: 'prod_001',
      productRevision: 1,
      briefingId: 'brief_shopee',
    });
    expect(result.request).toMatchObject({
      schemaVersion: 'media-acquisition-request/1.0.0',
      mediaAcquisitionRequestId: options.mediaAcquisitionRequestId,
      scriptId: request.scriptId,
      scriptContentHash: request.scriptContentHash,
      visualDirectionPosition: 1,
      assetType: 'VIDEO',
    });
    expect(result).not.toHaveProperty('authorization');
    expect(
      f.base.db.prepare('SELECT count(*) n FROM fal_generations').get()?.n,
    ).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
    for (const change of [
      { imageHash: 'd'.repeat(64) },
      { mediaRef: 'other-image' },
      { mediaAcquisitionRequestId: 'another_operation' },
      { scenePosition: 2 },
    ])
      await expect(
        service.prepareFalRequest(request, { ...options, ...change }),
      ).rejects.toThrow();
  });

  it('keeps the briefing URL without inventing Shopee API provenance when no source exists', async () => {
    vi.spyOn(catalog, 'resolveBriefingSource').mockResolvedValue(null);
    const result = await service.prepareFalRequest(request, {
      scenePosition: 1,
      mediaAcquisitionRequestId: 'p77_first_live_i2v',
      requestedAt: '2026-10-17T12:00:00Z',
      mediaRef: 'authorized-image-001',
      imageHash: 'c'.repeat(64),
    });
    expect(result.preparation.commercial.affiliateUrl).toBe(
      'https://s.shopee.com.br/offline',
    );
    expect(result.preparation.shopeeSource).toBeNull();
    expect(result.preparation.scenes[0].motionValidation).toBe('NOT_VALIDATED');
    expect(result).not.toHaveProperty('authorization');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves exact commercial lineage and Shopee provenance, without producing artifacts or writing state', async () => {
    const before = f.base.db.prepare('PRAGMA data_version').get()?.data_version;
    const plan = await service.prepare(request);
    expect(plan.schemaVersion).toBe('video-production-preparation/1.0.0');
    expect(plan.commercial).toMatchObject({
      productId: 'prod_001',
      productRevision: 1,
      campaignId: 'camp_001',
      campaignRevision: 2,
      briefingId: 'brief_shopee',
    });
    expect(plan.shopeeSource).toEqual(
      await catalog.resolveBriefingSource('brief_shopee'),
    );
    expect(plan.script).toEqual({
      scriptId: request.scriptId,
      revision: 1,
      contentHash: request.scriptContentHash,
    });
    expect(plan.scenes.map((s) => s.visualDirection.position)).toEqual([1, 2]);
    for (const scene of plan.scenes) {
      expect(scene.generationStatus).toBe('PENDING');
      expect(scene.motionValidation).toBe('NOT_VALIDATED');
      expect(scene.rights.status).toBe('UNCONFIRMED');
      expect(scene.acquisitionPlanned).toMatchObject({
        scriptId: request.scriptId,
        scriptContentHash: request.scriptContentHash,
        visualDirectionPosition: scene.position,
      });
      for (const key of [
        'mediaAssetId',
        'mediaReference',
        'providerRequestId',
        'url',
      ])
        expect(scene).not.toHaveProperty(key);
      expect(scene.acquisitionPlanned).not.toHaveProperty(
        'mediaAcquisitionRequestId',
      );
      expect(scene.acquisitionPlanned).not.toHaveProperty('contentHash');
    }
    expect(plan.scenes.map((s) => s.acquisitionPlanned.assetType)).toEqual([
      'VIDEO',
      'IMAGE',
    ]);
    expect(Object.isFrozen(plan.scenes[0])).toBe(true);
    expect(f.base.db.prepare('PRAGMA data_version').get()?.data_version).toBe(
      before,
    );
    for (const table of [
      'media_assets',
      'composition_plans',
      'cost_events',
      'campaign_executions',
      'pipeline_stage_attempts',
    ])
      expect(
        f.base.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
      ).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('is content addressed, stable across service instances and scene input order, with explicit optimistic conflicts', async () => {
    const first = await service.prepare(request);
    const fresh = new VideoProductionPreparationService(
      content,
      operations,
      catalog,
    );
    expect(
      await fresh.prepare({
        ...request,
        scenes: [...request.scenes].reverse(),
        expectedPreparationHash: first.contentHash,
      }),
    ).toEqual(first);
    const changed = {
      ...request,
      scenes: request.scenes.map((s) => ({
        ...s,
        sceneMediaType:
          s.visualDirectionPosition === 1 ? 'RECORDED_VIDEO' : s.sceneMediaType,
      })),
    };
    expect((await fresh.prepare(changed)).preparationId).not.toBe(
      first.preparationId,
    );
    await expect(
      fresh.prepare({ ...changed, expectedPreparationHash: first.contentHash }),
    ).rejects.toMatchObject({ code: 'VIDEO_PREPARATION_CONFLICT' });
  });
  it.each(['STATIC_IMAGE', 'ANIMATED_STILL'])(
    'rejects %s for required real motion',
    async (sceneMediaType) => {
      request.scenes[1].sceneMediaType = sceneMediaType;
      await expect(service.prepare(request)).rejects.toMatchObject({
        code: 'REAL_MOTION_INTENT_REQUIRED',
      });
    },
  );
  it('accepts an animated still only when static is allowed, without certifying motion or rights', async () => {
    request.scenes[0].sceneMediaType = 'ANIMATED_STILL';
    const plan = await service.prepare(request);
    expect(plan.scenes[1]).toMatchObject({
      sceneMediaType: 'ANIMATED_STILL',
      motionValidation: 'NOT_VALIDATED',
      generationStatus: 'PENDING',
      rights: { status: 'UNCONFIRMED' },
      acquisitionPlanned: { assetType: 'IMAGE' },
    });
  });
  it.each([
    { scriptRevision: 2 },
    { scriptContentHash: 'a'.repeat(64) },
    { scriptId: 'missing' },
  ])('rejects missing or stale script %j', async (override) => {
    await expect(
      service.prepare({ ...request, ...override }),
    ).rejects.toThrow();
  });
  it('rejects incomplete, duplicate or invented scene directions and invalid intent', async () => {
    for (const scenes of [
      [],
      [request.scenes[0]],
      [request.scenes[0], request.scenes[0]],
      request.scenes.map((s) => ({ ...s, visualDirectionPosition: 99 })),
      request.scenes.map((s) => ({ ...s, sceneMediaType: 'FAKE' })),
    ])
      await expect(service.prepare({ ...request, scenes })).rejects.toThrow();
    await expect(
      service.prepare({ ...request, mediaAssetId: 'invented' }),
    ).rejects.toThrow();
  });
  it('rejects inconsistent commercial lineage and invalid scripts', async () => {
    const original = content.getScript(request.scriptId)!;
    const getScript = vi.spyOn(content, 'getScript').mockReturnValue({
      ...original,
      revision: 0,
    });
    await expect(service.prepare(request)).rejects.toThrow();
    getScript.mockReturnValue(original);
    const resolve = vi.spyOn(operations, 'resolveAffiliateBriefing');
    resolve.mockReturnValue(null);
    await expect(service.prepare(request)).rejects.toMatchObject({
      code: 'VIDEO_PREPARATION_BRIEFING_MISMATCH',
    });
  });
  it('preserves valid script revisions and gives each revision its own identity', async () => {
    const first = await service.prepare(request);
    const original = content.getScript(request.scriptId)!;
    const next = {
      ...original,
      scriptId: 'script_002',
      revision: 2,
      supersedesScriptId: original.scriptId,
    };
    next.contentHash = scriptContentHash(next);
    content.registerScript(next);
    const plan = await service.prepare({
      ...request,
      scriptId: next.scriptId,
      scriptRevision: 2,
      scriptContentHash: next.contentHash,
    });
    expect(plan.script.revision).toBe(2);
    expect(plan.preparationId).not.toBe(first.preparationId);
    expect(plan.commercial).toEqual(first.commercial);
    expect(plan.scenes[0].sceneId).not.toBe(first.scenes[0].sceneId);
  });
  it('includes Shopee source revisions and provenance in content identity and rejects inconsistent source scope', async () => {
    const first = await service.prepare(request);
    const source = (await catalog.resolveBriefingSource('brief_shopee'))!;
    const resolve = vi.spyOn(catalog, 'resolveBriefingSource');
    resolve.mockResolvedValue({ ...source, revision: 2 });
    await expect(
      service.prepare({
        ...request,
        expectedPreparationHash: first.contentHash,
      }),
    ).rejects.toMatchObject({ code: 'VIDEO_PREPARATION_CONFLICT' });
    resolve.mockResolvedValue({ ...source, campaignRevision: 1 });
    await expect(service.prepare(request)).rejects.toMatchObject({
      code: 'VIDEO_PREPARATION_SOURCE_MISMATCH',
    });
    resolve.mockRejectedValue(
      Object.assign(new Error('ambiguous source'), {
        code: 'AFFILIATE_SOURCE_AMBIGUOUS',
      }),
    );
    await expect(service.prepare(request)).rejects.toMatchObject({
      code: 'AFFILIATE_SOURCE_AMBIGUOUS',
    });
  });
  it('accepts the absence of Shopee provenance without inventing a source', async () => {
    vi.spyOn(catalog, 'resolveBriefingSource').mockResolvedValue(null);
    expect((await service.prepare(request)).shopeeSource).toBeNull();
  });
  it('rejects run scope mismatch and missing commercial rights evidence', async () => {
    const run = operations.get('run_001');
    const get = vi
      .spyOn(operations, 'get')
      .mockReturnValue({ ...run, projectVersion: 2 });
    await expect(service.prepare(request)).rejects.toMatchObject({
      code: 'VIDEO_PREPARATION_SCOPE_MISMATCH',
    });
    get.mockReturnValue(run);
    const briefing = operations.resolveAffiliateBriefing('run_001')!;
    const changed = {
      ...briefing,
      evidence: briefing.evidence.filter((e) => e.kind !== 'MEDIA_USAGE_RIGHT'),
    };
    changed.contentHash = affiliateHash(changed);
    vi.spyOn(operations, 'resolveAffiliateBriefing').mockReturnValue(changed);
    await expect(service.prepare(request)).rejects.toThrow();
  });
});
