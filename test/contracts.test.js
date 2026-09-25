import test from "node:test";
import assert from "node:assert/strict";
import { validateCandidates } from "../src/domain/contracts.js";

const valid = {
  name: "Jogos brasileiros",
  macroNiche: "jogos",
  summary: "Resumo",
  evidenceIds: ["youtube:1"],
  trend: { searchMomentum: 50, videoVelocity: 75, crossConfirmation: 50, persistence: 75, recency: 100 },
  viability: { usableSource: 0, transformability: 100, repeatability: 75, inverseSaturation: 50, operationalFit: 100 },
  gates: { multipleSignals: true, fourWeekSupply: true, greenSource: false, knownOrigin: true, verifiable: true, safe: true },
  explanation: "Explicação baseada no sinal.",
};

test("aceita candidato ligado a uma evidência conhecida", () => {
  assert.equal(validateCandidates({ candidates: [valid] }, ["youtube:1"]).length, 1);
});
test("rejeita evidência inventada pela IA", () => {
  assert.throws(
    () => validateCandidates({ candidates: [{ ...valid, evidenceIds: ["youtube:inventado"] }] }, ["youtube:1"]),
    /Evidência desconhecida/,
  );
});

test("rejeita score fora do intervalo", () => {
  const invalid = { ...valid, trend: { ...valid.trend, recency: 101 } };
  assert.throws(() => validateCandidates({ candidates: [invalid] }, ["youtube:1"]), /entre 0 e 100/);
});

test("rejeita nome de candidato duplicado", () => {
  assert.throws(
    () => validateCandidates({ candidates: [valid, { ...valid }] }, ["youtube:1"]),
    /duplicado/,
  );
});
