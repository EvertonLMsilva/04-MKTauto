import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STAGE_RECOVERY_CONTRACT_VERSION } from "../src/domain/stage-recovery-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { StageRecoveryRepository } from "../src/stage-recovery-repository.js";
import { StageRecoveryService } from "../src/stage-recovery-service.js";

const HASH_A = "a".repeat(64); const HASH_B = "b".repeat(64); const HASH_C = "c".repeat(64);

test("retry idêntico reutiliza resultado terminal e não duplica artefato", async () => {
  await withRuntime(async ({ stages, repository }) => {
    let calls = 0; const operation = async () => { calls += 1; return produced("script:1", HASH_A); };
    const first = await stages.execute(stageRequest("SCRIPT", HASH_A), operation);
    const reused = await stages.execute(stageRequest("SCRIPT", HASH_A), operation);
    assert.equal(calls, 1); assert.equal(first.reused, false); assert.equal(reused.reused, true);
    assert.equal(repository.listAttempts("run_stage_001").length, 1);
  });
});

test("novo request cria revisão auditável e invalida somente descendente com hash antigo", async () => {
  await withRuntime(async ({ stages, repository }) => {
    await stages.execute(stageRequest("SCRIPT", HASH_A), async () => produced("script:1", HASH_A));
    await stages.execute(stageRequest("VOICE", HASH_A, [{ stage: "SCRIPT", artifactId: "script:1", contentHash: HASH_A }]), async () => produced("voice:1", HASH_B));
    await stages.execute(stageRequest("SCRIPT", HASH_C), async () => produced("script:2", HASH_C));
    const status = Object.fromEntries(stages.getStatuses("run_stage_001").map((item) => [item.stage, item.state]));
    assert.equal(status.SCRIPT, "SUCCEEDED"); assert.equal(status.VOICE, "PENDING"); assert.equal(status.RESEARCH, "PENDING");
    assert.deepEqual(repository.listAttempts("run_stage_001").filter(({ stage }) => stage === "SCRIPT").map(({ attempt }) => attempt), [1, 2]);
  });
});

test("mudança de hash da Composition invalida somente Preview e QC dependentes", async () => {
  await withRuntime(async ({ stages }) => {
    await stages.execute(stageRequest("VOICE", HASH_A), async () => produced("voice:1", HASH_A));
    await stages.execute(stageRequest("MEDIA", HASH_A), async () => produced("media:set:1", HASH_B));
    const inputs = [{ stage: "VOICE", artifactId: "voice:1", contentHash: HASH_A }, { stage: "MEDIA", artifactId: "media:set:1", contentHash: HASH_B }];
    await stages.execute(stageRequest("COMPOSITION", HASH_A, inputs), async () => produced("render:1", HASH_A));
    await stages.execute(stageRequest("PREVIEW", HASH_A, [{ stage: "COMPOSITION", artifactId: "render:1", contentHash: HASH_A }]), async () => produced("preview:1", HASH_B));
    await stages.execute(stageRequest("QC", HASH_A, [{ stage: "PREVIEW", artifactId: "preview:1", contentHash: HASH_B }]), async () => produced("qc:1", HASH_C));
    await stages.execute(stageRequest("COMPOSITION", HASH_C, inputs), async () => produced("render:2", HASH_C));
    const status = Object.fromEntries(stages.getStatuses("run_stage_001").map((item) => [item.stage, item.state]));
    assert.equal(status.VOICE, "SUCCEEDED"); assert.equal(status.MEDIA, "SUCCEEDED"); assert.equal(status.COMPOSITION, "SUCCEEDED");
    assert.equal(status.PREVIEW, "PENDING"); assert.equal(status.QC, "PENDING");
  });
});

test("retry automático usa backoff limitado somente para falha transitória", async () => {
  await withRuntime(async ({ stages, repository, sleeps }) => {
    let calls = 0;
    const result = await stages.execute(stageRequest("SCRIPT", HASH_A), async () => { calls += 1; if (calls < 3) throw error("PROVIDER_TIMEOUT", true); return produced("script:1", HASH_A); });
    assert.equal(result.attempt, 3); assert.deepEqual(sleeps, [10, 20]);
    assert.deepEqual(repository.listAttempts("run_stage_001").map(({ trigger, state }) => [trigger, state]), [["INITIAL", "FAILED"], ["AUTOMATIC", "FAILED"], ["AUTOMATIC", "SUCCEEDED"]]);
  });
});

test("erro permanente não entra em loop e retry manual é nova tentativa distinta", async () => {
  await withRuntime(async ({ stages, repository }) => {
    await assert.rejects(stages.execute(stageRequest("SCRIPT", HASH_A), async () => { throw error("INPUT_INVALID", false); }), /INPUT_INVALID/);
    assert.equal(repository.listAttempts("run_stage_001").length, 1);
    const retried = await stages.retry(stageRequest("SCRIPT", HASH_A), async () => produced("script:1", HASH_A));
    assert.equal(retried.attempt, 2);
    assert.deepEqual(repository.listAttempts("run_stage_001").map(({ trigger }) => trigger), ["INITIAL", "MANUAL"]);
  });
});

