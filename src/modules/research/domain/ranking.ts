import { createHash } from 'node:crypto';
import {
  TREND_SCORE_VERSION,
  validateTrendCandidate,
} from './research-record-contracts.js';
import { calculateHistoricalVelocity } from './velocity.js';

export const TREND_RANKING_CONFIG_VERSION: any = 'trend-ranking/1.0.0';
export const TREND_SCORE_COMPONENTS: any = Object.freeze([
  'velocity',
  'engagement',
  'recency',
  'recurrence',
]);
export const DEFAULT_TREND_REGIONS: any = Object.freeze([
  'BR',
  'US',
  'MX',
  'GB',
  'ES',
  'IN',
  'JP',
  'KR',
]);
export const DEFAULT_TREND_RANKING_CONFIG: any = Object.freeze({
  version: TREND_RANKING_CONFIG_VERSION,
  candidateLimit: 20,
  topLimit: 5,
  eligibleDurationSeconds: Object.freeze({ min: 15, max: 180 }),
  regions: DEFAULT_TREND_REGIONS,
  diversity: Object.freeze({
    maxPerPlatform: 10,
    maxPerRegion: 8,
    maxPerTopic: 4,
  }),
  componentWeights: Object.freeze({
    velocity: 0.35,
    engagement: 0.25,
    recency: 0.2,
    recurrence: 0.2,
  }),
});

export function validateTrendRankingConfig(config: any): any {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('trendRankingConfig deve ser objeto');
  }
  const expectedKeys: any = [
    'version',
    'candidateLimit',
    'topLimit',
    'eligibleDurationSeconds',
    'regions',
    'diversity',
    'componentWeights',
  ];
  assertExactKeys(config, expectedKeys, 'trendRankingConfig');
  if (config.version !== TREND_RANKING_CONFIG_VERSION) {
    throw new Error(`version deve ser ${TREND_RANKING_CONFIG_VERSION}`);
  }
  if (config.candidateLimit !== 20)
    throw new Error('candidateLimit deve ser 20');
  if (config.topLimit !== 5) throw new Error('topLimit deve ser 5');
  if (
    !Array.isArray(config.regions) ||
    config.regions.length === 0 ||
    new Set(config.regions).size !== config.regions.length
  ) {
    throw new Error('regions deve ser uma lista não vazia e sem duplicatas');
  }
  for (const region of config.regions) {
    if (typeof region !== 'string' || !/^[A-Z]{2}$/.test(region))
      throw new Error(`região inválida: ${region}`);
  }
  assertExactKeys(
    config.eligibleDurationSeconds,
    ['min', 'max'],
    'eligibleDurationSeconds',
  );
  if (
    config.eligibleDurationSeconds.min !== 15 ||
    config.eligibleDurationSeconds.max !== 180
  ) {
    throw new Error('eligibleDurationSeconds deve abranger 15 a 180 segundos');
  }
  assertExactKeys(
    config.diversity,
    ['maxPerPlatform', 'maxPerRegion', 'maxPerTopic'],
    'diversity',
  );
  for (const [key, value] of entries(config.diversity)) {
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > config.candidateLimit
    ) {
      throw new Error(
        `diversity.${key} deve ser inteiro entre 1 e ${config.candidateLimit}`,
      );
    }
  }
  assertExactKeys(
    config.componentWeights,
    TREND_SCORE_COMPONENTS,
    'componentWeights',
  );
  const total: any = Object.values(config.componentWeights).reduce(
    (sum: any, value: any): any => {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error('componentWeights devem estar entre 0 e 1');
      return sum + value;
    },
    0,
  );
  if (Math.abs(total - 1) > 0.00001)
    throw new Error(`componentWeights deve somar 1; total recebido: ${total}`);
  return config;
}

