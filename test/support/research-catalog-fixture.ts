import { RESEARCH_INPUT_CONTRACT_VERSION } from '../../src/modules/research/domain/research-contracts.js';
import { PROJECT_CONTRACT_VERSION } from '../../src/modules/project/domain/project-contracts.js';
import {
  RADAR_CONTRACT_VERSION,
  canonicalTrendIdentity,
} from '../../src/modules/research/domain/research-record-contracts.js';
export const DAY_ONE = '2026-09-26T12:00:00.000Z';
export const DAY_TWO = '2026-09-27T12:00:00.000Z';
export function batch({
  key,
  at,
  views,
  runId = 'run-2026-09-26',
  candidateId = 'candidate-1',
  snapshotId = 'snapshot-1',
  platformVideoId = 'video-1',
  canonicalUrl = 'https://youtube.com/watch?v=video-1',
  reason = 'FIRST_SEEN',
  previousPosition,
  position = 10,
  sourceStatus = 'SUCCESS',
}: any) {
  const identityKey = canonicalTrendIdentity({
    platform: 'YOUTUBE',
    platformVideoId,
    canonicalUrl,
  });
  const hasGap = sourceStatus !== 'SUCCESS';
  const candidate = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: candidateId,
    identityKey,
    platform: 'YOUTUBE',
    ...(platformVideoId === undefined ? {} : { platformVideoId }),
    canonicalUrl,
    state: 'ACTIVE',
    firstSeenAt: at,
    lastSeenAt: at,
    reappearanceCount: 1,
    durationSeconds: 45,
    publishedAt: '2026-09-25T12:00:00.000Z',
    region: 'BR',
    language: 'pt-BR',
    usageCondition: 'REFERENCE_ONLY',
    snapshotIds: [snapshotId],
    topicClusterIds: [],
  };
  const snapshot = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: snapshotId,
    candidateId,
    capturedAt: at,
    metrics: {
      views: metric(views),
      likes: metric(10),
      comments: { availability: 'UNAVAILABLE', reason: 'NOT_RETURNED' },
      shares: { availability: 'UNAVAILABLE', reason: 'NOT_EXPOSED' },
    },
  };
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `source-${runId}`,
    trendRunId: runId,
    platform: 'YOUTUBE',
    status: sourceStatus,
    startedAt: at,
    completedAt: at,
    capabilities: {
      discovery: 'GLOBAL_TRENDS',
      metrics: ['VIEWS', 'LIKES'],
      supportsRegions: true,
      limitations: hasGap ? ['quota'] : [],
    },
    coverage: {
      requestedRegions: ['BR', 'US'],
      coveredRegions: hasGap ? ['BR'] : ['BR', 'US'],
      complete: !hasGap,
    },
    gaps: hasGap ? ['US_UNAVAILABLE'] : [],
    ...(sourceStatus === 'FAILED' || sourceStatus === 'BLOCKED_BY_PROVIDER'
      ? { errorCode: 'PROVIDER_ERROR' }
      : {}),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: hasGap ? 'COMPLETED_WITH_GAPS' : 'COMPLETED',
    createdAt: at,
    updatedAt: at,
    sourceRunIds: [sourceRun.id],
    candidateIds: [candidateId],
    rankingConfigVersion: 'trend-ranking/1.0.0',
  };
  return {
    idempotencyKey: key,
    run,
    sourceRuns: [sourceRun],
    observations: [
      {
        candidate,
        snapshot,
        reappearanceReason: reason,
        previousPosition,
        currentPosition: position,
      },
    ],
  };
}

function metric(value: any) {
  return value === undefined
    ? { availability: 'UNAVAILABLE', reason: 'NOT_RETURNED' }
    : { availability: 'AVAILABLE', value };
}

export function cluster() {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: 'cluster-1',
    label: 'Assunto',
    niche: 'entretenimento',
    subtheme: 'vídeos curtos',
    likelyAudience: 'público brasileiro',
    narrativePattern: 'explicação direta',
    localization: 'adaptável ao contexto brasileiro',
    candidateIds: ['candidate-1'],
    evidenceSnapshotIds: ['snapshot-1'],
    createdBy: 'HUMAN',
    explanation: 'Agrupamento manual baseado na observação.',
  };
}

export function score() {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: 'score-1',
    candidateId: 'candidate-1',
    formulaVersion: 'trend-score/1.0.0',
    calculatedAt: DAY_ONE,
    value: 50,
    confidence: 0.75,
    components: {
      velocity: {
        availability: 'AVAILABLE',
        value: 50,
        evidenceSnapshotIds: ['snapshot-1'],
      },
      engagement: {
        availability: 'UNAVAILABLE',
        reason: 'MISSING_METRICS',
        evidenceSnapshotIds: ['snapshot-1'],
      },
      recency: {
        availability: 'AVAILABLE',
        value: 50,
        evidenceSnapshotIds: ['snapshot-1'],
      },
      recurrence: {
        availability: 'AVAILABLE',
        value: 50,
        evidenceSnapshotIds: ['snapshot-1'],
      },
    },
    explanation: 'Score persistido, não calculado neste tópico.',
  };
}

export function researchInput(
  networks: string[] = ['instagram', 'threads', 'tiktok', 'youtube'],
  overrides: any = {},
) {
  const projectId = overrides.projectId ?? 'canal_educacao';
  const projectVersion = overrides.projectVersion ?? 1;
  return {
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution: {
      pipelineRunId: overrides.pipelineRunId ?? 'pipeline_e02_r02_001',
      projectId,
      projectVersion,
      startedAt: DAY_ONE,
    },
    window: { logicalDate: '2026-09-26' },
    projectSnapshot: {
      schemaVersion: PROJECT_CONTRACT_VERSION,
      project: {
        id: projectId,
        name: 'Canal Educação',
        version: projectVersion,
        niche: overrides.niche ?? 'educação',
        subniches: ['ciência prática'],
        audience: {
          profile: 'adultos curiosos',
          language: overrides.language ?? 'pt-BR',
        },
      },
      channel: {
        format: 'short_video',
        aspectRatio: '9:16',
        minDurationSeconds: 25,
        maxDurationSeconds: 45,
        editorialStyle: 'informative',
        visualStyle: 'dynamic',
        voiceStyle: 'informative',
        publishing: {
          contentsPerDay: 1,
          networks,
          timezone: 'America/Sao_Paulo',
          times: ['10:00'],
        },
      },
      references: [],
    },
  };
}
