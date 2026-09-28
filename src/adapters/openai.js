import { validateScriptGenerationOutput } from "../domain/script-generation-contracts.js";
import { SCRIPT_GENERATION_POLICY } from "../script-generation-policy.js";
import { OpenAIAdapterError } from "./openai-error.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export { OpenAIAdapterError } from "./openai-error.js";

export class OpenAIAdapter {
  constructor(config, { fetchImpl = fetch } = {}) {
    validateConfig(config);
    if (typeof fetchImpl !== "function") throw new TypeError("fetch obrigatório");
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async generate(input, { signal } = {}) {
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody(input, this.config)),
        signal: controller.signal,
      });
      if (!response.ok) throw httpFailure(response.status);
      let body;
      try { body = await response.json(); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      const text = outputText(body);
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      let output;
      try { output = validateScriptGenerationOutput(parsed); }
      catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
      return deepFreeze({
        output,
        generationMetadata: {
          provider: "openai", model: this.config.model,
          taskType: SCRIPT_GENERATION_POLICY.taskType,
          promptVersion: SCRIPT_GENERATION_POLICY.version,
          configurationHash: this.config.configurationHash,
          publicConfiguration: this.config.publicConfiguration,
        },
      });
    } catch (caught) {
      if (caught instanceof OpenAIAdapterError) throw caught;
      if (timedOut) throw failure("PROVIDER_TIMEOUT", "timeoutMs", "provider excedeu o tempo limite", { cause: caught });
      if (signal?.aborted || caught?.name === "AbortError") throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada", { cause: caught });
      throw failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão com o provider", { cause: caught });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
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
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
