import { MediaProvider } from "../media-provider.js";
import { PEXELS_VIDEO_ENDPOINT } from "../pexels-video-config.js";
import { LocalPexelsVideoStorage } from "./local-pexels-video-storage.js";
import { PexelsVideoAdapterError } from "./pexels-video-error.js";

export { PexelsVideoAdapterError } from "./pexels-video-error.js";

export class PexelsVideoAdapter extends MediaProvider {
  constructor(config, { fetchImpl = fetch, storage } = {}) {
    super(); validateConfig(config); this.config = config; this.fetchImpl = fetchImpl;
    this.storage = storage ?? new LocalPexelsVideoStorage({
      root: config.storageRoot, maxBytes: config.maxVideoBytes,
      ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath,
    });
  }

  async provide(input, { signal } = {}) {
    validateInput(input);
    const controller = new AbortController(); let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true });
    try {
      const url = new URL(PEXELS_VIDEO_ENDPOINT);
      url.search = new URLSearchParams({ query: input.visualDirection.description, orientation: "portrait", size: "medium", locale: input.projectContext.language, page: "1", per_page: String(this.config.perPage) }).toString();
      const response = await this.fetchImpl(url, { headers: { authorization: this.config.apiKey }, signal: controller.signal, redirect: "error" });
      if (!response?.ok) throw httpFailure(response?.status);
      requireJson(response.headers?.get?.("content-type"));
      const body = await boundedBody(response.body, this.config.maxResponseBytes, controller.signal, true);
      const candidates = selectCandidates(body, input, this.config);
      for (const candidate of candidates) {
        try {
          const mediaResponse = await this.fetchImpl(candidate.link, { signal: controller.signal, redirect: "error" });
          if (!mediaResponse?.ok) throw httpFailure(mediaResponse?.status);
          if (!/^video\/mp4(?:\s*;|$)/i.test(mediaResponse.headers?.get?.("content-type") ?? "")) throw failure("PROVIDER_INVALID_VIDEO", "video.contentType", "MIME incompatível");
          const bytes = await boundedBody(mediaResponse.body, this.config.maxVideoBytes, controller.signal, false);
          const stored = await this.storage.store(bytes, { signal: controller.signal });
          if (stored.widthPixels < this.config.minimumWidthPixels || stored.heightPixels < this.config.minimumHeightPixels
            || stored.durationMilliseconds < input.projectContext.minDurationSeconds * 1000
            || stored.durationMilliseconds > input.projectContext.maxDurationSeconds * 1000) throw failure("PROVIDER_INVALID_VIDEO", "video", "vídeo fora dos requisitos físicos");
          return freeze({
            assetType: "VIDEO", technicalProperties: pickProperties(stored), contentHash: stored.contentHash,
            mediaReference: stored.mediaReference, origin: "PROVIDER_LICENSED", provider: "pexels", rights: this.config.rights,
            source: { externalAssetId: String(candidate.videoId), licenseName: this.config.licenseName, licenseUrl: this.config.licenseUrl, photographerName: candidate.photographerName, photographerUrl: candidate.photographerUrl, sourceUrl: candidate.sourceUrl },
          });
        } catch (caught) { if (!["PROVIDER_INVALID_VIDEO", "PROVIDER_VIDEO_STREAMS_INVALID", "PROVIDER_VIDEO_DECODE_FAILED", "PROVIDER_VIDEO_TOO_LARGE"].includes(caught?.code)) throw caught; }
      }
      throw failure("PROVIDER_NO_ELIGIBLE_VIDEO", "video", "nenhum clipe elegível");
    } catch (caught) {
      if (timedOut) throw failure("PROVIDER_TIMEOUT", "timeoutMs", "provider excedeu o tempo limite", { cause: caught });
      if (caught instanceof PexelsVideoAdapterError) throw caught;
      if (signal?.aborted || caught?.name === "AbortError") throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada", { cause: caught });
      throw failure("PROVIDER_CONNECTION_FAILED", "provider", "falha de conexão", { cause: caught });
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
  }
}

