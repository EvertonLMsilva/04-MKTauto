import { stat } from "node:fs/promises";
import { hashFile } from "./local-video-storage.js";
import { runProcess } from "./ffmpeg-video-composer.js";

export const QUALITY_INSPECTOR_FACTS_VERSION = "quality-inspector-facts/1.0.0";

export class FfmpegQualityInspector {
  constructor(config, { referenceResolver, processRunner = runProcess } = {}) {
    validateConfig(config);
    if (!referenceResolver || typeof referenceResolver.resolveVideo !== "function" || typeof referenceResolver.resolveMedia !== "function") throw new TypeError("resolvedor de artefatos obrigatório");
    if (typeof processRunner !== "function") throw new TypeError("executor de processo obrigatório");
    this.config = config; this.resolver = referenceResolver; this.processRunner = processRunner;
  }

  async inspect({ videoRender, mediaAssets }, { signal } = {}) {
    abort(signal);
    const videoFile = await inspectFile(() => this.resolver.resolveVideo(videoRender.logicalReference), this.config.maxOutputBytes, signal);
    let decodeSucceeded = false; let probeSucceeded = false; let technicalError = videoFile.errorKind; let probe = emptyProbe();
    if (videoFile.path !== null && videoFile.readable) {
      const decoded = await this.#execute(this.config.ffmpegPath, ["-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", videoFile.path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], signal);
      decodeSucceeded = decoded.succeeded; technicalError = decoded.errorKind;
      const inspected = await this.#execute(this.config.ffprobePath, ["-v", "error", "-of", "json", "-show_entries", "format=format_name,duration,size,start_time:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,start_time,sample_rate,channels", "-show_streams", "-show_format", videoFile.path], signal);
      if (inspected.succeeded) {
        const parsed = parseProbe(inspected.stdout, this.config.maxLogBytes);
        probeSucceeded = parsed !== null; probe = parsed ?? emptyProbe(); technicalError = parsed ? technicalError : "INVALID_PROBE";
      } else { technicalError = inspected.errorKind; }
    }
    const media = [];
    for (const asset of mediaAssets) {
      abort(signal);
      const file = await inspectFile(() => this.resolver.resolveMedia(asset.mediaReference, asset.assetType === "VIDEO" ? "mp4" : "png"), this.config.maxMediaBytes, signal);
      media.push(Object.freeze({ mediaAssetId: asset.mediaAssetId, exists: file.exists, accessible: file.accessible, regularFile: file.regularFile, sizeBytes: file.sizeBytes, readable: file.readable, sha256: file.sha256, errorKind: file.errorKind }));
    }
    return deepFreeze({
      schemaVersion: QUALITY_INSPECTOR_FACTS_VERSION,
      video: { exists: videoFile.exists, accessible: videoFile.accessible, regularFile: videoFile.regularFile, sizeBytes: videoFile.sizeBytes, readable: videoFile.readable, sha256: videoFile.sha256, decodeSucceeded, probeSucceeded, technicalError, ...probe },
      media,
    });
  }

  async #execute(command, args, signal) {
    abort(signal);
    try {
      const result = await this.processRunner(command, args, { signal, timeoutMs: this.config.timeoutMs, maxLogBytes: this.config.maxLogBytes, shell: false, windowsHide: true });
      return { succeeded: true, stdout: String(result?.stdout ?? ""), errorKind: null };
    } catch (caught) {
      abort(signal);
      const errorKind = caught?.code === "COMPOSER_TIMEOUT" ? "TIMEOUT" : caught?.code === "ENOENT" || /UNAVAILABLE$/.test(caught?.code ?? "") ? "UNAVAILABLE" : "PROCESS_FAILED";
      return { succeeded: false, stdout: "", errorKind };
    }
  }
}

