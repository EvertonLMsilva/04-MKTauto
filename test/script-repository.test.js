import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ScriptRepository, ScriptRepositoryError } from "../src/script-repository.js";
import { AI_CALL_TELEMETRY_CONTRACT_VERSION } from "../src/domain/ai-call-telemetry-contracts.js";
import { COST_EVENT_CONTRACT_VERSION } from "../src/domain/cost-event-contracts.js";
import { ScriptService } from "../src/script-service.js";
import { IdeaSelectionService } from "../src/idea-selection-service.js";
import { IdeaService } from "../src/idea-service.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { IDEA_SELECTION_CONTRACT_VERSION, selectionContentHash } from "../src/domain/idea-selection-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash } from "../src/domain/script-contracts.js";
import { SCRIPT_GENERATION_REQUEST_VERSION, scriptGenerationRequestHash } from "../src/domain/script-generation-contracts.js";
import { DEFAULT_RESEARCH_SHORTLIST_POLICY, RESEARCH_SHORTLIST_CONTRACT_VERSION } from "../src/domain/research-shortlist-contracts.js";

const STARTED_AT = "2026-09-28T11:00:00.000Z";

test("registra, recupera e lista roteiro explícito sem duplicar retry", () => {
  withService(({ service, selected, path }) => {
    const value = script(selected);
    const created = service.register(value);
    assert.deepEqual(service.register(value), created);
    assert.deepEqual(service.get(created.scriptId), created);
    assert.deepEqual(service.listByPipelineRun("run_e04_001"), [created]);
    assert.deepEqual(service.listBySelection(selected.ideaSelectionId), [created]);
    assert.equal("latest" in service, false);
    assert.equal(Object.isFrozen(created), true);
    assert.equal(count(path, "scripts"), 1);
    assert.equal(count(path, "artifact_lineage"), 4);
    assert.equal(count(path, "cost_events"), 0);
    const raw = new DatabaseSync(path);
    const input = raw.prepare("SELECT * FROM artifact_lineage_inputs WHERE artifact_id = 'script_001'").get();
    raw.close();
    assert.equal(input.input_id, selected.ideaSelectionId);
    assert.equal(input.content_hash, selected.contentHash);
  });
});

test("persiste identidade e metadados públicos de geração atomicamente", () => {
  withService(({ repository, selected, path }) => {
    const value = script(selected, { scriptId: "script:generation_ai01_001", origin: "EXTERNAL_CONSUMER" });
    const generation = { request: generationRequest(), script: value, generationMetadata: metadata(), telemetry: telemetry(), costEvent: null };
    const created = repository.registerGeneratedScript(generation);
    assert.deepEqual(repository.registerGeneratedScript(generation), created);
    assert.deepEqual(repository.getScriptGeneration("generation_ai01_001"), {
      requestHash: generation.request.contentHash,
      script: created,
      generationMetadata: metadata(),
    });
    assert.deepEqual(repository.getArtifact(created.scriptId).generationMetadata, metadata());
    assert.equal(count(path, "script_generation_requests"), 1);
    assert.equal(count(path, "scripts"), 1);
    assert.equal(count(path, "cost_events"), 0);
    assert.equal(count(path, "ai_call_telemetry"), 1);
    assert.deepEqual(repository.getAiCallTelemetryByLogicalCall("generation_ai01_001"), telemetry());
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE script_generation_requests SET request_hash = ? WHERE generation_request_id = ?").run("f".repeat(64), "generation_ai01_001"), /IMMUTABLE_SCRIPT_GENERATION_REQUEST/);
      assert.throws(() => raw.prepare("DELETE FROM script_generation_requests WHERE generation_request_id = ?").run("generation_ai01_001"), /IMMUTABLE_SCRIPT_GENERATION_REQUEST/);
    } finally { raw.close(); }

    const divergent = generationRequest({ ideaSelectionId: "selection_other" });
    assert.throws(
      () => repository.registerGeneratedScript({ ...generation, request: divergent }),
      repositoryError("GENERATION_REQUEST_ID_REUSED", "generationRequestId"),
    );
  });
});

