import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } from "../src/domain/script-contracts.js";
import { VOICE_TRACK_CONTRACT_VERSION } from "../src/domain/voice-track-contracts.js";
import { VOICE_GENERATION_REQUEST_VERSION, voiceGenerationRequestHash } from "../src/domain/voice-generation-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { VoiceTrackRepository, VoiceTrackRepositoryError } from "../src/voice-track-repository.js";
import { VoiceTrackService } from "../src/voice-track-service.js";

const STARTED_AT = "2026-09-28T12:00:00.000Z";

test("persiste faixa e linhagem do roteiro exato com retry idempotente", () => {
  withService(({ service, repository, script, path }) => {
    const value = voiceTrack(script);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(service.register(value), value);
    const lineage = repository.getArtifact(value.voiceTrackId);
    assert.equal(lineage.artifactType, "voice_track");
    assert.equal(lineage.contentIdentity, `voice-track:${script.scriptId}`);
    assert.deepEqual(lineage.inputs, [{
      position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.scriptId, contentHash: script.contentHash,
    }]);
    assert.equal(count(path, "voice_tracks"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 1);
  });
});

test("revalida roteiro, run, idioma e estilo antes de escrever", () => {
  withService(({ service, script, path }) => {
    for (const [change, code, field] of [
      [{ scriptContentHash: "f".repeat(64) }, "SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"],
      [{ projectVersion: 2 }, "VOICE_TRACK_RUN_SCOPE_MISMATCH", "projectVersion"],
      [{ language: "en-US" }, "VOICE_TRACK_SCRIPT_SCOPE_MISMATCH", "language"],
      [{ voiceStyle: "dramatic" }, "VOICE_TRACK_STYLE_MISMATCH", "voiceStyle"],
    ]) {
      assert.throws(() => service.register(voiceTrack(script, change)), repositoryError(code, field));
    }
    assert.equal(count(path, "voice_tracks"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 0);
  });
});

test("reutilização divergente de ID e revisão lógica falha sem duplicar", () => {
  withService(({ service, script, path }) => {
    const first = voiceTrack(script);
    service.register(first);
    assert.throws(() => service.register(voiceTrack(script, { contentHash: "c".repeat(64) })), repositoryError("VOICE_TRACK_ID_REUSED", "voiceTrackId"));
    assert.throws(() => service.register(voiceTrack(script, { voiceTrackId: "voice_track_other" })), repositoryError("VOICE_TRACK_REVISION_CONFLICT", "revision"));
    assert.equal(count(path, "voice_tracks"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 1);
  });
});

test("correção cria revisão histórica sem alterar a anterior", () => {
  withService(({ service, repository, script }) => {
    const first = service.register(voiceTrack(script));
    const second = service.register(voiceTrack(script, {
      voiceTrackId: "voice_track_002", contentHash: "c".repeat(64),
      storageReference: "object:voice/voice_track_002", createdAt: "2026-09-28T19:05:00.000Z",
      revision: 2, supersedesVoiceTrackId: first.voiceTrackId,
    }));
    assert.deepEqual(service.listByScript(script.scriptId), [first, second]);
    assert.equal(repository.getArtifact(second.voiceTrackId).inputs[1].inputId, first.voiceTrackId);
    assert.throws(() => repository.db.prepare("UPDATE voice_tracks SET audio_format = 'wav' WHERE voice_track_id = ?").run(first.voiceTrackId), /IMMUTABLE_VOICE_TRACK/);
    assert.deepEqual(service.get(first.voiceTrackId), first);
  });
});

test("falha na escrita reverte faixa e linhagem", () => {
  withService(({ service, repository, script, path }) => {
    repository.db.exec("CREATE TRIGGER reject_voice_track BEFORE INSERT ON voice_tracks BEGIN SELECT RAISE(ABORT, 'PRIVATE audio payload'); END;");
    assert.throws(() => service.register(voiceTrack(script)), repositoryError("VOICE_TRACK_PERSISTENCE_FAILED", "voiceTrack"));
    assert.equal(count(path, "voice_tracks"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 0);
  });
});

test("persiste solicitação concluída ligada à faixa e recupera retry idempotente", () => {
  withService(({ repository, script, path }) => {
    const request = generationRequest(script);
    const track = generatedVoiceTrack(script);
    assert.deepEqual(repository.registerGeneratedVoiceTrack({ request, voiceTrack: track }), track);
    assert.deepEqual(repository.getVoiceGeneration(request.generationRequestId), {
      requestHash: request.contentHash, voiceTrack: track,
    });
    assert.deepEqual(repository.registerGeneratedVoiceTrack({ request, voiceTrack: track }), track);
    assert.equal(count(path, "voice_generation_requests"), 1);
    assert.equal(count(path, "voice_tracks"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 1);

    const divergent = generationRequest(script, { requestedAt: "2026-09-28T20:01:00.000Z" });
    assert.throws(() => repository.registerGeneratedVoiceTrack({ request: divergent, voiceTrack: track }), repositoryError("GENERATION_REQUEST_ID_REUSED", "generationRequestId"));
  });
});

test("falha ao ligar solicitação reverte faixa, linhagem e identidade", () => {
  withService(({ repository, script, path }) => {
    repository.db.exec("CREATE TRIGGER reject_voice_generation BEFORE INSERT ON voice_generation_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE generation failure'); END;");
    assert.throws(
      () => repository.registerGeneratedVoiceTrack({ request: generationRequest(script), voiceTrack: generatedVoiceTrack(script) }),
      repositoryError("VOICE_TRACK_PERSISTENCE_FAILED", "voiceTrack"),
    );
    assert.equal(count(path, "voice_generation_requests"), 0);
    assert.equal(count(path, "voice_tracks"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'voice_track'"), 0);
  });
});

test("migração 016 é aditiva e preserva os dados existentes", () => {
  withDatabase((path) => {
    const { repository } = setup(path);
    repository.close();
    const before = new DatabaseSync(path);
    before.exec("DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24;");
    before.exec(`
      DROP TABLE subtitle_cues;
      DROP TABLE subtitle_tracks;
      DROP TABLE video_composition_requests;
      DROP TABLE video_renders;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DROP TABLE media_acquisition_requests;
      DROP TABLE media_assets;
      DROP TRIGGER voice_generation_requests_no_delete;
      DROP TRIGGER voice_generation_requests_no_update;
      DROP TRIGGER voice_generation_requests_validate_scope;
      DROP TABLE voice_generation_requests;
      DROP TRIGGER voice_tracks_no_delete;
      DROP TRIGGER voice_tracks_no_update;
      DROP TRIGGER voice_tracks_validate_revision;
      DROP TRIGGER voice_tracks_validate_scope;
      DROP TABLE voice_tracks;
      DROP TABLE script_generation_claims;
      DROP TABLE affiliate_commands;
      DROP TABLE affiliate_script_contexts;
      DROP TABLE affiliate_run_bindings;
      DROP TABLE affiliate_briefings;
      DROP TABLE affiliate_campaign_revisions;
      DROP TABLE affiliate_product_revisions;
      DELETE FROM schema_migrations WHERE version >= 16;
      PRAGMA user_version = 15;
    `);
    before.close();
    const migrated = new VoiceTrackRepository(path);
    assert.equal(migrated.getRun("run_e05_001").pipelineRunId, "run_e05_001");
    assert.deepEqual(migrated.listVoiceTracksByPipelineRun("run_e05_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 30);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 30);
    raw.close();
  });
});

test("migração 017 é aditiva e preserva os dados existentes", () => {
  withDatabase((path) => {
    const { repository } = setup(path);
    repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TABLE video_composition_requests;
      DROP TABLE video_renders;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DROP TABLE media_acquisition_requests;
      DROP TABLE media_assets;
      DROP TRIGGER voice_generation_requests_no_delete;
      DROP TRIGGER voice_generation_requests_no_update;
      DROP TRIGGER voice_generation_requests_validate_scope;
      DROP TABLE voice_generation_requests;
      DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24; DROP TABLE subtitle_cues; DROP TABLE subtitle_tracks; DELETE FROM schema_migrations WHERE version = 23; DELETE FROM schema_migrations WHERE version = 22;
      DELETE FROM schema_migrations WHERE version = 21;
      DELETE FROM schema_migrations WHERE version = 20;
      DELETE FROM schema_migrations WHERE version = 19;
      DELETE FROM schema_migrations WHERE version = 18;
      DELETE FROM schema_migrations WHERE version = 17;
      PRAGMA user_version = 16;
    `);
    before.close();
    const migrated = new VoiceTrackRepository(path);
    assert.equal(migrated.getRun("run_e05_001").pipelineRunId, "run_e05_001");
    assert.equal(migrated.getVoiceGeneration("voice_generation_001"), null);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 30);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 30);
    raw.close();
  });
});

function setup(path) {
  const repository = new VoiceTrackRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e05_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, startedAt: STARTED_AT,
  });
  const script = persistedScript();
  repository.registerArtifact({
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION, artifactId: script.scriptId,
    artifactType: "script", artifactVersion: 1, pipelineRunId: script.pipelineRunId,
    projectId: script.projectId, projectVersion: script.projectVersion,
    contentIdentity: "script:selection_001", hashAlgorithm: "sha256",
    contentHash: script.contentHash, inputs: [], generationMetadata: null,
    createdAt: script.createdAt,
  });
  repository.db.exec("PRAGMA foreign_keys = OFF; DROP TRIGGER scripts_validate_scope;");
  repository.db.prepare(`INSERT INTO scripts
    (script_id, schema_version, pipeline_run_id, project_id, project_version,
     idea_selection_id, idea_selection_content_hash, idea_candidate_id,
     idea_content_hash, language, content_format, estimated_duration_seconds,
     origin, created_at, revision, supersedes_script_id, content_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    script.scriptId, script.schemaVersion, script.pipelineRunId, script.projectId,
    script.projectVersion, script.ideaSelectionId, script.ideaSelectionContentHash,
    script.ideaCandidateId, script.ideaContentHash, script.language, script.contentFormat,
    script.estimatedDurationSeconds, script.origin, script.createdAt, script.revision,
    script.supersedesScriptId, script.contentHash, JSON.stringify(script),
  );
  repository.db.exec("PRAGMA foreign_keys = ON;");
  repository.getScript = (scriptId) => scriptId === script.scriptId ? script : null;
  return { repository, script };
}

function persistedScript() {
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION, scriptId: "script_001",
    pipelineRunId: "run_e05_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    ideaSelectionId: "selection_001", ideaSelectionContentHash: "a".repeat(64),
    ideaCandidateId: "idea_candidate_1", ideaContentHash: "b".repeat(64),
    language: "pt-BR", contentFormat: "short_video",
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Primeiro, escolha uma tarefa pequena e defina um resultado claro." }],
    fullNarration: "", visualDirections: [{ position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." }],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR",
    createdAt: "2026-09-28T14:00:00.000Z", revision: 1,
    supersedesScriptId: null, contentHash: "0".repeat(64),
  };
  value.fullNarration = [value.hook, ...value.narrativeBlocks.map(({ narration }) => narration), value.cta].join("\n\n");
  value.contentHash = scriptContentHash(value);
  return validateScript(value);
}

function voiceTrack(script, overrides = {}) {
  return {
    schemaVersion: VOICE_TRACK_CONTRACT_VERSION, voiceTrackId: "voice_track_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId,
    projectVersion: script.projectVersion, scriptId: script.scriptId,
    scriptContentHash: script.contentHash, language: script.language,
    voiceStyle: "informative", durationMilliseconds: 30125, audioFormat: "mp3",
    contentHash: "d".repeat(64), storageReference: "object:voice/voice_track_001",
    origin: "SYNTHETIC_TTS", provider: "provider_test",
    rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
    createdAt: "2026-09-28T19:00:00.000Z", revision: 1,
    supersedesVoiceTrackId: null, ...overrides,
  };
}

function generationRequest(script, overrides = {}) {
  const value = {
    schemaVersion: VOICE_GENERATION_REQUEST_VERSION,
    generationRequestId: "voice_generation_001",
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    requestedAt: "2026-09-28T20:00:00.000Z",
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = voiceGenerationRequestHash(value);
  return value;
}

function generatedVoiceTrack(script) {
  return voiceTrack(script, {
    voiceTrackId: "voice_track:voice_generation_001",
    createdAt: "2026-09-28T20:00:00.000Z",
  });
}

function project() {
  return {
    id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
    niche: "inteligência artificial", subniches: ["ferramentas"],
    audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" },
    references: [], channel: { voiceStyle: "informative", publishing: {
      contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"],
    } },
  };
}

function repositoryError(code, field) { return (caught) => caught instanceof VoiceTrackRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { db.close(); } }
function countWhere(path, table, where) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total; } finally { db.close(); } }
function withService(operation) { withDatabase((path) => { const { repository, script } = setup(path); const service = new VoiceTrackService(repository); try { operation({ service, repository, script, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-voice-track-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