test("máximo automático é respeitado e erros persistidos não contêm segredo", async () => {
  await withRuntime(async ({ stages, repository }) => {
    await assert.rejects(stages.execute(stageRequest("SCRIPT", HASH_A), async () => { const value = error("CONNECTION_TEMPORARY", true); value.message = "token=privado"; throw value; }), /token=privado/);
    const attempts = repository.listAttempts("run_stage_001"); assert.equal(attempts.length, 3); assert.ok(attempts.every(({ failure }) => failure.code === "CONNECTION_TEMPORARY"));
    assert.equal(JSON.stringify(attempts).includes("privado"), false);
  });
});

test("estado persistido permite retry depois de restart e histórico não pode ser apagado", async () => {
  await withDatabase(async (path) => {
    let context = setup(path);
    await assert.rejects(context.stages.execute(stageRequest("SCRIPT", HASH_A), async () => { throw error("INPUT_INVALID", false); }));
    context.repository.close();
    context = setup(path, false);
    const result = await context.stages.retry(stageRequest("SCRIPT", HASH_A), async () => produced("script:1", HASH_A));
    assert.equal(result.attempt, 2);
    const raw = new DatabaseSync(path); assert.throws(() => raw.prepare("DELETE FROM pipeline_stage_attempts").run(), /IMMUTABLE_STAGE_ATTEMPT/); raw.close();
    context.repository.close();
  });
});

test("tentativa RUNNING interrompida é reconciliada e retomada após restart", async () => {
  await withDatabase(async (path) => {
    let context = setup(path); const value = stageRequest("SCRIPT", HASH_A);
    context.repository.startAttempt(value, { trigger: "INITIAL", startedAt: "2026-09-30T12:00:01.000Z" });
    context.repository.close();
    context = setup(path, false);
    const recovered = await context.stages.recoverInterrupted(value, async () => produced("script:1", HASH_A));
    assert.equal(recovered.attempt, 2);
    assert.deepEqual(context.repository.listAttempts("run_stage_001").map(({ trigger, state, failure }) => [trigger, state, failure?.code ?? null]), [["INITIAL", "FAILED", "STAGE_INTERRUPTED"], ["MANUAL", "SUCCEEDED", null]]);
    context.repository.close();
  });
});

test("PipelineRun FAILED pode ser retomada preservando transições anteriores", async () => {
  await withRuntime(async ({ repository, runs }) => {
    runs.fail("run_stage_001", { completedAt: "2026-09-30T12:01:00.000Z", error: error("PROVIDER_TIMEOUT", true) });
    const resumed = runs.resume(handoff());
    assert.equal(resumed.state, "RUNNING");
    assert.deepEqual(resumed.transitions.map(({ previousState, nextState }) => [previousState, nextState]), [[null, "RUNNING"], ["RUNNING", "FAILED"], ["FAILED", "RUNNING"]]);
    repository.close();
  });
});

function setup(path, create = true) { const repository = new StageRecoveryRepository(path); const runs = new PipelineRunService(repository, { now: () => "2026-09-30T12:02:00.000Z" }); if (create) { repository.create(project(), { createdAt: "2026-09-30T12:00:00.000Z" }); runs.start(handoff()); } const sleeps = []; const ticks = times(); const stages = new StageRecoveryService(repository, { now: () => ticks.next().value, sleep: async (value) => sleeps.push(value), backoffMilliseconds: 10 }); return { repository, runs, stages, sleeps }; }
function stageRequest(stage, requestHash, inputs = []) { return { schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION, pipelineRunId: "run_stage_001", stage, requestHash, inputs, policyVersions: {}, providerConfigHash: null }; }
function produced(artifactId, contentHash) { return { artifactId, contentHash, value: { artifactId, contentHash } }; }
function error(code, transient) { return Object.assign(new Error(code), { code, field: "provider", transient }); }
function handoff() { return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_stage_001", projectId: "project_stage", projectVersion: 1, startedAt: "2026-09-30T12:00:00.000Z" }; }
function project() { return { id: "project_stage", name: "Stage Recovery", version: 1, niche: "tecnologia", subniches: ["software"], audience: { profile: "Operadores", language: "pt-BR" }, references: [], channel: { publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } } }; }
function* times() { let value = Date.parse("2026-09-30T12:00:01.000Z"); while (true) { yield new Date(value).toISOString(); value += 1000; } }
async function withRuntime(operation) { return withDatabase(async (path) => { const context = setup(path); try { await operation(context); } finally { if (context.repository.db?.isOpen) context.repository.close(); } }); }
async function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-stage-recovery-")); try { await operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
