import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "src/domain/voice-generation-contracts.js",
  "src/voice-provider.js",
  "src/voice-generation-service.js",
  "src/voice-track-repository.js",
];

test("domínio, porta e aplicação não dependem de SDK ou fornecedor específico", () => {
  for (const path of FILES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|elevenlabs|google|azure|aws)[^"']*["']/i);
  }
});

test("orquestração não consulta latest nem promete exactly-once distribuído", () => {
  const source = readFileSync(new URL("../src/voice-generation-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getLatest|findLatest|\.latest\s*\(|exactly.?once/i);
});
