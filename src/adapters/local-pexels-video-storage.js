import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, link, open, readFile, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { PexelsVideoAdapterError } from "./pexels-video-error.js";

const execute = promisify(execFile);

export class LocalPexelsVideoStorage {
  constructor({ root, maxBytes, ffmpegPath, ffprobePath }, { executeImpl = execute } = {}) {
    this.root = resolve(root); this.maxBytes = maxBytes; this.ffmpegPath = ffmpegPath; this.ffprobePath = ffprobePath; this.execute = executeImpl;
  }

  async store(value, { signal } = {}) {
    const bytes = Buffer.from(value ?? []);
    if (bytes.length === 0) fail("PROVIDER_INVALID_VIDEO", "video", "vídeo vazio");
    if (bytes.length > this.maxBytes) fail("PROVIDER_VIDEO_TOO_LARGE", "video", "vídeo excede o limite");
    const staging = join(this.root, ".staging"); await mkdir(staging, { recursive: true });
    const temporaryPath = inside(this.root, join(staging, `${randomUUID()}.mp4`));
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      const properties = await inspectVideo(temporaryPath, this.ffprobePath, this.ffmpegPath, signal, this.execute);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const directory = inside(this.root, join(this.root, "sha256", contentHash.slice(0, 2))); await mkdir(directory, { recursive: true });
      const physicalPath = inside(this.root, join(directory, `${contentHash}.mp4`));
      let reused = false;
      try { await link(temporaryPath, physicalPath); }
      catch (caught) {
        if (caught?.code !== "EEXIST") throw caught;
        const existing = await readFile(physicalPath);
        if (createHash("sha256").update(existing).digest("hex") !== contentHash) fail("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente divergente");
        await inspectVideo(physicalPath, this.ffprobePath, this.ffmpegPath, signal, this.execute); reused = true;
      }
      return Object.freeze({ contentHash, mediaReference: `media:sha256_${contentHash}`, physicalPath, reused, ...properties });
    } catch (caught) {
      if (caught instanceof PexelsVideoAdapterError) throw caught;
      fail("PROVIDER_STORAGE_FAILED", "storage", "não foi possível armazenar o vídeo", { cause: caught });
    } finally { if (handle) await handle.close().catch(() => {}); await unlink(temporaryPath).catch(() => {}); }
  }
}

async function inspectVideo(path, ffprobePath, ffmpegPath, signal, executeImpl) {
  let body;
  try {
    const result = await executeImpl(ffprobePath, ["-v", "error", "-of", "json", "-show_entries", "format=format_name,duration,size:stream=codec_type,width,height,duration", "-show_streams", "-show_format", path], { signal, windowsHide: true, maxBuffer: 1048576 });
    body = JSON.parse(result.stdout);
  } catch (caught) { fail("PROVIDER_INVALID_VIDEO", "video", "FFprobe rejeitou o vídeo", { cause: caught }); }
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const videos = streams.filter(({ codec_type: type }) => type === "video");
  if (videos.length !== 1 || streams.some(({ codec_type: type }) => type === "audio")) fail("PROVIDER_VIDEO_STREAMS_INVALID", "video", "vídeo deve conter uma faixa visual e nenhum áudio");
  const formatNames = String(body?.format?.format_name ?? "").split(",");
  const durationMilliseconds = Math.round(Number(body?.format?.duration) * 1000);
  const widthPixels = videos[0].width; const heightPixels = videos[0].height;
  if (!formatNames.includes("mp4") || !Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 1 || !Number.isSafeInteger(widthPixels) || !Number.isSafeInteger(heightPixels)) fail("PROVIDER_INVALID_VIDEO", "video", "propriedades físicas inválidas");
  try { await executeImpl(ffmpegPath, ["-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-f", "null", "-"], { signal, windowsHide: true, maxBuffer: 1048576 }); }
  catch (caught) { fail("PROVIDER_VIDEO_DECODE_FAILED", "video", "decode integral falhou", { cause: caught }); }
  return Object.freeze({ format: "mp4", mimeType: "video/mp4", widthPixels, heightPixels, durationMilliseconds, hasAudio: false });
}
function inside(root, candidate) { const normalizedRoot = resolve(root); const normalized = resolve(candidate); if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) fail("PROVIDER_STORAGE_FAILED", "storage", "localização inválida"); return normalized; }
function fail(code, field, message, options) { throw new PexelsVideoAdapterError(code, field, message, options); }
