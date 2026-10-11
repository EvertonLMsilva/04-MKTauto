import test from "node:test";
import assert from "node:assert/strict";
import { identifyCandidates, proposeTopicClusters } from "../src/adapters/ollama.js";

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

test("propõe clusters somente com rótulos e referências de evidência conhecidas", async () => {
  const evidence = [{
    candidateId: "candidate-1",
    title: "Título público",
    category: "educação",
    snapshots: [{ id: "snapshot-1", capturedAt: "2026-09-26T12:00:00.000Z", metrics: {} }],
  }];
  const proposal = {
    label: "Educação prática",
    niche: "educação",
    subtheme: "aprendizado rápido",
    likelyAudience: "adultos brasileiros",
    narrativePattern: "explicação curta",
    localization: "usar exemplos brasileiros",
    candidateRefs: ["C001"],
    explanation: "O título sustenta o assunto.",
  };
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ clusters: [proposal] }) } }) };
  };
  const result = await proposeTopicClusters({
    model: "qwen3:4b", evidence, language: "es-ES",
    context: { niche: "educación", subniches: ["ciencia"], audience: "adultos", language: "es-ES" },
    fetchImpl,
  });
  const { candidateRefs: _candidateRefs, ...semanticProposal } = proposal;
  assert.deepEqual(result, [{ ...semanticProposal, candidateIds: ["candidate-1"], evidenceSnapshotIds: ["snapshot-1"] }]);
  assert.equal(request.format.properties.clusters.items.additionalProperties, false);
  assert.equal(Object.hasOwn(request.format.properties.clusters.items.properties, "candidateIds"), false);
  assert.equal(Object.hasOwn(request.format.properties.clusters.items.properties, "candidateRefs"), true);
  assert.equal(Object.hasOwn(request.format.properties.clusters.items.properties, "evidenceSnapshotIds"), false);
  assert.match(request.messages[0].content, /Não devolva snapshotIds/);
  assert.match(request.messages[0].content, /Aliases obrigatórios: C001/);
  assert.match(request.messages[0].content, /idioma BCP 47 es-ES/);
  assert.match(request.messages[0].content, /educación/);
  assert.equal(request.messages[0].content.includes("Agrupe em pt-BR"), false);
  assert.equal(request.messages[0].content.includes("snapshot-1"), false);
  assert.equal(request.messages[0].content.includes("candidate-1"), false);
  assert.equal(request.stream, true);
});

test("consome resposta estruturada em streaming sem depender do término para receber headers", async () => {
  const evidence = [{ candidateId: "candidate-1", snapshots: [{ id: "snapshot-1" }] }];
  const proposal = { label: "Assunto", niche: "educação", subtheme: "subtema", likelyAudience: "público", narrativePattern: "padrão", localization: "Brasil", candidateRefs: ["C001"], explanation: "Evidência." };
  const serialized = JSON.stringify({ clusters: [proposal] });
  const body = {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(`${JSON.stringify({ message: { content: serialized.slice(0, 20) }, done: false })}\n`);
      yield new TextEncoder().encode(`${JSON.stringify({ message: { content: serialized.slice(20) }, done: true })}\n`);
    },
  };
  const result = await proposeTopicClusters({ model: "teste", evidence, fetchImpl: async () => ({ ok: true, body }) });
  assert.deepEqual(result[0].candidateIds, ["candidate-1"]);
});

test("rejeita tentativa da IA de fornecer snapshot e deriva evidência pelo candidato", async () => {
  const evidence = [{ candidateId: "candidate-1", snapshots: [{ id: "snapshot-1" }] }];
  const forbiddenProposal = {
    label: "Assunto",
    niche: "educação",
    subtheme: "subtema",
    likelyAudience: "público",
    narrativePattern: "padrão",
    localization: "localização",
    candidateRefs: ["C001"],
    evidenceSnapshotIds: ["snapshot-forged"],
    explanation: "Explicação",
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ message: { content: JSON.stringify({ clusters: [forbiddenProposal] }) } }),
  });
  await assert.rejects(
    () => proposeTopicClusters({ model: "teste", evidence, fetchImpl }),
    (error) => error.code === "AI_EVIDENCE_MUTATION",
  );

  const safeProposal = Object.fromEntries(Object.entries(forbiddenProposal).filter(([key]) => key !== "evidenceSnapshotIds"));
  const safeFetch = async () => ({
    ok: true,
    json: async () => ({ message: { content: JSON.stringify({ clusters: [safeProposal] }) } }),
  });
  const [result] = await proposeTopicClusters({ model: "teste", evidence, fetchImpl: safeFetch });
  assert.deepEqual(result.evidenceSnapshotIds, ["snapshot-1"]);
});

test("completa aliases ausentes em uma correção dirigida", async () => {
  const evidence = [
    { candidateId: "youtube:CaseSensitive", snapshots: [{ id: "snapshot-1" }] },
    { candidateId: "youtube:other", snapshots: [{ id: "snapshot-2" }] },
  ];
  const incomplete = {
    label: "Assunto", niche: "educação", subtheme: "subtema", likelyAudience: "público",
    narrativePattern: "padrão", localization: "localização", candidateRefs: ["C001"], explanation: "Explicação",
  };
  const repair = { ...incomplete, label: "Outro assunto", candidateRefs: ["C002"] };
  const requests = [];
  const responses = [incomplete, repair];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const proposal = responses.shift();
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ clusters: [proposal] }) } }) };
  };
  const result = await proposeTopicClusters({ model: "teste", evidence, fetchImpl });
  assert.equal(result.length, 2);
  assert.deepEqual(result.flatMap(({ candidateIds }) => candidateIds), ["youtube:CaseSensitive", "youtube:other"]);
  assert.match(requests[1].messages[0].content, /Aliases obrigatórios: C002/);
  assert.equal(requests[1].messages[0].content.includes("C001"), false);
  assert.equal(requests[1].messages[0].content.includes("youtube:other"), false);
});

test("divide volume real em lotes determinísticos e preserva cobertura exata", async () => {
  const evidence = Array.from({ length: 72 }, (_, index) => ({
    candidateId: `youtube:video-${String(index + 1).padStart(3, "0")}`,
    title: `Vídeo ${index + 1}`,
    snapshots: [{ id: `snapshot-${index + 1}` }],
  }));
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const aliases = /Aliases obrigatórios: ([^.]+)\./.exec(request.messages[0].content)[1].split(", ");
    requests.push({ request, aliases });
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ clusters: [{
      label: `Lote ${requests.length}`, niche: "jogos", subtheme: "lançamentos", likelyAudience: "jogadores",
      narrativePattern: "análise", localization: "Brasil", candidateRefs: aliases, explanation: "Evidências do lote.",
    }] }) } }) };
  };
  const result = await proposeTopicClusters({ model: "qwen3:4b", evidence, fetchImpl });
  assert.equal(requests.length, 9);
  assert.deepEqual(requests.map(({ aliases }) => aliases.length), Array(9).fill(8));
  assert.deepEqual(result.flatMap(({ candidateIds }) => candidateIds), evidence.map(({ candidateId }) => candidateId));
});