test("falha ao registrar identidade reverte roteiro e linhagem gerados", () => {
  withService(({ repository, selected, path }) => {
    repository.db.exec("CREATE TRIGGER reject_generation BEFORE INSERT ON script_generation_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE provider payload'); END;");
    let caught;
    try {
      repository.registerGeneratedScript({
        request: generationRequest(),
        script: script(selected, { scriptId: "script:generation_ai01_001", origin: "EXTERNAL_CONSUMER" }),
        generationMetadata: metadata(),
        telemetry: telemetry(),
        costEvent: null,
      });
    } catch (error) { caught = error; }
    assert.equal(caught?.code, "SCRIPT_PERSISTENCE_FAILED");
    assert.equal(caught?.message.includes("PRIVATE"), false);
    assert.equal(count(path, "script_generation_requests"), 0);
    assert.equal(count(path, "scripts"), 0);
    assert.equal(count(path, "artifact_lineage"), 3);
  });
});

test("persiste telemetria e custo correlacionados na mesma transação", () => {
  withService(({ repository, selected, path }) => {
    const generatedScript = script(selected, { scriptId: "script:generation_ai01_001", origin: "EXTERNAL_CONSUMER" });
    const knownCostTelemetry = telemetry({
      costEventId: "cost:ai_call:generation_ai01_001",
      costAmount: "0.015", currency: "USD", costOrigin: "provider_reported",
    });
    const event = costEvent(knownCostTelemetry);
    const value = {
      request: generationRequest(), script: generatedScript, generationMetadata: metadata(),
      telemetry: knownCostTelemetry, costEvent: event,
    };
    const created = repository.registerGeneratedScript(value);
    assert.deepEqual(repository.registerGeneratedScript(value), created);
    assert.equal(count(path, "ai_call_telemetry"), 1);
    assert.equal(count(path, "cost_events"), 1);
    const raw = new DatabaseSync(path);
    const storedCost = raw.prepare("SELECT artifact_id, amount, currency FROM cost_events WHERE cost_event_id = ?")
      .get(knownCostTelemetry.costEventId);
    raw.close();
    assert.equal(storedCost.artifact_id, created.scriptId);
    assert.equal(storedCost.amount, "0.015");
    assert.equal(storedCost.currency, "USD");
  });
});

test("falha registra telemetria sanitizada sem criar artefato falso", () => {
  withService(({ repository, path }) => {
    const failed = telemetry({ artifactId: null, outcome: "FAILURE", failureCode: "PROVIDER_TIMEOUT", outputHash: null });
    assert.deepEqual(repository.registerFailedAiCall({ request: generationRequest(), telemetry: failed, costEvent: null }), failed);
    assert.deepEqual(repository.registerFailedAiCall({ request: generationRequest(), telemetry: failed, costEvent: null }), failed);
    assert.equal(count(path, "ai_call_telemetry"), 1);
    assert.equal(count(path, "scripts"), 0);
    assert.equal(count(path, "cost_events"), 0);
  });
});

test("falha ao inserir telemetria reverte roteiro, linhagem e custo", () => {
  withService(({ repository, selected, path }) => {
    repository.db.exec("CREATE TRIGGER reject_ai_telemetry BEFORE INSERT ON ai_call_telemetry BEGIN SELECT RAISE(ABORT, 'PRIVATE telemetry payload'); END;");
    const knownCostTelemetry = telemetry({
      costEventId: "cost:ai_call:generation_ai01_001",
      costAmount: "0.015", currency: "USD", costOrigin: "provider_reported",
    });
    assert.throws(() => repository.registerGeneratedScript({
      request: generationRequest(),
      script: script(selected, { scriptId: "script:generation_ai01_001", origin: "EXTERNAL_CONSUMER" }),
      generationMetadata: metadata(), telemetry: knownCostTelemetry,
      costEvent: costEvent(knownCostTelemetry),
    }), repositoryError("SCRIPT_PERSISTENCE_FAILED", "script"));
    assert.equal(count(path, "scripts"), 0);
    assert.equal(count(path, "ai_call_telemetry"), 0);
    assert.equal(count(path, "cost_events"), 0);
    assert.equal(count(path, "artifact_lineage"), 3);
  });
});

