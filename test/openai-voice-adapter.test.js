import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIVoiceAdapter, OpenAIVoiceAdapterError } from "../src/adapters/openai-voice.js";
import { LocalVoiceStorage } from "../src/adapters/local-voice-storage.js";
import { inspectMvpWav } from "../src/adapters/wav-audio.js";
import { loadOpenAIVoiceConfig, OPENAI_VOICE_POLICY_VERSION } from "../src/openai-voice-config.js";
import { VoiceProvider } from "../src/voice-provider.js";
import { validateVoiceProviderOutput } from "../src/domain/voice-generation-contracts.js";

test("configura modelo, voz built-in e direitos de forma explícita e reproduzível", () => {
  const root = join(tmpdir(), "voice-config-test");
  const config = loadOpenAIVoiceConfig(env(root));
  assert.equal(config.model, "gpt-4o-mini-tts");
  assert.equal(config.voice, "marin");
  assert.equal(config.audioFormat, "wav");
  assert.equal(config.rights.commercialUseAllowed, true);
  assert.equal(config.policyVersion, OPENAI_VOICE_POLICY_VERSION);
  assert.equal(config.configurationHash.length, 64);
  assert.equal(JSON.stringify(config.publicConfiguration).includes("sk-test"), false);
  assert.equal(JSON.stringify(config.publicConfiguration).includes(root), false);
  assert.throws(() => loadOpenAIVoiceConfig(env(root, { OPENAI_VOICE: "alloy" })), adapterError("OPENAI_VOICE_CONFIGURATION_INVALID", "OPENAI_VOICE"));
  assert.throws(() => loadOpenAIVoiceConfig(env(root, { OPENAI_VOICE_MODEL: "tts-1" })), adapterError("OPENAI_VOICE_CONFIGURATION_INVALID", "OPENAI_VOICE_MODEL"));
  assert.throws(() => loadOpenAIVoiceConfig(env(root, { OPENAI_VOICE_COMMERCIAL_USE_ALLOWED: "false" })), adapterError("OPENAI_VOICE_RIGHTS_NOT_CONFIRMED", "OPENAI_VOICE_COMMERCIAL_USE_ALLOWED"));
});

test("gera WAV físico, mede duração, calcula hash dos bytes e devolve referência opaca", async () => {
  await withRoot(async (root) => {
    const bytes = wav({ durationMilliseconds: 1200 });
    let captured;
    const adapter = new OpenAIVoiceAdapter(loadOpenAIVoiceConfig(env(root)), {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(bytes, { status: 200, headers: { "content-type": "audio/wav" } });
      },
    });
    assert.equal(adapter instanceof VoiceProvider, true);
    const output = await adapter.synthesize(input());
    assert.deepEqual(validateVoiceProviderOutput(output), output);
    const body = JSON.parse(captured.options.body);
    assert.equal(captured.url, "https://api.openai.com/v1/audio/speech");
    assert.deepEqual(body, {
      model: "gpt-4o-mini-tts",
      input: input().narration,
      voice: "marin",
      instructions: "Fale em português do Brasil, com tom informativo, claro e natural. Não imite nem personifique qualquer pessoa.",
      response_format: "wav",
    });
    assert.equal(output.durationMilliseconds, 1200);
    assert.equal(output.audioFormat, "wav");
    assert.equal(output.contentHash, sha256(bytes));
    assert.equal(output.storageReference, `object:voice/sha256/${sha256(bytes)}`);
    assert.equal(output.provider, "openai");
    assert.deepEqual(output.rights, { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true });
    assert.equal("audioBytes" in output, false);
    assert.equal("cost" in output, false);
    assert.equal("telemetry" in output, false);
    assert.equal(JSON.stringify(output).includes(root), false);
    const stored = readFileSync(join(root, "sha256", output.contentHash.slice(0, 2), `${output.contentHash}.wav`));
    assert.deepEqual(stored, bytes);
  });
});

test("falha fechado para limites do endpoint, estilo não suportado e custom voice antes da rede", async () => {
  await withRoot(async (root) => {
    let calls = 0;
    const adapter = new OpenAIVoiceAdapter(loadOpenAIVoiceConfig(env(root)), { fetchImpl: async () => { calls += 1; throw new Error("não chamar"); } });
    await assert.rejects(adapter.synthesize(input({ narration: "a".repeat(4097) })), adapterError("PROVIDER_INPUT_LIMIT_EXCEEDED", "narration"));
    await assert.rejects(adapter.synthesize(input({ voiceStyle: "imitate-celebrity" })), adapterError("PROVIDER_UNSUPPORTED_VOICE_STYLE", "voiceStyle"));
    await assert.rejects(adapter.synthesize(input({ voiceStyle: "toString" })), adapterError("PROVIDER_UNSUPPORTED_VOICE_STYLE", "voiceStyle"));
    assert.equal(calls, 0);
  });
});

