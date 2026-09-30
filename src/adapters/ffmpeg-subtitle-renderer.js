import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeSubtitleAss } from "../domain/subtitle-generation.js";
import { SUBTITLE_RENDER_POLICY_VERSION, SUBTITLE_RENDER_RESULT_VERSION } from "../domain/subtitle-render-contracts.js";
import { validateSubtitleTrack } from "../domain/subtitle-track-contracts.js";
import { validateVideoRender } from "../domain/video-render-contracts.js";
import { SubtitleRenderer } from "../subtitle-renderer.js";
import { runProcess } from "./ffmpeg-video-composer.js";
import { FfmpegVideoAdapterError, ffmpegFailure } from "./ffmpeg-video-error.js";
import { LocalCompositionReferenceResolver } from "./local-composition-reference-resolver.js";
import { hashFile, LocalVideoStorage } from "./local-video-storage.js";

export class FfmpegSubtitleRenderer extends SubtitleRenderer {
  constructor(config, { referenceResolver, storage, processRunner = runProcess } = {}) {
    super(); validateConfig(config); this.config = config; this.processRunner = processRunner;
    this.resolver = referenceResolver ?? new LocalCompositionReferenceResolver({ voiceRoot: config.renderRoot, mediaRoot: config.renderRoot, renderRoot: config.renderRoot });
    this.storage = storage ?? new LocalVideoStorage({ root: config.renderRoot, maxBytes: config.maxOutputBytes });
  }

