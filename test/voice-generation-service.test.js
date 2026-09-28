import test from "node:test";
import assert from "node:assert/strict";
import { VOICE_GENERATION_REQUEST_VERSION, voiceGenerationRequestHash } from "../src/domain/voice-generation-contracts.js";
import { VoiceProvider } from "../src/voice-provider.js";
import { VoiceGenerationError, VoiceGenerationService } from "../src/voice-generation-service.js";

test("gera uma vez usando somente roteiro e snapshot persistidos", async () => {
  const repository = fakeRepository();
  const provider = fakeProvider();
  const created = await new VoiceGenerationService(repository, provider).generate(request());

  assert.equal(provider.calls.length, 1);
  assert.deepEqual(provider.calls[0], {
    narration: repository.script.fullNarration,
    language: "pt-BR",
    voiceStyle: "informative",
    durationLimits: { minimumSeconds: 25, maximumSeconds: 45 },
    logicalCallId: "voice_generation_001",
  });
  assert.equal(created.voiceTrackId, "voice_track:voice_generation_001");
  assert.equal(created.durationMilliseconds, 30125);
  assert.equal(created.scriptContentHash, repository.script.contentHash);
  assert.equal(repository.persisted.length, 1);
  assert.equal("audioBytes" in created, false);
});

test("retry concluído retorna a faixa persistida sem nova chamada", async () => {
  const repository = fakeRepository();
  const first = await new VoiceGenerationService(repository, fakeProvider()).generate(request());
  repository.prior = { requestHash: request().contentHash, voiceTrack: first };
  const provider = fakeProvider();
  assert.deepEqual(await new VoiceGenerationService(repository, provider).generate(request()), first);
  assert.equal(provider.calls.length, 0);
});

test("identidade divergente falha antes de consultar roteiro ou provider", async () => {
  const repository = fakeRepository();
  repository.prior = { requestHash: "f".repeat(64), voiceTrack: {} };
  const provider = fakeProvider();
  await assert.rejects(new VoiceGenerationService(repository, provider).generate(request()), generationError("GENERATION_REQUEST_ID_REUSED", "generationRequestId"));
  assert.deepEqual(repository.reads, ["generation"]);
  assert.equal(provider.calls.length, 0);
});

test("valida solicitação e hash do roteiro antes do provider", async () => {
  const invalidRepository = fakeRepository();
  await assert.rejects(new VoiceGenerationService(invalidRepository, fakeProvider()).generate({ ...request(), contentHash: "f".repeat(64) }), generationError("CONTENT_HASH_MISMATCH", "contentHash"));
  assert.deepEqual(invalidRepository.reads, []);

  const mismatchRepository = fakeRepository();
  const provider = fakeProvider();
  await assert.rejects(new VoiceGenerationService(mismatchRepository, provider).generate(request({ scriptContentHash: "c".repeat(64) })), generationError("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"));
  assert.equal(provider.calls.length, 0);
});

test("rejeita cadeia divergente e saída não confiável sem persistir", async () => {
  const scopeRepository = fakeRepository();
  scopeRepository.run.projectId = "project_other";
  const scopeProvider = fakeProvider();
  await assert.rejects(new VoiceGenerationService(scopeRepository, scopeProvider).generate(request()), generationError("VOICE_GENERATION_RUN_SCOPE_MISMATCH", "projectId"));
  assert.equal(scopeProvider.calls.length, 0);

  const outputRepository = fakeRepository();
  const outputProvider = fakeProvider({ storageReference: "C:/private/audio.mp3" });
  await assert.rejects(new VoiceGenerationService(outputRepository, outputProvider).generate(request()), generationError("INVALID_STORAGE_REFERENCE", "storageReference"));
  assert.equal(outputRepository.persisted.length, 0);

  const durationRepository = fakeRepository();
  const durationProvider = fakeProvider({ durationMilliseconds: 50000 });
  await assert.rejects(new VoiceGenerationService(durationRepository, durationProvider).generate(request()), generationError("VOICE_DURATION_OUT_OF_RANGE", "durationMilliseconds"));
  assert.equal(durationRepository.persisted.length, 0);
});

test("sanitiza falha do provider e não cria identidade parcial", async () => {
  const repository = fakeRepository();
  const provider = fakeProvider({}, new Error("PRIVATE token and raw response"));
  let caught;
  try { await new VoiceGenerationService(repository, provider).generate(request()); } catch (error) { caught = error; }
  assert.equal(caught?.code, "PROVIDER_FAILED");
  assert.equal(caught?.message.includes("PRIVATE"), false);
  assert.equal(repository.persisted.length, 0);
  assert.equal(repository.prior, null);
});

function fakeRepository() {
  return {
    prior: null,
    script: {
      scriptId: "script_001", pipelineRunId: "run_e05_001", projectId: "project_e05",
      projectVersion: 1, contentHash: "a".repeat(64), language: "pt-BR",
      fullNarration: "Narração exata persistida.", estimatedDurationSeconds: 30,
    },
    run: {
      pipelineRunId: "run_e05_001", projectId: "project_e05", projectVersion: 1,
      projectSnapshot: {
        project: { id: "project_e05", version: 1, audience: { language: "pt-BR" } },
        channel: { voiceStyle: "informative", minDurationSeconds: 25, maxDurationSeconds: 45 },
      },
    },
    persisted: [], reads: [],
    getVoiceGeneration() { this.reads.push("generation"); return this.prior; },
    getScript() { this.reads.push("script"); return this.script; },
    getRun() { this.reads.push("run"); return this.run; },
    registerGeneratedVoiceTrack(value) { this.persisted.push(value); return value.voiceTrack; },
  };
}

function fakeProvider(overrides = {}, failure = null) {
  return new class extends VoiceProvider {
    constructor() { super(); this.calls = []; }
    async synthesize(input) {
      this.calls.push(input);
      if (failure) throw failure;
      return {
        durationMilliseconds: 30125, audioFormat: "mp3", contentHash: "b".repeat(64),
        storageReference: "object:voice/voice_generation_001", provider: "provider_test",
        origin: "SYNTHETIC_TTS", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
        ...overrides,
      };
    }
  }();
}

function request(overrides = {}) {
  const value = {
    schemaVersion: VOICE_GENERATION_REQUEST_VERSION, generationRequestId: "voice_generation_001",
    scriptId: "script_001", scriptContentHash: "a".repeat(64),
    requestedAt: "2026-09-28T20:00:00.000Z", contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = voiceGenerationRequestHash(value);
  return value;
}

function generationError(code, field) {
  return (caught) => caught instanceof VoiceGenerationError && caught.code === code && caught.field === field;
}
