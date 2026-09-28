import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "src/domain/media-acquisition-contracts.js", "src/media-provider.js",
  "src/media-acquisition-service.js", "src/media-asset-repository.js",
];

test("domínio, porta e aplicação não dependem de SDK ou fornecedor específico", () => {
  for (const path of FILES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|google|azure|aws|cloudinary|pexels|unsplash)[^"']*["']/i);
  }
});

test("orquestração não consulta latest nem promete exactly-once distribuído", () => {
  const source = readFileSync(new URL("../src/media-acquisition-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getLatest|findLatest|\.latest\s*\(|exactly.?once/i);
});
