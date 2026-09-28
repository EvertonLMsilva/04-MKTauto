import { createHash } from "node:crypto";
import { OpenAIAdapterError } from "./adapters/openai-error.js";

export function loadOpenAIConfig(env = process.env) {
  const apiKey = required(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const model = required(env.OPENAI_MODEL, "OPENAI_MODEL");
  const timeoutMs = integer(env.OPENAI_TIMEOUT_MS ?? "30000", "OPENAI_TIMEOUT_MS", 1, 300000);
  const maxOutputTokens = integer(env.OPENAI_MAX_OUTPUT_TOKENS ?? "4000", "OPENAI_MAX_OUTPUT_TOKENS", 1, 100000);
  const publicConfiguration = deepFreeze({ outputLimit: maxOutputTokens, responseFormat: "json_schema", store: false, timeoutMs });
  const configurationHash = sha256(stableJson({ model, provider: "openai", publicConfiguration }));
  return deepFreeze({ apiKey, model, timeoutMs, maxOutputTokens, publicConfiguration, configurationHash });
}

function required(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new OpenAIAdapterError("OPENAI_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  return value.trim();
}
function integer(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new OpenAIAdapterError("OPENAI_CONFIGURATION_INVALID", field, "configuração inválida");
  return parsed;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