export function weightedScore(components: any, weights: any): any {
  let score: any = 0;
  for (const [key, weight] of entries(weights)) {
    const value: any = components[key];
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
}: any): any {
  validateTrendRankingConfig(config);
  const nowMs: any = Date.parse(now);
  if (!Number.isFinite(nowMs))
    throw new Error('now deve ser data ISO 8601 válida');
  const historyByCandidate: any =
    histories instanceof Map ? histories : new Map(entries(histories));
  return candidates.map((candidate: any): any => {
    validateTrendCandidate(candidate);
    const snapshots: any = [
      ...(historyByCandidate.get(candidate.id)?.snapshots ?? []),
    ].sort(
      (left: any, right: any): any =>
        Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
        left.id.localeCompare(right.id),
    );
    const latest: any = snapshots.at(-1);
    const relatedCluster: any = clusters.find((cluster: any): any =>
      cluster.candidateIds.includes(candidate.id),
    );
    const components: any = {
      velocity: velocityComponent(snapshots),
      engagement: engagementComponent(latest),
      recency: recencyComponent(candidate, latest, nowMs),
      recurrence: recurrenceComponent(relatedCluster, candidates, latest),
    };
    const confidence: any = round(
      entries(config.componentWeights).reduce(
        (sum: any, [name, weight]: any): any =>
          sum + (components[name].availability === 'AVAILABLE' ? weight : 0),
        0,
      ),
    );
    const weightedAvailable: any = entries(config.componentWeights).reduce(
      (sum: any, [name, weight]: any): any =>
        sum +
        (components[name].availability === 'AVAILABLE'
          ? components[name].value * weight
          : 0),
      0,
    );
    const value: any =
      confidence === 0 ? 0 : round(weightedAvailable / confidence);
    const availableNames: any = TREND_SCORE_COMPONENTS.filter(
      (name: any): any => components[name].availability === 'AVAILABLE',
    );
    const unavailableNames: any = TREND_SCORE_COMPONENTS.filter(
      (name: any): any => components[name].availability === 'UNAVAILABLE',
    );
    return {
      schemaVersion: candidate.schemaVersion,
      id: `score:${createHash('sha256').update(`${candidate.id}:${now}`).digest('hex').slice(0, 24)}`,
      candidateId: candidate.id,
      formulaVersion: TREND_SCORE_VERSION,
      calculatedAt: now,
      value,
      confidence,
      components,
      explanation: `Score determinístico com ${availableNames.join(', ') || 'nenhum componente disponível'}; indisponíveis: ${unavailableNames.join(', ') || 'nenhum'}. Evidências: ${unique(Object.values(components).flatMap(({ evidenceSnapshotIds }: any): any => evidenceSnapshotIds)).join(', ')}.`,
    };
  });
}

export function rankTrendCandidates({
  candidates,
  scores,
  clusters,
  config = DEFAULT_TREND_RANKING_CONFIG,
}: any): any {
  validateTrendRankingConfig(config);
  const scoreByCandidate: any = new Map(
    scores.map((score: any): any => [score.candidateId, score]),
  );
  const topicByCandidate: any = new Map(
    clusters.flatMap((cluster: any): any =>
      cluster.candidateIds.map((id: any): any => [id, cluster.id]),
    ),
  );
  const eligible: any = candidates
    .filter(
      (candidate: any): any => candidate.rankingExclusionReason === undefined,
    )
    .filter(
      (candidate: any): any =>
        durationValue(candidate.durationSeconds) >=
          config.eligibleDurationSeconds.min &&
        durationValue(candidate.durationSeconds) <=
          config.eligibleDurationSeconds.max &&
        scoreByCandidate.has(candidate.id),
    )
    .map((candidate: any): any => ({
      candidate,
      score: scoreByCandidate.get(candidate.id),
      topicId:
        topicByCandidate.get(candidate.id) ?? `unclustered:${candidate.id}`,
    }))
    .sort(
      (left: any, right: any): any =>
        right.score.value - left.score.value ||
        right.score.confidence - left.score.confidence ||
        Date.parse(right.candidate.publishedAt) -
          Date.parse(left.candidate.publishedAt) ||
        left.candidate.id.localeCompare(right.candidate.id),
    );

  const selected: any = [];
  const deferred: any = [];
  const counts: any = {
    platform: new Map(),
    region: new Map(),
    topic: new Map(),
  };
  for (const item of eligible) {
    if (selected.length >= config.candidateLimit) break;
    const dimensions: any = diversityDimensions(item);
    const permitted: any = dimensions.every(
      ([dimension, value, limit]: any): any =>
        (counts[dimension].get(value) ?? 0) < limit,
    );
    if (!permitted) deferred.push(item);
    else addSelected(selected, counts, item);
  }
  const gaps: any = [];
  if (selected.length < Math.min(config.candidateLimit, eligible.length)) {
    gaps.push('DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE');
    for (const item of deferred) {
      if (selected.length >= config.candidateLimit) break;
      addSelected(selected, counts, item);
    }
  }
  if (selected.length < config.candidateLimit)
    gaps.push(
      `INSUFFICIENT_ELIGIBLE_CANDIDATES:${selected.length}/${config.candidateLimit}`,
    );
  const ranked: any = selected.map((item: any, index: any): any => ({
    ...item,
    position: index + 1,
  }));
  return { ranked, top: ranked.slice(0, config.topLimit), gaps };

  function diversityDimensions(item: any): any {
    return [
      ['platform', item.candidate.platform, config.diversity.maxPerPlatform],
      [
        'region',
        item.candidate.region ?? 'UNAVAILABLE',
        config.diversity.maxPerRegion,
      ],
      ['topic', item.topicId, config.diversity.maxPerTopic],
    ];
  }
}

