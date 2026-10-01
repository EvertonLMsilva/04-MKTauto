import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } from "../src/domain/script-contracts.js";
import { SUBTITLE_STYLE_POLICY_VERSION, SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { VOICE_TRACK_CONTRACT_VERSION } from "../src/domain/voice-track-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { SubtitleTrackRepository, SubtitleTrackRepositoryError } from "../src/subtitle-track-repository.js";
import { SubtitleTrackService } from "../src/subtitle-track-service.js";
import { SubtitleGenerationService } from "../src/subtitle-generation-service.js";

const STARTED_AT = "2026-09-29T12:00:00.000Z";

test("persiste legenda e lineage exata com retry idempotente", () => {
  withService(({ service, repository, script, voice, path }) => {
    const value = subtitleTrack(script, voice);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(service.register(value), value);
    const lineage = repository.getArtifact(value.subtitleTrackId);
    assert.equal(lineage.artifactType, "subtitle_track");
    assert.equal(lineage.artifactVersion, 1);
    assert.deepEqual(lineage.inputs, [
      { position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.scriptId, contentHash: script.contentHash },
      { position: 2, kind: "INTERNAL_ARTIFACT", inputId: voice.voiceTrackId, contentHash: voice.contentHash },
    ]);
    assert.equal(count(path, "subtitle_tracks"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'subtitle_track'"), 1);
  });
});

test("geração usa o repository SQLite existente e retry não duplica estado", () => {
  withService(({ repository, script, voice, path }) => {
    const generation = new SubtitleGenerationService(repository);
    const request = {
      pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
      scriptId: script.scriptId, scriptContentHash: script.contentHash,
      voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash,
      stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, requestedAt: "2026-09-29T20:00:00.000Z",
    };
    const first = generation.generate(request);
    const retry = generation.generate({ ...request, requestedAt: "2026-09-29T21:00:00.000Z" });
    assert.deepEqual(retry, first);
    assert.equal(repository.getSubtitleTrack(first.subtitleTrack.subtitleTrackId).contentHash, first.subtitleTrack.contentHash);
    assert.equal(count(path, "subtitle_tracks"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'subtitle_track'"), 1);
  });
});

test("revalida run, snapshot, Script, VoiceTrack, idioma e duração antes de escrever", () => {
  withService(({ service, script, voice, path }) => {
    const cases = [
      [{ scriptContentHash: "f".repeat(64) }, "SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"],
      [{ voiceTrackContentHash: "e".repeat(64) }, "VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash"],
      [{ projectVersion: 2 }, "SUBTITLE_TRACK_RUN_SCOPE_MISMATCH", "projectVersion"],
      [{ language: "en-US" }, "SUBTITLE_TRACK_SCRIPT_SCOPE_MISMATCH", "language"],
      [{ durationMilliseconds: voice.durationMilliseconds - 1 }, "SUBTITLE_TRACK_VOICE_DURATION_MISMATCH", "durationMilliseconds"],
    ];
    for (const [change, code, field] of cases) {
      assert.throws(() => service.register(subtitleTrack(script, voice, change)), repositoryError(code, field));
    }
    assert.equal(count(path, "subtitle_tracks"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'subtitle_track'"), 0);
  });
});

test("reutilização divergente de ID e revisão lógica falha sem duplicar", () => {
  withService(({ service, script, voice, path }) => {
    const first = subtitleTrack(script, voice);
    service.register(first);
    const changed = subtitleTrack(script, voice, { cues: [{ position: 1, text: "Outro texto.", startMilliseconds: 0, endMilliseconds: 5000 }] });
    assert.throws(() => service.register(changed), repositoryError("SUBTITLE_TRACK_ID_REUSED", "subtitleTrackId"));
    assert.throws(() => service.register(subtitleTrack(script, voice, { subtitleTrackId: "subtitle_track_other" })), repositoryError("SUBTITLE_TRACK_REVISION_CONFLICT", "revision"));
    assert.equal(count(path, "subtitle_tracks"), 1);
  });
});

test("revisão preserva histórico, ordenação e permite gaps por design", () => {
  withService(({ service, repository, script, voice }) => {
    const first = service.register(subtitleTrack(script, voice));
    const second = service.register(subtitleTrack(script, voice, {
      subtitleTrackId: "subtitle_track_002",
      cues: [
        { position: 1, text: "Primeiro trecho revisado.", startMilliseconds: 0, endMilliseconds: 8000 },
        { position: 2, text: "Segundo trecho revisado.", startMilliseconds: 12000, endMilliseconds: 28000 },
      ],
      createdAt: "2026-09-29T20:05:00.000Z", revision: 2,
      supersedesSubtitleTrackId: first.subtitleTrackId,
    }));
    assert.deepEqual(service.listByPipelineRun(first.pipelineRunId), [first, second]);
    assert.deepEqual(service.listByScript(script.scriptId), [first, second]);
    assert.deepEqual(service.listByVoiceTrack(voice.voiceTrackId), [first, second]);
    assert.equal(repository.getArtifact(second.subtitleTrackId).inputs[2].inputId, first.subtitleTrackId);
    assert.throws(() => repository.db.prepare("UPDATE subtitle_tracks SET language = 'en-US' WHERE subtitle_track_id = ?").run(first.subtitleTrackId), /IMMUTABLE_SUBTITLE_TRACK/);
    assert.deepEqual(service.get(first.subtitleTrackId), first);
  });
});

test("supersessão fora da cadeia exata é recusada", () => {
  withService(({ service, script, voice }) => {
    const first = service.register(subtitleTrack(script, voice));
    assert.throws(() => service.register(subtitleTrack(script, voice, {
      subtitleTrackId: "subtitle_track_002", revision: 3,
      supersedesSubtitleTrackId: first.subtitleTrackId,
    })), repositoryError("SUBTITLE_TRACK_REVISION_MISMATCH", "revision"));
  });
});

test("falha na escrita reverte legenda e lineage", () => {
  withService(({ service, repository, script, voice, path }) => {
    repository.db.exec("CREATE TRIGGER reject_subtitle_track BEFORE INSERT ON subtitle_tracks BEGIN SELECT RAISE(ABORT, 'PRIVATE subtitle payload'); END;");
    assert.throws(() => service.register(subtitleTrack(script, voice)), repositoryError("SUBTITLE_TRACK_PERSISTENCE_FAILED", "subtitleTrack"));
    assert.equal(count(path, "subtitle_tracks"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'subtitle_track'"), 0);
  });
});

test("migration 023 é aditiva e preserva dados existentes", () => {
  withDatabase((path) => {
    const { repository } = setup(path);
    repository.close();
    const before = new DatabaseSync(path);
    before.exec("DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24;");
    before.exec(`
      DROP TRIGGER subtitle_cues_no_delete;
      DROP TRIGGER subtitle_cues_no_update;
      DROP TABLE subtitle_cues;
      DROP TRIGGER subtitle_tracks_no_delete;
      DROP TRIGGER subtitle_tracks_no_update;
      DROP TRIGGER subtitle_tracks_validate_revision;
      DROP TRIGGER subtitle_tracks_validate_scope;
      DROP TABLE subtitle_tracks;
      DELETE FROM schema_migrations WHERE version = 23;
      PRAGMA user_version = 22;
    `);
    before.close();
    const migrated = new SubtitleTrackRepository(path);
    assert.equal(migrated.getRun("run_e07_001").pipelineRunId, "run_e07_001");
    assert.deepEqual(migrated.listSubtitleTracksByPipelineRun("run_e07_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 27);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 27);
    raw.close();
  });
});

function setup(path) {
  const repository = new SubtitleTrackRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e07_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, startedAt: STARTED_AT,
  });
  const script = persistedScript();
  repository.registerArtifact({
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION, artifactId: script.scriptId,
    artifactType: "script", artifactVersion: 1, pipelineRunId: script.pipelineRunId,
    projectId: script.projectId, projectVersion: script.projectVersion,
    contentIdentity: "script:selection_001", hashAlgorithm: "sha256",
    contentHash: script.contentHash, inputs: [], generationMetadata: null, createdAt: script.createdAt,
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
  repository.getScript = (id) => id === script.scriptId ? script : null;
  const voice = voiceTrack(script);
  repository.registerVoiceTrack(voice);
  return { repository, script, voice };
}

function persistedScript() {
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION, scriptId: "script_001",
    pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    ideaSelectionId: "selection_001", ideaSelectionContentHash: "a".repeat(64),
    ideaCandidateId: "idea_candidate_1", ideaContentHash: "b".repeat(64),
    language: "pt-BR", contentFormat: "short_video",
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Primeiro, escolha uma tarefa pequena e defina um resultado claro." }],
    fullNarration: "", visualDirections: [{ position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." }],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR",
    createdAt: "2026-09-29T14:00:00.000Z", revision: 1,
    supersedesScriptId: null, contentHash: "0".repeat(64),
  };
  value.fullNarration = [value.hook, ...value.narrativeBlocks.map(({ narration }) => narration), value.cta].join("\n\n");
  value.contentHash = scriptContentHash(value);
  return validateScript(value);
}

function voiceTrack(script) {
  return {
    schemaVersion: VOICE_TRACK_CONTRACT_VERSION, voiceTrackId: "voice_track_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
    scriptId: script.scriptId, scriptContentHash: script.contentHash, language: script.language,
    voiceStyle: "informative", durationMilliseconds: 30000, audioFormat: "wav",
    contentHash: "c".repeat(64), storageReference: "object:voice/voice_track_001",
    origin: "SYNTHETIC_TTS", provider: "provider_test",
    rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
    createdAt: "2026-09-29T19:00:00.000Z", revision: 1, supersedesVoiceTrackId: null,
  };
}

function subtitleTrack(script, voice, overrides = {}) {
  const value = {
    schemaVersion: SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackId: "subtitle_track_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
    scriptId: script.scriptId, scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash,
    language: script.language, timeUnit: "MILLISECONDS", durationMilliseconds: voice.durationMilliseconds,
    stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION,
    cues: [
      { position: 1, text: "Primeiro trecho.", startMilliseconds: 0, endMilliseconds: 9000 },
      { position: 2, text: "Segundo trecho.", startMilliseconds: 10000, endMilliseconds: 29000 },
    ],
    createdAt: "2026-09-29T20:00:00.000Z", revision: 1,
    supersedesSubtitleTrackId: null, contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = subtitleTrackContentHash(value);
  return value;
}

function project() { return {
  id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
  niche: "inteligência artificial", subniches: ["ferramentas"],
  audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [],
  channel: { voiceStyle: "informative", publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
}; }

function repositoryError(code, field) { return (caught) => caught instanceof SubtitleTrackRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { db.close(); } }
function countWhere(path, table, where) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total; } finally { db.close(); } }
function withService(operation) { withDatabase((path) => { const { repository, script, voice } = setup(path); const service = new SubtitleTrackService(repository); try { operation({ service, repository, script, voice, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-subtitle-track-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
