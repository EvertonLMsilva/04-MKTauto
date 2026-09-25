const REQUIRED_GATES = [
  "multipleSignals",
  "fourWeekSupply",
  "greenSource",
  "knownOrigin",
  "verifiable",
  "safe",
];

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