test("rejeita output externo vazio, excessivo, formato incorreto e WAV fora do subconjunto MVP", async () => {
  await withRoot(async (root) => {
    const cases = [
      [Buffer.alloc(0), "PROVIDER_INVALID_AUDIO"],
      [Buffer.from("not wav"), "PROVIDER_INVALID_AUDIO"],
      [wav({ channels: 2 }), "PROVIDER_UNSUPPORTED_AUDIO"],
      [wav({ sampleRate: 44100 }), "PROVIDER_UNSUPPORTED_AUDIO"],
      [wav({ bitsPerSample: 8 }), "PROVIDER_UNSUPPORTED_AUDIO"],
      [wav({ silent: true }), "PROVIDER_INVALID_AUDIO"],
    ];
    for (const [bytes, code] of cases) {
      const adapter = new OpenAIVoiceAdapter(loadOpenAIVoiceConfig(env(root)), { fetchImpl: async () => new Response(bytes, { status: 200 }) });
      await assert.rejects(adapter.synthesize(input()), adapterError(code, "audio"));
    }
    const limited = loadOpenAIVoiceConfig(env(root, { OPENAI_VOICE_MAX_AUDIO_BYTES: "1024" }));
    const adapter = new OpenAIVoiceAdapter(limited, { fetchImpl: async () => new Response(wav({ durationMilliseconds: 1200 }), { status: 200 }) });
    await assert.rejects(adapter.synthesize(input()), adapterError("PROVIDER_AUDIO_TOO_LARGE", "audio"));
    assert.deepEqual(listFiles(root), []);
  });
});

test("storage content-addressed valida e reutiliza hash existente sem sobrescrever", async () => {
  await withRoot(async (root) => {
    const bytes = wav({ durationMilliseconds: 500 });
    const storage = new LocalVoiceStorage({ root, maxBytes: 2_000_000 });
    const first = await storage.store(chunks(bytes), { inspect: inspectMvpWav });
    const second = await storage.store(chunks(bytes), { inspect: inspectMvpWav });
    assert.equal(second.reused, true);
    assert.equal(second.physicalPath, first.physicalPath);
    assert.deepEqual(readFileSync(first.physicalPath), bytes);

    writeFileSync(first.physicalPath, Buffer.from("corrupted"));
    await assert.rejects(storage.store(chunks(bytes), { inspect: inspectMvpWav }), adapterError("PROVIDER_STORAGE_HASH_CONFLICT", "storage"));
    assert.deepEqual(readFileSync(first.physicalPath), Buffer.from("corrupted"));
  });
});

test("timeout, cancelamento e recusas do provider são sanitizados e limpam temporários", async () => {
  await withRoot(async (root) => {
    const timeoutConfig = loadOpenAIVoiceConfig(env(root, { OPENAI_VOICE_TIMEOUT_MS: "5" }));
    const timeout = new OpenAIVoiceAdapter(timeoutConfig, { fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(abortError("private timeout")), { once: true })) });
    await assert.rejects(timeout.synthesize(input()), adapterError("PROVIDER_TIMEOUT", "timeoutMs"));

    const controller = new AbortController();
    controller.abort("private cancel reason");
    await assert.rejects(timeout.synthesize(input(), { signal: controller.signal }), adapterError("PROVIDER_CANCELLED", "signal"));

    const refused = new OpenAIVoiceAdapter(loadOpenAIVoiceConfig(env(root)), { fetchImpl: async () => new Response(JSON.stringify({ error: { message: "sk-private raw" } }), { status: 403 }) });
    let caught;
    try { await refused.synthesize(input()); } catch (error) { caught = error; }
    assert.equal(caught?.code, "PROVIDER_PERMISSION_DENIED");
    assert.equal(caught?.message.includes("private"), false);
    assert.deepEqual(listFiles(root), []);
  });
});

function env(root, overrides = {}) {
  return {
    OPENAI_API_KEY: "sk-test-only",
    OPENAI_VOICE_MODEL: "gpt-4o-mini-tts",
    OPENAI_VOICE: "marin",
    OPENAI_VOICE_COMMERCIAL_USE_ALLOWED: "true",
    OPENAI_VOICE_STORAGE_ROOT: root,
    OPENAI_VOICE_TIMEOUT_MS: "1000",
    OPENAI_VOICE_MAX_AUDIO_BYTES: "2000000",
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    narration: "Um roteiro curto e original.", language: "pt-BR", voiceStyle: "informative",
    durationLimits: { minimumSeconds: 1, maximumSeconds: 45 }, logicalCallId: "voice_generation_001",
    ...overrides,
  };
}

function wav({ durationMilliseconds = 250, sampleRate = 24000, channels = 1, bitsPerSample = 16, silent = false } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.round(sampleRate * durationMilliseconds / 1000);
  const dataSize = frames * channels * bytesPerSample;
  const value = Buffer.alloc(44 + dataSize);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVE", 8);
  value.write("fmt ", 12); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20);
  value.writeUInt16LE(channels, 22); value.writeUInt32LE(sampleRate, 24);
  value.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  value.writeUInt16LE(channels * bytesPerSample, 32); value.writeUInt16LE(bitsPerSample, 34);
  value.write("data", 36); value.writeUInt32LE(dataSize, 40);
  if (!silent && dataSize > 1) value.writeInt16LE(1000, 44);
  return value;
}

async function* chunks(value) { yield value.subarray(0, 17); yield value.subarray(17); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function abortError(message) { const error = new Error(message); error.name = "AbortError"; return error; }
function adapterError(code, field) { return (caught) => caught instanceof OpenAIVoiceAdapterError && caught.code === code && caught.field === field; }
function listFiles(root) { return existsSync(root) ? readdirSync(root, { recursive: true }).filter((name) => statSync(join(root, name)).isFile()) : []; }
async function withRoot(run) { const root = mkdtempSync(join(tmpdir(), "mktauto-voice-")); try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); } }
