import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("domínio e aplicação de burn-in independem de FFmpeg, processos, filesystem e paths", () => {
  for (const file of ["../src/domain/subtitle-render-contracts.js", "../src/subtitle-renderer.js", "../src/subtitle-rendering-service.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:(?:fs|path|child_process)|from\s+["'][^"']*ffmpeg|\blatest\b/i);
  }
});

test("serviço exige somente identidades explícitas e porta isolada", async () => {
  const { SubtitleRenderingService } = await import("../src/subtitle-rendering-service.js");
  assert.equal("latest" in SubtitleRenderingService.prototype, false);
  assert.equal("publish" in SubtitleRenderingService.prototype, false);
  assert.equal("approve" in SubtitleRenderingService.prototype, false);
});
