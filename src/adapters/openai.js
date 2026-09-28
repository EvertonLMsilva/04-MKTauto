import { createHash } from "node:crypto";
import { validateScriptGenerationOutput } from "../domain/script-generation-contracts.js";
import { SCRIPT_GENERATION_POLICY } from "../script-generation-policy.js";
import { OpenAIAdapterError } from "./openai-error.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export { OpenAIAdapterError } from "./openai-error.js";

export class OpenAIAdapter {
  constructor(config, { fetchImpl = fetch, now = Date.now } = {}) {
    validateConfig(config);
    if (typeof fetchImpl !== "function") throw new TypeError("fetch obrigatório");
    if (typeof now !== "function") throw new TypeError("relógio obrigatório");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async generate(input, { signal } = {}) {
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const startedAt = this.now();
    const requestPayload = requestBody(input, this.config);
    const inputHash = sha256(JSON.stringify(requestPayload));
    let usage = emptyUsage();
    let outputHash = null;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
      if (!response.ok) throw httpFailure(response.status);
      let providerBody;
      try { providerBody = await response.json(); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      usage = providerUsage(providerBody);
      const text = outputText(providerBody);
      outputHash = sha256(text);
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      let output;
      try { output = validateScriptGenerationOutput(parsed); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      return deepFreeze({
        output,
        generationMetadata: generationMetadata(this.config),
        telemetry: observation(this.config, usage, startedAt, this.now(), inputHash, outputHash),
      });
    } catch (caught) {
      let mapped;
      if (caught instanceof OpenAIAdapterError) mapped = caught;
      else if (timedOut) mapped = failure("PROVIDER_TIMEOUT", "timeoutMs", "provider excedeu o tempo limite", { cause: caught });
      else if (signal?.aborted || caught?.name === "AbortError") mapped = failure("PROVIDER_CANCELLED", "signal", "operação cancelada", { cause: caught });
      else mapped = failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão com o provider", { cause: caught });
      mapped.telemetry = observation(this.config, usage, startedAt, this.now(), inputHash, outputHash);
      throw mapped;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

function generationMetadata(config) {
  return {
    provider: "openai", model: config.model,
    taskType: SCRIPT_GENERATION_POLICY.taskType,
    promptVersion: SCRIPT_GENERATION_POLICY.version,
    configurationHash: config.configurationHash,
    publicConfiguration: config.publicConfiguration,
  };
}

function observation(config, usage, startedAt, finishedAt, inputHash, outputHash) {
  const metadata = generationMetadata(config);
  return deepFreeze({
    provider: metadata.provider,
    model: metadata.model,
    taskType: metadata.taskType,
    promptVersion: metadata.promptVersion,
    ...usage,
    costAmount: null,
    currency: null,
    costOrigin: null,
    latencyMs: Math.max(0, Math.round(finishedAt - startedAt)),
    occurredAt: new Date(startedAt).toISOString(),
    fallback: false,
    inputHash,
    outputHash,
  });
}

function providerUsage(body) {
  if (body?.usage === undefined || body.usage === null) return emptyUsage();
  if (!body.usage || typeof body.usage !== "object" || Array.isArray(body.usage)) {
    throw failure("PROVIDER_INVALID_RESPONSE", "usage", "uso informado pelo provider é inválido");
  }
  const inputTokens = optionalCount(body.usage.input_tokens, "usage.input_tokens");
  const outputTokens = optionalCount(body.usage.output_tokens, "usage.output_tokens");
  const details = body.usage.input_tokens_details;
  if (details !== undefined && details !== null && (!details || typeof details !== "object" || Array.isArray(details))) {
    throw failure("PROVIDER_INVALID_RESPONSE", "usage.input_tokens_details", "uso informado pelo provider é inválido");
  }
  const cachedInputTokens = optionalCount(details?.cached_tokens, "usage.input_tokens_details.cached_tokens");
  const usageOrigin = [inputTokens, outputTokens, cachedInputTokens].some((value) => value !== null)
    ? "provider_response"
    : null;
  return { inputTokens, outputTokens, cachedInputTokens, usageOrigin };
}

function optionalCount(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw failure("PROVIDER_INVALID_RESPONSE", field, "uso informado pelo provider é inválido");
  }
  return value;
}

function emptyUsage() {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, usageOrigin: null };
}

function requestBody(input, config) {
  const context = {
    idea: { title: input.idea.title, editorialAngle: input.idea.editorialAngle },
    project: {
      niche: input.projectSnapshot.project.niche,
      subniches: input.projectSnapshot.project.subniches,
      audience: input.projectSnapshot.project.audience,
    },
    channel: {
      format: input.projectSnapshot.channel.format,
      aspectRatio: input.projectSnapshot.channel.aspectRatio,
      minDurationSeconds: input.projectSnapshot.channel.minDurationSeconds,
      maxDurationSeconds: input.projectSnapshot.channel.maxDurationSeconds,
      editorialStyle: input.projectSnapshot.channel.editorialStyle,
      visualStyle: input.projectSnapshot.channel.visualStyle,
      voiceStyle: input.projectSnapshot.channel.voiceStyle,
    },
  };
  return {
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    input: [
      { role: "developer", content: [{ type: "input_text", text: SCRIPT_GENERATION_POLICY.instructions.join("\n") }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(context) }] },
    ],
    text: { format: { type: "json_schema", name: "script_generation", strict: true, schema: SCRIPT_GENERATION_POLICY.outputSchema } },
  };
}

function outputText(body) {
  if (!body || body.status !== "completed" || !Array.isArray(body.output)) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta incompleta");
  const texts = body.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item.text === "string");
  if (texts.length !== 1) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada ausente");
  return texts[0].text;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw failure("OPENAI_CONFIGURATION_MISSING", "config", "configuração obrigatória ausente");
  for (const field of ["apiKey", "model", "configurationHash"]) if (typeof config[field] !== "string" || config[field].length === 0) throw failure("OPENAI_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1) throw failure("OPENAI_CONFIGURATION_INVALID", "timeoutMs", "configuração inválida");
  if (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1) throw failure("OPENAI_CONFIGURATION_INVALID", "maxOutputTokens", "configuração inválida");
  if (!config.publicConfiguration || typeof config.publicConfiguration !== "object") throw failure("OPENAI_CONFIGURATION_INVALID", "publicConfiguration", "configuração inválida");
}

function httpFailure(status) {
  if (status === 401) return failure("PROVIDER_AUTHENTICATION_FAILED", "provider", "autenticação do provider falhou");
  if (status === 403) return failure("PROVIDER_PERMISSION_DENIED", "provider", "provider recusou a operação");
  if (status === 408) return failure("PROVIDER_TIMEOUT", "provider", "provider excedeu o tempo limite");
  if (status === 429) return failure("PROVIDER_RATE_LIMITED", "provider", "limite temporário do provider atingido");
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", "provider", "provider temporariamente indisponível");
  return failure("PROVIDER_REQUEST_REJECTED", "provider", "provider rejeitou a solicitação");
}

function failure(code, field, message, options) { return new OpenAIAdapterError(code, field, message, options); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
