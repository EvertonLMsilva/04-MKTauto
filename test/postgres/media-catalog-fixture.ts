import type { PostgresDatabase } from '../../src/infrastructure/database/postgres/index.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { PostgresOperationsPersistence } from '../../src/modules/content-operations/infrastructure/postgres-campaign.persistence.js';
import { PostgresAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.persistence.js';
import { PostgresAffiliateSessionFactory } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.session.js';
import { PostgresContentPersistence } from '../../src/modules/content/infrastructure/postgres-content.persistence.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { SqliteAffiliateRepository } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { SqliteOperationsRepository } from '../../src/modules/content-operations/infrastructure/sqlite-operations.repository.js';
import { affiliateHash } from '../../src/modules/affiliate/domain/affiliate-contracts.js';
import { scriptContentHash } from '../../src/modules/content/domain/script-contracts.js';
import { mediaAcquisitionRequestHash } from '../../src/modules/media/domain/media-acquisition-contracts.js';
import { mediaSelectionRequestHash } from '../../src/modules/media/domain/media-selection-contracts.js';
import type { MediaAsset } from '../../src/modules/media/domain/media.types.js';
import {
  project,
  product,
  campaign,
  at,
  sqliteAffiliateFixture,
} from './affiliate-fixture.js';
import {
  script as scriptFixture,
  contentFixture,
  submission,
} from './content-fixture.js';
import { selectionContentHash } from '../../src/modules/content/domain/idea-selection-contracts.js';
import { contentStore } from '../support/content-store.js';
import { mediaStore } from '../support/media-store.js';
import { asset } from '../support/media-fixture.js';
export { at };
export const mediaRun = 'run_media_001';
/** Seed a valid PG-Content V1 script via its existing isolated composition, not raw fictitious lineage. */
export async function researchScriptFixture(db: PostgresDatabase) {
  const source = contentFixture({ editorial: false });
  const reader = contentStore(source.database).open(true);
  try {
    const request = submission();
    const shortlist = await reader.research.getShortlist(
      request.researchShortlistId,
    );
    const projects = await new PostgresProjectPersistence(db).open();
    const snapshot = await projects.create(
      { ...project(), id: request.projectId },
      { createdAt: request.createdAt },
    );
    await projects.close();
    const ops = await new PostgresOperationsPersistence(db).open();
    await ops.startRun({
      execution: {
        pipelineRunId: request.pipelineRunId,
        projectId: request.projectId,
        projectVersion: 1,
        startedAt: '2026-09-28T11:00:00.000Z',
      },
      projectSnapshot: snapshot,
    });
    const run = await ops.getRun(request.pipelineRunId);
    await ops.close();
    const repository = await new PostgresContentPersistence(db, {
      operations: { get: () => run! },
      affiliate: { resolveRunBriefing: () => null },
      research: {
        getShortlist: async () => structuredClone(shortlist),
        getInsight: async () => null,
      },
    }).open();
    try {
      const [{ idea, score }] = await repository.registerBatch(request);
      const selected = {
        schemaVersion: 'idea-selection/1.0.0',
        ideaSelectionId: 'selection_research_only',
        pipelineRunId: idea.pipelineRunId,
        projectId: idea.projectId,
        projectVersion: idea.projectVersion,
        ideaBatchId: idea.ideaBatchId,
        ideaCandidateId: idea.ideaCandidateId,
        ideaScoreId: score.ideaScoreId,
        ideaContentHash: idea.contentHash,
        ideaScoreContentHash: score.contentHash,
        decision: 'SELECTED',
        actor: { type: 'HUMAN', id: 'operator_001' },
        decidedAt: '2026-09-28T13:00:00.000Z',
        editorialRationale: 'Escolha editorial explícita',
        revision: 1,
        supersedesIdeaSelectionId: null,
        contentHash: '',
      };
      selected.contentHash = selectionContentHash(selected);
      await repository.registerSelection(selected);
      return await repository.registerScript(
        scriptFixture(selected, { scriptId: 'script_research_only' }),
      );
    } finally {
      await repository.close();
    }
  } finally {
    reader.close();
    source.close();
  }
}
export async function mediaCatalogFixture(db: PostgresDatabase) {
  const projects = await new PostgresProjectPersistence(db).open();
  const snapshot = await projects.create(project(), { createdAt: at });
  await projects.close();
  const ops = await new PostgresOperationsPersistence(db).open();
  await ops.startRun({
    execution: {
      pipelineRunId: mediaRun,
      projectId: 'project_001',
      projectVersion: 1,
      startedAt: at,
    },
    projectSnapshot: snapshot,
  });
  await ops.close();
  const pgAffiliate = new PostgresAffiliatePersistence(
    new PostgresAffiliateSessionFactory(db, undefined, true),
  );
  const catalog = await pgAffiliate.open();
  await catalog.registerProduct(product(), 'product_media');
  await catalog.registerCampaign(campaign(), 'campaign_media', true);
  const briefing = await catalog.createBriefing(
    {
      briefingId: 'brief_media_001',
      campaignId: 'camp_001',
      campaignRevision: 1,
    },
    'brief_media',
    true,
  );
  await catalog.close();
  const bind = { pipelineRunId: mediaRun, briefingId: briefing.briefingId };
  await new AffiliateRunContextService<true>(pgAffiliate).bindRun(
    bind,
    'binding_media',
  );
  const body = {
    schemaVersion: 'affiliate-editorial-selection/1.0.0',
    selectionId: 'editorial_media_001',
    pipelineRunId: mediaRun,
    projectId: 'project_001',
    projectVersion: 1,
    briefingId: briefing.briefingId,
    briefingHash: briefing.contentHash,
    evidenceRefs: ['ev_spec', 'ev_rights'],
    title: 'Fone autorizado',
    editorialAngle: 'Conectividade no cotidiano',
    decision: 'SELECTED',
    actor: { type: 'HUMAN', id: 'operator_001' },
    decidedAt: at,
  };
  const selected = { ...body, contentHash: affiliateHash(body) };
  const script = scriptFixture(selected, {
    schemaVersion: 'script/2.0.0',
    editorialSelectionId: selected.selectionId,
    editorialSelectionContentHash: selected.contentHash,
    cta: briefing.cta,
    createdAt: at,
  });
  for (const field of [
    'ideaSelectionId',
    'ideaSelectionContentHash',
    'ideaCandidateId',
    'ideaContentHash',
  ])
    delete script[field];
  script.contentHash = scriptContentHash(script);
  const content = await PostgresContentPersistence.coordinated(db).open();
  await content.registerAffiliateEditorialSelection(selected);
  await content.registerScript(script);
  await content.close();
  const sqlite = sqliteAffiliateFixture();
  try {
    const nativeOps = new SqliteOperationsRepository(sqlite.path);
    nativeOps.startRun({
      execution: {
        pipelineRunId: mediaRun,
        projectId: 'project_001',
        projectVersion: 1,
        startedAt: at,
      },
      projectSnapshot: snapshot,
    });
    nativeOps.close();
    const nativeCatalog = new SqliteAffiliateRepository(sqlite.path);
    nativeCatalog.registerProduct(product(), 'product_media');
    nativeCatalog.registerCampaign(campaign(), 'campaign_media', true);
    nativeCatalog.createBriefing(
      {
        briefingId: briefing.briefingId,
        campaignId: 'camp_001',
        campaignRevision: 1,
      },
      'brief_media',
      true,
    );
    nativeCatalog.close();
    new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(sqlite.path),
    ).bindRun(bind, 'binding_media');
    const nativeContent = contentStore(sqlite.path).open();
    nativeContent.registerAffiliateEditorialSelection(selected);
    nativeContent.registerScript(script);
    nativeContent.close();
  } catch (error) {
    sqlite.cleanup();
    throw error;
  }
  return {
    script,
    snapshot,
    selected,
    briefing,
    sqlite,
    native: mediaStore(sqlite.path).open(),
    cleanup: () => sqlite.cleanup(),
  };
}
export function catalogAsset(script: any, overrides: Partial<MediaAsset> = {}) {
  return asset(script, {
    createdAt: at,
    mediaReference: `media:sha256_${'a'.repeat(64)}`,
    ...overrides,
  });
}
export function licensedAsset(
  script: any,
  overrides: Partial<MediaAsset> = {},
) {
  return catalogAsset(script, {
    schemaVersion: 'media-asset/2.0.0',
    assetType: 'VIDEO',
    technicalProperties: {
      format: 'mp4',
      widthPixels: 1920,
      heightPixels: 1080,
      durationMilliseconds: 5000,
      mimeType: 'video/mp4',
      hasAudio: false,
    },
    origin: 'PROVIDER_LICENSED',
    provider: 'fixture_stock',
    rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
    source: {
      externalAssetId: 'fixture-001',
      licenseName: 'Fixture commercial license',
      licenseUrl: 'https://example.com/license',
      photographerName: 'Fixture photographer',
      photographerUrl: 'https://example.com/author',
      sourceUrl: 'https://example.com/media',
    },
    ...overrides,
  });
}
export function acquisition(
  script: any,
  id = 'acquisition_media_001',
  type: 'IMAGE' | 'VIDEO' = 'IMAGE',
) {
  const body = {
    schemaVersion: 'media-acquisition-request/1.0.0',
    mediaAcquisitionRequestId: id,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: 1,
    assetType: type,
    requestedAt: at,
  };
  return { ...body, contentHash: mediaAcquisitionRequestHash(body) };
}
export function selection(
  script: any,
  id = 'selection_media_001',
  profile: 'STATIC_IMAGE_V1' | 'MIXED_MEDIA_V2' = 'STATIC_IMAGE_V1',
) {
  const body = {
    schemaVersion: 'media-selection-request/1.0.0',
    mediaSelectionRequestId: id,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: 1,
    productionProfile: profile,
    requestedAt: at,
  };
  return { ...body, contentHash: mediaSelectionRequestHash(body) };
}