function selectCandidates(body, input, config) {
  if (!body || !Array.isArray(body.videos)) throw failure("PROVIDER_INVALID_RESPONSE", "response.videos", "resposta inválida");
  const excluded = new Set(input.excludedExternalAssetIds);
  const selected = [];
  for (const video of body.videos) {
    if (!Number.isSafeInteger(video?.id) || excluded.has(String(video.id)) || !safePexelsUrl(video.url) || !safePexelsUrl(video.user?.url) || typeof video.user?.name !== "string" || video.user.name.trim() === "") continue;
    if (!Number.isFinite(video.duration) || video.duration * 1000 < input.projectContext.minDurationSeconds * 1000 || video.duration * 1000 > input.projectContext.maxDurationSeconds * 1000) continue;
    const files = Array.isArray(video.video_files) ? video.video_files.filter((file) => file?.file_type === "video/mp4" && Number.isSafeInteger(file.width) && Number.isSafeInteger(file.height) && file.height > file.width && safeVideoUrl(file.link)) : [];
    files.sort((a, b) => Number(b.width >= config.minimumWidthPixels && b.height >= config.minimumHeightPixels) - Number(a.width >= config.minimumWidthPixels && a.height >= config.minimumHeightPixels) || b.width * b.height - a.width * a.height || a.id - b.id);
    if (files[0]) selected.push({ videoId: video.id, sourceUrl: video.url, photographerName: video.user.name.trim(), photographerUrl: video.user.url, link: files[0].link });
  }
  return selected;
}
async function boundedBody(stream, max, signal, json) { if (!stream || typeof stream[Symbol.asyncIterator] !== "function") throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta vazia"); const chunks=[]; let size=0; for await (const part of stream) { if (signal.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada"); const bytes=Buffer.from(part); size+=bytes.length; if(size>max) throw failure(json?"PROVIDER_RESPONSE_TOO_LARGE":"PROVIDER_VIDEO_TOO_LARGE", json?"response":"video", "resposta excede o limite"); chunks.push(bytes); } const value=Buffer.concat(chunks); if(!json) return value; try{return JSON.parse(value.toString("utf8"));}catch(caught){throw failure("PROVIDER_INVALID_RESPONSE","response","JSON inválido",{cause:caught});} }
function validateInput(input) {
  exact(input, ["logicalCallId", "assetType", "excludedExternalAssetIds", "visualDirection", "projectContext"], "input");
  if (input.assetType !== "VIDEO") throw failure("PROVIDER_UNSUPPORTED_ASSET_TYPE", "assetType", "adapter aceita somente vídeo");
  if (!Array.isArray(input.excludedExternalAssetIds) || input.excludedExternalAssetIds.some((id) => typeof id !== "string" || !/^\d+$/.test(id))) throw failure("PROVIDER_INVALID_INPUT", "excludedExternalAssetIds", "lista inválida");
  exact(input.visualDirection, ["position", "blockPosition", "description"], "visualDirection");
  if (typeof input.visualDirection.description !== "string" || input.visualDirection.description.trim() === "" || input.visualDirection.description.length > 2000 || /https?:\/\/|www\.|(?:^|\s)@/i.test(input.visualDirection.description)) throw failure("PROVIDER_INVALID_INPUT", "visualDirection.description", "direção inválida");
  exact(input.projectContext, ["projectId", "projectVersion", "language", "audienceProfile", "niche", "contentFormat", "aspectRatio", "visualStyle", "productionProfile", "minDurationSeconds", "maxDurationSeconds"], "projectContext");
  if (input.projectContext.productionProfile !== "MIXED_MEDIA_V2") throw failure("PROVIDER_PROFILE_MISMATCH", "projectContext.productionProfile", "perfil incompatível");
  if (input.projectContext.aspectRatio !== "9:16") throw failure("PROVIDER_UNSUPPORTED_ASPECT_RATIO", "projectContext.aspectRatio", "proporção incompatível");
  if (!Number.isSafeInteger(input.projectContext.minDurationSeconds) || !Number.isSafeInteger(input.projectContext.maxDurationSeconds) || input.projectContext.minDurationSeconds < 1 || input.projectContext.maxDurationSeconds < input.projectContext.minDurationSeconds) throw failure("PROVIDER_INVALID_INPUT", "projectContext.maxDurationSeconds", "duração inválida");
}
function validateConfig(config) {
  const textFields = ["apiKey", "storageRoot", "ffmpegPath", "ffprobePath", "licenseName"];
  const integerFields = ["timeoutMs", "maxResponseBytes", "maxVideoBytes", "perPage", "minimumWidthPixels", "minimumHeightPixels"];
  if (!config || config.endpoint !== PEXELS_VIDEO_ENDPOINT || textFields.some((field) => typeof config[field] !== "string" || config[field] === "")
    || integerFields.some((field) => !Number.isSafeInteger(config[field]) || config[field] < 1)
    || config.rights?.usageBasis !== "PROVIDER_TERMS" || config.rights?.commercialUseAllowed !== true
    || config.licenseUrl !== "https://www.pexels.com/license/") throw failure("PEXELS_VIDEO_CONFIGURATION_INVALID", "config", "configuração inválida");
}
function safePexelsUrl(value) { try { const url=new URL(value); return url.protocol==="https:" && (url.hostname==="www.pexels.com" || url.hostname==="pexels.com") && !url.username && !url.password; } catch { return false; } }
function safeVideoUrl(value) { try { const url=new URL(value); return url.protocol==="https:" && (url.hostname==="videos.pexels.com" || url.hostname.endsWith(".pexels.com")) && !url.username && !url.password; } catch { return false; } }
function requireJson(value) { if (!/^application\/json(?:\s*;|$)/i.test(value ?? "")) throw failure("PROVIDER_INVALID_RESPONSE", "response.contentType", "Content-Type incompatível"); }
function pickProperties(value) { return { format: value.format, mimeType: value.mimeType, widthPixels: value.widthPixels, heightPixels: value.heightPixels, durationMilliseconds: value.durationMilliseconds, hasAudio: value.hasAudio }; }
function httpFailure(status) { if(status===401) return failure("PROVIDER_AUTHENTICATION_FAILED","provider","autenticação falhou"); if(status===429) return failure("PROVIDER_RATE_LIMITED","provider","limite atingido"); if(status>=500) return failure("PROVIDER_UNAVAILABLE","provider","provider indisponível"); return failure("PROVIDER_REQUEST_REJECTED","provider","solicitação rejeitada"); }
function failure(code, field, message, options) { return new PexelsVideoAdapterError(code, field, message, options); }
function exact(value, fields, path) { if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("PROVIDER_INVALID_INPUT", path, "objeto inválido"); for (const key of Object.keys(value)) if (!fields.includes(key)) throw failure("PROVIDER_INVALID_INPUT", `${path}.${key}`, "campo não permitido"); for (const key of fields) if (!(key in value)) throw failure("PROVIDER_INVALID_INPUT", `${path}.${key}`, "campo obrigatório"); }
function freeze(value) { const clone=structuredClone(value); const visit=(item)=>{if(!item||typeof item!=="object"||Object.isFrozen(item))return item;Object.values(item).forEach(visit);return Object.freeze(item);};return visit(clone); }
