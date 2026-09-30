import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("orquestração de preview não consulta latest, publica, aprova ou depende de infraestrutura", () => {
  const source = readFileSync(new URL("../src/real-preview-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\blatest\b|getLatest|findLatest|publish|approve|quality.?control|node:(?:fs|path|child_process)|ffmpeg/i);
});
