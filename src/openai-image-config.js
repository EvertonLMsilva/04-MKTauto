import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { OpenAIImageAdapterError } from "./adapters/openai-image-error.js";

export const OPENAI_IMAGE_POLICY_VERSION = "openai-image-policy/1.0.0";
export const OPENAI_IMAGE_PROMPT_VERSION = "openai-image-prompt/1.0.0";
export const OPENAI_IMAGE_PRICING_VERSION = "openai-image-pricing/1.0.0";
export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare-2026-09-08";
export const OPENAI_IMAGE_WIDTH = 1152;
export const OPENAI_IMAGE_HEIGHT = 2048;
export const OPENAI_IMAGE_FORMAT = "png";
export const OPENAI_IMAGE_QUALITY = "medium";

export function loadOpenAIImageConfig(env = process.env, { now = Date.now } = {}) {
  const apiKey = required(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const model = exact(env.OPENAI_IMAGE_MODEL ?? OPENAI_IMAGE_MODEL, OPENAI_IMAGE_MODEL, "OPENAI_IMAGE_MODEL");
  const termsVersion = executionDate(now);
  const storageRoot = resolve(required(env.OPENAI_IMAGE_STORAGE_ROOT, "OPENAI_IMAGE_STORAGE_ROOT"));
  const timeoutMs = integer(env.OPENAI_IMAGE_TIMEOUT_MS ?? "120000", "OPENAI_IMAGE_TIMEOUT_MS", 1, 300000);
  const maxResponseBytes = integer(env.OPENAI_IMAGE_MAX_RESPONSE_BYTES ?? "31457280", "OPENAI_IMAGE_MAX_RESPONSE_BYTES", 1024, 104857600);
  const maxImageBytes = integer(env.OPENAI_IMAGE_MAX_IMAGE_BYTES ?? "20971520", "OPENAI_IMAGE_MAX_IMAGE_BYTES", 1024, 52428800);
  const rights = deepFreeze({ usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true });
  const pricing = deepFreeze({
    version: OPENAI_IMAGE_PRICING_VERSION,
    effectiveDate: "2026-09-29",
    currency: "USD",
    textInputUsdPerMillionTokens: 5,
    imageOutputUsdPerMillionTokens: 30,
    costOrigin: "calculated_openai_image_pricing_2026_09_29",
  });
  const publicConfiguration = deepFreeze({
    model, size: `${OPENAI_IMAGE_WIDTH}x${OPENAI_IMAGE_HEIGHT}`,
    widthPixels: OPENAI_IMAGE_WIDTH, heightPixels: OPENAI_IMAGE_HEIGHT,
    outputFormat: OPENAI_IMAGE_FORMAT, quality: OPENAI_IMAGE_QUALITY,
    background: "opaque", count: 1, moderation: "auto",
    maxResponseBytes, maxImageBytes, timeoutMs,
    policyVersion: OPENAI_IMAGE_POLICY_VERSION, promptVersion: OPENAI_IMAGE_PROMPT_VERSION,
    termsVersion, rights, pricing,
  });
  const configurationHash = sha256(stableJson({ provider: "openai", ...publicConfiguration }));
  return deepFreeze({
    apiKey, storageRoot, model, widthPixels: OPENAI_IMAGE_WIDTH,
    heightPixels: OPENAI_IMAGE_HEIGHT, outputFormat: OPENAI_IMAGE_FORMAT,
    quality: OPENAI_IMAGE_QUALITY, maxResponseBytes, maxImageBytes, timeoutMs,
    policyVersion: OPENAI_IMAGE_POLICY_VERSION, promptVersion: OPENAI_IMAGE_PROMPT_VERSION,
    termsVersion, rights, pricing, publicConfiguration, configurationHash,
  });
}

function required(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw failure("OPENAI_IMAGE_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  return value.trim();
}
function executionDate(now) {
  if (typeof now !== "function") throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "now", "relógio inválido");
  const value = new Date(now());
  if (!Number.isFinite(value.getTime())) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "now", "relógio inválido");
  return value.toISOString().slice(0, 10);
}
function exact(value, expected, field) {
  if (value !== expected) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", field, "configuração fora da política versionada");
  return value;
}
function integer(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", field, "configuração inválida");
  return parsed;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function failure(code, field, message, options) { return new OpenAIImageAdapterError(code, field, message, options); }
