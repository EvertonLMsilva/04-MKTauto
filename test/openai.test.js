import test from "node:test";
import assert from "node:assert/strict";
import { extractOutputText, identifyCandidates } from "../src/adapters/openai.js";

const signal = { id: "youtube:1", title: "Jogo brasileiro", rightsState: "unknown" };
const candidate = {
  name: "Jogos brasileiros",
  macroNiche: "jogos",
  summary: "Resumo",
  evidenceIds: ["youtube:1"],
  trend: { searchMomentum: 50, videoVelocity: 75, crossConfirmation: 50, persistence: 75, recency: 100 },
  viability: { usableSource: 25, transformability: 100, repeatability: 75, inverseSaturation: 50, operationalFit: 100 },
  gates: { multipleSignals: true, fourWeekSupply: true, greenSource: true, knownOrigin: true, verifiable: true, safe: true },
  explanation: "Explicação",
};

test("extrai output_text sem assumir a primeira posição", () => {
  const text = extractOutputText({ output: [
    { type: "reasoning" },
    { type: "message", content: [{ type: "output_text", text: "resultado" }] },
  ] });
  assert.equal(text, "resultado");
});
test("força fonte verde para falso em sinais do YouTube", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates: [candidate] }) }] }] }),
  });
  const result = await identifyCandidates({ apiKey: "teste", model: "teste", signals: [signal], fetchImpl });
  assert.equal(result[0].gates.greenSource, false);
});
