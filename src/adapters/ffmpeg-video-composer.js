import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateCompositionPlan } from "../domain/composition-plan-contracts.js";
import { validateMediaAsset } from "../domain/media-asset-contracts.js";
import { validateVoiceTrack } from "../domain/voice-track-contracts.js";
import { VideoComposer } from "../video-composer.js";
import { inspectMvpPng } from "./png-image.js";
import { inspectMvpWav } from "./wav-audio.js";
import { FfmpegVideoAdapterError, ffmpegFailure } from "./ffmpeg-video-error.js";
import { LocalCompositionReferenceResolver } from "./local-composition-reference-resolver.js";
import { hashFile, LocalVideoStorage } from "./local-video-storage.js";

export { FfmpegVideoAdapterError } from "./ffmpeg-video-error.js";

export class FfmpegVideoComposer extends VideoComposer {
  constructor(config, { artifactCatalog, referenceResolver, storage, processRunner = runProcess } = {}) {
    super(); validateConfig(config);
    if (!artifactCatalog || typeof artifactCatalog.getVoiceTrack !== "function" || typeof artifactCatalog.getMediaAsset !== "function") throw new TypeError("catálogo de artefatos obrigatório");
    if (typeof processRunner !== "function") throw new TypeError("executor de processo obrigatório");
    this.config = config; this.catalog = artifactCatalog; this.processRunner = processRunner;
    this.resolver = referenceResolver ?? new LocalCompositionReferenceResolver(config);
    this.storage = storage ?? new LocalVideoStorage({ root: config.renderRoot, maxBytes: config.maxOutputBytes });
  }

  async compose(input, { signal } = {}) {
    if (signal?.aborted) throw failure("COMPOSER_CANCELLED", "signal", "operação cancelada");
    const { plan, voice, media } = this.#validateInput(input);
    let staging;
    try {
      staging = await this.storage.createStaging();
      const staged = await this.#stageInputs(staging, voice, media, signal);
      const filterPath = join(staging, "filtergraph.txt"); const outputPath = join(staging, "render.mp4");
      await writeFile(filterPath, filterGraph(plan, this.config), { flag: "wx", mode: 0o600 });
      await this.#execute(this.config.ffmpegPath, encodeArgs(staged, filterPath, outputPath, plan, this.config), staging, signal, "encode");
      await requireOutput(outputPath, this.config.maxOutputBytes);
      await this.#decode(outputPath, staging, signal);
      const measured = await this.#probe(outputPath, staging, signal, plan.durationMilliseconds);
      const contentHash = await hashFile(outputPath, this.config.maxOutputBytes);
      const promoted = await this.storage.promote(outputPath, contentHash, { validateExisting: async (path) => {
        await this.#decode(path, staging, signal); await this.#probe(path, staging, signal, plan.durationMilliseconds);
      } });
      await this.#probe(promoted.physicalPath, staging, signal, plan.durationMilliseconds);
      return Object.freeze({ ...measured, contentHash, logicalReference: promoted.logicalReference });
    } catch (caught) { throw mapError(caught, signal); }
    finally { if (staging) await this.storage.cleanup(staging).catch(() => {}); }
  }

