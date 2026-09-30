import { createHash } from "node:crypto";
import { MediaProvider } from "../media-provider.js";
import {
  OPENAI_IMAGE_FORMAT, OPENAI_IMAGE_HEIGHT, OPENAI_IMAGE_MODEL,
  OPENAI_IMAGE_POLICY_VERSION, OPENAI_IMAGE_PROMPT_VERSION,
  OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_WIDTH,
} from "../openai-image-config.js";
import { LocalMediaStorage } from "./local-media-storage.js";
import { OpenAIImageAdapterError } from "./openai-image-error.js";
import { inspectMvpPng } from "./png-image.js";

const IMAGE_URL = "https://api.openai.com/v1/images/generations";
const INPUT_FIELDS = Object.freeze(["logicalCallId", "assetType", "visualDirection", "projectContext"]);
const DIRECTION_FIELDS = Object.freeze(["position", "blockPosition", "description"]);
const CONTEXT_FIELDS = Object.freeze(["projectId", "projectVersion", "language", "audienceProfile", "niche", "contentFormat", "aspectRatio", "visualStyle"]);
const FORBIDDEN_REFERENCE = /(?:https?:\/\/|www\.|(?:^|\s)@[a-z0-9_]{2,}|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|br|app|dev|ai|me|tv)(?:\/\S*)?\b)/i;
const MAX_PROMPT_CHARACTERS = 8000;

export { OpenAIImageAdapterError } from "./openai-image-error.js";

export class OpenAIImageAdapter extends MediaProvider {
  constructor(config, { fetchImpl = fetch, storage, now = Date.now } = {}) {
    super();
    validateConfig(config);
    if (typeof fetchImpl !== "function") throw new TypeError("fetch obrigatório");
    if (typeof now !== "function") throw new TypeError("relógio obrigatório");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.storage = storage ?? new LocalMediaStorage({ root: config.storageRoot, maxBytes: config.maxImageBytes });
    this.now = now;
    if (!this.storage || typeof this.storage.store !== "function") throw new TypeError("storage de mídia obrigatório");
  }

  async provide(input, { signal } = {}) {
    validateInput(input);
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const payload = requestBody(input, this.config);
    const inputHash = sha256(JSON.stringify(payload));
    const startedAt = this.now();
    let usage = emptyUsage();
    let outputHash = null;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.fetchImpl(IMAGE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal, redirect: "error",
      });
      if (!response?.ok) throw httpFailure(response?.status);
      validateContentType(response.headers?.get?.("content-type"));
      const providerBody = await boundedJson(response.body, this.config.maxResponseBytes, controller.signal);
      usage = providerUsage(providerBody, this.config);
      const imageBytes = imageOutput(providerBody, this.config);
      const stored = await this.storage.store(imageBytes, {
        inspect: (bytes) => inspectMvpPng(bytes, { widthPixels: this.config.widthPixels, heightPixels: this.config.heightPixels }),
        signal: controller.signal,
      });
      outputHash = stored.contentHash;
      return deepFreeze({
        assetType: "IMAGE",
        technicalProperties: { format: stored.format, widthPixels: stored.widthPixels, heightPixels: stored.heightPixels, durationMilliseconds: null },
        contentHash: stored.contentHash, mediaReference: stored.mediaReference,
        origin: "PROVIDER_GENERATED", provider: "openai", rights: this.config.rights,
        telemetry: observation(this.config, usage, startedAt, this.now(), inputHash, outputHash),
      });
    } catch (caught) {
      if (timedOut) throw failure("PROVIDER_TIMEOUT", "timeoutMs", "provider excedeu o tempo limite", { cause: caught });
      if (caught instanceof OpenAIImageAdapterError) throw caught;
      if (signal?.aborted || caught?.name === "AbortError") throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada", { cause: caught });
      throw failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão com o provider", { cause: caught });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

function requestBody(input, config) {
  const prompt = [
    "Crie uma imagem vertical original para uso comercial em vídeo curto.",
    `Direção visual: ${input.visualDirection.description}`,
    `Nicho: ${input.projectContext.niche}. Público: ${input.projectContext.audienceProfile}.`,
    `Estilo visual: ${input.projectContext.visualStyle}. Idioma contextual: ${input.projectContext.language}.`,
    "Composição 9:16, assunto principal legível em tela pequena, sem texto, URLs, handles, logotipos, marcas, personagens protegidos ou imitação de obra existente.",
  ].join("\n");
  if (Array.from(prompt).length > MAX_PROMPT_CHARACTERS) throw failure("PROVIDER_INPUT_LIMIT_EXCEEDED", "prompt", "prompt excede o limite do adapter");
  if (FORBIDDEN_REFERENCE.test(prompt)) throw failure("PROVIDER_FORBIDDEN_REFERENCE", "prompt", "prompt contém referência externa proibida");
  return {
    model: config.model, prompt, n: 1,
    size: `${config.widthPixels}x${config.heightPixels}`,
    quality: config.quality, output_format: config.outputFormat,
    background: "opaque", moderation: "auto",
  };
}

function validateInput(input) {
  record(input, "input"); exact(input, INPUT_FIELDS, "input");
  token(input.logicalCallId, "logicalCallId", 180);
  if (input.assetType !== "IMAGE") throw failure("PROVIDER_UNSUPPORTED_ASSET_TYPE", "assetType", "estratégia inicial suporta somente imagem");
  record(input.visualDirection, "visualDirection"); exact(input.visualDirection, DIRECTION_FIELDS, "visualDirection");
  positive(input.visualDirection.position, "visualDirection.position"); positive(input.visualDirection.blockPosition, "visualDirection.blockPosition");
  safeText(input.visualDirection.description, "visualDirection.description", 2000);
  record(input.projectContext, "projectContext"); exact(input.projectContext, CONTEXT_FIELDS, "projectContext");
  token(input.projectContext.projectId, "projectContext.projectId", 80); positive(input.projectContext.projectVersion, "projectContext.projectVersion");
  for (const field of ["language", "audienceProfile", "niche", "contentFormat", "visualStyle"]) safeText(input.projectContext[field], `projectContext.${field}`, 2000);
  if (input.projectContext.aspectRatio !== "9:16") throw failure("PROVIDER_UNSUPPORTED_ASPECT_RATIO", "projectContext.aspectRatio", "política inicial exige 9:16");
}

async function boundedJson(stream, maxBytes, signal) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta externa ausente");
  const chunks = []; let size = 0;
  for await (const part of stream) {
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const bytes = Buffer.from(part); size += bytes.length;
    if (size > maxBytes) throw failure("PROVIDER_RESPONSE_TOO_LARGE", "response", "resposta excede o limite configurado");
    chunks.push(bytes);
  }
  if (size === 0) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta externa vazia");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (caught) { throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta estruturada inválida", { cause: caught }); }
}

