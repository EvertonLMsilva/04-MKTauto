import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IdeaRepository, IdeaRepositoryError } from "../src/idea-repository.js";
import { IdeaService } from "../src/idea-service.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { DEFAULT_RESEARCH_SHORTLIST_POLICY, RESEARCH_SHORTLIST_CONTRACT_VERSION } from "../src/domain/research-shortlist-contracts.js";
import { REFERENCE_ANALYSIS_POLICY_VERSION, REFERENCE_INSIGHT_CONTRACT_VERSION } from "../src/domain/reference-insight-contracts.js";

const STARTED_AT = "2026-09-28T11:00:00.000Z";

test("registra, recupera e lista ideias e scores sem duplicar retry", () => {
  withService(({ service, path }) => {
    const created = service.registerBatch(submission());
    assert.equal(created.length, 2);
    assert.deepEqual(service.registerBatch(submission()), created);
    assert.deepEqual(service.get(created[0].idea.ideaCandidateId), created[0]);
    assert.deepEqual(service.listByPipelineRun("run_e03_001"), created);
    assert.equal(Object.isFrozen(created[0].idea), true);
    assert.equal(count(path, "idea_candidates"), 2);
    assert.equal(count(path, "idea_scores"), 2);
    assert.equal(count(path, "artifact_lineage"), 4);
    assert.equal(count(path, "cost_events"), 0);
  });
});

test("rejeita run, projeto, shortlist e evidências fora do escopo", () => {
  withService(({ service, path }) => {
    assert.throws(() => service.registerBatch(submission({ pipelineRunId: "run_missing_001" })), repositoryError("PIPELINE_RUN_NOT_FOUND", "pipelineRunId"));
    assert.throws(() => service.registerBatch(submission({ projectVersion: 2 })), repositoryError("IDEA_RUN_SCOPE_MISMATCH", "projectVersion"));
    assert.throws(() => service.registerBatch(submission({ researchShortlistId: "research-shortlist:missing" })), repositoryError("RESEARCH_SHORTLIST_NOT_FOUND", "researchShortlistId"));
    const value = submission();
    value.proposals[0].evidenceCandidateIds = ["candidate-missing"];
    assert.throws(() => service.registerBatch(value), repositoryError("IDEA_EVIDENCE_NOT_IN_SHORTLIST", "proposals.0.evidenceCandidateIds.0"));
    assert.equal(count(path, "idea_batches"), 0);
  });
});

test("ReferenceInsight é opcional, mas deve existir, ter escopo e evidência coerentes", () => {
  withService(({ service, repository }) => {
    seedReferenceInsight(repository.db);
    const linked = submission();
    linked.proposals[0].referenceInsightId = "reference-insight:001";
    linked.proposals[0].referenceEvidenceIds = ["ref-evidence-1"];
    const created = service.registerBatch(linked);
    assert.equal(created.find(({ idea }) => idea.ideaCandidateId === "idea_candidate_1").idea.referenceInsightId, "reference-insight:001");

    const missing = submission({ ideaBatchId: "idea_batch_missing_ref" });
    missing.proposals[0].ideaCandidateId = "idea_candidate_missing_ref";
    missing.proposals[0].referenceInsightId = "reference-insight:missing";
    assert.throws(() => service.registerBatch(missing), repositoryError("REFERENCE_INSIGHT_NOT_FOUND", "referenceInsightId"));

    const invalidEvidence = submission({ ideaBatchId: "idea_batch_invalid_ref" });
    invalidEvidence.proposals[0].ideaCandidateId = "idea_candidate_invalid_ref";
    invalidEvidence.proposals[0].referenceInsightId = "reference-insight:001";
    invalidEvidence.proposals[0].referenceEvidenceIds = ["ref-evidence-missing"];
    assert.throws(() => service.registerBatch(invalidEvidence), repositoryError("REFERENCE_EVIDENCE_NOT_FOUND", "referenceEvidenceIds.0"));
  });
});

