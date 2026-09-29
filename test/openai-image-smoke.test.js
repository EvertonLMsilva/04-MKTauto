import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIImageAdapter } from "../src/adapters/openai-image.js";
import { loadOpenAIImageConfig } from "../src/openai-image-config.js";

test("smoke real do OpenAIImageAdapter requer habilitação explícita", {
  skip: process.env.OPENAI_IMAGE_SMOKE_TEST !== "1",
  timeout: 310000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-image-smoke-"));
  try {
    const adapter = new OpenAIImageAdapter(loadOpenAIImageConfig({ ...process.env, OPENAI_IMAGE_STORAGE_ROOT: root }));
    const output = await adapter.provide({
      logicalCallId: "media_smoke_001", assetType: "IMAGE",
      visualDirection: { position: 1, blockPosition: 1, description: "Mesa organizada com três cartões de tarefas abstratos, sem texto ou marcas." },
      projectContext: { projectId: "project_smoke", projectVersion: 1, language: "pt-BR", audienceProfile: "Pessoas interessadas em produtividade", niche: "produtividade", contentFormat: "short_video", aspectRatio: "9:16", visualStyle: "dynamic" },
    });
    const path = join(root, "sha256", output.contentHash.slice(0, 2), `${output.contentHash}.png`);
    const bytes = readFileSync(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), output.contentHash);
    assert.deepEqual(output.technicalProperties, { format: "png", widthPixels: 1152, heightPixels: 2048, durationMilliseconds: null });
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});