function imageOutput(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.data) || body.data.length !== 1) throw failure("PROVIDER_INVALID_RESPONSE", "response.data", "imagem externa ausente ou ambígua");
  if (body.output_format !== undefined && body.output_format !== config.outputFormat) throw failure("PROVIDER_IMAGE_FORMAT_MISMATCH", "response.output_format", "formato declarado diverge da política");
  if (body.size !== undefined && body.size !== `${config.widthPixels}x${config.heightPixels}`) throw failure("PROVIDER_IMAGE_DIMENSION_MISMATCH", "image", "dimensões declaradas divergem da política");
  if (body.quality !== undefined && body.quality !== config.quality) throw failure("PROVIDER_INVALID_RESPONSE", "response.quality", "qualidade declarada diverge da política");
  const image = body.data[0];
  if (!image || typeof image !== "object" || Array.isArray(image) || "url" in image) throw failure("PROVIDER_INVALID_RESPONSE", "response.data", "URL externa ou item inválido não é aceito");

  for (const key of Object.keys(image)) if (!["b64_json", "revised_prompt", "generation_id"].includes(key)) throw failure("PROVIDER_INVALID_RESPONSE", `response.data.${key}`, "campo externo não permitido");
  const encoded = image.b64_json;
  if (typeof encoded !== "string" || !strictBase64(encoded)) throw failure("PROVIDER_INVALID_IMAGE", "image", "imagem base64 ausente ou inválida");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > config.maxImageBytes) throw failure("PROVIDER_IMAGE_TOO_LARGE", "image", "imagem excede o limite configurado");
  return bytes;
}

