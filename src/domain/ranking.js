import { createHash } from "node:crypto";
import { TREND_SCORE_VERSION, validateTrendCandidate } from "./contracts.js";
import { calculateHistoricalVelocity } from "./velocity.js";

const REQUIRED_GATES = [
  "multipleSignals",
  "fourWeekSupply",
  "greenSource",
  "knownOrigin",
  "verifiable",
  "safe",
];

export const TREND_RANKING_CONFIG_VERSION = "trend-ranking/1.0.0";
export const TREND_SCORE_COMPONENTS = Object.freeze([
  "velocity",
  "engagement",
  "recency",
  "recurrence",
]);
export const DEFAULT_TREND_REGIONS = Object.freeze([
  "BR", "US", "MX", "GB", "ES", "IN", "JP", "KR",
]);
export const DEFAULT_TREND_RANKING_CONFIG = Object.freeze({
  version: TREND_RANKING_CONFIG_VERSION,
  candidateLimit: 20,
  topLimit: 5,
  eligibleDurationSeconds: Object.freeze({ min: 15, max: 180 }),
  regions: DEFAULT_TREND_REGIONS,
  diversity: Object.freeze({ maxPerPlatform: 10, maxPerRegion: 8, maxPerTopic: 4 }),
  componentWeights: Object.freeze({ velocity: 0.35, engagement: 0.25, recency: 0.2, recurrence: 0.2 }),
});

export function validateTrendRankingConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("trendRankingConfig deve ser objeto");
  }
  const expectedKeys = [
    "version", "candidateLimit", "topLimit", "eligibleDurationSeconds",
    "regions", "diversity", "componentWeights",
  ];
  assertExactKeys(config, expectedKeys, "trendRankingConfig");
  if (config.version !== TREND_RANKING_CONFIG_VERSION) {
    throw new Error(`version deve ser ${TREND_RANKING_CONFIG_VERSION}`);
  }
  if (config.candidateLimit !== 20) throw new Error("candidateLimit deve ser 20");
  if (config.topLimit !== 5) throw new Error("topLimit deve ser 5");
  if (!Array.isArray(config.regions) || config.regions.length === 0 || new Set(config.regions).size !== config.regions.length) {
    throw new Error("regions deve ser uma lista não vazia e sem duplicatas");
  }
  for (const region of config.regions) {
    if (typeof region !== "string" || !/^[A-Z]{2}$/.test(region)) throw new Error(`região inválida: ${region}`);
  }
  assertExactKeys(config.eligibleDurationSeconds, ["min", "max"], "eligibleDurationSeconds");
  if (config.eligibleDurationSeconds.min !== 15 || config.eligibleDurationSeconds.max !== 180) {
    throw new Error("eligibleDurationSeconds deve abranger 15 a 180 segundos");
  }
  assertExactKeys(config.diversity, ["maxPerPlatform", "maxPerRegion", "maxPerTopic"], "diversity");
  for (const [key, value] of Object.entries(config.diversity)) {
    if (!Number.isInteger(value) || value < 1 || value > config.candidateLimit) {
      throw new Error(`diversity.${key} deve ser inteiro entre 1 e ${config.candidateLimit}`);
    }
  }
  assertExactKeys(config.componentWeights, TREND_SCORE_COMPONENTS, "componentWeights");
  const total = Object.values(config.componentWeights).reduce((sum, value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("componentWeights devem estar entre 0 e 1");
    return sum + value;
  }, 0);
  if (Math.abs(total - 1) > 0.00001) throw new Error(`componentWeights deve somar 1; total recebido: ${total}`);
  return config;
}

