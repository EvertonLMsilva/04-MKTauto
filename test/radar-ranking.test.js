import test from "node:test";
import assert from "node:assert/strict";
import {
  TREND_RANKING_CONFIG_VERSION,
  validateTrendRankingConfig,
} from "../src/domain/ranking.js";

function config(overrides = {}) {
  return {
    version: TREND_RANKING_CONFIG_VERSION,
    candidateLimit: 20,
    topLimit: 5,
    regions: ["BR", "US", "MX", "GB", "ES", "IN", "JP", "KR"],
    eligibleDurationSeconds: { min: 15, max: 180 },
    diversity: { maxPerPlatform: 10, maxPerRegion: 8, maxPerTopic: 4 },
    componentWeights: { velocity: 0.35, engagement: 0.25, recency: 0.2, recurrence: 0.2 },
    ...overrides,
  };
}

test("valida limites 20/top 5, duração e diversidade configurável", () => {
  const value = validateTrendRankingConfig(config());
  assert.equal(value.candidateLimit, 20);
  assert.equal(value.topLimit, 5);
  assert.deepEqual(value.eligibleDurationSeconds, { min: 15, max: 180 });
});

test("rejeita limites, duração, diversidade e pesos incompatíveis", () => {
  const invalid = [
    config({ candidateLimit: 19 }),
    config({ topLimit: 6 }),
    config({ regions: ["BR", "br"] }),
    config({ eligibleDurationSeconds: { min: 14, max: 180 } }),
    config({ diversity: { maxPerPlatform: 21, maxPerRegion: 8, maxPerTopic: 4 } }),
    config({ componentWeights: { velocity: 1, engagement: 1, recency: 0, recurrence: 0 } }),
  ];
  for (const value of invalid) assert.throws(() => validateTrendRankingConfig(value));
});
