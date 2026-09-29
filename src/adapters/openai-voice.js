import { LocalVoiceStorage } from "./local-voice-storage.js";
import { OpenAIVoiceAdapterError } from "./openai-voice-error.js";
import { inspectMvpWav } from "./wav-audio.js";
import { VoiceProvider } from "../voice-provider.js";
import {
  OPENAI_BUILT_IN_VOICE,
  OPENAI_VOICE_AUDIO_FORMAT,
  OPENAI_VOICE_MAX_INPUT_CHARACTERS,
  OPENAI_VOICE_MODEL,
  OPENAI_VOICE_POLICY_VERSION,
} from "../openai-voice-config.js";

const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const STYLE_INSTRUCTIONS = Object.freeze({
  informative: "Fale em português do Brasil, com tom informativo, claro e natural. Não imite nem personifique qualquer pessoa.",
});

export { OpenAIVoiceAdapterError } from "./openai-voice-error.js";

export class OpenAIVoiceAdapter extends VoiceProvider {
  constructor(config, { fetchImpl = fetch, storage } = {}) {
    super();
    validateConfig(config);
    if (typeof fetchImpl !== "function") throw new TypeError("fetch obrigatório");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.storage = storage ?? new LocalVoiceStorage({ root: config.storageRoot, maxBytes: config.maxAudioBytes });
    if (!this.storage || typeof this.storage.store !== "function") throw new TypeError("storage de voz obrigatório");
  }

  async synthesize(input, { signal } = {}) {
    validateInput(input, this.config);
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.fetchImpl(SPEECH_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody(input, this.config)),
        signal: controller.signal,
      });
      if (!response?.ok) throw httpFailure(response?.status);
      if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") throw failure("PROVIDER_INVALID_AUDIO", "audio", "provider não retornou áudio");
      const stored = await this.storage.store(response.body, { inspect: inspectMvpWav, signal: controller.signal });
      return deepFreeze({
        durationMilliseconds: stored.durationMilliseconds,
        audioFormat: stored.audioFormat,
        contentHash: stored.contentHash,
        storageReference: stored.storageReference,
        provider: "openai",
        origin: "SYNTHETIC_TTS",
        rights: this.config.rights,
      });
    } catch (caught) {
      if (timedOut) throw failure("PROVIDER_TIMEOUT", "timeoutMs", "provider excedeu o tempo limite", { cause: caught });
      if (caught instanceof OpenAIVoiceAdapterError) throw caught;
      if (signal?.aborted || caught?.name === "AbortError") throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada", { cause: caught });
      throw failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão com o provider", { cause: caught });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

function requestBody(input, config) {
  return { model: config.model, input: input.narration, voice: config.voice, instructions: STYLE_INSTRUCTIONS[input.voiceStyle], response_format: config.audioFormat };
}
function validateInput(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw failure("PROVIDER_INVALID_INPUT", "input", "entrada de voz inválida");
  if (typeof input.narration !== "string" || input.narration.length === 0) throw failure("PROVIDER_INVALID_INPUT", "narration", "narração obrigatória");
  if (Array.from(input.narration).length > config.maxInputCharacters) throw failure("PROVIDER_INPUT_LIMIT_EXCEEDED", "narration", "narração excede o limite efetivo do endpoint");
  if (!Object.hasOwn(STYLE_INSTRUCTIONS, input.voiceStyle)) throw failure("PROVIDER_UNSUPPORTED_VOICE_STYLE", "voiceStyle", "estilo de voz não autorizado");
  if (input.language !== "pt-BR") throw failure("PROVIDER_UNSUPPORTED_LANGUAGE", "language", "idioma não suportado pela política inicial");
  if (typeof input.logicalCallId !== "string" || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(input.logicalCallId)) throw failure("PROVIDER_INVALID_INPUT", "logicalCallId", "identidade inválida");
}
function validateConfig(config) {
  if (!config || typeof config !== "object") throw failure("OPENAI_VOICE_CONFIGURATION_MISSING", "config", "configuração obrigatória ausente");
  for (const field of ["apiKey", "model", "voice", "audioFormat", "storageRoot", "policyVersion", "configurationHash"]) if (typeof config[field] !== "string" || config[field].length === 0) throw failure("OPENAI_VOICE_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  if (config.model !== OPENAI_VOICE_MODEL || config.voice !== OPENAI_BUILT_IN_VOICE
    || config.audioFormat !== OPENAI_VOICE_AUDIO_FORMAT || config.policyVersion !== OPENAI_VOICE_POLICY_VERSION
    || config.maxInputCharacters !== OPENAI_VOICE_MAX_INPUT_CHARACTERS) {
    throw failure("OPENAI_VOICE_CONFIGURATION_INVALID", "config", "configuração fora da política versionada");
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || !Number.isSafeInteger(config.maxAudioBytes) || config.maxAudioBytes < 1) throw failure("OPENAI_VOICE_CONFIGURATION_INVALID", "config", "configuração inválida");
  if (config.rights?.usageBasis !== "PROVIDER_TERMS" || config.rights?.commercialUseAllowed !== true) throw failure("OPENAI_VOICE_RIGHTS_NOT_CONFIRMED", "rights", "direitos comerciais não confirmados");
}
function httpFailure(status) {
  if (status === 401) return failure("PROVIDER_AUTHENTICATION_FAILED", "provider", "autenticação do provider falhou");
  if (status === 403) return failure("PROVIDER_PERMISSION_DENIED", "provider", "provider recusou a operação");
  if (status === 408) return failure("PROVIDER_TIMEOUT", "provider", "provider excedeu o tempo limite");
  if (status === 413) return failure("PROVIDER_INPUT_LIMIT_EXCEEDED", "narration", "provider recusou o tamanho da entrada");
  if (status === 429) return failure("PROVIDER_RATE_LIMITED", "provider", "limite temporário do provider atingido");
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", "provider", "provider temporariamente indisponível");
  return failure("PROVIDER_REQUEST_REJECTED", "provider", "provider rejeitou a solicitação");
}
function failure(code, field, message, options) { return new OpenAIVoiceAdapterError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