  #validateInput(input) {
    if (!input || typeof input !== "object" || input.output?.containerFormat !== "mp4" || input.output?.widthPixels !== 1080 || input.output?.heightPixels !== 1920) failureNow("COMPOSER_POLICY_MISMATCH", "output", "saída fora da política");
    let plan;
    try { plan = validateCompositionPlan(input.compositionPlan); } catch (caught) { failureNow("COMPOSER_INPUT_INVALID", "compositionPlan", "plano inválido", { cause: caught }); }
    if (plan.outputAspectRatio !== "9:16" || plan.segments.length > this.config.maxSegments || plan.durationMilliseconds > this.config.maxDurationMilliseconds) failureNow("COMPOSER_LIMIT_EXCEEDED", "compositionPlan", "plano fora dos limites");
    let voice;
    try { voice = validateVoiceTrack(this.catalog.getVoiceTrack(plan.voiceTrackId)); } catch (caught) { failureNow("COMPOSER_INPUT_INVALID", "voiceTrack", "voz persistida inválida", { cause: caught }); }
    if (voice.voiceTrackId !== plan.voiceTrackId || voice.contentHash !== plan.voiceTrackContentHash) failureNow("COMPOSER_VOICE_HASH_MISMATCH", "voiceTrackContentHash", "voz divergente do plano");
    verifyScope(plan, voice, "voiceTrack");
    if (voice.audioFormat !== "wav" || voice.durationMilliseconds !== plan.durationMilliseconds) failureNow("COMPOSER_VOICE_UNSUPPORTED", "voiceTrack", "voz fora da política");
    const media = plan.segments.map((segment, index) => {
      let asset;
      try { asset = validateMediaAsset(this.catalog.getMediaAsset(segment.mediaAssetId)); } catch (caught) { failureNow("COMPOSER_INPUT_INVALID", `segments.${index}.mediaAssetId`, "mídia persistida inválida", { cause: caught }); }
      if (asset.mediaAssetId !== segment.mediaAssetId || asset.contentHash !== segment.mediaAssetContentHash) failureNow("COMPOSER_MEDIA_HASH_MISMATCH", `segments.${index}.mediaAssetContentHash`, "mídia divergente do plano");
      verifyScope(plan, asset, `segments.${index}`);
      if (asset.assetType !== "IMAGE" || asset.technicalProperties.format !== "png") failureNow("COMPOSER_MEDIA_UNSUPPORTED", `segments.${index}`, "mídia fora da allowlist");
      return asset;
    });
    return { plan, voice, media };
  }

  async #stageInputs(staging, voice, media, signal) {
    const items = [];
    const voiceSource = await this.resolver.resolveVoice(voice.storageReference);
    items.push(await copyAndValidate(voiceSource, join(staging, "voice.wav"), this.config.maxVoiceBytes, voice.contentHash, (bytes) => {
      const measured = inspectMvpWav(bytes); if (measured.durationMilliseconds !== voice.durationMilliseconds || measured.audioFormat !== voice.audioFormat) failureNow("COMPOSER_VOICE_PROPERTIES_MISMATCH", "voiceTrack", "propriedades físicas da voz divergentes");
    }, signal));
    for (let index = 0; index < media.length; index += 1) {
      const asset = media[index]; const source = await this.resolver.resolveMedia(asset.mediaReference);
      items.push(await copyAndValidate(source, join(staging, `media-${String(index + 1).padStart(3, "0")}.png`), this.config.maxImageBytes, asset.contentHash, (bytes) => {
        const measured = inspectMvpPng(bytes); const expected = asset.technicalProperties;
        if (measured.format !== expected.format || measured.widthPixels !== expected.widthPixels || measured.heightPixels !== expected.heightPixels) failureNow("COMPOSER_MEDIA_PROPERTIES_MISMATCH", `segments.${index}`, "propriedades físicas da mídia divergentes");
      }, signal));
    }
    const total = items.reduce((sum, item) => sum + item.size, 0);
    if (total > this.config.maxTotalInputBytes) failureNow("COMPOSER_LIMIT_EXCEEDED", "inputs", "entradas excedem limite total");
    return { voicePath: items[0].path, mediaPaths: items.slice(1).map(({ path }) => path) };
  }

  async #execute(command, args, cwd, signal, phase) {
    try { return await this.processRunner(command, args, { cwd, signal, timeoutMs: this.config.timeoutMs, maxLogBytes: this.config.maxLogBytes, shell: false, windowsHide: true }); }
    catch (caught) { if (caught instanceof FfmpegVideoAdapterError) throw caught; if (caught?.code === "COMPOSER_TIMEOUT") throw caught; if (caught?.code === "ENOENT") throw failure("COMPOSER_UNAVAILABLE", phase, "binário indisponível", { cause: caught }); throw failure("COMPOSER_PROCESS_FAILED", phase, "processo de mídia falhou", { cause: caught }); }
  }
  async #decode(path, cwd, signal) { await this.#execute(this.config.ffmpegPath, ["-hide_banner", "-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], cwd, signal, "decode"); }
  async #probe(path, cwd, signal, durationMilliseconds) {
    const result = await this.#execute(this.config.ffprobePath, ["-v", "error", "-of", "json", "-show_entries", "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,sample_rate,channels", "-show_streams", "-show_format", path], cwd, signal, "probe");
    return parseProbe(result?.stdout, durationMilliseconds, this.config);
  }
}

