import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../src/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../../src/content-operations/infrastructure/sqlite-operations.repository.js';
import { SqliteAffiliateRepository } from '../../src/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { affiliateHash } from '../../src/affiliate/domain/affiliate-contracts.js';
import type { MediaAuthorization } from '../../src/affiliate/domain/affiliate-contracts.js';
import { SqliteResearchRepository } from '../../src/research/infrastructure/sqlite-research.repository.js';
import { createResearchInput } from '../../src/research/domain/research-contracts.js';
import { createResearchShortlist } from '../../src/research/domain/research-shortlist-contracts.js';
import { buildResearchShortlist } from '../../src/research/application/research-shortlist.js';
import { batch, cluster, score } from './research-catalog-fixture.js';
import { referenceInsight } from './research-insight-fixture.js';

export const P2_TIME = '2026-10-14T12:00:00Z';

// Simulated trusted price evidence only; this fixture never invokes a transport.
export function p2FinancialProof() {
  return {
    operationId: 'p2_finance_mock',
    requestHash: 'a'.repeat(64),
    provider: 'openai',
    kind: 'ENFORCED_MAXIMUM',
    includesAllCharges: true,
    currency: 'USD',
    maximumAmount: '0.6',
    evidenceReference: 'mock:enforced',
    expiresAt: '2027-12-31T00:00:00Z',
  };
}

