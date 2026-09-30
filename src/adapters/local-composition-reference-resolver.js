import { lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ffmpegFailure } from "./ffmpeg-video-error.js";

const VOICE_REFERENCE = /^object:voice\/sha256\/([a-f0-9]{64})$/;
const MEDIA_REFERENCE = /^media:sha256_([a-f0-9]{64})$/;

export class LocalCompositionReferenceResolver {
  constructor({ voiceRoot, mediaRoot }) {
    this.voiceRoot = requiredRoot(voiceRoot, "voiceRoot");
    this.mediaRoot = requiredRoot(mediaRoot, "mediaRoot");
  }

  async resolveVoice(reference) { return this.#resolve(reference, VOICE_REFERENCE, this.voiceRoot, "wav"); }
  async resolveMedia(reference) { return this.#resolve(reference, MEDIA_REFERENCE, this.mediaRoot, "png"); }

  async #resolve(reference, pattern, root, extension) {
    const match = typeof reference === "string" ? pattern.exec(reference) : null;
    if (!match) throw ffmpegFailure("COMPOSER_REFERENCE_INVALID", "reference", "referência lógica não reconhecida");
    const hash = match[1];
    return safeFile(join(root, "sha256", hash.slice(0, 2), `${hash}.${extension}`), root);
  }
}

async function safeFile(candidate, root) {
  let rootReal;
  let candidateReal;
  let entry;
  try {
    [rootReal, entry, candidateReal] = await Promise.all([realpath(root), lstat(candidate), realpath(candidate)]);
  } catch (caught) {
    if (caught?.code === "ENOENT") throw ffmpegFailure("COMPOSER_INPUT_NOT_FOUND", "reference", "arquivo físico não encontrado", { cause: caught });
    throw ffmpegFailure("COMPOSER_REFERENCE_INVALID", "reference", "referência física inválida", { cause: caught });
  }
  if (entry.isSymbolicLink()) throw ffmpegFailure("COMPOSER_REFERENCE_OUTSIDE_ROOT", "reference", "link simbólico não autorizado");
  if (!entry.isFile()) throw ffmpegFailure("COMPOSER_REFERENCE_INVALID", "reference", "entrada não é arquivo regular");
  const normalizedRoot = resolve(rootReal); const normalized = resolve(candidateReal);
  if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) {
    throw ffmpegFailure("COMPOSER_REFERENCE_OUTSIDE_ROOT", "reference", "arquivo fora do root autorizado");
  }
  return normalized;
}
function requiredRoot(value, field) { if (typeof value !== "string" || value.length === 0) throw ffmpegFailure("FFMPEG_CONFIGURATION_MISSING", field, "root obrigatório"); return resolve(value); }