async function inspectFile(resolveReference, maxBytes, signal) {
  abort(signal); let path;
  try { path = await resolveReference(); }
  catch (caught) { abort(signal); return { path: null, exists: caught?.cause?.code !== "EACCES" && caught?.code !== "EACCES" ? false : null, accessible: false, regularFile: false, sizeBytes: null, readable: false, sha256: null, errorKind: publicFileError(caught) }; }
  let info;
  try { info = await stat(path); }
  catch (caught) { abort(signal); return { path: null, exists: caught?.code === "ENOENT" ? false : null, accessible: false, regularFile: false, sizeBytes: null, readable: false, sha256: null, errorKind: publicFileError(caught) }; }
  const base = { path, exists: true, accessible: true, regularFile: info.isFile(), sizeBytes: info.size, readable: false, sha256: null, errorKind: null };
  if (!info.isFile()) return { ...base, errorKind: "NOT_FILE" };
  try { return { ...base, readable: true, sha256: await hashFile(path, maxBytes) }; }
  catch (caught) { abort(signal); return { ...base, errorKind: info.size > maxBytes ? "TOO_LARGE" : "UNREADABLE" }; }
}

function parseProbe(text, maxBytes) {
  if (typeof text !== "string" || Buffer.byteLength(text) > maxBytes) return null;
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!value || !Array.isArray(value.streams) || !value.format || typeof value.format !== "object") return null;
  const number = (input) => { const parsed = Number(input); return Number.isFinite(parsed) ? parsed : null; };
  const milliseconds = (input) => { const parsed = number(input); return parsed === null ? null : Math.round(parsed * 1000); };
  const streams = value.streams.slice(0, 20).map((stream) => Object.freeze({
    index: Number.isSafeInteger(stream.index) ? stream.index : null,
    type: ["video", "audio", "subtitle", "data", "attachment"].includes(stream.codec_type) ? stream.codec_type : "other",
    codec: typeof stream.codec_name === "string" ? stream.codec_name.slice(0, 40) : null,
    profile: typeof stream.profile === "string" ? stream.profile.slice(0, 40) : null,
    level: Number.isSafeInteger(stream.level) ? stream.level : null,
    widthPixels: Number.isSafeInteger(stream.width) ? stream.width : null,
    heightPixels: Number.isSafeInteger(stream.height) ? stream.height : null,
    pixelFormat: typeof stream.pix_fmt === "string" ? stream.pix_fmt.slice(0, 40) : null,
    frameRate: typeof stream.r_frame_rate === "string" ? stream.r_frame_rate.slice(0, 40) : null,
    averageFrameRate: typeof stream.avg_frame_rate === "string" ? stream.avg_frame_rate.slice(0, 40) : null,
    durationMilliseconds: milliseconds(stream.duration), startMilliseconds: milliseconds(stream.start_time),
    sampleRate: number(stream.sample_rate), channels: Number.isSafeInteger(stream.channels) ? stream.channels : null,
  }));
  return Object.freeze({ containerNames: typeof value.format.format_name === "string" ? value.format.format_name.split(",").filter((name) => /^[a-z0-9_]{1,40}$/.test(name)).sort() : [], durationMilliseconds: milliseconds(value.format.duration), startMilliseconds: milliseconds(value.format.start_time), streams });
}

function emptyProbe() { return Object.freeze({ containerNames: [], durationMilliseconds: null, startMilliseconds: null, streams: [] }); }
function publicFileError(caught) { const code = caught?.cause?.code ?? caught?.code; if (code === "ENOENT" || /NOT_FOUND$/.test(caught?.code ?? "")) return "NOT_FOUND"; if (code === "EACCES" || code === "EPERM") return "ACCESS_DENIED"; if (/OUTSIDE_ROOT$/.test(caught?.code ?? "")) return "OUTSIDE_ROOT"; if (/REFERENCE_INVALID$/.test(caught?.code ?? "")) return "INVALID_REFERENCE"; return "REFERENCE_FAILED"; }
function abort(signal) { if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "QUALITY_INSPECTION_CANCELLED", field: "signal" }); }
function validateConfig(config) { for (const key of ["ffmpegPath", "ffprobePath"]) if (typeof config?.[key] !== "string" || !config[key]) throw new TypeError("configuração de inspeção obrigatória"); for (const key of ["maxOutputBytes", "maxMediaBytes", "timeoutMs", "maxLogBytes"]) if (!Number.isSafeInteger(config?.[key]) || config[key] < 1) throw new TypeError("limite de inspeção inválido"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
