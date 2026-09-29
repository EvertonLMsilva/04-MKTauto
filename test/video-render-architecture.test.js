import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../src/domain/video-render-contracts.js",
  "../src/video-render-service.js",
  "../src/video-render-repository.js",
];

test("domínio e aplicação de render independem de composer, FFmpeg, SDK, fornecedor e storage", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:ffmpeg|openai|google|azure|aws|cloudinary|s3|storage)[^"']*["']/i);
  }
});

test("serviço usa identidades explícitas e não oferece latest", async () => {
  const { VideoRenderService } = await import("../src/video-render-service.js");
  const calls = [];
  const service = new VideoRenderService({
    registerVideoRender: (value) => (calls.push(["register", value]), value),
    getVideoRender: (id) => (calls.push(["get", id]), null),
    listVideoRendersByPipelineRun: (id) => (calls.push(["run", id]), []),
    listVideoRendersByCompositionPlan: (id) => (calls.push(["plan", id]), []),
  });
  service.register({ videoRenderId: "video_render_001" });
  service.get("video_render_001");
  service.listByPipelineRun("run_e07_001");
  service.listByCompositionPlan("composition_plan_001");
  assert.deepEqual(calls, [
    ["register", { videoRenderId: "video_render_001" }],
    ["get", "video_render_001"], ["run", "run_e07_001"], ["plan", "composition_plan_001"],
  ]);
  assert.equal("latest" in service, false);
});
