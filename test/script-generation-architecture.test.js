import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("domínio, porta e aplicação não importam SDK nem tipos da OpenAI", () => {
  for (const path of [
    "src/domain/script-generation-contracts.js",
    "src/script-generator.js",
    "src/script-generation-service.js",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']openai["']|adapters\/openai|OpenAIAdapter/);
  }
});

test("serviço exige IDs explícitos e não oferece consulta latest", async () => {
  const source = readFileSync(new URL("../src/script-generation-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getLatest|findLatest|\.latest\s*\(/);
});
