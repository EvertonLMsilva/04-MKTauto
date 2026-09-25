import test from "node:test";
import assert from "node:assert/strict";
import { identifyCandidates } from "../src/adapters/ollama.js";

const signals = Array.from({ length: 20 }, (_, index) => ({
  id: `youtube:${index + 1}`,
  title: `Sinal ${index + 1}`,
  rightsState: "unknown",
}));
const macroNiches = ["jogos", "música", "esportes", "automóveis", "educação"];
const candidates = signals.map((signal, index) => ({
  name: `Candidato ${index + 1}`,
  macroNiche: macroNiches[index % macroNiches.length],
  summary: "Resumo",
  evidenceIds: [signal.id],
  trend: { searchMomentum: 50, videoVelocity: 75, crossConfirmation: 50, persistence: 75, recency: 100 },
  viability: { usableSource: 25, transformability: 100, repeatability: 75, inverseSaturation: 50, operationalFit: 100 },
  gates: { multipleSignals: true, fourWeekSupply: true, greenSource: true, knownOrigin: true, verifiable: true, safe: true },
  explanation: "Explicação",
}));

test("usa schema estruturado local e força fonte verde para falso", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ candidates }) } }),
    };
  };

  const result = await identifyCandidates({
    model: "qwen3:4b",
    signals,
    fetchImpl,
  });

  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(request.body.model, "qwen3:4b");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.options.num_ctx, 16_384);
  assert.equal(request.body.format.properties.candidates.minItems, 20);
  assert.equal(request.body.format.properties.candidates.items.properties.evidenceIds.minItems, 2);
  assert.equal(result.length, 20);
  assert.equal(result[0].gates.greenSource, false);
  assert.equal(result[0].gates.multipleSignals, false);
});
