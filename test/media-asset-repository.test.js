import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { MEDIA_ASSET_CONTRACT_VERSION } from "../src/domain/media-asset-contracts.js";
import { MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestHash } from "../src/domain/media-acquisition-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } from "../src/domain/script-contracts.js";
import { MediaAssetRepository, MediaAssetRepositoryError } from "../src/media-asset-repository.js";
import { MediaAssetService } from "../src/media-asset-service.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";

const STARTED_AT = "2026-09-28T12:00:00.000Z";

test("persiste ativo e linhagem do roteiro exato com retry idempotente", () => {
  withService(({ service, repository, script, path }) => {
    const value = mediaAsset(script);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(service.register(value), value);
    const lineage = repository.getArtifact(value.mediaAssetId);
    assert.equal(lineage.artifactType, "media_asset");
    assert.equal(lineage.contentIdentity, `media-asset:${script.scriptId}:1:image`);
    assert.deepEqual(lineage.inputs, [{
      position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.scriptId, contentHash: script.contentHash,
    }]);
    assert.equal(count(path, "media_assets"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 1);
  });
});

test("revalida run, projeto, roteiro, hash e direção visual antes da escrita", () => {
  withService(({ service, script, path }) => {
    for (const [change, code, field] of [
      [{ projectVersion: 2 }, "MEDIA_ASSET_RUN_SCOPE_MISMATCH", "projectVersion"],
      [{ scriptContentHash: "f".repeat(64) }, "SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"],
      [{ visualDirectionPosition: 3 }, "VISUAL_DIRECTION_NOT_FOUND", "visualDirectionPosition"],
      [{ scriptId: "script_missing" }, "SCRIPT_NOT_FOUND", "scriptId"],
    ]) {
      assert.throws(() => service.register(mediaAsset(script, change)), repositoryError(code, field));
    }
    assert.equal(count(path, "media_assets"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 0);
  });
});

test("reutilização divergente de ID e revisão lógica falha sem alterar dados", () => {
  withService(({ service, script, path }) => {
    service.register(mediaAsset(script));
    assert.throws(() => service.register(mediaAsset(script, { contentHash: "c".repeat(64) })), repositoryError("MEDIA_ASSET_ID_REUSED", "mediaAssetId"));
    assert.throws(() => service.register(mediaAsset(script, { mediaAssetId: "media_asset_other" })), repositoryError("MEDIA_ASSET_REVISION_CONFLICT", "revision"));
    assert.equal(count(path, "media_assets"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 1);
  });
});

test("correção cria revisão histórica e listagens determinísticas", () => {
  withService(({ service, repository, script }) => {
    const first = service.register(mediaAsset(script));
    const second = service.register(mediaAsset(script, {
      mediaAssetId: "media_asset_002", contentHash: "c".repeat(64),
      mediaReference: "media:asset_002", createdAt: "2026-09-28T21:05:00.000Z",
      revision: 2, supersedesMediaAssetId: first.mediaAssetId,
    }));
    assert.deepEqual(service.listByPipelineRun(script.pipelineRunId), [first, second]);
    assert.deepEqual(service.listByScript(script.scriptId), [first, second]);
    assert.deepEqual(service.listByVisualDirection(script.scriptId, 1), [first, second]);
    assert.equal(repository.getArtifact(second.mediaAssetId).inputs[1].inputId, first.mediaAssetId);
    assert.throws(() => repository.db.prepare("UPDATE media_assets SET media_format = 'jpeg' WHERE media_asset_id = ?").run(first.mediaAssetId), /IMMUTABLE_MEDIA_ASSET/);
    assert.deepEqual(service.get(first.mediaAssetId), first);
  });
});

test("correção não pode mudar escopo, direção ou tipo lógico", () => {
  withService(({ service, script }) => {
    const first = service.register(mediaAsset(script));
    for (const [change, field] of [
      [{ visualDirectionPosition: 2 }, "visualDirectionPosition"],
      [{ assetType: "VIDEO", technicalProperties: { format: "mp4", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: 4000 } }, "assetType"],
    ]) {
      assert.throws(() => service.register(mediaAsset(script, {
        mediaAssetId: `media_asset_${field.toLowerCase()}`, contentHash: "c".repeat(64),
        mediaReference: `media:${field.toLowerCase()}`, createdAt: "2026-09-28T21:05:00.000Z",
        revision: 2, supersedesMediaAssetId: first.mediaAssetId, ...change,
      })), repositoryError("MEDIA_ASSET_SUPERSESSION_SCOPE_MISMATCH", field));
    }
  });
});

test("falha na escrita reverte ativo e linhagem integralmente", () => {
  withService(({ service, repository, script, path }) => {
    repository.db.exec("CREATE TRIGGER reject_media_asset BEFORE INSERT ON media_assets BEGIN SELECT RAISE(ABORT, 'PRIVATE media payload'); END;");
    assert.throws(() => service.register(mediaAsset(script)), repositoryError("MEDIA_ASSET_PERSISTENCE_FAILED", "mediaAsset"));
    assert.equal(count(path, "media_assets"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 0);
  });
});

test("persiste solicitação, ativo e linhagem na mesma transação", () => {
  withService(({ repository, script, path }) => {
    const request = acquisitionRequest(script);
    const asset = mediaAsset(script, {
      mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
      createdAt: request.requestedAt,
    });
    assert.deepEqual(repository.registerAcquiredMediaAsset({ request, mediaAsset: asset }), asset);
    assert.deepEqual(repository.registerAcquiredMediaAsset({ request, mediaAsset: asset }), asset);
    assert.deepEqual(repository.getMediaAcquisition(request.mediaAcquisitionRequestId), {
      requestHash: request.contentHash, mediaAsset: asset,
    });
    assert.equal(count(path, "media_acquisition_requests"), 1);
    assert.equal(count(path, "media_assets"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 1);
  });
});

test("falha da identidade reverte solicitação, ativo e linhagem", () => {
  withService(({ repository, script, path }) => {
    const request = acquisitionRequest(script);
    const asset = mediaAsset(script, {
      mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
      createdAt: request.requestedAt,
    });
    repository.db.exec("CREATE TRIGGER reject_acquisition BEFORE INSERT ON media_acquisition_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE acquisition payload'); END;");
    assert.throws(() => repository.registerAcquiredMediaAsset({ request, mediaAsset: asset }));
    assert.equal(count(path, "media_acquisition_requests"), 0);
    assert.equal(count(path, "media_assets"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'media_asset'"), 0);
  });
});

test("migração 019 é aditiva e preserva ativos existentes", () => {
  withDatabase((path) => {
    const { repository, script } = setup(path);
    repository.registerMediaAsset(mediaAsset(script));
    repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TABLE video_renders;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DROP TRIGGER media_acquisition_requests_no_delete;
      DROP TRIGGER media_acquisition_requests_no_update;
      DROP TRIGGER media_acquisition_requests_validate_scope;
      DROP TABLE media_acquisition_requests;
      DELETE FROM schema_migrations WHERE version = 21;
      DELETE FROM schema_migrations WHERE version = 20;
      DELETE FROM schema_migrations WHERE version = 19;
      PRAGMA user_version = 18;
    `);
    before.close();
    const migrated = new MediaAssetRepository(path);
    assert.equal(migrated.getMediaAcquisition("media_acquisition_001"), null);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("SELECT media_asset_id FROM media_assets").get().media_asset_id, "media_asset_001");
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 21);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 21);
    raw.close();
  });
});

test("migração 018 é aditiva e preserva dados existentes", () => {
  withDatabase((path) => {
    const { repository } = setup(path);
    repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TABLE video_renders;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DROP TRIGGER media_acquisition_requests_no_delete;
      DROP TRIGGER media_acquisition_requests_no_update;
      DROP TRIGGER media_acquisition_requests_validate_scope;
      DROP TABLE media_acquisition_requests;
      DROP TRIGGER media_assets_no_delete;
      DROP TRIGGER media_assets_no_update;
      DROP TRIGGER media_assets_validate_revision;
      DROP TRIGGER media_assets_validate_scope;
      DROP TABLE media_assets;
      DELETE FROM schema_migrations WHERE version = 21;
      DELETE FROM schema_migrations WHERE version = 20;
      DELETE FROM schema_migrations WHERE version = 19;
      DELETE FROM schema_migrations WHERE version = 18;
      PRAGMA user_version = 17;
    `);
    before.close();
    const migrated = new MediaAssetRepository(path);
    assert.equal(migrated.getRun("run_e06_001").pipelineRunId, "run_e06_001");
    assert.deepEqual(migrated.listMediaAssetsByPipelineRun("run_e06_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 21);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 21);
    raw.close();
  });
});

function setup(path) {
  const repository = new MediaAssetRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e06_001",
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
    pipelineRunId: "run_e06_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    ideaSelectionId: "selection_001", ideaSelectionContentHash: "a".repeat(64),
    ideaCandidateId: "idea_candidate_1", ideaContentHash: "b".repeat(64),
    language: "pt-BR", contentFormat: "short_video",
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Primeiro, escolha uma tarefa pequena e defina um resultado claro." }],
    fullNarration: "", visualDirections: [
      { position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." },
      { position: 2, blockPosition: 1, description: "Pessoa marcando uma tarefa concluída." },
    ],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR",
    createdAt: "2026-09-28T14:00:00.000Z", revision: 1,
    supersedesScriptId: null, contentHash: "0".repeat(64),
  };
  value.fullNarration = [value.hook, ...value.narrativeBlocks.map(({ narration }) => narration), value.cta].join("\n\n");
  value.contentHash = scriptContentHash(value);
  return validateScript(value);
}

function mediaAsset(script, overrides = {}) {
  return {
    schemaVersion: MEDIA_ASSET_CONTRACT_VERSION, mediaAssetId: "media_asset_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId,
    projectVersion: script.projectVersion, scriptId: script.scriptId,
    scriptContentHash: script.contentHash, visualDirectionPosition: 1,
    assetType: "IMAGE", technicalProperties: {
      format: "png", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: null,
    },
    contentHash: "d".repeat(64), mediaReference: "media:asset_001",
    origin: "OPERATOR_OWNED", provider: null,
    rights: { usageBasis: "OWNED", commercialUseAllowed: true },
    createdAt: "2026-09-28T21:00:00.000Z", revision: 1,
    supersedesMediaAssetId: null, ...overrides,
  };
}

function acquisitionRequest(script, overrides = {}) {
  const value = {
    schemaVersion: MEDIA_ACQUISITION_REQUEST_VERSION,
    mediaAcquisitionRequestId: "media_acquisition_001",
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: 1,
    assetType: "IMAGE",
    requestedAt: "2026-09-28T22:00:00.000Z",
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = mediaAcquisitionRequestHash(value);
  return value;
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

function repositoryError(code, field) { return (caught) => caught instanceof MediaAssetRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { db.close(); } }
function countWhere(path, table, where) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total; } finally { db.close(); } }
function withService(operation) { withDatabase((path) => { const { repository, script } = setup(path); const service = new MediaAssetService(repository); try { operation({ service, repository, script, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-media-asset-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