function filterGraph(plan, config) {
  const duration = seconds(plan.durationMilliseconds); const filters = plan.segments.map((_, index) => `[${index}:v]scale=${config.widthPixels}:${config.heightPixels}:force_original_aspect_ratio=increase:flags=lanczos,crop=${config.widthPixels}:${config.heightPixels},setsar=1,fps=${config.frameRate},format=${config.pixelFormat},trim=duration=${duration},setpts=PTS-STARTPTS[i${index}]`);
  let current = "i0";
  for (let index = 1; index < plan.segments.length; index += 1) { const next = `v${index}`; filters.push(`[${current}][i${index}]overlay=enable='gte(t\\,${seconds(plan.segments[index].startMilliseconds)})':shortest=1:eof_action=repeat[${next}]`); current = next; }
  if (current === "i0") filters.push("[i0]null[vout]"); else filters.push(`[${current}]null[vout]`);
  const audioIndex = plan.segments.length;
  filters.push(`[${audioIndex}:a:0]aresample=${config.audioSampleRate},atrim=duration=${duration},asetpts=PTS-STARTPTS[aout]`);
  return `${filters.join(";\n")}\n`;
}

function encodeArgs(staged, filterPath, outputPath, plan, config) {
  const duration = seconds(plan.durationMilliseconds); const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"];
  for (const path of staged.mediaPaths) args.push("-loop", "1", "-framerate", String(config.frameRate), "-t", duration, "-i", path);
  args.push("-i", staged.voicePath, "-filter_complex_script", filterPath, "-map", "[vout]", "-map", "[aout]", "-t", duration, "-fps_mode", "cfr",
    "-c:v", config.videoCodec, "-profile:v", config.videoProfile, "-level:v", config.videoLevel, "-crf", String(config.crf), "-preset", config.preset,
    "-pix_fmt", config.pixelFormat, "-r", String(config.frameRate), "-g", String(config.gopSize), "-keyint_min", String(config.gopSize), "-sc_threshold", "0", "-threads:v", "1",
    "-c:a", config.audioCodec, "-profile:a", config.audioProfile, "-b:a", config.audioBitrate, "-ar", String(config.audioSampleRate), "-ac", String(config.audioChannels),
    "-map_metadata", "-1", "-map_chapters", "-1", "-metadata", "creation_time=1970-01-01T00:00:00Z", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-movflags", "+faststart", "-f", "mp4", outputPath);
  return args;
}

async function copyAndValidate(source, destination, maxBytes, expectedHash, inspect, signal) {
  if (signal?.aborted) failureNow("COMPOSER_CANCELLED", "signal", "operação cancelada");
  const sourceInfo = await stat(source); if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > maxBytes) failureNow("COMPOSER_LIMIT_EXCEEDED", "input", "entrada fora do limite");
  const bytes = await readFile(source);
  validateBytes(bytes, expectedHash, inspect); await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  const consumed = await readFile(destination); validateBytes(consumed, expectedHash, inspect);
  return { path: destination, size: consumed.length };
}
function validateBytes(bytes, expectedHash, inspect) { if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) failureNow("COMPOSER_PHYSICAL_HASH_MISMATCH", "input", "hash físico divergente"); try { inspect(bytes); } catch (caught) { if (caught instanceof FfmpegVideoAdapterError) throw caught; failureNow("COMPOSER_INPUT_INVALID", "input", "conteúdo físico inválido", { cause: caught }); } }
function parseProbe(text, expectedDuration, config) {
  if (typeof text !== "string" || Buffer.byteLength(text) > config.maxLogBytes) failureNow("COMPOSER_PROBE_INVALID", "probe", "resposta do probe inválida");
  let value; try { value = JSON.parse(text); } catch (caught) { failureNow("COMPOSER_PROBE_INVALID", "probe", "resposta do probe malformada", { cause: caught }); }
  const streams = Array.isArray(value?.streams) ? value.streams : []; const video = streams.filter(({ codec_type: type }) => type === "video"); const audio = streams.filter(({ codec_type: type }) => type === "audio");
  const format = value?.format; const duration = milliseconds(format?.duration);
  const valid = video.length === 1 && audio.length === 1 && streams.length === 2 && String(format?.format_name).split(",").includes("mp4") && duration === expectedDuration
    && video[0].codec_name === "h264" && video[0].profile === "High" && video[0].level === 40 && video[0].width === config.widthPixels && video[0].height === config.heightPixels
    && video[0].pix_fmt === config.pixelFormat && video[0].r_frame_rate === "30/1" && video[0].avg_frame_rate === "30/1"
    && Number.isFinite(Number(video[0].duration)) && expectedDuration - Number(video[0].duration) * 1000 >= -0.5 && expectedDuration - Number(video[0].duration) * 1000 < (1000 / config.frameRate) + 1
    && audio[0].codec_name === "aac" && audio[0].profile === "LC" && audio[0].sample_rate === String(config.audioSampleRate) && audio[0].channels === config.audioChannels && milliseconds(audio[0].duration) === expectedDuration;
  if (!valid) failureNow("COMPOSER_OUTPUT_POLICY_MISMATCH", "output", "saída medida diverge da política");
  return Object.freeze({ durationMilliseconds: duration, containerFormat: "mp4", widthPixels: video[0].width, heightPixels: video[0].height });
}
function milliseconds(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : NaN; }
function seconds(millisecondsValue) { return (millisecondsValue / 1000).toFixed(3); }
async function requireOutput(path, maxBytes) { const value = await stat(path).catch((caught) => { failureNow("COMPOSER_OUTPUT_INVALID", "output", "saída ausente", { cause: caught }); }); if (!value?.isFile() || value.size < 1 || value.size > maxBytes) failureNow("COMPOSER_OUTPUT_INVALID", "output", "saída inválida"); }
function verifyScope(plan, artifact, field) { for (const key of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash"]) if (artifact[key] !== plan[key]) failureNow("COMPOSER_ARTIFACT_SCOPE_MISMATCH", `${field}.${key}`, "artefato fora do escopo do plano"); }
function validateConfig(config) {
  const exact = { policyVersion: "ffmpeg-video-policy/1.0.0", widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "aac", audioProfile: "aac_low", audioBitrate: "192k", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, maxSegments: 60, maxDurationMilliseconds: 180000 };
  const strings = ["ffmpegPath", "ffprobePath", "voiceRoot", "mediaRoot", "renderRoot", "stagingRoot"];
  const limits = ["maxVoiceBytes", "maxImageBytes", "maxTotalInputBytes", "maxOutputBytes", "timeoutMs", "maxLogBytes"];
  const invalid = !config || Object.entries(exact).some(([key, value]) => config[key] !== value) || strings.some((key) => typeof config[key] !== "string" || config[key].length === 0) || limits.some((key) => !Number.isSafeInteger(config[key]) || config[key] < 1) || config.stagingRoot !== join(config.renderRoot, ".staging");
  if (invalid) throw failure("FFMPEG_CONFIGURATION_INVALID", "config", "configuração fora da política");
}
function mapError(caught, signal) { if (caught instanceof FfmpegVideoAdapterError) return caught; if (caught?.code === "COMPOSER_TIMEOUT") return failure("COMPOSER_TIMEOUT", "process", "processo excedeu o limite", { cause: caught }); if (signal?.aborted || caught?.name === "AbortError" || caught?.code === "COMPOSER_CANCELLED") return failure("COMPOSER_CANCELLED", "signal", "operação cancelada", { cause: caught }); return failure("COMPOSER_FAILED", "composer", "composição não concluída", { cause: caught }); }
function failure(code, field, message, options) { return ffmpegFailure(code, field, message, options); }
function failureNow(code, field, message, options) { throw failure(code, field, message, options); }

export function runProcess(command, args, { cwd, signal, timeoutMs, maxLogBytes, shell = false, windowsHide = true } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController(); let timedOut = false; let settled = false;
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let child; try { child = spawn(command, args, { cwd, signal: controller.signal, shell, windowsHide, stdio: ["ignore", "pipe", "pipe"] }); } catch (caught) { finish(reject, caught); return; }
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0);
    const collect = (target) => (chunk) => { const clean = Buffer.from(String(chunk).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")); if (target === "out") stdout = bounded(stdout, clean, maxLogBytes); else stderr = bounded(stderr, clean, maxLogBytes); };
    child.stdout.on("data", collect("out")); child.stderr.on("data", collect("err"));
    child.on("error", (caught) => { if (timedOut) finish(reject, failure("COMPOSER_TIMEOUT", "process", "processo excedeu o limite", { cause: caught })); else if (signal?.aborted) finish(reject, failure("COMPOSER_CANCELLED", "signal", "operação cancelada", { cause: caught })); else finish(reject, caught); });
    child.on("close", (code) => { if (timedOut) finish(reject, failure("COMPOSER_TIMEOUT", "process", "processo excedeu o limite")); else if (signal?.aborted) finish(reject, failure("COMPOSER_CANCELLED", "signal", "operação cancelada")); else if (code !== 0) finish(reject, failure("COMPOSER_PROCESS_FAILED", "process", "processo encerrou com falha")); else finish(resolve, { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") }); });
    function finish(callback, value) { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel); callback(value); }
  });
}
function bounded(current, addition, limit) { const combined = Buffer.concat([current, addition]); return combined.length <= limit ? combined : combined.subarray(combined.length - limit); }
