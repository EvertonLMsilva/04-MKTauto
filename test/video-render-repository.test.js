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
import { VIDEO_RENDER_CONTRACT_VERSION } from "../src/domain/video-render-contracts.js";
import { VIDEO_COMPOSITION_REQUEST_VERSION, videoCompositionRequestHash } from "../src/domain/video-composition-contracts.js";
import { SUBTITLE_RENDER_POLICY_VERSION, SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderIdentityHash, subtitleRenderRequestHash } from "../src/domain/subtitle-render-contracts.js";
import { SUBTITLE_TRACK_CONTRACT_VERSION, SUBTITLE_STYLE_POLICY_VERSION, subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { VOICE_TRACK_CONTRACT_VERSION } from "../src/domain/voice-track-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { VoiceTrackRepository } from "../src/voice-track-repository.js";
import { SubtitleTrackRepository } from "../src/subtitle-track-repository.js";
import { VideoRenderRepository, VideoRenderRepositoryError } from "../src/video-render-repository.js";
import { VideoRenderService } from "../src/video-render-service.js";

const STARTED_AT = "2026-09-28T12:00:00.000Z";

test("persiste render e linhagem do plano exato com retry idempotente", () => {
  withService(({ service, repository, compositionPlan, path }) => {
    const value = render(compositionPlan);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(service.register(value), value);
    assert.deepEqual(repository.getArtifact(value.videoRenderId).inputs, [
      { position: 1, kind: "INTERNAL_ARTIFACT", inputId: compositionPlan.compositionPlanId, contentHash: compositionPlan.contentHash },
    ]);
    assert.equal(count(path, "video_renders"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'video_render'"), 1);
  });
});

test("persiste solicitação, render e linhagem atomicamente com retry terminal", () => {
  withService(({ repository, compositionPlan, path }) => {
    const value = compositionRequest(compositionPlan);
    const videoRender = render(compositionPlan, {
      videoRenderId: `video_render:${value.videoCompositionRequestId}`,
      createdAt: value.requestedAt,
    });
    assert.deepEqual(repository.registerVideoComposition({ request: value, videoRender }), videoRender);
    assert.deepEqual(repository.registerVideoComposition({ request: value, videoRender }), videoRender);
    assert.deepEqual(repository.getVideoComposition(value.videoCompositionRequestId), {
      requestHash: value.contentHash, videoRender,
    });
    assert.equal(count(path, "video_composition_requests"), 1);
    assert.equal(count(path, "video_renders"), 1);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'video_render'"), 1);
  });
});

test("persiste burn-in como revisão 2 imutável, request normalizada e lineage exata sem migration", () => {
  withService(({ repository, compositionPlan, path }) => {
    const source = repository.registerVideoRender(render(compositionPlan));
    const subtitles = new SubtitleTrackRepository(path); subtitles.getScript = repository.getScript; const track = subtitleTrack(compositionPlan);
    try { subtitles.registerSubtitleTrack(track); } finally { subtitles.close(); }
    const request = subtitleRenderRequest(source, track, compositionPlan); const result = subtitleRenderResult(request);
    const burned = render(compositionPlan, { videoRenderId: `video_render:subtitle:${request.subtitleRenderRequestId.slice("subtitle_render:".length)}`, contentHash: result.contentHash,
      logicalReference: result.logicalReference, createdAt: request.requestedAt, revision: 2, supersedesVideoRenderId: source.videoRenderId });
    assert.deepEqual(repository.registerSubtitleRendering({ request, result, videoRender: burned }), burned);
    assert.deepEqual(repository.registerSubtitleRendering({ request, result, videoRender: burned }), burned);
    assert.deepEqual(repository.getSubtitleRendering(request.subtitleRenderRequestId), { requestHash: request.contentHash, videoRender: burned });
    assert.deepEqual(repository.getArtifact(burned.videoRenderId).inputs, [
      { position: 1, kind: "INTERNAL_ARTIFACT", inputId: compositionPlan.compositionPlanId, contentHash: compositionPlan.contentHash },
      { position: 2, kind: "INTERNAL_ARTIFACT", inputId: source.videoRenderId, contentHash: source.contentHash },
      { position: 3, kind: "INTERNAL_ARTIFACT", inputId: track.subtitleTrackId, contentHash: track.contentHash },
    ]);
    assert.deepEqual(repository.getVideoRender(source.videoRenderId), source); assert.equal(count(path, "video_renders"), 2); assert.equal(countWhere(path, "schema_migrations", "version > 32"), 0);
    assert.throws(() => repository.db.prepare("UPDATE video_renders SET content_hash = ? WHERE video_render_id = ?").run("0".repeat(64), burned.videoRenderId), /IMMUTABLE_VIDEO_RENDER/);
  });
});

test("falha no burn-in reverte revisão 2, request normalizada e lineage", () => {
  withService(({ repository, compositionPlan, path }) => {
    const source = repository.registerVideoRender(render(compositionPlan)); const subtitles = new SubtitleTrackRepository(path); subtitles.getScript = repository.getScript; const track = subtitleTrack(compositionPlan);
    try { subtitles.registerSubtitleTrack(track); } finally { subtitles.close(); }
    const request = subtitleRenderRequest(source, track, compositionPlan); const result = subtitleRenderResult(request); const burned = render(compositionPlan, { videoRenderId: `video_render:subtitle:${request.subtitleRenderRequestId.slice("subtitle_render:".length)}`, contentHash: result.contentHash, logicalReference: result.logicalReference, createdAt: request.requestedAt, revision: 2, supersedesVideoRenderId: source.videoRenderId });
    repository.db.exec("CREATE TRIGGER reject_subtitle_render BEFORE INSERT ON video_renders WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'PRIVATE failure'); END;");
    assert.throws(() => repository.registerSubtitleRendering({ request, result, videoRender: burned }), repositoryError("VIDEO_RENDER_PERSISTENCE_FAILED", "videoRender"));
    assert.equal(count(path, "video_renders"), 1); assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'video_render'"), 1);
  });
});

test("conflito de solicitação e falha de persistência não deixam estado parcial", () => {
  withService(({ repository, compositionPlan, path }) => {
    const value = compositionRequest(compositionPlan);
    const videoRender = render(compositionPlan, {
      videoRenderId: `video_render:${value.videoCompositionRequestId}`,
      createdAt: value.requestedAt,
    });
    repository.registerVideoComposition({ request: value, videoRender });
    assert.throws(() => repository.registerVideoComposition({
      request: compositionRequest(compositionPlan, { containerFormat: "webm" }),
      videoRender,
    }), repositoryError("VIDEO_COMPOSITION_REQUEST_ID_REUSED", "videoCompositionRequestId"));
    assert.equal(count(path, "video_composition_requests"), 1);
  });

  withService(({ repository, compositionPlan, path }) => {
    repository.db.exec("CREATE TRIGGER reject_video_composition BEFORE INSERT ON video_composition_requests BEGIN SELECT RAISE(ABORT, 'PRIVATE request failure'); END;");
    const value = compositionRequest(compositionPlan);
    const videoRender = render(compositionPlan, {
      videoRenderId: `video_render:${value.videoCompositionRequestId}`,
      createdAt: value.requestedAt,
    });
    assert.throws(() => repository.registerVideoComposition({ request: value, videoRender }), repositoryError("VIDEO_RENDER_PERSISTENCE_FAILED", "videoRender"));
    assert.equal(count(path, "video_composition_requests"), 0);
    assert.equal(count(path, "video_renders"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'video_render'"), 0);
  });
});

test("revalida run, projeto, versão, snapshot, plano, hash, proporção e duração medida", () => {
  withService(({ service, compositionPlan, path }) => {
    for (const [change, code, field] of [
      [{ projectVersion: 2 }, "VIDEO_RENDER_RUN_SCOPE_MISMATCH", "projectVersion"],
      [{ compositionPlanContentHash: "f".repeat(64) }, "COMPOSITION_PLAN_CONTENT_HASH_MISMATCH", "compositionPlanContentHash"],
      [{ outputAspectRatio: "1:1", widthPixels: 1000, heightPixels: 1000 }, "OUTPUT_ASPECT_RATIO_MISMATCH", "outputAspectRatio"],
      [{ durationMilliseconds: 10001 }, "VIDEO_RENDER_DURATION_MISMATCH", "durationMilliseconds"],
    ]) assert.throws(() => service.register(render(compositionPlan, change)), repositoryError(code, field));
    assert.equal(count(path, "video_renders"), 0);
  });
});

test("duração real precisa ser informada e não é inferida automaticamente do plano", () => {
  withService(({ service, compositionPlan }) => {
    const value = render(compositionPlan);
    delete value.durationMilliseconds;
    assert.throws(() => service.register(value), repositoryError("REQUIRED_FIELD", "videoRender.durationMilliseconds"));
  });
});

test("ID divergente e revisão lógica conflitante não alteram o histórico", () => {
  withService(({ service, compositionPlan, path }) => {
    service.register(render(compositionPlan));
    assert.throws(() => service.register(render(compositionPlan, { contentHash: "e".repeat(64) })), repositoryError("VIDEO_RENDER_ID_REUSED", "videoRenderId"));
    assert.throws(() => service.register(render(compositionPlan, { videoRenderId: "video_render_other" })), repositoryError("VIDEO_RENDER_REVISION_CONFLICT", "revision"));
    assert.equal(count(path, "video_renders"), 1);
  });
});

test("correção append-only preserva a revisão anterior e listagens determinísticas", () => {
  withService(({ service, repository, compositionPlan }) => {
    const first = service.register(render(compositionPlan));
    const second = service.register(render(compositionPlan, {
      videoRenderId: "video_render_002", contentHash: "e".repeat(64),
      logicalReference: "render:output_002", createdAt: "2026-09-28T23:40:00.000Z",
      revision: 2, supersedesVideoRenderId: first.videoRenderId,
    }));
    assert.deepEqual(service.listByPipelineRun(compositionPlan.pipelineRunId), [first, second]);
    assert.deepEqual(service.listByCompositionPlan(compositionPlan.compositionPlanId), [first, second]);
    assert.throws(() => repository.db.prepare("UPDATE video_renders SET width_pixels = 2160 WHERE video_render_id = ?").run(first.videoRenderId), /IMMUTABLE_VIDEO_RENDER/);
    assert.deepEqual(service.get(first.videoRenderId), first);
  });
});

test("falha de persistência reverte render e linhagem na mesma transação", () => {
  withService(({ service, repository, compositionPlan, path }) => {
    repository.db.exec("CREATE TRIGGER reject_video_render BEFORE INSERT ON video_renders BEGIN SELECT RAISE(ABORT, 'PRIVATE render failure'); END;");
    assert.throws(() => service.register(render(compositionPlan)), repositoryError("VIDEO_RENDER_PERSISTENCE_FAILED", "videoRender"));
    assert.equal(count(path, "video_renders"), 0);
    assert.equal(countWhere(path, "artifact_lineage", "artifact_type = 'video_render'"), 0);
  });
});

test("leitura revalida colunas, payload, identidade, escopo e linhagem", () => {
  withService(({ service, repository, compositionPlan }) => {
    const value = service.register(render(compositionPlan));
    repository.db.exec("PRAGMA foreign_keys = OFF; DROP TRIGGER video_renders_no_update;");
    repository.db.prepare("UPDATE video_renders SET logical_reference = 'render:tampered' WHERE video_render_id = ?").run(value.videoRenderId);
    assert.throws(() => service.get(value.videoRenderId), repositoryError("INVALID_PERSISTED_VIDEO_RENDER", "videoRenderId"));
  });
});

test("migração 022 é aditiva, não cria solicitações ou renders retroativos e preserva planos", () => {
  withDatabase((path) => {
    const context = setup(path);
    context.repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TRIGGER video_composition_requests_no_delete;
      DROP TRIGGER video_composition_requests_no_update;
      DROP TRIGGER video_composition_requests_validate_scope;
      DROP TABLE video_composition_requests;
      DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24; DROP TABLE subtitle_cues; DROP TABLE subtitle_tracks; DELETE FROM schema_migrations WHERE version = 23; DELETE FROM schema_migrations WHERE version = 22;
      PRAGMA user_version = 21;
    `);
    before.close();
    const migrated = new VideoRenderRepository(path);
    assert.deepEqual(migrated.listVideoRendersByPipelineRun("run_e07_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 32);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 32);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM video_composition_requests").get().total, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM video_renders").get().total, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM composition_plans").get().total, 1);
    raw.close();
  });
});

test("migração 021 continua recuperável junto da 022", () => {
  withDatabase((path) => {
    const context = setup(path);
    context.repository.close();
    const before = new DatabaseSync(path);
    before.exec(`
      DROP TRIGGER video_composition_requests_no_delete;
      DROP TRIGGER video_composition_requests_no_update;
      DROP TRIGGER video_composition_requests_validate_scope;
      DROP TABLE video_composition_requests;
      DROP TRIGGER video_renders_no_delete;
      DROP TRIGGER video_renders_no_update;
      DROP TRIGGER video_renders_validate_revision;
      DROP TRIGGER video_renders_validate_scope;
      DROP TABLE video_renders;
      DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24; DROP TABLE subtitle_cues; DROP TABLE subtitle_tracks; DELETE FROM schema_migrations WHERE version = 23; DELETE FROM schema_migrations WHERE version = 22;
      DELETE FROM schema_migrations WHERE version = 21;
      PRAGMA user_version = 20;
    `);
    before.close();
    const migrated = new VideoRenderRepository(path);
    assert.deepEqual(migrated.listVideoRendersByPipelineRun("run_e07_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 32);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 32);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM video_composition_requests").get().total, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM video_renders").get().total, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM composition_plans").get().total, 1);
    raw.close();
  });
});

function setup(path) {
  const repository = new VideoRenderRepository(path);
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
  const compositionPlan = plan(script, voice, assets);
  repository.registerCompositionPlan(compositionPlan);
  return { repository, compositionPlan };
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

function plan(script, voice, assets) {
  const value = {
    schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanId: "composition_plan_001",
    pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion,
    scriptId: script.scriptId, scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash,
    outputAspectRatio: "9:16", timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS",
    durationMilliseconds: voice.durationMilliseconds, segments: [
      { position: 1, visualDirectionPosition: 1, mediaAssetId: assets[0].mediaAssetId, mediaAssetContentHash: assets[0].contentHash, startMilliseconds: 0, endMilliseconds: 4000 },
      { position: 2, visualDirectionPosition: 2, mediaAssetId: assets[1].mediaAssetId, mediaAssetContentHash: assets[1].contentHash, startMilliseconds: 4000, endMilliseconds: 10000 },
    ],
    createdAt: "2026-09-28T23:00:00.000Z", revision: 1,
    supersedesCompositionPlanId: null, contentHash: "0".repeat(64),
  };
  value.contentHash = compositionPlanContentHash(value);
  return value;
}

function render(compositionPlan, overrides = {}) { return {
  schemaVersion: VIDEO_RENDER_CONTRACT_VERSION, videoRenderId: "video_render_001",
  pipelineRunId: compositionPlan.pipelineRunId, projectId: compositionPlan.projectId,
  projectVersion: compositionPlan.projectVersion, compositionPlanId: compositionPlan.compositionPlanId,
  compositionPlanContentHash: compositionPlan.contentHash, outputAspectRatio: compositionPlan.outputAspectRatio,
  durationMilliseconds: 10000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920,
  contentHash: "f".repeat(64), logicalReference: "render:output_001",
  createdAt: "2026-09-28T23:30:00.000Z", revision: 1, supersedesVideoRenderId: null,
  ...overrides,
}; }

function compositionRequest(compositionPlan, overrides = {}) {
  const value = {
    schemaVersion: VIDEO_COMPOSITION_REQUEST_VERSION,
    videoCompositionRequestId: "video_composition_001",
    compositionPlanId: compositionPlan.compositionPlanId,
    compositionPlanContentHash: compositionPlan.contentHash,
    containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920,
    requestedAt: "2026-09-29T00:00:00.000Z", contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = videoCompositionRequestHash(value);
  return value;
}

function subtitleTrack(planValue) { const value = { schemaVersion: SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackId: "subtitle_track_render_001", pipelineRunId: planValue.pipelineRunId, projectId: planValue.projectId, projectVersion: planValue.projectVersion,
  scriptId: planValue.scriptId, scriptContentHash: planValue.scriptContentHash, voiceTrackId: planValue.voiceTrackId, voiceTrackContentHash: planValue.voiceTrackContentHash, language: "pt-BR", timeUnit: "MILLISECONDS", durationMilliseconds: planValue.durationMilliseconds,
  stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, cues: [{ position: 1, text: "Legenda física", startMilliseconds: 0, endMilliseconds: 9880 }], createdAt: "2026-09-29T10:00:00.000Z", revision: 1, supersedesSubtitleTrackId: null, contentHash: "0".repeat(64) };
  value.contentHash = subtitleTrackContentHash(value); return value; }
function subtitleRenderRequest(source, track, planValue) { const value = { schemaVersion: SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderRequestId: "pending", pipelineRunId: source.pipelineRunId, projectId: source.projectId, projectVersion: source.projectVersion,
  videoRenderId: source.videoRenderId, videoRenderContentHash: source.contentHash, compositionPlanId: planValue.compositionPlanId, compositionPlanContentHash: planValue.contentHash,
  subtitleTrackId: track.subtitleTrackId, subtitleTrackContentHash: track.contentHash, scriptId: track.scriptId, scriptContentHash: track.scriptContentHash, voiceTrackId: track.voiceTrackId, voiceTrackContentHash: track.voiceTrackContentHash,
  stylePolicyVersion: track.stylePolicyVersion, renderPolicyVersion: SUBTITLE_RENDER_POLICY_VERSION, requestedAt: "2026-09-29T12:00:00.000Z", contentHash: "0".repeat(64) };
  value.subtitleRenderRequestId = `subtitle_render:${subtitleRenderIdentityHash(value)}`; value.contentHash = subtitleRenderRequestHash(value); return value; }
function subtitleRenderResult(requestValue) { const contentHash = "9".repeat(64); return { schemaVersion: "subtitle-render-result/1.0.0", subtitleRenderRequestId: requestValue.subtitleRenderRequestId, requestContentHash: requestValue.contentHash,
  durationMilliseconds: 10000, containerFormat: "mp4", outputAspectRatio: "9:16", widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "h264", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 1,
  contentHash, logicalReference: `render:sha256_${contentHash}`, toolchain: { ffmpegVersion: "ffmpeg version test", libassFingerprint: "8".repeat(64), fontFamily: "Arial", fontProvider: "libass-default" } }; }

function project() { return {
  id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
  niche: "inteligência artificial", subniches: ["ferramentas"],
  audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [],
  channel: { voiceStyle: "informative", publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
}; }

function repositoryError(code, field) { return (caught) => caught instanceof VideoRenderRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { db.close(); } }
function countWhere(path, table, where) { const db = new DatabaseSync(path); try { return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total; } finally { db.close(); } }
function withService(operation) { withDatabase((path) => { const context = setup(path); const service = new VideoRenderService(context.repository); try { operation({ ...context, service, path }); } finally { if (context.repository.db?.isOpen) context.repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-video-render-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
