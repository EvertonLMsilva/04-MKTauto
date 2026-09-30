import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LocalCompositionReferenceResolver } from "../src/adapters/local-composition-reference-resolver.js";
import { LocalPreviewVerifier } from "../src/adapters/local-preview-verifier.js";

test("verifica existência e SHA-256 físico do render final content-addressed", async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-preview-verifier-"));
  try {
    const bytes = Buffer.from("physical preview"); const hash = createHash("sha256").update(bytes).digest("hex");
    const directory = join(root, "sha256", hash.slice(0, 2)); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${hash}.mp4`), bytes);
    const resolver = new LocalCompositionReferenceResolver({ voiceRoot: root, mediaRoot: root, renderRoot: root });
    const verifier = new LocalPreviewVerifier(resolver);
    assert.deepEqual(await verifier.verify({ logicalReference: `render:sha256_${hash}`, contentHash: hash }), { contentHash: hash });
    await assert.rejects(verifier.verify({ logicalReference: `render:sha256_${hash}`, contentHash: "0".repeat(64) }), (caught) => caught.code === "PREVIEW_PHYSICAL_HASH_MISMATCH");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