// P2 uses only native repositories. Shared legacy parity fixtures stay intact.
export function p2EditorialFixture({
  pipelineRunId = 'run_001',
  projectId = 'project_001',
  briefingId = 'brief_001',
  references = false,
  mediaAuthorization,
}: {
  pipelineRunId?: string;
  projectId?: string;
  briefingId?: string;
  references?: boolean;
  mediaAuthorization?: MediaAuthorization;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-p2-native-'));
  const database = join(directory, 'catalog.sqlite');
  const schema = new DatabaseSync(database);
  try {
    provisionSchema(schema, 40);
  } finally {
    schema.close();
  }
  const base = new SqliteOperationsRepository(database);
  try {
    const snapshot = base.create(
      {
        id: projectId,
        name: 'Projeto editorial P2',
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
      { createdAt: P2_TIME },
    );
    const execution = {
      pipelineRunId,
      projectId,
      projectVersion: 1,
      startedAt: P2_TIME,
    };
    base.startRun({ execution, projectSnapshot: snapshot });
    const catalog = new SqliteAffiliateRepository(database);
    try {
      catalog.registerProduct(
        {
          schemaVersion: 'affiliate-product/1.0.0',
          productId: 'prod_001',
          revision: 1,
          name: 'Fone de exemplo',
          brand: 'Marca exemplo',
          attributes: [
            {
              name: 'connectivity',
              value: 'Bluetooth',
              evidenceRef: 'ev_spec',
            },
          ],
          media: [
            { mediaRef: 'authorized-image-001', evidenceRef: 'ev_rights' },
          ],
          evidence: [
            {
              id: 'ev_spec',
              kind: 'PRODUCT_SPECIFICATION',
              sourceRef: 'manual-spec-001',
              recordedAt: P2_TIME,
            },
            {
              id: 'ev_rights',
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'authorization-001',
              recordedAt: P2_TIME,
              ...(mediaAuthorization ? { mediaAuthorization } : {}),
            },
          ],
        },
        'product_p2',
      );
      catalog.registerCampaign(
        {
          schemaVersion: 'affiliate-campaign/1.0.0',
          campaignId: 'camp_001',
          revision: 1,
          projectId,
          productId: 'prod_001',
          productRevision: 1,
          affiliateUrl: 'https://example.com/item?tag=affiliate%2B001&ref=x',
          cta: 'Confira pelo link',
          disclosure: 'Publicidade | Link de afiliado',
        },
        'campaign_p2',
        base.get(projectId) !== null,
      );
      catalog.createBriefing(
        { briefingId, campaignId: 'camp_001', campaignRevision: 1 },
        'brief_p2',
        base.get(projectId) !== null,
      );
    } finally {
      catalog.close();
    }
    const research = new SqliteResearchRepository(database);
    try {
      const input = createResearchInput({
        schemaVersion: 'research-input/1.0.0',
        execution,
        window: { logicalDate: '2026-09-28' },
        projectSnapshot: snapshot,
      });
      const operation = batch({ key: 'p2_catalog', at: P2_TIME, views: 100 });
      research.recordOperation(operation);
      research.recordAnalysis({
        idempotencyKey: 'p2_analysis',
        runId: operation.run.id,
        topicClusters: [cluster()],
        scores: [score()],
      });
      research.beginResearchDailyRun({
        id: 'research_p2',
        ...execution,
        logicalDate: input.window.logicalDate,
        timezone: snapshot.channel.publishing.timezone,
        researchInputHash: affiliateHash(input),
        configHash: 'b'.repeat(64),
        config: {},
        sourcePlan: [],
      });
      const body = {
        schemaVersion: 'research-topic-catalog/1.0.0',
        artifactId: 'research-catalog:p2',
        artifactType: 'topic_discovery',
        revision: 1,
        pipelineRunId,
        projectId,
        projectVersion: 1,
        logicalDate: input.window.logicalDate,
        timezone: snapshot.channel.publishing.timezone,
        createdAt: P2_TIME,
        createdBy: 'SYSTEM',
        researchInputHash: affiliateHash(input),
        analysisContext: {
          niche: snapshot.project.niche,
          subniches: snapshot.project.subniches,
          audience: snapshot.project.audience.profile,
          language: snapshot.project.audience.language,
        },
        sourcePlan: [
          {
            network: 'youtube',
            role: 'CONFIGURED_NETWORK',
            adapter: 'fixture',
            status: 'SUCCESS',
            sourceRunIds: operation.run.sourceRunIds,
            gaps: [],
          },
        ],
        trendRunId: operation.run.id,
        state: 'COMPLETED',
        gaps: [],
        rights: {
          usageCondition: 'REFERENCE_ONLY',
          mediaDownloaded: false,
          republicationAllowed: false,
        },
      };
      const source = research.recordResearchArtifact({
        researchDailyRunId: 'research_p2',
        artifact: { ...body, contentHash: affiliateHash(body) },
      });
      research.finishResearchDailyRun({
        id: 'research_p2',
        state: 'COMPLETED',
        trendRunId: operation.run.id,
        completedAt: P2_TIME,
        durationMs: 1,
        result: {},
      });
      const shortlist = createResearchShortlist(
        buildResearchShortlist({
          store: research,
          researchInput: input,
          researchTopicCatalog: source,
          clock: () => new Date(P2_TIME),
        }),
      );
      if (references) {
        const insight = {
          ...referenceInsight(pipelineRunId),
          projectId,
          researchInputHash: affiliateHash(input),
          projectSnapshotHash: affiliateHash(snapshot),
        };
        insight.contentHash = affiliateHash(insight);
        research.beginReferenceAnalysisRun({
          id: 'reference_p2',
          pipelineRunId,
          projectId,
          projectVersion: 1,
          logicalDate: insight.logicalDate,
          timezone: insight.analysisWindow.timezone,
          researchInputHash: insight.researchInputHash,
          projectSnapshotHash: insight.projectSnapshotHash,
          policyVersion: insight.policyVersion,
          configHash: 'd'.repeat(64),
          startedAt: P2_TIME,
        });
        research.recordReferenceInsight({
          referenceAnalysisRunId: 'reference_p2',
          artifact: insight,
        });
        research.finishReferenceAnalysisRun({
          id: 'reference_p2',
          state: 'COMPLETED',
          completedAt: P2_TIME,
          durationMs: 1,
          result: {},
        });
      }
      return {
        database,
        base,
        shortlist,
        cleanup() {
          base.close();
          rmSync(directory, { recursive: true, force: true });
        },
      };
    } finally {
      research.close();
    }
  } catch (error) {
    base.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
