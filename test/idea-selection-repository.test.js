import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IdeaSelectionRepository, IdeaSelectionRepositoryError } from "../src/idea-selection-repository.js";
import { IdeaSelectionService } from "../src/idea-selection-service.js";
import { IdeaService } from "../src/idea-service.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { IDEA_SELECTION_CONTRACT_VERSION, selectionContentHash } from "../src/domain/idea-selection-contracts.js";
import { DEFAULT_RESEARCH_SHORTLIST_POLICY, RESEARCH_SHORTLIST_CONTRACT_VERSION } from "../src/domain/research-shortlist-contracts.js";

const STARTED_AT = "2026-09-28T11:00:00.000Z";

test("seleciona ideia explícita, recupera e lista sem duplicar retry", () => {
  withService(({ service, ideas, path }) => {
    const lowerRanked = ideas.find(({ score }) => score.rank === 2);
    const value = selection(lowerRanked);
    const created = service.select(value);
    assert.deepEqual(service.select(value), created);
    assert.deepEqual(service.get(created.ideaSelectionId), created);
    assert.deepEqual(service.listByPipelineRun("run_e03_001"), [created]);
    assert.deepEqual(service.listByBatch("idea_batch_1"), [created]);
    assert.equal("latest" in service, false);
    assert.equal(created.ideaCandidateId, lowerRanked.idea.ideaCandidateId);
    assert.equal(Object.isFrozen(created), true);
    assert.equal(count(path, "idea_selections"), 1);
    assert.equal(count(path, "artifact_lineage"), 5);
    assert.equal(count(path, "cost_events"), 0);
  });
});

test("rejeita artefatos ausentes, escopo divergente e hashes inexatos", () => {
  withService(({ service, ideas, path }) => {
    const [first, second] = ideas;
    assert.throws(() => service.select(selection(first, { pipelineRunId: "run_missing_001" })), repositoryError("PIPELINE_RUN_NOT_FOUND", "pipelineRunId"));
    assert.throws(() => service.select(selection(first, { ideaCandidateId: "idea_missing_1" })), repositoryError("IDEA_CANDIDATE_NOT_FOUND", "ideaCandidateId"));
    assert.throws(() => service.select(selection(first, { ideaScoreId: "score_missing_1" })), repositoryError("IDEA_SCORE_NOT_FOUND", "ideaScoreId"));
    assert.throws(() => service.select(selection(first, { ideaScoreId: second.score.ideaScoreId, ideaScoreContentHash: second.score.contentHash })), repositoryError("IDEA_SELECTION_SCORE_SCOPE_MISMATCH", "ideaCandidateId"));
    assert.throws(() => service.select(selection(first, { ideaContentHash: "f".repeat(64) })), repositoryError("IDEA_CONTENT_HASH_MISMATCH", "ideaContentHash"));
    assert.equal(count(path, "idea_selections"), 0);
  });
});

test("retry conflitante usa código estável e falha transacional não deixa linhagem parcial", () => {
  withService(({ service, ideas, path }) => {
    const value = selection(ideas[0]);
    service.select(value);
    assert.throws(() => service.select(selection(ideas[0], { editorialRationale: "Outra justificativa pública" })), repositoryError("IDEA_SELECTION_ID_REUSED", "ideaSelectionId"));

    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER reject_selection BEFORE INSERT ON idea_selections BEGIN SELECT RAISE(ABORT, 'PRIVATE selection payload'); END;");
    raw.close();
    assert.throws(() => service.select(selection(ideas[1], {
      ideaSelectionId: "selection_rollback", decidedAt: "2026-09-28T13:10:00.000Z",
      revision: 2, supersedesIdeaSelectionId: value.ideaSelectionId,
    })), repositoryError("IDEA_SELECTION_PERSISTENCE_FAILED", "ideaSelection"));
    assert.equal(count(path, "idea_selections"), 1);
    assert.equal(count(path, "artifact_lineage"), 5);
  });
});

test("correção cria nova revisão append-only e preserva ordem determinística", () => {
  withService(({ service, ideas, path }) => {
    const first = service.select(selection(ideas[0]));
    const second = service.select(selection(ideas[1], {
      ideaSelectionId: "selection_002", revision: 2,
      supersedesIdeaSelectionId: first.ideaSelectionId,
      decidedAt: "2026-09-28T13:05:00.000Z",
      editorialRationale: "Correção editorial após revisão humana",
    }));
    assert.deepEqual(service.listByBatch("idea_batch_1"), [first, second]);
    assert.deepEqual(service.get(first.ideaSelectionId), first);
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE idea_selections SET actor_id = 'other' WHERE idea_selection_id = 'selection_001'").run(), /IMMUTABLE_IDEA_SELECTION/);
      assert.throws(() => raw.prepare("DELETE FROM idea_selections WHERE idea_selection_id = 'selection_001'").run(), /IMMUTABLE_IDEA_SELECTION/);
    } finally { raw.close(); }
  });
});

test("rejeita revisão sem predecessora imediata e dupla substituição", () => {
  withService(({ service, ideas }) => {
    const first = service.select(selection(ideas[0]));
    assert.throws(() => service.select(selection(ideas[1], {
      ideaSelectionId: "selection_003", revision: 3,
      supersedesIdeaSelectionId: first.ideaSelectionId,
    })), repositoryError("IDEA_SELECTION_REVISION_MISMATCH", "revision"));
    service.select(selection(ideas[1], {
      ideaSelectionId: "selection_002", revision: 2,
      supersedesIdeaSelectionId: first.ideaSelectionId,
    }));
    assert.throws(() => service.select(selection(ideas[0], {
      ideaSelectionId: "selection_002b", revision: 2,
      supersedesIdeaSelectionId: first.ideaSelectionId,
    })), (caught) => caught instanceof IdeaSelectionRepositoryError
      && ["IDEA_SELECTION_REVISION_CONFLICT", "IDEA_SELECTION_ALREADY_SUPERSEDED"].includes(caught.code));
  });
});

