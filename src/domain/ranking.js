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