test("retry conflitante usa código e campo estáveis sem estado parcial", () => {
  withService(({ service, path }) => {
    service.registerBatch(submission());
    const changed = submission();
    changed.proposals[0].title = "Outro conceito editorial válido";
    assert.throws(() => service.registerBatch(changed), repositoryError("IDEA_BATCH_ID_REUSED", "ideaBatchId"));
    assert.equal(count(path, "idea_candidates"), 2);
  });
});

test("falha transacional remove lote, ideias, scores e linhagem parcial", () => {
  withService(({ service, path }) => {
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER reject_idea_score BEFORE INSERT ON idea_scores BEGIN SELECT RAISE(ABORT, 'PRIVATE scoring payload'); END;");
    raw.close();
    assert.throws(() => service.registerBatch(submission()), repositoryError("IDEA_PERSISTENCE_FAILED", "ideaBatch"));
    for (const table of ["idea_batches", "idea_candidates", "idea_scores", "artifact_lineage"]) assert.equal(count(path, table), 0);
  });
});

test("banco impede update e delete retroativos", () => {
  withService(({ service, path }) => {
    service.registerBatch(submission());
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE idea_candidates SET content_identity = 'idea:changed' WHERE idea_candidate_id = 'idea_candidate_1'").run(), /IMMUTABLE_IDEA_CANDIDATE/);
      assert.throws(() => raw.prepare("DELETE FROM idea_scores WHERE idea_candidate_id = 'idea_candidate_1'").run(), /IMMUTABLE_IDEA_SCORE/);
    } finally { raw.close(); }
  });
});

test("leitura revalida contrato e hash persistidos", () => {
  withService(({ service, path }) => {
    service.registerBatch(submission());
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER idea_candidates_no_update");
    const payload = JSON.parse(raw.prepare("SELECT payload_json FROM idea_candidates WHERE idea_candidate_id = ?").get("idea_candidate_1").payload_json);
    payload.origin = "INVENTED";
    raw.prepare("UPDATE idea_candidates SET payload_json = ? WHERE idea_candidate_id = ?").run(JSON.stringify(payload), "idea_candidate_1");
    raw.close();
    assert.throws(() => service.get("idea_candidate_1"), repositoryError("INVALID_PERSISTED_IDEA_CANDIDATE", "ideaCandidateId"));
  });
});

