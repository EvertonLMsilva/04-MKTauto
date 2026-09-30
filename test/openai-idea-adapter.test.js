import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIIdeaAdapter } from "../src/adapters/openai-idea.js";

test("adapter gera propostas estruturadas somente com evidência da shortlist", async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.type, "json_schema"); assert.equal("uniqueItems" in body.text.format.schema.properties.proposals.items.properties.evidenceCandidateIds, false);
    return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ proposals: [{ title: "Ideia nova para o canal", editorialAngle: "Ângulo prático e original para o público", evidenceCandidateIds: ["candidate_1"] }] }) }] }] }) };
  };
  const adapter = new OpenAIIdeaAdapter({ apiKey: "secret", model: "model", timeoutMs: 1000, maxOutputTokens: 1000 }, { fetchImpl });
  const output = await adapter.generate({ projectSnapshot: snapshot(), shortlist: shortlist() });
  assert.equal(output[0].evidenceCandidateIds[0], "candidate_1");
  assert.equal(Object.isFrozen(output), true);
});

test("adapter mantém validação local de evidência duplicada sem keyword incompatível", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ proposals: [{ title: "Ideia nova para o canal", editorialAngle: "Ângulo prático e original para o público", evidenceCandidateIds: ["candidate_1", "candidate_1"] }] }) }] }] }) });
  const adapter = new OpenAIIdeaAdapter({ apiKey: "secret", model: "model", timeoutMs: 1000, maxOutputTokens: 1000 }, { fetchImpl });
  await assert.rejects(() => adapter.generate({ projectSnapshot: snapshot(), shortlist: shortlist() }), (error) => error.code === "PROVIDER_INVALID_RESPONSE");
});

test("adapter classifica recusas HTTP sem expor resposta externa", async () => {
  for (const [status, code] of [[401, "PROVIDER_AUTHENTICATION_FAILED"], [403, "PROVIDER_PERMISSION_DENIED"], [429, "PROVIDER_RATE_LIMITED"], [500, "PROVIDER_UNAVAILABLE"]]) {
    const adapter = new OpenAIIdeaAdapter({ apiKey: "secret", model: "model", timeoutMs: 1000, maxOutputTokens: 1000 }, { fetchImpl: async () => ({ ok: false, status }) });
    await assert.rejects(() => adapter.generate({ projectSnapshot: snapshot(), shortlist: shortlist() }), (error) => error.code === code && !error.message.includes("secret"));
  }
});

test("adapter rejeita ID inventado pelo provider", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ proposals: [{ title: "Ideia nova para o canal", editorialAngle: "Ângulo prático e original para o público", evidenceCandidateIds: ["inventado"] }] }) }] }] }) });
  const adapter = new OpenAIIdeaAdapter({ apiKey: "secret", model: "model", timeoutMs: 1000, maxOutputTokens: 1000 }, { fetchImpl });
  await assert.rejects(() => adapter.generate({ projectSnapshot: snapshot(), shortlist: shortlist() }), (error) => error.code === "PROVIDER_INVALID_RESPONSE" && error.field.includes("evidenceCandidateIds"));
});

function snapshot() { return { project: { niche: "tecnologia", subniches: ["IA"], audience: { profile: "profissionais", language: "pt-BR" } }, channel: { format: "short_video", editorialStyle: "didático", minDurationSeconds: 30, maxDurationSeconds: 60 } }; }
function shortlist() { return { orderedCandidates: [{ candidate: { id: "candidate_1", title: "Referência", platform: "YOUTUBE" }, cluster: { label: "IA" }, score: { value: 80 } }] }; }
