import { IDEA_GENERATION_POLICY } from "../idea-generation-policy.js";
import { OpenAIAdapterError } from "./openai-error.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIIdeaAdapter {
  constructor(config, { fetchImpl = fetch } = {}) { validateConfig(config); this.config = config; this.fetchImpl = fetchImpl; }

  async generate({ projectSnapshot, shortlist }, { signal } = {}) {
    const allowed = new Set(shortlist.orderedCandidates.map(({ candidate }) => candidate.id));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody(projectSnapshot, shortlist, this.config)), signal: controller.signal,
      });
      if (!response.ok) throw failure(response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_REQUEST_REJECTED", "provider", "provider recusou a geração de ideias");
      const body = await response.json();
      const text = outputText(body);
      let parsed; try { parsed = JSON.parse(text); } catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      return validateOutput(parsed, allowed);
    } catch (caught) {
      if (caught instanceof OpenAIAdapterError) throw caught;
      if (caught?.name === "AbortError") throw failure("PROVIDER_TIMEOUT", "provider", "provider excedeu o tempo limite", { cause: caught });
      throw failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão com o provider", { cause: caught });
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
  }
}

function requestBody(snapshot, shortlist, config) {
  const context = {
    project: { niche: snapshot.project.niche, subniches: snapshot.project.subniches, audience: snapshot.project.audience },
    channel: { format: snapshot.channel.format, editorialStyle: snapshot.channel.editorialStyle, minDurationSeconds: snapshot.channel.minDurationSeconds, maxDurationSeconds: snapshot.channel.maxDurationSeconds },
    researchCandidates: shortlist.orderedCandidates.map(({ candidate, cluster, score }) => ({ id: candidate.id, title: candidate.title, platform: candidate.platform, clusterLabel: cluster.label, score: score.value })),
  };
  return { model: config.model, store: false, max_output_tokens: config.maxOutputTokens,
    input: [
      { role: "developer", content: [{ type: "input_text", text: IDEA_GENERATION_POLICY.instructions.join("\n") }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(context) }] },
    ],
    text: { format: { type: "json_schema", name: "idea_generation", strict: true, schema: IDEA_GENERATION_POLICY.outputSchema } },
  };
}

function validateOutput(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.proposals) || value.proposals.length < 1 || value.proposals.length > 5) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida");
  return Object.freeze(value.proposals.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join() !== "editorialAngle,evidenceCandidateIds,title") throw failure("PROVIDER_INVALID_RESPONSE", `proposals.${index}`, "proposta inválida");
    const title = text(item.title, 8, 160, `proposals.${index}.title`); const editorialAngle = text(item.editorialAngle, 8, 400, `proposals.${index}.editorialAngle`);
    if (!Array.isArray(item.evidenceCandidateIds) || item.evidenceCandidateIds.length < 1 || item.evidenceCandidateIds.length > 3 || new Set(item.evidenceCandidateIds).size !== item.evidenceCandidateIds.length || item.evidenceCandidateIds.some((id) => !allowed.has(id))) throw failure("PROVIDER_INVALID_RESPONSE", `proposals.${index}.evidenceCandidateIds`, "evidência inválida");
    return Object.freeze({ title, editorialAngle, evidenceCandidateIds: Object.freeze([...item.evidenceCandidateIds].sort()) });
  }));
}
function text(value, min, max, field) { const normalized = typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : ""; if (normalized.length < min || normalized.length > max || /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i.test(normalized)) throw failure("PROVIDER_INVALID_RESPONSE", field, "texto inválido"); return normalized; }
function outputText(body) { const texts = body?.output?.flatMap((item) => item?.content ?? []).filter((item) => item?.type === "output_text" && typeof item.text === "string") ?? []; if (body?.status !== "completed" || texts.length !== 1) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada ausente"); return texts[0].text; }
function validateConfig(config) { if (!config || !config.apiKey || !config.model || !Number.isSafeInteger(config.timeoutMs) || !Number.isSafeInteger(config.maxOutputTokens)) throw failure("OPENAI_CONFIGURATION_MISSING", "config", "configuração obrigatória ausente"); }
function failure(code, field, message, options) { return new OpenAIAdapterError(code, field, message, options); }
