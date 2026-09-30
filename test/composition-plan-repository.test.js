import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanContentHash } from "../src/domain/composition-plan-contracts.js";
import { MEDIA_ASSET_CONTRACT_VERSION } from "../src/domain/media-asset-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } from "../src/domain/script-contracts.js";
import { VOICE_TRACK_CONTRACT_VERSION } from "../src/domain/voice-track-contracts.js";
import { CompositionPlanRepository, CompositionPlanRepositoryError } from "../src/composition-plan-repository.js";
import { CompositionPlanService } from "../src/composition-plan-service.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { VoiceTrackRepository } from "../src/voice-track-repository.js";

const STARTED_AT = "2026-09-28T12:00:00.000Z";

test("persiste plano e linhagem ordenada com retry idempotente", () => {
  withService(({ service, repository, script, voice, assets, path }) => {
    const value = plan(script, voice, assets);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(repository.getArtifact(value.compositionPlanId).inputs, [
      input(1, script.scriptId, script.contentHash), input(2, voice.voiceTrackId, voice.contentHash),
      input(3, assets[0].mediaAssetId, assets[0].contentHash), input(4, assets[1].mediaAssetId, assets[1].contentHash),
    ]);
    assert.equal(count(path, "composition_plans"), 1);
    assert.equal(count(path, "composition_plan_segments"), 2);
  });
});

test("revalida identidades, hashes, snapshot e duração real da voz", () => {
  withService(({ service, script, voice, assets, path }) => {
    for (const [change, code, field] of [
      [{ projectVersion: 2 }, "COMPOSITION_PLAN_RUN_SCOPE_MISMATCH", "projectVersion"],
      [{ scriptContentHash: "f".repeat(64) }, "SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"],
      [{ voiceTrackContentHash: "f".repeat(64) }, "VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash"],
      [{ outputAspectRatio: "1:1" }, "OUTPUT_ASPECT_RATIO_MISMATCH", "outputAspectRatio"],
      [{ durationMilliseconds: 10001, segments: segments(assets, [{}, { endMilliseconds: 10001 }]) }, "VOICE_TRACK_DURATION_MISMATCH", "durationMilliseconds"],
    ]) assert.throws(() => service.register(plan(script, voice, assets, change)), repositoryError(code, field));
    assert.equal(count(path, "composition_plans"), 0);
  });
});

test("exige cobertura exata das direções e vínculo explícito de cada ativo", () => {
  withService(({ service, script, voice, assets }) => {
    const missing = segments(assets).slice(0, 1);
    missing[0] = { ...missing[0], endMilliseconds: 10000 };
    assert.throws(() => service.register(plan(script, voice, assets, { segments: missing })), repositoryError("VISUAL_DIRECTION_COVERAGE_MISMATCH", "segments"));
    const wrong = segments(assets, [{ mediaAssetContentHash: "f".repeat(64) }]);
    assert.throws(() => service.register(plan(script, voice, assets, { segments: wrong })), repositoryError("MEDIA_ASSET_CONTENT_HASH_MISMATCH", "segments.0.mediaAssetContentHash"));
  });
});

test("revalida direitos no momento da criação sem confiar no registro anterior", () => {
  withService(({ service, repository, script, voice, assets }) => {
    const original = repository.getMediaAsset.bind(repository);
    repository.getMediaAsset = (id) => id === assets[0].mediaAssetId
      ? { ...original(id), rights: { usageBasis: "OWNED", commercialUseAllowed: false } }
      : original(id);
    assert.throws(() => service.register(plan(script, voice, assets)), repositoryError("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"));
  });
});

test("vídeo precisa ter duração real suficiente para seu segmento", () => {
  withService(({ service, script, voice, assets }) => {
    const longSegment = segments(assets, [{ endMilliseconds: 3000 }, { startMilliseconds: 3000 }]);
    assert.throws(() => service.register(plan(script, voice, assets, { segments: longSegment })), repositoryError("MEDIA_DURATION_INSUFFICIENT", "segments.1"));
  });
});