function providerUsage(body, config) {
  if (body.usage === undefined || body.usage === null) return emptyUsage();
  record(body.usage, "usage");
  const inputTokens = optionalCount(body.usage.input_tokens, "usage.input_tokens");
  const outputTokens = optionalCount(body.usage.output_tokens, "usage.output_tokens");
  const hasUsage = inputTokens !== null || outputTokens !== null;
  const complete = inputTokens !== null && outputTokens !== null;
  const costAmount = complete ? calculateCost(inputTokens, outputTokens, config.pricing) : null;
  return {
    inputTokens, outputTokens, cachedInputTokens: null,
    usageOrigin: hasUsage ? "provider_response" : null,
    costAmount, currency: costAmount === null ? null : config.pricing.currency,
    costOrigin: costAmount === null ? null : config.pricing.costOrigin,
  };
}
function calculateCost(inputTokens, outputTokens, pricing) {
  const millionths = BigInt(inputTokens) * BigInt(pricing.textInputUsdPerMillionTokens)
    + BigInt(outputTokens) * BigInt(pricing.imageOutputUsdPerMillionTokens);
  if (millionths === 0n) return null;
  const raw = millionths.toString().padStart(7, "0");
  const fraction = raw.slice(-6).replace(/0+$/, "");
  return fraction ? `${raw.slice(0, -6)}.${fraction}` : raw.slice(0, -6);
}
function observation(config, usage, startedAt, finishedAt, inputHash, outputHash) {
  return {
    provider: "openai", model: config.model, taskType: "image_generation",
    promptVersion: config.promptVersion, ...usage,
    latencyMs: Math.max(0, Math.round(finishedAt - startedAt)),
    occurredAt: new Date(startedAt).toISOString(), fallback: false, inputHash, outputHash,
  };
}
function emptyUsage() { return { inputTokens: null, outputTokens: null, cachedInputTokens: null, usageOrigin: null, costAmount: null, currency: null, costOrigin: null }; }
function validateContentType(value) { if (value !== null && !/^application\/json(?:\s*;|$)/i.test(value)) throw failure("PROVIDER_INVALID_RESPONSE", "response.contentType", "Content-Type externo incompatível"); }
function strictBase64(value) { return value.length > 0 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value); }
function optionalCount(value, field) { if (value === undefined || value === null) return null; if (!Number.isSafeInteger(value) || value < 0) throw failure("PROVIDER_INVALID_RESPONSE", field, "uso informado pelo provider é inválido"); return value; }
function validateConfig(config) {
  if (!config || typeof config !== "object") throw failure("OPENAI_IMAGE_CONFIGURATION_MISSING", "config", "configuração obrigatória ausente");
  for (const field of ["apiKey", "model", "storageRoot", "policyVersion", "promptVersion", "configurationHash", "termsVersion"]) if (typeof config[field] !== "string" || config[field].length === 0) throw failure("OPENAI_IMAGE_CONFIGURATION_MISSING", field, "configuração obrigatória ausente");
  if (config.model !== OPENAI_IMAGE_MODEL || config.policyVersion !== OPENAI_IMAGE_POLICY_VERSION || config.promptVersion !== OPENAI_IMAGE_PROMPT_VERSION || config.outputFormat !== OPENAI_IMAGE_FORMAT || config.quality !== OPENAI_IMAGE_QUALITY || config.widthPixels !== OPENAI_IMAGE_WIDTH || config.heightPixels !== OPENAI_IMAGE_HEIGHT) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "config", "configuração fora da política versionada");
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1 || !Number.isSafeInteger(config.maxImageBytes) || config.maxImageBytes < 1) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "config", "configuração inválida");
  if (config.rights?.usageBasis !== "PROVIDER_TERMS" || config.rights?.commercialUseAllowed !== true) throw failure("OPENAI_IMAGE_RIGHTS_NOT_CONFIRMED", "rights", "direitos comerciais não confirmados");
  if (config.pricing?.version !== "openai-image-pricing/1.0.0") throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "pricing", "pricing não versionado");
}
function httpFailure(status) { if (status === 401) return failure("PROVIDER_AUTHENTICATION_FAILED", "provider", "autenticação do provider falhou"); if (status === 403) return failure("PROVIDER_PERMISSION_DENIED", "provider", "provider recusou a operação"); if (status === 408) return failure("PROVIDER_TIMEOUT", "provider", "provider excedeu o tempo limite"); if (status === 413) return failure("PROVIDER_INPUT_LIMIT_EXCEEDED", "prompt", "provider recusou o tamanho da entrada"); if (status === 429) return failure("PROVIDER_RATE_LIMITED", "provider", "limite temporário do provider atingido"); if (status >= 500) return failure("PROVIDER_UNAVAILABLE", "provider", "provider temporariamente indisponível"); return failure("PROVIDER_REQUEST_REJECTED", "provider", "provider rejeitou a solicitação"); }
function record(value, field) { if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("PROVIDER_INVALID_INPUT", field, "objeto inválido"); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) throw failure("PROVIDER_INVALID_INPUT", `${path}.${key}`, "campo não permitido"); for (const key of fields) if (!(key in value)) throw failure("PROVIDER_INVALID_INPUT", `${path}.${key}`, "campo obrigatório"); }
function token(value, field, max) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("PROVIDER_INVALID_INPUT", field, "identificador inválido"); }
function positive(value, field) { if (!Number.isSafeInteger(value) || value < 1) throw failure("PROVIDER_INVALID_INPUT", field, "inteiro positivo obrigatório"); }
function safeText(value, field, max) { if (typeof value !== "string" || value.trim() === "" || Array.from(value).length > max) throw failure("PROVIDER_INVALID_INPUT", field, "texto inválido"); if (FORBIDDEN_REFERENCE.test(value)) throw failure("PROVIDER_FORBIDDEN_REFERENCE", field, "referência externa proibida"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new OpenAIImageAdapterError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
