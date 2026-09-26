import { createHash } from "node:crypto";
import { proposeTopicClusters } from "./adapters/ollama.js";
import {
  RADAR_CONTRACT_VERSION,
  validateAiTopicProposal,
  validateTopicCluster,
} from "./domain/contracts.js";
import {
  DEFAULT_TREND_RANKING_CONFIG,
  calculateTrendScores,
  rankTrendCandidates,
  validateTrendRankingConfig,
} from "./domain/ranking.js";

export async function analyzeTrendRun({
  store,
  runId,
  idempotencyKey,
  model,
  config = DEFAULT_TREND_RANKING_CONFIG,
  now = new Date().toISOString(),
  clusterer = proposeTopicClusters,
  fetchImpl,
}) {
  if (!store || typeof store.getRun !== "function" || typeof store.recordAnalysis !== "function") {
    throw new Error("TrendCatalogStore inválido");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") throw new Error("idempotencyKey obrigatório");
  validateTrendRankingConfig(config);
  const prior = store.getOperation(idempotencyKey);
  if (prior && prior.topicClusters.length > 0 && prior.scores.length > 0) return resultFromCatalog(prior, config);

  const catalog = store.getRun(runId);
  if (!catalog) throw new Error(`Run não encontrada: ${runId}`);
  if (catalog.candidates.length === 0) {
    return { catalog, ranked: [], top: [], gaps: [`INSUFFICIENT_ELIGIBLE_CANDIDATES:0/${config.candidateLimit}`] };
  }
  const histories = new Map(catalog.candidates.map(({ id }) => [id, store.getCandidateHistory(id)]));
  const evidence = catalog.candidates.map((candidate) => ({
    candidateId: candidate.id,
    title: candidate.title ?? "Título público indisponível",
    category: candidate.category ?? "Categoria pública indisponível",
    author: candidate.author ?? "Autor público indisponível",
    region: candidate.region ?? "Região indisponível",
    language: candidate.language ?? "Idioma indisponível",
    publishedAt: candidate.publishedAt,
    durationSeconds: candidate.durationSeconds,
    snapshots: histories.get(candidate.id).snapshots.map(({ id, capturedAt, metrics }) => ({ id, capturedAt, metrics })),
  }));
  const proposals = await clusterer({ model, evidence, ...(fetchImpl ? { fetchImpl } : {}) });
  if (!Array.isArray(proposals) || proposals.length === 0) throw new Error("O agrupador não retornou clusters");
  const knownCandidateIds = catalog.candidates.map(({ id }) => id);
  const snapshotOwner = new Map(evidence.flatMap(({ candidateId, snapshots }) => snapshots.map(({ id }) => [id, candidateId])));
  const knownSnapshotIds = [...snapshotOwner.keys()];
  const topicClusters = proposals.map((proposal) => {
    const validated = validateAiTopicProposal(proposal, knownCandidateIds, knownSnapshotIds);
    for (const snapshotId of validated.evidenceSnapshotIds) {
      if (!validated.candidateIds.includes(snapshotOwner.get(snapshotId))) {
        throw new Error(`Snapshot ${snapshotId} não pertence aos candidatos propostos`);
      }
    }
    return validateTopicCluster({
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: stableId("topic", `${runId}:${stableJson(validated)}`),
      ...validated,
      createdBy: "OLLAMA",
    }, knownCandidateIds, knownSnapshotIds);
  });
  ensureCompleteUniqueMembership(topicClusters, knownCandidateIds);
  const scores = calculateTrendScores({ candidates: catalog.candidates, histories, clusters: topicClusters, config, now });
  const persisted = store.recordAnalysis({ idempotencyKey, runId, topicClusters, scores });
  return resultFromCatalog(persisted, config);
}

function resultFromCatalog(catalog, config) {
  const ranking = rankTrendCandidates({
    candidates: catalog.candidates,
    scores: catalog.scores,
    clusters: catalog.topicClusters,
    config,
  });
  return { catalog, ...ranking };
}

function ensureCompleteUniqueMembership(clusters, candidateIds) {
  const assigned = new Set();
  for (const cluster of clusters) {
    for (const candidateId of cluster.candidateIds) {
      if (assigned.has(candidateId)) throw new Error(`Candidato presente em mais de um cluster: ${candidateId}`);
      assigned.add(candidateId);
    }
  }
  const missing = candidateIds.filter((candidateId) => !assigned.has(candidateId));
  if (missing.length > 0) throw new Error(`Candidatos sem cluster: ${missing.join(", ")}`);
}

function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