test("ID divergente e revisão lógica conflitante não alteram o histórico", () => {
  withService(({ service, script, voice, assets, path }) => {
    service.register(plan(script, voice, assets));
    assert.throws(() => service.register(plan(script, voice, assets, { createdAt: "2026-09-28T23:01:00.000Z" })), repositoryError("COMPOSITION_PLAN_ID_REUSED", "compositionPlanId"));
    assert.throws(() => service.register(plan(script, voice, assets, { compositionPlanId: "composition_plan_other" })), repositoryError("COMPOSITION_PLAN_REVISION_CONFLICT", "revision"));
    assert.equal(count(path, "composition_plans"), 1);
  });
});

test("correção append-only preserva a revisão anterior e listagens determinísticas", () => {
  withService(({ service, repository, script, voice, assets }) => {
    const first = service.register(plan(script, voice, assets));
    const second = service.register(plan(script, voice, assets, {
      compositionPlanId: "composition_plan_002", createdAt: "2026-09-28T23:05:00.000Z",
      revision: 2, supersedesCompositionPlanId: first.compositionPlanId,
    }));
    assert.deepEqual(service.listByPipelineRun(script.pipelineRunId), [first, second]);
    assert.deepEqual(service.listByScript(script.scriptId), [first, second]);
    assert.throws(() => repository.db.prepare("UPDATE composition_plans SET output_aspect_ratio = '1:1' WHERE composition_plan_id = ?").run(first.compositionPlanId), /IMMUTABLE_COMPOSITION_PLAN/);
    assert.deepEqual(service.get(first.compositionPlanId), first);
  });
});

