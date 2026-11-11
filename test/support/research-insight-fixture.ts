import type { DatabaseSync } from 'node:sqlite';
import {
  REFERENCE_ANALYSIS_POLICY_VERSION,
  REFERENCE_INSIGHT_CONTRACT_VERSION,
} from '../../src/modules/research/domain/reference-insight-contracts.js';
const STARTED_AT = '2026-09-28T11:00:00.000Z';
export function referenceInsight(pipelineRunId = 'run_e04_001') {
  return {
    schemaVersion: REFERENCE_INSIGHT_CONTRACT_VERSION,
    artifactType: 'strategic_reference_analysis',
    artifactId: 'reference-insight:001',
    revision: 1,
    pipelineRunId: pipelineRunId,
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    logicalDate: '2026-09-28',
    researchInputHash: 'a'.repeat(64),
    projectSnapshotHash: 'f'.repeat(64),
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    analysisWindow: {
      start: '2026-09-27T00:00:00.000Z',
      end: '2026-09-28T00:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      maxItemsPerReference: 10,
    },
    createdAt: STARTED_AT,
    createdBy: 'SYSTEM',
    state: 'COMPLETED',
    references: [
      {
        referenceKey: 'youtube:canal',
        platform: 'youtube',
        configuredHandle: '@canal',
        purpose: 'strategic_reference',
        usage: 'strategic_reference_only',
        grantsUsageRights: false,
        capability: 'public_videos',
        status: 'SUCCESS',
        observedItems: 1,
        evidence: [
          {
            evidenceId: 'ref-evidence-1',
            providerContentId: 'video-1',
            canonicalUrl: 'https://youtube.com/watch?v=video-1',
            publishedAt: STARTED_AT,
            observedAt: STARTED_AT,
            mediaType: 'video',
            durationBand: '31_60S',
          },
        ],
        gaps: [],
      },
    ],
    patterns: [],
    gaps: [],
    contentHash: '2'.repeat(64),
    rights: {
      usageCondition: 'strategic_reference_only',
      grantsUsageRights: false,
      mediaDownloaded: false,
      sourceTextStored: false,
      republicationAllowed: false,
    },
  };
}
export function seedInsight(db: DatabaseSync, value = referenceInsight()) {
  db.prepare(
    "INSERT INTO reference_analysis_runs (id,pipeline_run_id,project_id,project_version,logical_date,timezone,research_input_hash,project_snapshot_hash,policy_version,config_hash,state,started_at) VALUES (?, ?, ?, 1, '2026-09-28', 'America/Sao_Paulo', ?, ?, ?, ?, 'COMPLETED', ?)",
  ).run(
    'reference-run-1',
    value.pipelineRunId,
    value.projectId,
    'a'.repeat(64),
    'f'.repeat(64),
    REFERENCE_ANALYSIS_POLICY_VERSION,
    '1'.repeat(64),
    STARTED_AT,
  );
  db.prepare(
    'INSERT INTO reference_insights (artifact_id,schema_version,reference_analysis_run_id,pipeline_run_id,project_id,project_version,content_hash,payload_json,created_at) VALUES (?,?,?,?,?,1,?,?,?)',
  ).run(
    value.artifactId,
    value.schemaVersion,
    'reference-run-1',
    value.pipelineRunId,
    value.projectId,
    value.contentHash,
    JSON.stringify(value),
    value.createdAt,
  );
}