  async render(input, { signal } = {}) {
    if (signal?.aborted) throw failure("SUBTITLE_RENDER_CANCELLED", "signal", "operação cancelada");
    let staging;
    try {
      const { request, video, track } = validateInput(input); const toolchain = await this.#toolchain(signal);
      const reconciled = await this.storage.reconcile(request.contentHash, this.config.policyVersion);
      if (reconciled) { await this.#decode(reconciled.physicalPath, this.config.renderRoot, signal); const measured = await this.#probe(reconciled.physicalPath, this.config.renderRoot, signal, video.durationMilliseconds); return result(request, measured, reconciled, reconciled.toolchain); }
      const sourcePath = await this.resolver.resolveVideo(video.logicalReference);
      if (await hashFile(sourcePath, this.config.maxInputBytes) !== video.contentHash) failureNow("SUBTITLE_RENDER_PHYSICAL_HASH_MISMATCH", "videoRender", "hash físico divergente");
      await this.#probe(sourcePath, this.config.renderRoot, signal, video.durationMilliseconds);
      staging = await this.storage.createStaging(); const assPath = join(staging, "subtitles.ass"); const outputPath = join(staging, "render.mp4");
      await writeFile(assPath, serializeSubtitleAss(track), { flag: "wx", mode: 0o600 });
      await this.#execute(this.config.ffmpegPath, encodeArgs(sourcePath, outputPath, this.config), staging, signal, "encode");
      await requireOutput(outputPath, this.config.maxOutputBytes); await this.#decode(outputPath, staging, signal);
      const measured = await this.#probe(outputPath, staging, signal, video.durationMilliseconds); const contentHash = await hashFile(outputPath, this.config.maxOutputBytes);
      const promoted = await this.storage.promote(outputPath, contentHash, { validateExisting: async (path) => { await this.#decode(path, staging, signal); await this.#probe(path, staging, signal, video.durationMilliseconds); }, reconciliation: { requestHash: request.contentHash, policyVersion: this.config.policyVersion, toolchain } });
      await this.#decode(promoted.physicalPath, staging, signal); await this.#probe(promoted.physicalPath, staging, signal, video.durationMilliseconds);
      return result(request, measured, { ...promoted, contentHash }, toolchain);
    } catch (caught) { throw mapError(caught, signal); }
    finally { if (staging) await this.storage.cleanup(staging).catch(() => {}); }
  }

  async #toolchain(signal) {
    const version = await this.#execute(this.config.ffmpegPath, ["-version"], this.config.renderRoot, signal, "toolchain");
    const filter = await this.#execute(this.config.ffmpegPath, ["-hide_banner", "-h", "filter=subtitles"], this.config.renderRoot, signal, "toolchain");
    const ffmpegVersion = String(version.stdout ?? "").split(/\r?\n/u)[0].trim(); const evidence = `${filter.stdout ?? ""}\n${filter.stderr ?? ""}`;
    if (!/^ffmpeg version .{1,220}$/u.test(ffmpegVersion) || !/subtitles/iu.test(evidence)) failureNow("SUBTITLE_RENDER_TOOLCHAIN_INVALID", "toolchain", "toolchain sem evidência suficiente");
    return Object.freeze({ ffmpegVersion, libassFingerprint: sha256(evidence), fontFamily: this.config.fontFamily, fontProvider: this.config.fontProvider });
  }
  async #execute(command, args, cwd, signal, phase) { try { return await this.processRunner(command, args, { cwd, signal, timeoutMs: this.config.timeoutMs, maxLogBytes: this.config.maxLogBytes, shell: false, windowsHide: true }); } catch (caught) { if (caught instanceof FfmpegVideoAdapterError) throw caught; if (caught?.code === "COMPOSER_TIMEOUT") throw failure("SUBTITLE_RENDER_TIMEOUT", phase, "processo excedeu limite", { cause: caught }); if (caught?.code === "ENOENT") throw failure("SUBTITLE_RENDER_UNAVAILABLE", phase, "binário indisponível", { cause: caught }); throw failure("SUBTITLE_RENDER_PROCESS_FAILED", phase, "processo falhou", { cause: caught }); } }
  async #decode(path, cwd, signal) { await this.#execute(this.config.ffmpegPath, ["-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], cwd, signal, "decode"); }
  async #probe(path, cwd, signal, duration) { const output = await this.#execute(this.config.ffprobePath, ["-v", "error", "-of", "json", "-show_entries", "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,sample_rate,channels", "-show_streams", "-show_format", path], cwd, signal, "probe"); return parseProbe(output.stdout, duration, this.config); }
}

function validateInput(input) { if (!input || typeof input !== "object" || !input.request || typeof input.request.contentHash !== "string") failureNow("SUBTITLE_RENDER_INPUT_INVALID", "input", "entrada inválida"); let video; let track; try { video = validateVideoRender(input.videoRender); track = validateSubtitleTrack(input.subtitleTrack); } catch (caught) { failureNow("SUBTITLE_RENDER_INPUT_INVALID", "input", "artefato inválido", { cause: caught }); } return { request: input.request, video, track }; }
function encodeArgs(input, output, config) { return ["-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", input, "-map", "0:v:0", "-map", "0:a:0", "-vf", "subtitles=filename=subtitles.ass", "-c:v", config.videoCodec, "-profile:v", config.videoProfile, "-level:v", config.videoLevel, "-crf", String(config.crf), "-preset", config.preset, "-pix_fmt", config.pixelFormat, "-r", String(config.frameRate), "-g", String(config.gopSize), "-c:a", "copy", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-y", output]; }
function parseProbe(text, expectedDuration, config) { if (typeof text !== "string" || Buffer.byteLength(text) > config.maxLogBytes) failureNow("SUBTITLE_RENDER_PROBE_INVALID", "probe", "resposta inválida"); let value; try { value = JSON.parse(text); } catch (caught) { failureNow("SUBTITLE_RENDER_PROBE_INVALID", "probe", "resposta malformada", { cause: caught }); } const streams = Array.isArray(value?.streams) ? value.streams : []; const videos = streams.filter((item) => item.codec_type === "video"); const audios = streams.filter((item) => item.codec_type === "audio"); const video = videos[0]; const audio = audios[0]; const duration = milliseconds(value?.format?.duration); const within = (actual) => Math.abs(actual - expectedDuration) <= config.durationToleranceMilliseconds;
  const valid = streams.length === 2 && videos.length === 1 && audios.length === 1 && value.format?.format_name?.split(",").includes("mp4") && video?.codec_name === "h264" && video.profile === "High" && video.level === 40 && video.width === 1080 && video.height === 1920 && video.pix_fmt === "yuv420p" && video.r_frame_rate === "30/1" && video.avg_frame_rate === "30/1" && audio?.codec_name === "aac" && audio.profile === "LC" && audio.sample_rate === "48000" && audio.channels === 1 && within(duration) && within(milliseconds(video.duration)) && within(milliseconds(audio.duration));
  if (!valid) failureNow("SUBTITLE_RENDER_OUTPUT_POLICY_MISMATCH", "probe", "mídia fora da política"); return Object.freeze({ durationMilliseconds: duration, containerFormat: "mp4", outputAspectRatio: "9:16", widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "h264", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 1 }); }
function result(request, measured, stored, toolchain) { return Object.freeze({ schemaVersion: SUBTITLE_RENDER_RESULT_VERSION, subtitleRenderRequestId: request.subtitleRenderRequestId, requestContentHash: request.contentHash, ...measured, contentHash: stored.contentHash, logicalReference: stored.logicalReference, toolchain }); }
function validateConfig(config) { const exact = { policyVersion: SUBTITLE_RENDER_POLICY_VERSION, widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "copy", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, durationToleranceMilliseconds: 34, fontFamily: "Arial", fontProvider: "libass-default" }; const strings = ["ffmpegPath", "ffprobePath", "renderRoot", "stagingRoot"]; const limits = ["maxInputBytes", "maxOutputBytes", "timeoutMs", "maxLogBytes"]; if (!config || Object.entries(exact).some(([key, value]) => config[key] !== value) || strings.some((key) => typeof config[key] !== "string" || !config[key]) || limits.some((key) => !Number.isSafeInteger(config[key]) || config[key] < 1) || config.stagingRoot !== join(config.renderRoot, ".staging")) throw failure("FFMPEG_CONFIGURATION_INVALID", "config", "configuração fora da política"); }
async function requireOutput(path, max) { const value = await stat(path).catch((caught) => failureNow("SUBTITLE_RENDER_OUTPUT_INVALID", "output", "saída ausente", { cause: caught })); if (!value?.isFile() || value.size < 1 || value.size > max) failureNow("SUBTITLE_RENDER_OUTPUT_INVALID", "output", "saída inválida"); }
function milliseconds(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : NaN; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function mapError(caught, signal) { if (caught instanceof FfmpegVideoAdapterError) return caught; if (signal?.aborted || caught?.name === "AbortError") return failure("SUBTITLE_RENDER_CANCELLED", "signal", "operação cancelada", { cause: caught }); return failure("SUBTITLE_RENDER_FAILED", "renderer", "renderização não concluída", { cause: caught }); }
function failure(code, field, message, options) { return ffmpegFailure(code, field, message, options); }
function failureNow(code, field, message, options) { throw failure(code, field, message, options); }
