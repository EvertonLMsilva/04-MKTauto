import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { rankCandidates, scoreCandidate } from "../src/domain/ranking.js";

const config = await loadConfig();

function candidate(overrides = {}) {
  return {
    name: "Candidato",
    macroNiche: "macro",
    summary: "Resumo",
    evidenceIds: ["E1"],
    trend: { searchMomentum: 100, videoVelocity: 50, crossConfirmation: 100, persistence: 100, recency: 100 },
    viability: { usableSource: 100, transformability: 100, repeatability: 100, inverseSaturation: 75, operationalFit: 100 },
    gates: { multipleSignals: true, fourWeekSupply: true, greenSource: true, knownOrigin: true, verifiable: true, safe: true },
    explanation: "Explicação",
    ...overrides,
  };
}

test("calcula os scores com os pesos configurados", () => {
  const result = scoreCandidate(candidate(), config);
  assert.equal(result.trendScore, 87.5);
  assert.equal(result.viabilityScore, 96.25);
  assert.equal(result.finalScore, 91);
  assert.equal(result.eligible, true);
});

test("bloqueia candidato sem fonte verde", () => {
  const input = candidate({ gates: { ...candidate().gates, greenSource: false } });
  const result = scoreCandidate(input, config);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failedGates, ["greenSource"]);
});

test("separa ranking provisório sem promover fonte pendente", () => {
  const input = candidate({ gates: { ...candidate().gates, greenSource: false } });
  const result = rankCandidates([input], config);
  assert.equal(result.top.length, 0);
  assert.equal(result.provisionalTop.length, 1);
  assert.deepEqual(result.provisionalTop[0].failedGates, ["greenSource"]);
});

test("limita a dois candidatos por macronicho", () => {
  const candidates = [
    candidate({ name: "A", macroNiche: "jogos" }),
    candidate({ name: "B", macroNiche: "jogos" }),
    candidate({ name: "C", macroNiche: "jogos" }),
    candidate({ name: "D", macroNiche: "clima" }),
    candidate({ name: "E", macroNiche: "finanças" }),
    candidate({ name: "F", macroNiche: "automóveis" }),
  ];
  const { top } = rankCandidates(candidates, config);
  assert.equal(top.length, 5);
  assert.equal(top.filter((item) => item.macroNiche === "jogos").length, 2);
});