test("migração 011 é aditiva e preserva registros existentes", () => {
  withDatabase((path) => {
    const repository = new IdeaRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    new PipelineRunService(repository).start(request());
    repository.close();
    const before = new DatabaseSync(path);
    before.exec(`DROP TABLE media_acquisition_requests; DROP TABLE media_assets; DROP TABLE voice_generation_requests; DROP TABLE voice_tracks; DROP TABLE ai_call_telemetry; DROP TABLE script_generation_requests; DROP TABLE scripts; DROP TABLE idea_selections; DROP TABLE idea_candidate_evidence; DROP TABLE idea_scores; DROP TABLE idea_candidates; DROP TABLE idea_batches;
      DELETE FROM schema_migrations WHERE version = 19; DELETE FROM schema_migrations WHERE version = 18; DELETE FROM schema_migrations WHERE version = 17; DELETE FROM schema_migrations WHERE version = 16; DELETE FROM schema_migrations WHERE version = 15; DELETE FROM schema_migrations WHERE version = 14; DELETE FROM schema_migrations WHERE version = 13; DELETE FROM schema_migrations WHERE version = 12; DELETE FROM schema_migrations WHERE version = 11; PRAGMA user_version = 10;`);
    before.close();
    const migrated = new IdeaRepository(path);
    assert.equal(migrated.getRun("run_e03_001").projectId, "project_curiosidades_ia");
    assert.deepEqual(migrated.listIdeasByPipelineRun("run_e03_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 19);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 19);
    raw.close();
  });
});

function submission(overrides = {}) {
  return {
    ideaBatchId: "idea_batch_1", pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    researchShortlistId: "research-shortlist:001", origin: "OPERATOR",
    createdAt: "2026-09-28T12:00:00.000Z",
    proposals: [
      { ideaCandidateId: "idea_candidate_1", title: "IA para organizar a rotina", editorialAngle: "Ferramentas práticas para produtividade", evidenceCandidateIds: ["candidate-1"], referenceInsightId: null, referenceEvidenceIds: [] },
      { ideaCandidateId: "idea_candidate_2", title: "Ferramentas de IA no trabalho", editorialAngle: "Exemplos seguros para profissionais de tecnologia", evidenceCandidateIds: ["candidate-2"], referenceInsightId: null, referenceEvidenceIds: [] },
    ],
    ...overrides,
  };
}

function seedResearch(db) {
  const shortlist = researchShortlist();
  db.prepare(`INSERT INTO trend_runs
    (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
    VALUES (?, ?, 'SUCCEEDED', ?, ?, 'trend-score/1.0.0', '{}')`)
    .run("trend-run-1", RADAR_CONTRACT_VERSION, STARTED_AT, STARTED_AT);
  db.prepare(`INSERT INTO research_daily_runs
    (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
     research_input_hash, config_hash, config_json, source_plan_json, state,
     trend_run_id, started_at)
    VALUES (?, ?, ?, 1, '2026-09-28', 'America/Sao_Paulo', ?, ?, '{}', '[]',
      'COMPLETED', ?, ?)`)
    .run("research-daily-1", "run_e03_001", "project_curiosidades_ia", "a".repeat(64), "b".repeat(64), "trend-run-1", STARTED_AT);
  db.prepare(`INSERT INTO research_artifacts
    (artifact_id, schema_version, research_daily_run_id, trend_run_id, pipeline_run_id,
     project_id, project_version, content_hash, payload_json, created_at)
    VALUES (?, 'research-topic-catalog/1.0.0', ?, ?, ?, ?, 1, ?, '{}', ?)`)
    .run("research-catalog:001", "research-daily-1", "trend-run-1", "run_e03_001", "project_curiosidades_ia", "c".repeat(64), STARTED_AT);
  db.prepare(`INSERT INTO research_shortlists
    (artifact_id, schema_version, revision, pipeline_run_id, project_id, project_version,
     logical_date, research_artifact_id, trend_run_id, research_input_hash,
     research_topic_catalog_hash, trend_catalog_hash, policy_version, state,
     content_hash, payload_json, created_at)
    VALUES (?, ?, 1, ?, ?, 1, '2026-09-28', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`)
    .run(shortlist.artifactId, shortlist.schemaVersion, shortlist.pipelineRunId,
      shortlist.projectId, shortlist.researchTopicCatalogArtifactId, shortlist.trendRunId,
      shortlist.researchInputHash, shortlist.researchTopicCatalogHash, shortlist.trendCatalogHash,
      shortlist.policy.version, shortlist.contentHash, JSON.stringify(shortlist), shortlist.createdAt);
}

function researchShortlist() {
  const items = [shortlistItem(1, 80, 1), shortlistItem(2, 60, 0.5)];
  return {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION, artifactId: "research-shortlist:001",
    artifactType: "research_shortlist", revision: 1, pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, logicalDate: "2026-09-28",
    timezone: "America/Sao_Paulo", createdAt: STARTED_AT, createdBy: "SYSTEM",
    researchInputHash: "a".repeat(64), researchTopicCatalogArtifactId: "research-catalog:001",
    researchTopicCatalogHash: "c".repeat(64), trendRunId: "trend-run-1",
    trendCatalogHash: "d".repeat(64), policy: DEFAULT_RESEARCH_SHORTLIST_POLICY,
    state: "COMPLETED", orderedCandidates: items,
    decisions: items.map((item) => ({ candidateId: item.candidate.id, decision: "INCLUDED", position: item.position, reasons: item.inclusionReasons })),
    coverage: [], gaps: [], contentHash: "e".repeat(64),
    rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
  };
}

function shortlistItem(position, value, confidence) {
  const candidateId = `candidate-${position}`;
  const snapshotId = `snapshot-${position}`;
  const component = { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: [snapshotId] };
  return {
    position,
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: candidateId, identityKey: `YOUTUBE:video-${position}`,
      platform: "YOUTUBE", platformVideoId: `video-${position}`, canonicalUrl: `https://youtube.com/watch?v=video-${position}`,
      state: "ACTIVE", firstSeenAt: STARTED_AT, lastSeenAt: STARTED_AT, reappearanceCount: 1,
      durationSeconds: 45, publishedAt: STARTED_AT, region: "BR", language: "pt-BR",
      usageCondition: "REFERENCE_ONLY", snapshotIds: [snapshotId], topicClusterIds: [],
    },
    cluster: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: `cluster-${position}`, label: `cluster-${position}`,
      niche: "inteligência artificial", subtheme: "produtividade", likelyAudience: "adultos",
      narrativePattern: "explicação", localization: "Brasil", candidateIds: [candidateId],
      evidenceSnapshotIds: [snapshotId], createdBy: "OLLAMA", explanation: "evidência persistida",
    },
    score: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: `score-${position}`, candidateId,
      formulaVersion: "trend-score/1.0.0", calculatedAt: STARTED_AT, value, confidence,
      components: { velocity: component, engagement: component, recency: component, recurrence: component },
      explanation: "score persistido",
    },
    inclusionReasons: ["BASE_RANK", "DIVERSITY_ACCEPTED"],
  };
}

