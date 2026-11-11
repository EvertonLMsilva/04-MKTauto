import { createHash } from 'node:crypto';
import { TrendStoreError } from '../domain/research.errors.js';

import {
  RADAR_CONTRACT_VERSION,
  validateAiTopicProposal,
  validateTopicCluster,
} from '../domain/research-record-contracts.js';
import {
  DEFAULT_TREND_RANKING_CONFIG,
  calculateTrendScores,
  rankTrendCandidates,
  validateTrendRankingConfig,
} from '../domain/ranking.js';

export async function analyzeTrendRun({
  store,
  runId,
  idempotencyKey,
  model,
  config = DEFAULT_TREND_RANKING_CONFIG,
  now = new Date().toISOString(),
  clusterer,
  analysisContext,
  historyScope,
  fetchImpl,
}: any): Promise<any> {
  if (
    !store ||
    typeof store.getRun !== 'function' ||
    typeof store.recordAnalysis !== 'function'
  ) {
    throw new Error('TrendCatalogStore inválido');
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '')
    throw new TrendStoreError(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey obrigatório',
    );
  if (typeof clusterer !== 'function')
    throw new Error('LOCAL_CLUSTERER_REQUIRED');
  try {
    validateTrendRankingConfig(config);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new TrendStoreError('INVALID_RANKING_CONFIG', error.message, {
      cause: error,
    });
  }
  const prior: any = await store.getOperation(idempotencyKey);
  if (prior && prior.topicClusters.length > 0 && prior.scores.length > 0)
    return resultFromCatalog(prior, config);

  const catalog: any = await store.getRun(runId);
  if (!catalog)
    throw new TrendStoreError('RUN_NOT_FOUND', `Run não encontrada: ${runId}`);
  if (catalog.candidates.length === 0) {
    return {
      catalog,
      ranked: [],
      top: [],
      gaps: [`INSUFFICIENT_ELIGIBLE_CANDIDATES:0/${config.candidateLimit}`],
    };
  }
  const histories: any = new Map();
  for (const { id } of catalog.candidates) {
    histories.set(
      id,
      await (historyScope &&
      typeof store.getCandidateResearchHistory === 'function'
        ? store.getCandidateResearchHistory(id, { runId, ...historyScope })
        : store.getCandidateHistory(id)),
    );
  }
  const evidence: any = catalog.candidates.map((candidate: any): any => ({
    candidateId: candidate.id,
    title: candidate.title ?? 'Título público indisponível',
    category: candidate.category ?? 'Categoria pública indisponível',
    author: candidate.author ?? 'Autor público indisponível',
    region: candidate.region ?? 'Região indisponível',
    language: candidate.language ?? 'Idioma indisponível',
    publishedAt: candidate.publishedAt,
    durationSeconds: candidate.durationSeconds,
    snapshots: catalog.snapshots
      .filter(({ candidateId }: any): any => candidateId === candidate.id)
      .map(({ id, capturedAt, metrics }: any): any => ({
        id,
        capturedAt,
        metrics,
      })),
  }));
  const proposals: any = await clusterer({
    model,
    evidence,
    language: analysisContext?.language,
    context: analysisContext,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  if (!Array.isArray(proposals) || proposals.length === 0)
    throw new TrendStoreError(
      'INVALID_CLUSTER_PROPOSALS',
      'O agrupador não retornou clusters',
    );
  const knownCandidateIds: any = catalog.candidates.map(
    ({ id }: any): any => id,
  );
  const snapshotOwner: any = new Map(
    evidence.flatMap(({ candidateId, snapshots }: any): any =>
      snapshots.map(({ id }: any): any => [id, candidateId]),
    ),
  );
  const knownSnapshotIds: any = [...snapshotOwner.keys()];
  const topicClusters: any = proposals.map((proposal: any): any => {
    const validated: any = validateAiTopicProposal(
      proposal,
      knownCandidateIds,
      knownSnapshotIds,
    );
    for (const snapshotId of validated.evidenceSnapshotIds) {
      if (!validated.candidateIds.includes(snapshotOwner.get(snapshotId))) {
        throw new TrendStoreError(
          'INVALID_CLUSTER_EVIDENCE',
          `Snapshot ${snapshotId} não pertence aos candidatos propostos`,
        );
      }
    }
    return validateTopicCluster(
      {
        schemaVersion: RADAR_CONTRACT_VERSION,
        id: stableId('topic', `${runId}:${stableJson(validated)}`),
        ...validated,
        createdBy: 'OLLAMA',
      },
      knownCandidateIds,
      knownSnapshotIds,
    );
  });
  ensureCompleteUniqueMembership(topicClusters, knownCandidateIds);
  const scores: any = calculateTrendScores({
    candidates: catalog.candidates,
    histories,
    clusters: topicClusters,
    config,
    now,
  });
  const persisted: any = await store.recordAnalysis({
    idempotencyKey,
    runId,
    topicClusters,
    scores,
  });
  return resultFromCatalog(persisted, config);
}

function resultFromCatalog(catalog: any, config: any): any {
  const ranking: any = rankTrendCandidates({
    candidates: catalog.candidates,
    scores: catalog.scores,
    clusters: catalog.topicClusters,
    config,
  });
  return { catalog, ...ranking };
}

function ensureCompleteUniqueMembership(clusters: any, candidateIds: any): any {
  const assigned: any = new Set();
  for (const cluster of clusters) {
    for (const candidateId of cluster.candidateIds) {
      if (assigned.has(candidateId))
        throw new TrendStoreError(
          'INVALID_CLUSTER_MEMBERSHIP',
          `Candidato presente em mais de um cluster: ${candidateId}`,
        );
      assigned.add(candidateId);
    }
  }
  const missing: any = candidateIds.filter(
    (candidateId: any): any => !assigned.has(candidateId),
  );
  if (missing.length > 0)
    throw new TrendStoreError(
      'INVALID_CLUSTER_MEMBERSHIP',
      `Candidatos sem cluster: ${missing.join(', ')}`,
    );
}

function stableId(prefix: any, value: any): any {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function stableJson(value: any): any {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key: any): any => `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