test("rejeita seleção ausente, escopo, hashes e configuração divergentes", () => {
  withService(({ service, selected }) => {
    assert.throws(() => service.register(script(selected, { ideaSelectionId: "selection_missing" })), repositoryError("IDEA_SELECTION_NOT_FOUND", "ideaSelectionId"));
    assert.throws(() => service.register(script(selected, { ideaSelectionContentHash: "f".repeat(64) })), repositoryError("IDEA_SELECTION_CONTENT_HASH_MISMATCH", "ideaSelectionContentHash"));
    assert.throws(() => service.register(script(selected, { ideaContentHash: "e".repeat(64) })), repositoryError("IDEA_CONTENT_HASH_MISMATCH", "ideaContentHash"));
    assert.throws(() => service.register(script(selected, { language: "en-US" })), repositoryError("SCRIPT_LANGUAGE_MISMATCH", "language"));
    assert.throws(() => service.register(script(selected, { contentFormat: "long_video" })), repositoryError("SCRIPT_CONTENT_FORMAT_MISMATCH", "contentFormat"));
    assert.throws(() => service.register(script(selected, { estimatedDurationSeconds: 46 })), repositoryError("SCRIPT_DURATION_OUT_OF_RANGE", "estimatedDurationSeconds"));
  });
});

test("correção cria revisão append-only e preserva roteiro anterior", () => {
  withService(({ service, selected, path }) => {
    const first = service.register(script(selected));
    const second = service.register(script(selected, {
      scriptId: "script_002", revision: 2, supersedesScriptId: first.scriptId,
      hook: "Uma correção simples pode deixar sua rotina mais clara.",
      createdAt: "2026-09-28T14:05:00.000Z",
    }));
    assert.deepEqual(service.listBySelection(selected.ideaSelectionId), [first, second]);
    assert.deepEqual(service.get(first.scriptId), first);
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE scripts SET origin = 'EXTERNAL_CONSUMER' WHERE script_id = 'script_001'").run(), /IMMUTABLE_SCRIPT/);
      assert.throws(() => raw.prepare("DELETE FROM scripts WHERE script_id = 'script_001'").run(), /IMMUTABLE_SCRIPT/);
    } finally { raw.close(); }
  });
});

test("conflitos usam códigos estáveis e rollback não deixa linhagem parcial", () => {
  withService(({ service, selected, path }) => {
    const value = script(selected);
    service.register(value);
    assert.throws(() => service.register(script(selected, { cta: "Compartilhe com alguém." })), repositoryError("SCRIPT_ID_REUSED", "scriptId"));
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER reject_script BEFORE INSERT ON scripts BEGIN SELECT RAISE(ABORT, 'PRIVATE provider payload'); END;");
    raw.close();
    let caught;
    try {
      service.register(script(selected, { scriptId: "script_002", revision: 2, supersedesScriptId: value.scriptId }));
    } catch (error) { caught = error; }
    assert.equal(caught?.code, "SCRIPT_PERSISTENCE_FAILED");
    assert.equal(caught?.message.includes("PRIVATE"), false);
    assert.equal(count(path, "scripts"), 1);
    assert.equal(count(path, "artifact_lineage"), 4);
  });
});

test("leitura revalida contrato, colunas e hashes da seleção e ideia", () => {
  withService(({ service, selected, path }) => {
    service.register(script(selected));
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER scripts_no_update");
    const payload = JSON.parse(raw.prepare("SELECT payload_json FROM scripts WHERE script_id = 'script_001'").get().payload_json);
    payload.origin = "SYSTEM";
    raw.prepare("UPDATE scripts SET payload_json = ? WHERE script_id = 'script_001'").run(JSON.stringify(payload));
    raw.close();
    assert.throws(() => service.get("script_001"), repositoryError("INVALID_PERSISTED_SCRIPT", "scriptId"));
  });
});

