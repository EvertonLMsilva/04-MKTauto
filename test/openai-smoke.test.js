import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIAdapter } from "../src/adapters/openai.js";
import { loadOpenAIConfig } from "../src/openai-config.js";

test("smoke real do OpenAIAdapter requer habilitação explícita", {
  skip: process.env.OPENAI_SMOKE_TEST !== "1",
  timeout: 310000,
}, async () => {
  const adapter = new OpenAIAdapter(loadOpenAIConfig(process.env));
  const result = await adapter.generate({
    idea: { title: "Uma rotina simples de organização", editorialAngle: "Três passos práticos sem afirmações factuais" },
    projectSnapshot: {
      project: { niche: "produtividade", subniches: ["organização"], audience: { profile: "adultos", language: "pt-BR" } },
      channel: { format: "short_video", aspectRatio: "9:16", minDurationSeconds: 25, maxDurationSeconds: 45, editorialStyle: "informative", visualStyle: "dynamic", voiceStyle: "informative" },
    },
  });
  assert.equal(result.generationMetadata.provider, "openai");
  assert.ok(result.output.narrativeBlocks.length > 0);
});
