import { createHash, randomUUID } from "node:crypto";
import { mkdir, link, open, readFile, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { OpenAIImageAdapterError } from "./openai-image-error.js";

export class LocalMediaStorage {
  constructor({ root, maxBytes }) {
    if (typeof root !== "string" || root.length === 0) throw failure("OPENAI_IMAGE_CONFIGURATION_MISSING", "storageRoot", "storage privado obrigatório");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw failure("OPENAI_IMAGE_CONFIGURATION_INVALID", "maxImageBytes", "limite inválido");
    this.root = resolve(root);
    this.maxBytes = maxBytes;
  }

  async store(value, { inspect, signal } = {}) {
    const bytes = Buffer.from(value ?? []);
    if (typeof inspect !== "function") throw failure("PROVIDER_INVALID_IMAGE", "image", "inspeção física obrigatória");
    if (bytes.length > this.maxBytes) throw failure("PROVIDER_IMAGE_TOO_LARGE", "image", "imagem excede o limite configurado");
    if (bytes.length === 0) throw failure("PROVIDER_INVALID_IMAGE", "image", "imagem vazia");
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
    const staging = join(this.root, ".staging");
    await mkdir(staging, { recursive: true });
    const temporaryPath = inside(this.root, join(staging, `${randomUUID()}.tmp`));
    let handle;
    try {
      const properties = inspect(bytes);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      handle = await open(temporaryPath, "wx", 0o600);
      let offset = 0;
      while (offset < bytes.length) {
        if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");
        const { bytesWritten } = await handle.write(bytes, offset, Math.min(65536, bytes.length - offset));
        if (bytesWritten < 1) throw failure("PROVIDER_STORAGE_FAILED", "storage", "escrita física incompleta");
        offset += bytesWritten;
      }
      await handle.sync(); await handle.close(); handle = null;
      const directory = inside(this.root, join(this.root, "sha256", contentHash.slice(0, 2)));
      const physicalPath = inside(this.root, join(directory, `${contentHash}.png`));
      await mkdir(directory, { recursive: true });
      let reused = false;
      try { await link(temporaryPath, physicalPath); }
      catch (caught) {
        if (caught?.code !== "EEXIST") throw caught;
        await validateExisting(physicalPath, contentHash, inspect);
        reused = true;
      }
      return Object.freeze({ contentHash, mediaReference: `media:sha256_${contentHash}`, physicalPath, reused, ...properties });
    } catch (caught) {
      if (caught instanceof OpenAIImageAdapterError) throw caught;
      throw failure("PROVIDER_STORAGE_FAILED", "storage", "não foi possível armazenar a imagem", { cause: caught });
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
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw failure("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente diverge do hash lógico");
  try { inspect(bytes); }
  catch (caught) { throw failure("PROVIDER_STORAGE_HASH_CONFLICT", "storage", "objeto existente possui conteúdo inválido", { cause: caught }); }
}
function inside(root, candidate) { const normalizedRoot = resolve(root); const normalized = resolve(candidate); if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}${sep}`)) throw failure("PROVIDER_STORAGE_FAILED", "storage", "localização privada inválida"); return normalized; }
function failure(code, field, message, options) { return new OpenAIImageAdapterError(code, field, message, options); }
