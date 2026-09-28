import test from "node:test";
import assert from "node:assert/strict";
import { ScriptGenerator } from "../src/script-generator.js";
import { ScriptGenerationError, ScriptGenerationService } from "../src/script-generation-service.js";
import { SCRIPT_GENERATION_REQUEST_VERSION, scriptGenerationRequestHash } from "../src/domain/script-generation-contracts.js";

const SELECTION_HASH = "a".repeat(64);
const IDEA_HASH = "b".repeat(64);

test("gera uma vez a partir da seleção explícita e persiste script/1.0.0 com escopo exato", async () => {
  const repository = fakeRepository();
  const generator = fakeGenerator();
  const service = new ScriptGenerationService(repository, generator);
  const created = await service.generate(request());

  assert.equal(generator.calls.length, 1);
  assert.equal(generator.calls[0].selection.ideaSelectionId, "selection_001");
  assert.equal(generator.calls[0].idea.ideaCandidateId, "idea_candidate_001");
  assert.equal(generator.calls[0].projectSnapshot.project.version, 1);
  assert.equal(created.schemaVersion, "script/1.0.0");
  assert.equal(created.scriptId, "script:generation_ai01_001");
  assert.equal(created.pipelineRunId, "run_ai01_001");
  assert.equal(created.ideaSelectionContentHash, SELECTION_HASH);
  assert.equal(created.ideaContentHash, IDEA_HASH);
  assert.equal(created.language, "pt-BR");
  assert.equal(created.contentFormat, "short_video");
  assert.equal(created.fullNarration, `${providerOutput().hook}\n\n${providerOutput().narrativeBlocks[0].narration}\n\n${providerOutput().cta}`);
  assert.equal(repository.persisted.length, 1);
  assert.equal(repository.persisted[0].generationMetadata.provider, "openai");
  assert.equal(repository.persisted[0].telemetry.pipelineRunId, "run_ai01_001");
  assert.equal(repository.persisted[0].telemetry.artifactId, created.scriptId);
  assert.equal(repository.persisted[0].telemetry.costEventId, null);
  assert.equal("latest" in service, false);
});

test("retry concluído retorna o roteiro persistido sem nova chamada e conflito falha de forma estável", async () => {
  const repository = fakeRepository();
  const firstGenerator = fakeGenerator();
  const first = await new ScriptGenerationService(repository, firstGenerator).generate(request());
  repository.prior = { requestHash: request().contentHash, script: first };
  repository.priorTelemetry = repository.persisted[0].telemetry;
  const retryGenerator = fakeGenerator();
  assert.deepEqual(await new ScriptGenerationService(repository, retryGenerator).generate(request()), first);
  assert.equal(retryGenerator.calls.length, 0);

  const divergent = request({ ideaSelectionId: "selection_002" });
  await assert.rejects(
    new ScriptGenerationService(repository, retryGenerator).generate(divergent),
    generationError("GENERATION_REQUEST_ID_REUSED", "generationRequestId"),
  );
  assert.equal(retryGenerator.calls.length, 0);
});

test("rejeita seleção ausente, não selecionada e cadeia divergente antes do provider", async () => {
  for (const [mutate, code, field] of [
    [(repository) => { repository.selection = null; }, "IDEA_SELECTION_NOT_FOUND", "ideaSelectionId"],
    [(repository) => { repository.selection.decision = "REJECTED"; }, "IDEA_SELECTION_NOT_SELECTED", "ideaSelectionId"],
    [(repository) => { repository.run.projectId = "project_other"; }, "GENERATION_RUN_SCOPE_MISMATCH", "projectId"],
    [(repository) => { repository.idea.contentHash = "c".repeat(64); }, "IDEA_CONTENT_HASH_MISMATCH", "ideaContentHash"],
  ]) {
    const repository = fakeRepository();
    mutate(repository);
    const generator = fakeGenerator();
    await assert.rejects(new ScriptGenerationService(repository, generator).generate(request()), generationError(code, field));
    assert.equal(generator.calls.length, 0);
    assert.equal(repository.persisted.length, 0);
  }
});

test("saída inválida, duração incompatível e falha do provider não deixam persistência parcial", async () => {
  const malformedRepository = fakeRepository();
  const malformed = fakeGenerator({ output: { ...providerOutput(), narrativeBlocks: [] } });
  await assert.rejects(new ScriptGenerationService(malformedRepository, malformed).generate(request()), generationError("INVALID_BLOCKS", "narrativeBlocks"));
  assert.equal(malformedRepository.persisted.length, 0);
  assert.equal(malformedRepository.failed[0].telemetry.failureCode, "INVALID_BLOCKS");

  const durationRepository = fakeRepository();
  const duration = fakeGenerator({ output: { ...providerOutput(), estimatedDurationSeconds: 60 } });
  await assert.rejects(new ScriptGenerationService(durationRepository, duration).generate(request()), generationError("SCRIPT_DURATION_OUT_OF_RANGE", "estimatedDurationSeconds"));
  assert.equal(durationRepository.persisted.length, 0);
  assert.equal(durationRepository.failed[0].telemetry.failureCode, "SCRIPT_DURATION_OUT_OF_RANGE");

  const failedRepository = fakeRepository();
  const failed = fakeGenerator(null, new Error("private provider payload"));
  let caught;
  try { await new ScriptGenerationService(failedRepository, failed).generate(request()); } catch (error) { caught = error; }
  assert.equal(caught?.code, "PROVIDER_FAILED");
  assert.equal(caught?.message.includes("private"), false);
  assert.equal(failedRepository.persisted.length, 0);
  assert.equal(failedRepository.failed[0].telemetry.failureCode, "PROVIDER_FAILED");
});