test("leitura revalida contrato e hash persistidos", () => {
  withService(({ service, ideas, path }) => {
    service.select(selection(ideas[0]));
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER idea_selections_no_update");
    const payload = JSON.parse(raw.prepare("SELECT payload_json FROM idea_selections WHERE idea_selection_id = 'selection_001'").get().payload_json);
    payload.actor.type = "SYSTEM";
    raw.prepare("UPDATE idea_selections SET payload_json = ? WHERE idea_selection_id = 'selection_001'").run(JSON.stringify(payload));
    raw.close();
    assert.throws(() => service.get("selection_001"), repositoryError("INVALID_PERSISTED_IDEA_SELECTION", "ideaSelectionId"));
  });
});

test("leitura revalida os hashes persistidos da ideia e do score", () => {
  withService(({ service, ideas, path }) => {
    service.select(selection(ideas[0]));
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER idea_candidates_no_update");
    raw.prepare("UPDATE idea_candidates SET content_hash = ? WHERE idea_candidate_id = ?")
      .run("f".repeat(64), ideas[0].idea.ideaCandidateId);
    raw.close();
    assert.throws(() => service.get("selection_001"), repositoryError("INVALID_PERSISTED_IDEA_SELECTION", "ideaSelectionId"));
  });
});

test("migração 012 é aditiva e preserva ideias existentes", () => {
  withDatabase((path) => {
    const repository = setupRepository(path);
    const ideas = new IdeaService(repository).registerBatch(submission());
    repository.close();
    const before = new DatabaseSync(path);
    before.exec("DROP TABLE ai_call_telemetry; DROP TABLE script_generation_requests; DROP TABLE scripts; DROP TABLE idea_selections; DELETE FROM schema_migrations WHERE version = 15; DELETE FROM schema_migrations WHERE version = 14; DELETE FROM schema_migrations WHERE version = 13; DELETE FROM schema_migrations WHERE version = 12; PRAGMA user_version = 11;");
    before.close();
    const migrated = new IdeaSelectionRepository(path);
    assert.equal(migrated.getIdea(ideas[0].idea.ideaCandidateId).ideaCandidateId, ideas[0].idea.ideaCandidateId);
    assert.deepEqual(migrated.listSelectionsByPipelineRun("run_e03_001"), []);
    migrated.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 15);
    raw.close();
  });
});

function selection(item, overrides = {}) {
  const value = {
    schemaVersion: IDEA_SELECTION_CONTRACT_VERSION,
    ideaSelectionId: "selection_001", pipelineRunId: item.idea.pipelineRunId,
    projectId: item.idea.projectId, projectVersion: item.idea.projectVersion,
    ideaBatchId: item.idea.ideaBatchId, ideaCandidateId: item.idea.ideaCandidateId,
    ideaScoreId: item.score.ideaScoreId, ideaContentHash: item.idea.contentHash,
    ideaScoreContentHash: item.score.contentHash, decision: "SELECTED",
    actor: { type: "HUMAN", id: "operator_001" },
    decidedAt: "2026-09-28T13:00:00.000Z", editorialRationale: "Escolha editorial explícita",
    revision: 1, supersedesIdeaSelectionId: null, contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = selectionContentHash(value);
  return value;
}

function submission() {
  return {
    ideaBatchId: "idea_batch_1", pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    researchShortlistId: "research-shortlist:001", origin: "OPERATOR",
    createdAt: "2026-09-28T12:00:00.000Z",
    proposals: [
      { ideaCandidateId: "idea_candidate_1", title: "IA para organizar a rotina", editorialAngle: "Ferramentas práticas para produtividade", evidenceCandidateIds: ["candidate-1"], referenceInsightId: null, referenceEvidenceIds: [] },
      { ideaCandidateId: "idea_candidate_2", title: "Ferramentas de IA no trabalho", editorialAngle: "Exemplos seguros para profissionais de tecnologia", evidenceCandidateIds: ["candidate-2"], referenceInsightId: null, referenceEvidenceIds: [] },
    ],
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

function request() { return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId: "run_e03_001", projectId: "project_curiosidades_ia", projectVersion: 1, startedAt: STARTED_AT }; }
function project() { return { id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1, niche: "inteligência artificial", subniches: ["ferramentas", "produtividade"], audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" }, references: [], channel: { publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } } }; }
function setupRepository(path) { const repository = new IdeaSelectionRepository(path); repository.create(project(), { createdAt: STARTED_AT }); new PipelineRunService(repository).start(request()); seedResearch(repository.db); return repository; }
function repositoryError(code, field) { return (caught) => caught instanceof IdeaSelectionRepositoryError && caught.code === code && caught.field === field; }
function count(path, table) { const raw = new DatabaseSync(path); try { return raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total; } finally { raw.close(); } }
function withService(operation) { withDatabase((path) => { const repository = setupRepository(path); const ideas = new IdeaService(repository).registerBatch(submission()); const service = new IdeaSelectionService(repository); try { operation({ service, repository, ideas, path }); } finally { if (repository.db?.isOpen) repository.close(); } }); }
function withDatabase(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-selection-")); try { operation(join(root, "catalog.sqlite")); } finally { rmSync(root, { recursive: true, force: true }); } }
