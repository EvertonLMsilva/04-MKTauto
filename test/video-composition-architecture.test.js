import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "src/domain/video-composition-contracts.js", "src/video-composer.js",
  "src/video-composition-service.js", "src/video-render-repository.js",
];

test("domínio, porta e aplicação independem de FFmpeg, SDK, fornecedor e storage", () => {
  for (const path of FILES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:ffmpeg|openai|google|azure|aws|cloudinary|s3|storage)[^"']*["']/i);
  }
});

test("orquestração não consulta latest nem promete exactly-once distribuído", () => {
  const source = readFileSync(new URL("../src/video-composition-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getLatest|findLatest|\.latest\s*\(|exactly.?once/i);
});