test("falha nos segmentos reverte plano e linhagem na mesma transação", () => {
  withService(({ service, repository, script, voice, assets, path }) => {
    repository.db.exec("CREATE TRIGGER reject_composition_segment BEFORE INSERT ON composition_plan_segments BEGIN SELECT RAISE(ABORT, 'PRIVATE segment failure'); END;");
    assert.throws(() => service.register(plan(script, voice, assets)), repositoryError("COMPOSITION_PLAN_PERSISTENCE_FAILED", "compositionPlan"));
    assert.equal(count(path, "composition_plans"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'composition_plan'"), 0);
  });
});

test("migração 020 é aditiva, não cria planos retroativos e preserva ativos", () => {
  withDatabase((path) => {
    const context = setup(path);
    context.repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TABLE video_composition_requests;
      DROP TABLE video_renders;
      DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24; DROP TABLE subtitle_cues; DROP TABLE subtitle_tracks; DELETE FROM schema_migrations WHERE version = 23; DELETE FROM schema_migrations WHERE version = 22;
      DELETE FROM schema_migrations WHERE version = 21;
      DROP TRIGGER composition_plan_segments_no_delete;
      DROP TRIGGER composition_plan_segments_no_update;
      DROP TRIGGER composition_plan_segments_validate_scope;
      DROP TRIGGER composition_plans_no_delete;
      DROP TRIGGER composition_plans_no_update;
      DROP TRIGGER composition_plans_validate_revision;
      DROP TRIGGER composition_plans_validate_scope;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DELETE FROM schema_migrations WHERE version = 20;
      PRAGMA user_version = 19;
    `);
    before.close();
    const migrated = new CompositionPlanRepository(path);
    assert.deepEqual(migrated.listCompositionPlansByPipelineRun("run_e07_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 24);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 24);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM composition_plans").get().total, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM media_assets").get().total, 2);
    raw.close();
  });
});

function setup(path) {
  const repository = new CompositionPlanRepository(path);
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
  const voiceRepository = new VoiceTrackRepository(path);
  voiceRepository.getScript = (id) => id === script.scriptId ? script : null;
  voiceRepository.registerVoiceTrack(voice);
  voiceRepository.close();

  const assets = [mediaAsset(script), mediaAsset(script, {
    mediaAssetId: "media_asset_002", visualDirectionPosition: 2, assetType: "VIDEO",
    technicalProperties: { format: "mp4", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: 6000 },
    contentHash: "e".repeat(64), mediaReference: "media:asset_002",
  })];
  assets.forEach((asset) => repository.registerMediaAsset(asset));
  return { repository, script, voice, assets };
}

function persistedScript() {
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION, scriptId: "script_001", pipelineRunId: "run_e07_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, ideaSelectionId: "selection_001",
    ideaSelectionContentHash: "a".repeat(64), ideaCandidateId: "idea_candidate_1", ideaContentHash: "b".repeat(64),
    language: "pt-BR", contentFormat: "short_video", hook: "Organize a rotina com dois passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Escolha uma tarefa pequena e conclua antes de iniciar outra." }],
    fullNarration: "", visualDirections: [
      { position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." },
      { position: 2, blockPosition: 1, description: "Pessoa marcando a tarefa concluída." },
    ], cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR", createdAt: "2026-09-28T14:00:00.000Z",
    revision: 1, supersedesScriptId: null, contentHash: "0".repeat(64),
  };
  value.fullNarration = [value.hook, ...value.narrativeBlocks.map(({ narration }) => narration), value.cta].join("\n\n");
  value.contentHash = scriptContentHash(value);
  return validateScript(value);
}

function voiceTrack(script) { return {
  schemaVersion: VOICE_TRACK_CONTRACT_VERSION, voiceTrackId: "voice_track_001",
  pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
  scriptId: script.scriptId, scriptContentHash: script.contentHash, language: script.language,
  voiceStyle: "informative", durationMilliseconds: 10000, audioFormat: "mp3",
  contentHash: "c".repeat(64), storageReference: "object:voice/voice_track_001",
  origin: "SYNTHETIC_TTS", provider: "provider_test",
  rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
  createdAt: "2026-09-28T19:00:00.000Z", revision: 1, supersedesVoiceTrackId: null,
}; }

function mediaAsset(script, overrides = {}) { return {
  schemaVersion: MEDIA_ASSET_CONTRACT_VERSION, mediaAssetId: "media_asset_001",
  pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
  scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: 1,
  assetType: "IMAGE", technicalProperties: { format: "png", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: null },
  contentHash: "d".repeat(64), mediaReference: "media:asset_001", origin: "OPERATOR_OWNED", provider: null,
  rights: { usageBasis: "OWNED", commercialUseAllowed: true }, createdAt: "2026-09-28T21:00:00.000Z",
  revision: 1, supersedesMediaAssetId: null, ...overrides,
}; }

function segments(assets, overrides = []) { return [
  { position: 1, visualDirectionPosition: 1, mediaAssetId: assets[0].mediaAssetId, mediaAssetContentHash: assets[0].contentHash, startMilliseconds: 0, endMilliseconds: 4000 },
  { position: 2, visualDirectionPosition: 2, mediaAssetId: assets[1].mediaAssetId, mediaAssetContentHash: assets[1].contentHash, startMilliseconds: 4000, endMilliseconds: 10000 },
].map((item, index) => ({ ...item, ...(overrides[index] ?? {}) })); }

function plan(script, voice, assets, overrides = {}) {
  const value = {
    schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanId: "composition_plan_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
    scriptId: script.scriptId, scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash,
    outputAspectRatio: "9:16", timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS",
    durationMilliseconds: voice.durationMilliseconds, segments: segments(assets),
    createdAt: "2026-09-28T23:00:00.000Z", revision: 1,
    supersedesCompositionPlanId: null, contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = compositionPlanContentHash(value);
  return value;
}

function project() { return {
  id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
  niche: "inteligência artificial", subniches: ["ferramentas"],
  audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [],
  channel: { voiceStyle: "informative", publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
}; }

function input(position, inputId, contentHash) { return { position, kind: "INTERNAL_ARTIFACT", inputId, contentHash }; }
function repositoryError(code, field) { return (caught) => caught instanceof CompositionPlanRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { db.close(); } }
function countWhere(path, table, where) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total; } finally { db.close(); } }
function withService(operation) { withDatabase((path) => { const context = setup(path); const service = new CompositionPlanService(context.repository); try { operation({ ...context, service, path }); } finally { if (context.repository.db?.isOpen) context.repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-composition-plan-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
