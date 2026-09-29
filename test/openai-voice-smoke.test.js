import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OpenAIVoiceAdapter } from "../src/adapters/openai-voice.js";
import { loadOpenAIVoiceConfig } from "../src/openai-voice-config.js";

test("smoke real do OpenAIVoiceAdapter requer habilitação explícita", {
  skip: process.env.OPENAI_VOICE_SMOKE_TEST !== "1",
  timeout: 310000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-voice-smoke-"));
  try {
    const adapter = new OpenAIVoiceAdapter(loadOpenAIVoiceConfig({ ...process.env, OPENAI_VOICE_STORAGE_ROOT: root }));
    const output = await adapter.synthesize({
      narration: "Organize uma tarefa de cada vez e acompanhe o resultado.",
      language: "pt-BR", voiceStyle: "informative",
      durationLimits: { minimumSeconds: 1, maximumSeconds: 30 },
      logicalCallId: "voice_smoke_001",
    });
    const path = join(root, "sha256", output.contentHash.slice(0, 2), `${output.contentHash}.wav`);
    const bytes = readFileSync(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), output.contentHash);
    assert.equal(output.audioFormat, "wav");
    assert.ok(output.durationMilliseconds > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