function seedReferenceInsight(db) {
  const insight = referenceInsight();
  db.prepare(`INSERT INTO reference_analysis_runs
    (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
     research_input_hash, project_snapshot_hash, policy_version, config_hash, state, started_at)
    VALUES (?, ?, ?, 1, '2026-09-28', 'America/Sao_Paulo', ?, ?, ?, ?, 'COMPLETED', ?)`)
    .run("reference-run-1", "run_e03_001", "project_curiosidades_ia", "a".repeat(64), "f".repeat(64), REFERENCE_ANALYSIS_POLICY_VERSION, "1".repeat(64), STARTED_AT);
  db.prepare(`INSERT INTO reference_insights
    (artifact_id, schema_version, reference_analysis_run_id, pipeline_run_id,
     project_id, project_version, content_hash, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(insight.artifactId, insight.schemaVersion, "reference-run-1", insight.pipelineRunId,
      insight.projectId, insight.contentHash, JSON.stringify(insight), insight.createdAt);
}

function referenceInsight() {
  return {
    schemaVersion: REFERENCE_INSIGHT_CONTRACT_VERSION, artifactType: "strategic_reference_analysis",
    artifactId: "reference-insight:001", revision: 1, pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1, logicalDate: "2026-09-28",
    researchInputHash: "a".repeat(64), projectSnapshotHash: "f".repeat(64),
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    analysisWindow: { start: "2026-09-27T00:00:00.000Z", end: "2026-09-28T00:00:00.000Z", timezone: "America/Sao_Paulo", maxItemsPerReference: 10 },
    createdAt: STARTED_AT, createdBy: "SYSTEM", state: "COMPLETED",
    references: [{
      referenceKey: "youtube:canal", platform: "youtube", configuredHandle: "@canal",
      purpose: "strategic_reference", usage: "strategic_reference_only", grantsUsageRights: false,
      capability: "public_videos", status: "SUCCESS", observedItems: 1,
      evidence: [{ evidenceId: "ref-evidence-1", providerContentId: "video-1", canonicalUrl: "https://youtube.com/watch?v=video-1", publishedAt: STARTED_AT, observedAt: STARTED_AT, mediaType: "video", durationBand: "31_60S" }], gaps: [],
    }],
    patterns: [], gaps: [], contentHash: "2".repeat(64),
    rights: { usageCondition: "strategic_reference_only", grantsUsageRights: false, mediaDownloaded: false, sourceTextStored: false, republicationAllowed: false },
  };
}

function request() {
  return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e03_001", projectId: "project_curiosidades_ia", projectVersion: 1, startedAt: STARTED_AT };
}

function project() {
  return {
    id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
    niche: "inteligência artificial", subniches: ["ferramentas", "produtividade"],
    audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [],
    channel: { publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
  };
}

function repositoryError(code, field) { return (caught) => caught instanceof IdeaRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const raw = new DatabaseSync(path); try { return raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { raw.close(); } }
function withService(operation) { withDatabase((path) => { const repository = new IdeaRepository(path); repository.create(project(), { createdAt: STARTED_AT }); new PipelineRunService(repository).start(request()); seedResearch(repository.db); const service = new IdeaService(repository); try { operation({ service, repository, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-idea-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
