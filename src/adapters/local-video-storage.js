import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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

  async promote(sourcePath, contentHash, { validateExisting, reconciliation } = {}) {
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
    if (reconciliation) await createReceipt(this.root, sourcePath, contentHash, reconciliation);
    return Object.freeze({ logicalReference: `render:sha256_${contentHash}`, physicalPath, reused });
  }

  async reconcile(requestHash, policyVersion) {
    if (!/^[a-f0-9]{64}$/.test(requestHash)) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "requestHash", "hash inválido");
    const directory = join(this.root, ".requests", requestHash.slice(0, 2));
    const receiptPath = join(directory, `${requestHash}.json`); const aliasPath = join(directory, `${requestHash}.mp4`);
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath, "utf8")); }
    catch (caught) { if (caught?.code === "ENOENT") return null; throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "receipt", "receipt inválido", { cause: caught }); }
    if (!validReceipt(receipt) || receipt.requestHash !== requestHash || receipt.policyVersion !== policyVersion) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "receipt", "receipt divergente");
    const actualHash = await hashFile(aliasPath, this.maxBytes).catch((caught) => { throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "output", "alias inválido", { cause: caught }); });
    if (actualHash !== receipt.contentHash) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "contentHash", "hash físico divergente");
    const contentDirectory = join(this.root, "sha256", actualHash.slice(0, 2)); const physicalPath = join(contentDirectory, `${actualHash}.mp4`); await mkdir(contentDirectory, { recursive: true });
    try { await link(aliasPath, physicalPath); } catch (caught) { if (caught?.code !== "EEXIST") throw ffmpegFailure("COMPOSER_STORAGE_FAILED", "storage", "reconciliação falhou", { cause: caught }); if (await hashFile(physicalPath, this.maxBytes) !== actualHash) throw ffmpegFailure("COMPOSER_STORAGE_HASH_CONFLICT", "storage", "objeto divergente"); }
    return Object.freeze({ contentHash: actualHash, logicalReference: `render:sha256_${actualHash}`, physicalPath, toolchain: Object.freeze(receipt.toolchain) });
  }

  async cleanup(stagingPath) {
    if (typeof stagingPath !== "string") return;
    const rootReal = await realpath(this.root).catch(() => this.root);
    const candidate = resolve(stagingPath);
    if (!inside(join(rootReal, ".staging"), candidate)) throw ffmpegFailure("COMPOSER_STORAGE_FAILED", "staging", "cleanup fora do staging");
    await rm(candidate, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

async function createReceipt(root, sourcePath, contentHash, value) {
  const receipt = { schemaVersion: "subtitle-render-receipt/1.0.0", requestHash: value.requestHash, contentHash, policyVersion: value.policyVersion, toolchain: value.toolchain };
  if (!validReceipt(receipt)) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "receipt", "receipt inválido");
  const directory = join(root, ".requests", receipt.requestHash.slice(0, 2)); await mkdir(directory, { recursive: true });
  const aliasPath = join(directory, `${receipt.requestHash}.mp4`); const receiptPath = join(directory, `${receipt.requestHash}.json`);
  try { await link(sourcePath, aliasPath); } catch (caught) { if (caught?.code !== "EEXIST") throw caught; if (await hashFile(aliasPath) !== contentHash) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "requestHash", "alias divergente"); }
  const stagedReceipt = join(resolve(sourcePath, ".."), `receipt-${receipt.requestHash}.json`); await writeFile(stagedReceipt, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
  try { await link(stagedReceipt, receiptPath); } catch (caught) { if (caught?.code !== "EEXIST") throw caught; let existing; try { existing = JSON.parse(await readFile(receiptPath, "utf8")); } catch (cause) { throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "receipt", "receipt inválido", { cause }); } if (JSON.stringify(existing) !== JSON.stringify(receipt)) throw ffmpegFailure("SUBTITLE_RENDER_RECONCILIATION_INVALID", "receipt", "receipt divergente"); }
}
function validReceipt(value) { return value?.schemaVersion === "subtitle-render-receipt/1.0.0" && /^[a-f0-9]{64}$/.test(value.requestHash) && /^[a-f0-9]{64}$/.test(value.contentHash) && value.policyVersion === "ffmpeg-subtitle-render-policy/1.0.0" && typeof value.toolchain?.ffmpegVersion === "string" && /^[a-f0-9]{64}$/.test(value.toolchain?.libassFingerprint) && value.toolchain?.fontFamily === "Arial" && value.toolchain?.fontProvider === "libass-default" && Object.keys(value).length === 5 && Object.keys(value.toolchain).length === 4; }

export async function hashFile(path, maxBytes = Number.MAX_SAFE_INTEGER) {
  const info = await stat(path).catch((caught) => { throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "arquivo ausente", { cause: caught }); });
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw ffmpegFailure("COMPOSER_OUTPUT_INVALID", "output", "arquivo fora dos limites");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function inside(root, candidate) { const normalizedRoot = resolve(root); const normalized = resolve(candidate); return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${sep}`); }