export function weightedScore(components, weights) {
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key];
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Componente ${key} deve estar entre 0 e 100`);
    }
    score += value * weight;
  }
  return round(score);
}

export function calculateTrendScores({
  candidates,
  histories,
  clusters,
  config = DEFAULT_TREND_RANKING_CONFIG,
  now = new Date().toISOString(),
}) {
  validateTrendRankingConfig(config);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("now deve ser data ISO 8601 válida");
  const historyByCandidate = histories instanceof Map ? histories : new Map(Object.entries(histories));
  return candidates.map((candidate) => {
    validateTrendCandidate(candidate);
    const snapshots = [...(historyByCandidate.get(candidate.id)?.snapshots ?? [])]
      .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.id.localeCompare(right.id));
    const latest = snapshots.at(-1);
    const relatedCluster = clusters.find((cluster) => cluster.candidateIds.includes(candidate.id));
    const components = {
      velocity: velocityComponent(snapshots),
      engagement: engagementComponent(latest),
      recency: recencyComponent(candidate, latest, nowMs),
      recurrence: recurrenceComponent(relatedCluster, candidates, latest),
    };
    const confidence = round(Object.entries(config.componentWeights)
      .reduce((sum, [name, weight]) => sum + (components[name].availability === "AVAILABLE" ? weight : 0), 0));
    const weightedAvailable = Object.entries(config.componentWeights)
      .reduce((sum, [name, weight]) => sum + (components[name].availability === "AVAILABLE" ? components[name].value * weight : 0), 0);
    const value = confidence === 0 ? 0 : round(weightedAvailable / confidence);
    const availableNames = TREND_SCORE_COMPONENTS.filter((name) => components[name].availability === "AVAILABLE");
    const unavailableNames = TREND_SCORE_COMPONENTS.filter((name) => components[name].availability === "UNAVAILABLE");
    return {
      schemaVersion: candidate.schemaVersion,
      id: `score:${createHash("sha256").update(`${candidate.id}:${now}`).digest("hex").slice(0, 24)}`,
      candidateId: candidate.id,
      formulaVersion: TREND_SCORE_VERSION,
      calculatedAt: now,
      value,
      confidence,
      components,
      explanation: `Score determinístico com ${availableNames.join(", ") || "nenhum componente disponível"}; indisponíveis: ${unavailableNames.join(", ") || "nenhum"}. Evidências: ${unique(Object.values(components).flatMap(({ evidenceSnapshotIds }) => evidenceSnapshotIds)).join(", ")}.`,
    };
  });
}

export function rankTrendCandidates({
  candidates,
  scores,
  clusters,
  config = DEFAULT_TREND_RANKING_CONFIG,
}) {
  validateTrendRankingConfig(config);
  const scoreByCandidate = new Map(scores.map((score) => [score.candidateId, score]));
  const topicByCandidate = new Map(clusters.flatMap((cluster) => cluster.candidateIds.map((id) => [id, cluster.id])));
  const eligible = candidates
    .filter((candidate) => candidate.rankingExclusionReason === undefined)
    .filter((candidate) => durationValue(candidate.durationSeconds) >= config.eligibleDurationSeconds.min
      && durationValue(candidate.durationSeconds) <= config.eligibleDurationSeconds.max
      && scoreByCandidate.has(candidate.id))
    .map((candidate) => ({ candidate, score: scoreByCandidate.get(candidate.id), topicId: topicByCandidate.get(candidate.id) ?? `unclustered:${candidate.id}` }))
    .sort((left, right) => right.score.value - left.score.value
      || right.score.confidence - left.score.confidence
      || Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt)
      || left.candidate.id.localeCompare(right.candidate.id));

  const selected = [];
  const deferred = [];
  const counts = { platform: new Map(), region: new Map(), topic: new Map() };
  for (const item of eligible) {
    if (selected.length >= config.candidateLimit) break;
    const dimensions = diversityDimensions(item);
    const permitted = dimensions.every(([dimension, value, limit]) => (counts[dimension].get(value) ?? 0) < limit);
    if (!permitted) deferred.push(item);
    else addSelected(selected, counts, item);
  }
  const gaps = [];
  if (selected.length < Math.min(config.candidateLimit, eligible.length)) {
    gaps.push("DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE");
    for (const item of deferred) {
      if (selected.length >= config.candidateLimit) break;
      addSelected(selected, counts, item);
    }
  }
  if (selected.length < config.candidateLimit) gaps.push(`INSUFFICIENT_ELIGIBLE_CANDIDATES:${selected.length}/${config.candidateLimit}`);
  const ranked = selected.map((item, index) => ({ ...item, position: index + 1 }));
  return { ranked, top: ranked.slice(0, config.topLimit), gaps };

  function diversityDimensions(item) {
    return [
      ["platform", item.candidate.platform, config.diversity.maxPerPlatform],
      ["region", item.candidate.region ?? "UNAVAILABLE", config.diversity.maxPerRegion],
      ["topic", item.topicId, config.diversity.maxPerTopic],
    ];
  }
}

function durationValue(value) {
  if (Number.isFinite(value)) return value;
  return value?.availability === "AVAILABLE" && Number.isFinite(value.value) ? value.value : Number.NaN;
}

function velocityComponent(snapshots) {
  const results = calculateHistoricalVelocity(snapshots).map(({ result }) => result);
  const latest = results.at(-1);
  if (!latest || latest.availability !== "AVAILABLE") {
    const evidenceSnapshotIds = latest?.evidenceSnapshotIds ?? snapshots.slice(-1).map(({ id }) => id);
    return unavailable(latest?.reason ?? "INSUFFICIENT_HISTORY", evidenceSnapshotIds);
  }
  return available(Math.min(100, round(Math.log10(1 + latest.valuePerHour) * 20)), latest.evidenceSnapshotIds);
}

function engagementComponent(snapshot) {
  if (!snapshot) return unavailable("MISSING_SNAPSHOT", []);
  const evidence = [snapshot.id];
  const views = snapshot.metrics.views;
  if (views.availability !== "AVAILABLE" || views.value <= 0) return unavailable("MISSING_VALID_DENOMINATOR", evidence);
  const interactions = ["likes", "comments", "shares"]
    .map((name) => snapshot.metrics[name])
    .filter((metric) => metric.availability === "AVAILABLE");
  if (interactions.length === 0) return unavailable("MISSING_INTERACTION_METRICS", evidence);
  const total = interactions.reduce((sum, metric) => sum + metric.value, 0);
  return available(Math.min(100, round((total / views.value) * 1_000)), evidence);
}

function recencyComponent(candidate, snapshot, nowMs) {
  const evidence = snapshot ? [snapshot.id] : [];
  const ageHours = (nowMs - Date.parse(candidate.publishedAt)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0) return unavailable("INVALID_PUBLICATION_TIME", evidence);
  return available(Math.max(0, round(100 - (ageHours / 168) * 100)), evidence);
}

function recurrenceComponent(cluster, candidates, latestSnapshot) {
  if (!cluster) return unavailable("NO_TOPIC_CLUSTER", latestSnapshot ? [latestSnapshot.id] : []);
  const members = candidates.filter(({ id }) => cluster.candidateIds.includes(id));
  const regions = new Set(members.map(({ region }) => region).filter(Boolean));
  const platforms = new Set(members.map(({ platform }) => platform));
  const value = Math.min(100,
    Math.max(0, members.length - 1) * 25
      + Math.max(0, regions.size - 1) * 15
      + Math.max(0, platforms.size - 1) * 20);
  return available(value, cluster.evidenceSnapshotIds);
}

function available(value, evidenceSnapshotIds) {
  return { availability: "AVAILABLE", value, evidenceSnapshotIds: unique(evidenceSnapshotIds) };
}

function unavailable(reason, evidenceSnapshotIds) {
  return { availability: "UNAVAILABLE", reason, evidenceSnapshotIds: unique(evidenceSnapshotIds) };
}

function addSelected(selected, counts, item) {
  selected.push(item);
  for (const [dimension, value] of [
    ["platform", item.candidate.platform],
    ["region", item.candidate.region ?? "UNAVAILABLE"],
    ["topic", item.topicId],
  ]) counts[dimension].set(value, (counts[dimension].get(value) ?? 0) + 1);
}

function unique(values) {
  return [...new Set(values)];
}
export function scoreCandidate(candidate, config) {
  const trendScore = weightedScore(candidate.trend, config.trendWeights);
  const viabilityScore = weightedScore(
    candidate.viability,
    config.viabilityWeights,
  );
  const finalScore = round(
    trendScore * config.finalWeights.trend +
      viabilityScore * config.finalWeights.viability,
  );
  const failedGates = REQUIRED_GATES.filter((gate) => candidate.gates[gate] !== true);

  return {
    ...candidate,
    trendScore,
    viabilityScore,
    finalScore,
    eligible: failedGates.length === 0,
    failedGates,
  };
}

export function rankCandidates(candidates, config) {
  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, config))
    .sort((left, right) => right.finalScore - left.finalScore || left.name.localeCompare(right.name));

  const top = selectDiverse(scored.filter((candidate) => candidate.eligible), config);
  const provisionalTop = selectDiverse(
    scored.filter((candidate) =>
      candidate.failedGates.length === 1 && candidate.failedGates[0] === "greenSource"),
    config,
  );

  return { scored, top, provisionalTop };
}

function selectDiverse(candidates, config) {
  const macroCounts = new Map();
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= config.topSize) break;
    const count = macroCounts.get(candidate.macroNiche) ?? 0;
    if (count >= config.maxPerMacroNiche) continue;
    macroCounts.set(candidate.macroNiche, count + 1);
    selected.push(candidate);
  }
  return selected;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function assertExactKeys(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} deve ser objeto`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(`${path} possui campos inválidos; ausentes: ${missing.join(", ")}; desconhecidos: ${unknown.join(", ")}`);
  }
}