function durationValue(value: any): any {
  if (Number.isFinite(value)) return value;
  return value?.availability === 'AVAILABLE' && Number.isFinite(value.value)
    ? value.value
    : Number.NaN;
}

function velocityComponent(snapshots: any): any {
  const results: any = calculateHistoricalVelocity(snapshots).map(
    ({ result }: any): any => result,
  );
  const latest: any = results.at(-1);
  if (!latest || latest.availability !== 'AVAILABLE') {
    const evidenceSnapshotIds: any =
      latest?.evidenceSnapshotIds ??
      snapshots.slice(-1).map(({ id }: any): any => id);
    return unavailable(
      latest?.reason ?? 'INSUFFICIENT_HISTORY',
      evidenceSnapshotIds,
    );
  }
  return available(
    Math.min(100, round(Math.log10(1 + latest.valuePerHour) * 20)),
    latest.evidenceSnapshotIds,
  );
}

function engagementComponent(snapshot: any): any {
  if (!snapshot) return unavailable('MISSING_SNAPSHOT', []);
  const evidence: any = [snapshot.id];
  const views: any = snapshot.metrics.views;
  if (views.availability !== 'AVAILABLE' || views.value <= 0)
    return unavailable('MISSING_VALID_DENOMINATOR', evidence);
  const interactions: any = ['likes', 'comments', 'shares']
    .map((name: any): any => snapshot.metrics[name])
    .filter((metric: any): any => metric.availability === 'AVAILABLE');
  if (interactions.length === 0)
    return unavailable('MISSING_INTERACTION_METRICS', evidence);
  const total: any = interactions.reduce(
    (sum: any, metric: any): any => sum + metric.value,
    0,
  );
  return available(
    Math.min(100, round((total / views.value) * 1_000)),
    evidence,
  );
}

function recencyComponent(candidate: any, snapshot: any, nowMs: any): any {
  const evidence: any = snapshot ? [snapshot.id] : [];
  const ageHours: any = (nowMs - Date.parse(candidate.publishedAt)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0)
    return unavailable('INVALID_PUBLICATION_TIME', evidence);
  return available(Math.max(0, round(100 - (ageHours / 168) * 100)), evidence);
}

function recurrenceComponent(
  cluster: any,
  candidates: any,
  latestSnapshot: any,
): any {
  if (!cluster)
    return unavailable(
      'NO_TOPIC_CLUSTER',
      latestSnapshot ? [latestSnapshot.id] : [],
    );
  const members: any = candidates.filter(({ id }: any): any =>
    cluster.candidateIds.includes(id),
  );
  const regions: any = new Set(
    members.map(({ region }: any): any => region).filter(Boolean),
  );
  const platforms: any = new Set(
    members.map(({ platform }: any): any => platform),
  );
  const value: any = Math.min(
    100,
    Math.max(0, members.length - 1) * 25 +
      Math.max(0, regions.size - 1) * 15 +
      Math.max(0, platforms.size - 1) * 20,
  );
  return available(value, cluster.evidenceSnapshotIds);
}

function available(value: any, evidenceSnapshotIds: any): any {
  return {
    availability: 'AVAILABLE',
    value,
    evidenceSnapshotIds: unique(evidenceSnapshotIds),
  };
}

function unavailable(reason: any, evidenceSnapshotIds: any): any {
  return {
    availability: 'UNAVAILABLE',
    reason,
    evidenceSnapshotIds: unique(evidenceSnapshotIds),
  };
}

function addSelected(selected: any, counts: any, item: any): any {
  selected.push(item);
  for (const [dimension, value] of [
    ['platform', item.candidate.platform],
    ['region', item.candidate.region ?? 'UNAVAILABLE'],
    ['topic', item.topicId],
  ])
    counts[dimension].set(value, (counts[dimension].get(value) ?? 0) + 1);
}

function unique(values: any): any {
  return [...new Set(values)];
}

function round(value: any): any {
  return Math.round(value * 100) / 100;
}
function assertExactKeys(value: any, keys: any, path: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} deve ser objeto`);
  const actual: any = Object.keys(value);
  const unknown: any = actual.filter((key: any): any => !keys.includes(key));
  const missing: any = keys.filter(
    (key: any): any => !Object.hasOwn(value, key),
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `${path} possui campos inválidos; ausentes: ${missing.join(', ')}; desconhecidos: ${unknown.join(', ')}`,
    );
  }
}

function entries(value: any): [string, any][] {
  return Object.entries(value);
}
