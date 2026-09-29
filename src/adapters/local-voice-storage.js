import { createHash, randomUUID } from "node:crypto";
import { mkdir, link, open, readFile, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { OpenAIVoiceAdapterError } from "./openai-voice-error.js";

export class LocalVoiceStorage {
  constructor({ root, maxBytes }) {
    if (typeof root !== "string" || root.length === 0) throw failure("OPENAI_VOICE_CONFIGURATION_MISSING", "storageRoot", "storage privado obrigatório");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw failure("OPENAI_VOICE_CONFIGURATION_INVALID", "maxAudioBytes", "limite inválido");
    this.root = resolve(root);
    this.maxBytes = maxBytes;
  }

  async store(chunks, { inspect, signal } = {}) {
    if (!chunks || typeof chunks[Symbol.asyncIterator] !== "function") throw failure("PROVIDER_INVALID_AUDIO", "audio", "stream de áudio inválido");
    if (typeof inspect !== "function") throw failure("PROVIDER_INVALID_AUDIO", "audio", "inspeção de áudio obrigatória");
    const staging = join(this.root, ".staging");
    await mkdir(staging, { recursive: true });
    const temporaryPath = inside(this.root, join(staging, `${randomUUID()}.tmp`));
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      const hash = createHash("sha256");
      let size = 0;
      for await (const part of chunks) {
        if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
        const bytes = Buffer.from(part);
        size += bytes.length;
        if (size > this.maxBytes) throw failure("PROVIDER_AUDIO_TOO_LARGE", "audio", "áudio excede o limite configurado");
        hash.update(bytes);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
          if (bytesWritten < 1) throw failure("PROVIDER_STORAGE_FAILED", "storage", "escrita física incompleta");
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (size === 0) throw failure("PROVIDER_INVALID_AUDIO", "audio", "áudio vazio");
      const contentHash = hash.digest("hex");
      const bytes = await readFile(temporaryPath);
      const properties = inspect(bytes);
      const directory = inside(this.root, join(this.root, "sha256", contentHash.slice(0, 2)));
      const physicalPath = inside(this.root, join(directory, `${contentHash}.wav`));
      await mkdir(directory, { recursive: true });
      let reused = false;
      try { await link(temporaryPath, physicalPath); }
      catch (caught) {
        if (caught?.code !== "EEXIST") throw caught;
        await validateExisting(physicalPath, contentHash, inspect);
        reused = true;
      }
      return Object.freeze({
        contentHash, storageReference: `object:voice/sha256/${contentHash}`,
        physicalPath, reused, ...properties,
      });
    } catch (caught) {
      if (caught instanceof OpenAIVoiceAdapterError) throw caught;
      throw failure("PROVIDER_STORAGE_FAILED", "storage", "não foi possível armazenar o áudio", { cause: caught });
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
    }
  }
}

async function validateExisting(path, expectedHash, inspect) {
  let bytes;
  try { bytes = await readFile(path); }
  catch (caught) { throw failure("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente não pôde ser validado", { cause: caught }); }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) throw failure("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente diverge do hash lógico");
  try { inspect(bytes); }
  catch (caught) { throw failure("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente possui conteúdo inválido", { cause: caught }); }
}
function inside(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalized = resolve(candidate);
  if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) throw failure("PROVIDER_STORAGE_FAILED", "storage", "localização privada inválida");
  return normalized;
}
function failure(code, field, message, options) { return new OpenAIVoiceAdapterError(code, field, message, options); }
