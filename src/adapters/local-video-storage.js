import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ffmpegFailure } from "./ffmpeg-video-error.js";

export class LocalVideoStorage {
  constructor({ root, maxBytes }) {
    if (typeof root !== "string" || root.length === 0) throw ffmpegFailure("FFMPEG_CONFIGURATION_MISSING", "renderRoot", "storage de render obrigatório");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw ffmpegFailure("FFMPEG_CONFIGURATION_INVALID", "maxOutputBytes", "limite inválido");
    this.root = resolve(root); this.maxBytes = maxBytes;
  }

  async createStaging() {
    await mkdir(this.root, { recursive: true });
    const rootReal = await realpath(this.root);
    const parent = join(rootReal, ".staging");
    try { if ((await lstat(parent)).isSymbolicLink()) throw ffmpegFailure("FFMPEG_CONFIGURATION_INVALID", "stagingRoot", "staging não pode ser link simbólico"); }
    catch (caught) { if (caught?.code !== "ENOENT") throw caught; }
    await mkdir(parent, { recursive: true });
    const parentReal = await realpath(parent);
    if (!inside(rootReal, parentReal)) throw ffmpegFailure("FFMPEG_CONFIGURATION_INVALID", "stagingRoot", "staging fora do renderRoot");
    const [rootDevice, stagingDevice] = await Promise.all([stat(rootReal), stat(parentReal)]);
    if (rootDevice.dev !== stagingDevice.dev) throw ffmpegFailure("FFMPEG_CONFIGURATION_INVALID", "stagingRoot", "staging e renderRoot não compartilham filesystem");
    return mkdtemp(join(parentReal, "compose-"));
  }

  async promote(sourcePath, contentHash, { validateExisting } = {}) {
    const [rootReal, sourceReal] = await Promise.all([realpath(this.root), realpath(sourcePath).catch((caught) => { throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "saída física ausente", { cause: caught }); })]);
    if (!inside(join(rootReal, ".staging"), sourceReal)) throw ffmpegFailure("COMPOSER_STORAGE_FAILED", "storage", "saída fora do staging autorizado");
    const source = await stat(sourcePath).catch((caught) => { throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "saída física ausente", { cause: caught }); });
    if (!source.isFile() || source.size < 1 || source.size > this.maxBytes) throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "saída física inválida");
    const directory = join(this.root, "sha256", contentHash.slice(0, 2));
    const physicalPath = join(directory, `${contentHash}.mp4`); await mkdir(directory, { recursive: true });
    let reused = false;
    try { await link(sourcePath, physicalPath); }
    catch (caught) {
      if (caught?.code === "EXDEV") throw ffmpegFailure("FFMPEG_CONFIGURATION_INVALID", "stagingRoot", "staging e renderRoot não compartilham filesystem", { cause: caught });
      if (caught?.code !== "EEXIST") throw ffmpegFailure("COMPOSER_STORAGE_FAILED", "storage", "promoção do render falhou", { cause: caught });
      if (await hashFile(physicalPath, this.maxBytes) !== contentHash) throw ffmpegFailure("COMPOSER_STORAGE_HASH_CONFLICT", "storage", "objeto existente diverge do hash lógico");
      if (validateExisting) await validateExisting(physicalPath);
      reused = true;
    }
    return Object.freeze({ logicalReference: `render:sha256_${contentHash}`, physicalPath, reused });
  }

  async cleanup(stagingPath) {
    if (typeof stagingPath !== "string") return;
    const rootReal = await realpath(this.root).catch(() => this.root);
    const candidate = resolve(stagingPath);
    if (!inside(join(rootReal, ".staging"), candidate)) throw ffmpegFailure("COMPOSER_STORAGE_FAILED", "staging", "cleanup fora do staging");
    await rm(candidate, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

export async function hashFile(path, maxBytes = Number.MAX_SAFE_INTEGER) {
  const info = await stat(path).catch((caught) => { throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "arquivo ausente", { cause: caught }); });
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "arquivo fora dos limites");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function inside(root, candidate) { const normalizedRoot = resolve(root); const normalized = resolve(candidate); return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${sep}`); }