test("leitura rejeita quando a ideia selecionada deixa de preservar o hash exato", () => {
  withService(({ service, selected, path }) => {
    service.register(script(selected));
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER idea_candidates_no_update");
    raw.prepare("UPDATE idea_candidates SET content_hash = ? WHERE idea_candidate_id = ?")
      .run("f".repeat(64), selected.ideaCandidateId);
    raw.close();
    assert.throws(() => service.get("script_001"), repositoryError("INVALID_PERSISTED_SCRIPT", "scriptId"));
  });
});

test("migrações 013 a 022 são aditivas e preservam seleção existente", () => {
  withDatabase((path) => {
    const { repository, selected } = setup(path);
    repository.close();
    const before = new DatabaseSync(path);
    before.exec("DROP TABLE video_composition_requests; DROP TABLE video_renders; DROP TABLE composition_plan_segments; DROP TABLE composition_plans; DROP TABLE media_acquisition_requests; DROP TABLE media_assets; DROP TABLE voice_generation_requests; DROP TABLE voice_tracks; DROP TABLE ai_call_telemetry; DROP TABLE script_generation_requests; DROP TABLE scripts; DELETE FROM schema_migrations WHERE version = 22; DELETE FROM schema_migrations WHERE version = 21; DELETE FROM schema_migrations WHERE version = 20; DELETE FROM schema_migrations WHERE version = 19; DELETE FROM schema_migrations WHERE version = 18; DELETE FROM schema_migrations WHERE version = 17; DELETE FROM schema_migrations WHERE version = 16; DELETE FROM schema_migrations WHERE version = 15; DELETE FROM schema_migrations WHERE version = 14; DELETE FROM schema_migrations WHERE version = 13; PRAGMA user_version = 12;");
    before.close();
    const migrated = new ScriptRepository(path);
    assert.equal(migrated.getSelection(selected.ideaSelectionId).ideaSelectionId, selected.ideaSelectionId);
    assert.deepEqual(migrated.listScriptsByPipelineRun("run_e04_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 22);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 22);
    raw.close();
  });
});

function script(selection, overrides = {}) {
  const blocks = [{ position: 1, purpose: "EXPLANATION", narration: "Primeiro, escolha uma tarefa pequena e defina um resultado claro." }];
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION,
    scriptId: "script_001", pipelineRunId: selection.pipelineRunId,
    projectId: selection.projectId, projectVersion: selection.projectVersion,
    ideaSelectionId: selection.ideaSelectionId, ideaSelectionContentHash: selection.contentHash,
    ideaCandidateId: selection.ideaCandidateId, ideaContentHash: selection.ideaContentHash,
    language: "pt-BR", contentFormat: "short_video",
    hook: "Você pode organizar a rotina com três passos simples.", narrativeBlocks: blocks,
    fullNarration: "", visualDirections: [{ position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." }],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR",
    createdAt: "2026-09-28T14:00:00.000Z", revision: 1,
    supersedesScriptId: null, contentHash: "0".repeat(64), ...overrides,
  };
  value.fullNarration = [value.hook, ...value.narrativeBlocks.map(({ narration }) => narration), value.cta].filter(Boolean).join("\n\n");
  value.contentHash = scriptContentHash(value);
  return value;
}

function generationRequest(overrides = {}) {
  const value = {
    schemaVersion: SCRIPT_GENERATION_REQUEST_VERSION,
    generationRequestId: "generation_ai01_001", ideaSelectionId: "selection_001",
    requestedAt: "2026-09-28T14:00:00.000Z", contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = scriptGenerationRequestHash(value);
  return value;
}

function metadata() {
  return {
    provider: "openai", model: "model-test", taskType: "script_generation",
    promptVersion: "script-generation-prompt/1.0.0", configurationHash: "d".repeat(64),
    publicConfiguration: { outputLimit: 1200, responseFormat: "json_schema", store: false, timeoutMs: 1000 },
  };
}

function telemetry(overrides = {}) {
  return {
    schemaVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    aiCallId: "ai_call:generation_ai01_001", logicalCallId: "generation_ai01_001",
    requestHash: generationRequest().contentHash,
    pipelineRunId: "run_e04_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    artifactId: "script:generation_ai01_001", costEventId: null,
    provider: "openai", model: "model-test", taskType: "script_generation",
    promptVersion: "script-generation-prompt/1.0.0",
    inputTokens: 120, outputTokens: 30, cachedInputTokens: 40,
    usageOrigin: "provider_response", costAmount: null, currency: null, costOrigin: null,
    latencyMs: 125, occurredAt: "2026-09-28T14:00:00.000Z", fallback: false,
    inputHash: "e".repeat(64), outputHash: "f".repeat(64), outcome: "SUCCESS",
    failureCode: null, recordedAt: "2026-09-28T14:00:01.000Z", ...overrides,
  };
}

function costEvent(aiTelemetry) {
  return {
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: aiTelemetry.costEventId, category: "ai_cost",
    pipelineRunId: aiTelemetry.pipelineRunId, projectId: aiTelemetry.projectId,
    projectVersion: aiTelemetry.projectVersion, contentIdentity: "script:selection_001",
    artifactId: aiTelemetry.artifactId, amount: aiTelemetry.costAmount,
    currency: aiTelemetry.currency, occurredAt: aiTelemetry.occurredAt,
    origin: `ai_telemetry:${aiTelemetry.costOrigin}`,
    attributionRuleVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    recordedAt: aiTelemetry.recordedAt,
  };
}

function setup(path) {
  const repository = new ScriptRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start(request());
  seedResearch(repository.db);
  const [{ idea, score }] = new IdeaService(repository).registerBatch(submission());
  const value = {
    schemaVersion: IDEA_SELECTION_CONTRACT_VERSION, ideaSelectionId: "selection_001",
    pipelineRunId: idea.pipelineRunId, projectId: idea.projectId,
    projectVersion: idea.projectVersion, ideaBatchId: idea.ideaBatchId,
    ideaCandidateId: idea.ideaCandidateId, ideaScoreId: score.ideaScoreId,
    ideaContentHash: idea.contentHash, ideaScoreContentHash: score.contentHash,
    decision: "SELECTED", actor: { type: "HUMAN", id: "operator_001" },
    decidedAt: "2026-09-28T13:00:00.000Z", editorialRationale: "Escolha editorial explícita",
    revision: 1, supersedesIdeaSelectionId: null, contentHash: "0".repeat(64),
  };
  value.contentHash = selectionContentHash(value);
  const selected = new IdeaSelectionService(repository).select(value);
  return { repository, selected };
}

function submission() {
  return {
    ideaBatchId: "idea_batch_1", pipelineRunId: "run_e04_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    researchShortlistId: "research-shortlist:001", origin: "OPERATOR",
    createdAt: "2026-09-28T12:00:00.000Z",
    proposals: [{ ideaCandidateId: "idea_candidate_1", title: "IA para organizar a rotina", editorialAngle: "Ferramentas práticas para produtividade", evidenceCandidateIds: ["candidate-1"], referenceInsightId: null, referenceEvidenceIds: [] }],
  };
}

function seedResearch(db) {
  const shortlist = researchShortlist();
  db.prepare(`INSERT INTO trend_runs (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
    VALUES (?, ?, 'SUCCEEDED', ?, ?, 'trend-score/1.0.0', '{}')`).run("trend-run-1", RADAR_CONTRACT_VERSION, STARTED_AT, STARTED_AT);
  db.prepare(`INSERT INTO research_daily_runs
    (id, pipeline_run_id, project_id, project_version, logical_date, timezone, research_input_hash, config_hash, config_json, source_plan_json, state, trend_run_id, started_at)
    VALUES (?, ?, ?, 1, '2026-09-28', 'America/Sao_Paulo', ?, ?, '{}', '[]', 'COMPLETED', ?, ?)`)
    .run("research-daily-1", "run_e04_001", "project_curiosidades_ia", "a".repeat(64), "b".repeat(64), "trend-run-1", STARTED_AT);
  db.prepare(`INSERT INTO research_artifacts
    (artifact_id, schema_version, research_daily_run_id, trend_run_id, pipeline_run_id, project_id, project_version, content_hash, payload_json, created_at)
    VALUES (?, 'research-topic-catalog/1.0.0', ?, ?, ?, ?, 1, ?, '{}', ?)`)
    .run("research-catalog:001", "research-daily-1", "trend-run-1", "run_e04_001", "project_curiosidades_ia", "c".repeat(64), STARTED_AT);
  db.prepare(`INSERT INTO research_shortlists
    (artifact_id, schema_version, revision, pipeline_run_id, project_id, project_version, logical_date, research_artifact_id, trend_run_id, research_input_hash,
     research_topic_catalog_hash, trend_catalog_hash, policy_version, state, content_hash, payload_json, created_at)
    VALUES (?, ?, 1, ?, ?, 1, '2026-09-28', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`)
    .run(shortlist.artifactId, shortlist.schemaVersion, shortlist.pipelineRunId, shortlist.projectId,
      shortlist.researchTopicCatalogArtifactId, shortlist.trendRunId, shortlist.researchInputHash,
      shortlist.researchTopicCatalogHash, shortlist.trendCatalogHash, shortlist.policy.version,
      shortlist.contentHash, JSON.stringify(shortlist), shortlist.createdAt);
}

function researchShortlist() {
  const item = shortlistItem();
  return {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION, artifactId: "research-shortlist:001",
    artifactType: "research_shortlist", revision: 1, pipelineRunId: "run_e04_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, logicalDate: "2026-09-28",
    timezone: "America/Sao_Paulo", createdAt: STARTED_AT, createdBy: "SYSTEM",
    researchInputHash: "a".repeat(64), researchTopicCatalogArtifactId: "research-catalog:001",
    researchTopicCatalogHash: "c".repeat(64), trendRunId: "trend-run-1", trendCatalogHash: "d".repeat(64),
    policy: DEFAULT_RESEARCH_SHORTLIST_POLICY, state: "COMPLETED", orderedCandidates: [item],
    decisions: [{ candidateId: item.candidate.id, decision: "INCLUDED", position: 1, reasons: item.inclusionReasons }],
    coverage: [], gaps: [], contentHash: "e".repeat(64),
    rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
  };
}

function shortlistItem() {
  const component = { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: ["snapshot-1"] };
  return {
    position: 1,
    candidate: { schemaVersion: RADAR_CONTRACT_VERSION, id: "candidate-1", identityKey: "YOUTUBE:video-1", platform: "YOUTUBE", platformVideoId: "video-1", canonicalUrl: "https://youtube.com/watch?v=video-1", state: "ACTIVE", firstSeenAt: STARTED_AT, lastSeenAt: STARTED_AT, reappearanceCount: 1, durationSeconds: 45, publishedAt: STARTED_AT, region: "BR", language: "pt-BR", usageCondition: "REFERENCE_ONLY", snapshotIds: ["snapshot-1"], topicClusterIds: [] },
    cluster: { schemaVersion: RADAR_CONTRACT_VERSION, id: "cluster-1", label: "cluster-1", niche: "inteligência artificial", subtheme: "produtividade", likelyAudience: "adultos", narrativePattern: "explicação", localization: "Brasil", candidateIds: ["candidate-1"], evidenceSnapshotIds: ["snapshot-1"], createdBy: "OLLAMA", explanation: "evidência persistida" },
    score: { schemaVersion: RADAR_CONTRACT_VERSION, id: "score-1", candidateId: "candidate-1", formulaVersion: "trend-score/1.0.0", calculatedAt: STARTED_AT, value: 80, confidence: 1, components: { velocity: component, engagement: component, recency: component, recurrence: component }, explanation: "score persistido" },
    inclusionReasons: ["BASE_RANK", "DIVERSITY_ACCEPTED"],
  };
}

function request() { return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e04_001", projectId: "project_curiosidades_ia", projectVersion: 1, startedAt: STARTED_AT }; }
function project() { return { id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1, niche: "inteligência artificial", subniches: ["ferramentas"], audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [], channel: { publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } } }; }
function repositoryError(code, field) { return (caught) => caught instanceof ScriptRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const raw = new DatabaseSync(path); try { return raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { raw.close(); } }
function withService(operation) { withDatabase((path) => { const { repository, selected } = setup(path); const service = new ScriptService(repository); try { operation({ service, repository, selected, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-script-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