test("custo conhecido cria evento correlacionado e retry não o duplica", async () => {
  const repository = fakeRepository();
  const generator = fakeGenerator({ telemetry: observation({
    inputTokens: 100, outputTokens: 20, cachedInputTokens: 25,
    usageOrigin: "provider_response", costAmount: "0.015", currency: "USD",
    costOrigin: "provider_reported",
  }) });
  const created = await new ScriptGenerationService(repository, generator, {
    now: () => "2026-09-28T18:00:01.000Z",
  }).generate(request());
  const persisted = repository.persisted[0];
  assert.equal(persisted.telemetry.costEventId, "cost:ai_call:generation_ai01_001");
  assert.equal(persisted.costEvent.artifactId, created.scriptId);
  assert.equal(persisted.costEvent.amount, "0.015");
  assert.equal(persisted.costEvent.origin, "ai_telemetry:provider_reported");

  repository.prior = { requestHash: request().contentHash, script: created };
  repository.priorTelemetry = persisted.telemetry;
  await new ScriptGenerationService(repository, fakeGenerator()).generate(request());
  assert.equal(repository.persisted.length, 1);
});

test("retry de falha observada não chama novamente o provider", async () => {
  const repository = fakeRepository();
  repository.priorTelemetry = {
    ...observation(), requestHash: request().contentHash, outcome: "FAILURE",
    failureCode: "PROVIDER_TIMEOUT",
  };
  const generator = fakeGenerator();
  await assert.rejects(
    new ScriptGenerationService(repository, generator).generate(request()),
    generationError("PROVIDER_TIMEOUT", "provider"),
  );
  assert.equal(generator.calls.length, 0);
  assert.equal(repository.failed.length, 0);
});

test("cancelamento anterior à chamada não invoca o provider", async () => {
  const repository = fakeRepository();
  const generator = fakeGenerator();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new ScriptGenerationService(repository, generator).generate(request(), { signal: controller.signal }), generationError("PROVIDER_CANCELLED", "signal"));
  assert.equal(generator.calls.length, 0);
});

function fakeRepository() {
  const repository = {
    prior: null,
    priorTelemetry: null,
    selection: {
      ideaSelectionId: "selection_001", pipelineRunId: "run_ai01_001",
      projectId: "project_ai01", projectVersion: 1, ideaCandidateId: "idea_candidate_001",
      ideaContentHash: IDEA_HASH, contentHash: SELECTION_HASH, decision: "SELECTED",
    },
    idea: {
      ideaCandidateId: "idea_candidate_001", pipelineRunId: "run_ai01_001",
      projectId: "project_ai01", projectVersion: 1, contentHash: IDEA_HASH,
      title: "IA para organizar a rotina", editorialAngle: "Ferramentas práticas para produtividade",
    },
    run: { pipelineRunId: "run_ai01_001", projectId: "project_ai01", projectVersion: 1, projectSnapshot: snapshot() },
    persisted: [],
    failed: [],
    getScriptGeneration() { return this.prior; },
    getAiCallTelemetryByLogicalCall() { return this.priorTelemetry; },
    getSelection() { return this.selection; },
    getIdea() { return this.idea; },
    getRun() { return this.run; },
    registerGeneratedScript(value) { this.persisted.push(value); return value.script; },
    registerFailedAiCall(value) { this.failed.push(value); return value.telemetry; },
  };
  return repository;
}

function fakeGenerator(result = {}, failure = null) {
  const resolved = result === null ? null : { output: providerOutput(), generationMetadata: metadata(), telemetry: observation(), ...result };
  const generator = new class extends ScriptGenerator {
    constructor() { super(); this.calls = []; }
    async generate(input) { this.calls.push(input); if (failure) { failure.telemetry ??= observation(); throw failure; } return resolved; }
  }();
  return generator;
}

function request(overrides = {}) {
  const value = {
    schemaVersion: SCRIPT_GENERATION_REQUEST_VERSION,
    generationRequestId: "generation_ai01_001", ideaSelectionId: "selection_001",
    requestedAt: "2026-09-28T15:00:00.000Z", contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = scriptGenerationRequestHash(value);
  return value;
}

function providerOutput() {
  return {
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Escolha uma tarefa pequena e defina um resultado claro." }],
    visualDirections: [{ position: 1, blockPosition: 1, description: "Uma lista simples aparece em tela." }],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [],
  };
}

function metadata() {
  return {
    provider: "openai", model: "model-test", taskType: "script_generation",
    promptVersion: "script-generation-prompt/1.0.0", configurationHash: "d".repeat(64),
    publicConfiguration: { outputLimit: 1200, responseFormat: "json_schema", store: false, timeoutMs: 1000 },
  };
}

function observation(overrides = {}) {
  return {
    provider: "openai", model: "model-test", taskType: "script_generation",
    promptVersion: "script-generation-prompt/1.0.0",
    inputTokens: null, outputTokens: null, cachedInputTokens: null, usageOrigin: null,
    costAmount: null, currency: null, costOrigin: null, latencyMs: 125,
    occurredAt: "2026-09-28T15:00:00.000Z", fallback: false,
    inputHash: "e".repeat(64), outputHash: "f".repeat(64), ...overrides,
  };
}

function snapshot() {
  return {
    project: { id: "project_ai01", version: 1, niche: "tecnologia", subniches: ["produtividade"], audience: { profile: "adultos", language: "pt-BR" } },
    channel: { format: "short_video", aspectRatio: "9:16", minDurationSeconds: 25, maxDurationSeconds: 45, editorialStyle: "informative", visualStyle: "dynamic", voiceStyle: "informative" },
  };
}

function generationError(code, field) { return (caught) => caught instanceof ScriptGenerationError && caught.code === code && caught.field === field; }
