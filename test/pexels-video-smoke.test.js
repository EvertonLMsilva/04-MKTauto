import test from "node:test";
import assert from "node:assert/strict";
import { PexelsVideoAdapter } from "../src/adapters/pexels-video.js";
import { loadPexelsVideoConfig } from "../src/pexels-video-config.js";

const enabled = process.env.RUN_PEXELS_VIDEO_SMOKE === "1";

test("smoke opt-in adquire clipe Pexels físico, licenciado e sem áudio", { skip: !enabled }, async () => {
  const adapter = new PexelsVideoAdapter(loadPexelsVideoConfig());
  const output = await adapter.provide({
    logicalCallId: `pexels_smoke_${Date.now()}`, assetType: "VIDEO", excludedExternalAssetIds: [],
    visualDirection: { position: 1, blockPosition: 1, description: "natureza vertical" },
    projectContext: { projectId: "project_smoke", projectVersion: 2, language: "pt-BR", audienceProfile: "Público geral", niche: "natureza", contentFormat: "short_video", aspectRatio: "9:16", visualStyle: "dynamic", productionProfile: "MIXED_MEDIA_V2", minDurationSeconds: 1, maxDurationSeconds: 60 },
  });
  assert.equal(output.assetType, "VIDEO"); assert.equal(output.provider, "pexels");
  assert.equal(output.technicalProperties.mimeType, "video/mp4"); assert.equal(output.technicalProperties.hasAudio, false);
  assert.equal(output.rights.commercialUseAllowed, true); assert.match(output.source.sourceUrl, /^https:\/\/www\.pexels\.com\//);
});
