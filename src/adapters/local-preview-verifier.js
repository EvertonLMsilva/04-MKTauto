import { hashFile } from "./local-video-storage.js";

export class LocalPreviewVerifier {
  constructor(referenceResolver) {
    if (!referenceResolver || typeof referenceResolver.resolveVideo !== "function") throw new TypeError("resolvedor de vídeo obrigatório");
    this.referenceResolver = referenceResolver;
  }

  async verify({ logicalReference, contentHash }, { signal } = {}) {
    if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "PREVIEW_VERIFY_CANCELLED" });
    const path = await this.referenceResolver.resolveVideo(logicalReference);
    const actual = await hashFile(path);
    if (actual !== contentHash) throw Object.assign(new Error("hash mismatch"), { code: "PREVIEW_PHYSICAL_HASH_MISMATCH", field: "contentHash" });
    return Object.freeze({ contentHash: actual });
  }
}
