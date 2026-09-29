import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { OpenAIVoiceAdapterError } from "./adapters/openai-voice-error.js";

export const OPENAI_VOICE_POLICY_VERSION = "openai-voice-policy/1.0.0";
export const OPENAI_VOICE_MODEL = "gpt-4o-mini-tts";
export const OPENAI_BUILT_IN_VOICE = "marin";
export const OPENAI_VOICE_AUDIO_FORMAT = "wav";
export const OPENAI_VOICE_MAX_INPUT_CHARACTERS = 4096;

export function loadOpenAIVoiceConfig(env = process.env) {
  const apiKey = required(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const model = exact(env.OPENAI_VOICE_MODEL ?? OPENAI_VOICE_MODEL, OPENAI_VOICE_MODEL, "OPENAI_VOICE_MODEL");
  const voice = exact(env.OPENAI_VOICE ?? OPENAI_BUILT_IN_VOICE, OPENAI_BUILT_IN_VOICE, "OPENAI_VOICE");
  if (env.OPENAI_VOICE_COMMERCIAL_USE_ALLOWED !== "true") {
    throw failure("OPENAI_VOICE_RIGHTS_NOT_CONFIRMED", "OPENAI_VOICE_COMMERCIAL_USE_ALLOWED", "direitos comerciais precisam ser confirmados para esta execução");
  }
  const storageRoot = resolve(required(env.OPENAI_VOICE_STORAGE_ROOT, "OPENAI_VOICE_STORAGE_ROOT"));
  const timeoutMs = integer(env.OPENAI_VOICE_TIMEOUT_MS ?? "60000", "OPENAI_VOICE_TIMEOUT_MS", 1, 300000);
  const maxAudioBytes = integer(env.OPENAI_VOICE_MAX_AUDIO_BYTES ?? "20971520", "OPENAI_VOICE_MAX_AUDIO_BYTES", 1024, 104857600);
  const rights = deepFreeze({ usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true });
  const publicConfiguration = deepFreeze({
    model, voice, audioFormat: OPENAI_VOICE_AUDIO_FORMAT,
    maxInputCharacters: OPENAI_VOICE_MAX_INPUT_CHARACTERS,
    maxAudioBytes, timeoutMs, policyVersion: OPENAI_VOICE_POLICY_VERSION, rights,
  });
  const configurationHash = sha256(stableJson({ provider: "openai", ...publicConfiguration }));
  return deepFreeze({
    apiKey, storageRoot, model, voice, audioFormat: OPENAI_VOICE_AUDIO_FORMAT,
    maxInputCharacters: OPENAI_VOICE_MAX_INPUT_CHARACTERS, maxAudioBytes, timeoutMs,
    policyVersion: OPENAI_VOICE_POLICY_VERSION, rights, publicConfiguration, configurationHash,
  });
}

function required(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw failure("OPENAI_VOICE_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  return value.trim();
}
function exact(value, expected, field) {
  if (value !== expected) throw failure("OPENAI_VOICE_CONFIGURATION_INVALID", field, "configuração fora da política versionada");
  return value;
}
function integer(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw failure("OPENAI_VOICE_CONFIGURATION_INVALID", field, "configuração inválida");
  return parsed;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function failure(code, field, message, options) { return new OpenAIVoiceAdapterError(code, field, message, options); }
