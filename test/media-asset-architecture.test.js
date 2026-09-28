import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../src/domain/media-asset-contracts.js",
  "../src/media-asset-service.js",
  "../src/media-asset-repository.js",
];

test("domínio e aplicação de mídia não dependem de SDK ou fornecedor específico", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|google|azure|aws|cloudinary|pexels|unsplash)[^"']*["']/i);
  }
});

test("serviço oferece somente registro e consultas por identidades explícitas", async () => {
  const { MediaAssetService } = await import("../src/media-asset-service.js");
  const calls = [];
  const service = new MediaAssetService({
    registerMediaAsset: (value) => (calls.push(["register", value]), value),
    getMediaAsset: (id) => (calls.push(["get", id]), null),
    listMediaAssetsByPipelineRun: (id) => (calls.push(["run", id]), []),
    listMediaAssetsByScript: (id) => (calls.push(["script", id]), []),
    listMediaAssetsByVisualDirection: (scriptId, position) => (calls.push(["direction", scriptId, position]), []),
  });
  service.register({ mediaAssetId: "media_asset_001" });
  service.get("media_asset_001");
  service.listByPipelineRun("run_e06_001");
  service.listByScript("script_001");
  service.listByVisualDirection("script_001", 1);
  assert.deepEqual(calls, [
    ["register", { mediaAssetId: "media_asset_001" }],
    ["get", "media_asset_001"],
    ["run", "run_e06_001"],
    ["script", "script_001"],
    ["direction", "script_001", 1],
  ]);
  assert.equal("latest" in service, false);
});
