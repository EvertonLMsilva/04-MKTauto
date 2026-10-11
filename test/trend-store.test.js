import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import { TrendCatalogStore, TrendStoreError } from "../src/trend-store.js";

const DAY_ONE = "2026-09-26T12:00:00.000Z";
const DAY_TWO = "2026-09-27T12:00:00.000Z";

test("migra banco vazio e reabre o catálogo sem alteração destrutiva", () => {
  withDatabase((path) => {
    const first = new TrendCatalogStore(path);
    first.recordOperation(batch({ key: "collect:2026-09-26", at: DAY_ONE, views: 100 }));
    first.close();
    const second = new TrendCatalogStore(path);
    assert.equal(second.getRun("run-2026-09-26").candidates.length, 1);
    second.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 32);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 32);
    raw.close();
  });
});

test("migrações 007 a 024 preservam catálogo e análises existentes da versão 6", () => {
  withDatabase((path) => {
    const first = new TrendCatalogStore(path);
    first.recordOperation(batch({ key: "before-reference-migration", at: DAY_ONE, views: 100 }));
    first.close();
    const raw = new DatabaseSync(path);
    raw.exec(`
      DROP TABLE video_composition_requests;
      DROP TABLE video_renders;
      DROP TABLE composition_plan_segments;
      DROP TABLE composition_plans;
      DROP TABLE media_acquisition_requests;
      DROP TABLE media_assets;
      DROP TABLE voice_generation_requests;
      DROP TABLE voice_tracks;
      DROP TABLE ai_call_telemetry;
      DROP TABLE script_generation_requests;
      DROP TABLE scripts;
      DROP TABLE idea_selections;
      DROP TABLE idea_candidate_evidence;
      DROP TABLE idea_scores;
      DROP TABLE idea_candidates;
      DROP TABLE idea_batches;
      DROP TRIGGER cost_events_no_update;
      DROP TRIGGER cost_events_no_delete;
      DROP TABLE cost_events;
      DROP TRIGGER artifact_lineage_no_update;
      DROP TRIGGER artifact_lineage_no_delete;
      DROP TRIGGER artifact_lineage_inputs_no_update;
      DROP TRIGGER artifact_lineage_inputs_no_delete;
      DROP TABLE artifact_lineage_inputs;
      DROP TABLE artifact_lineage;
      DROP TRIGGER pipeline_runs_no_identity_update;
      DROP TRIGGER pipeline_runs_valid_state_update;
      DROP TRIGGER pipeline_runs_no_delete;
      DROP TRIGGER pipeline_run_transitions_no_update;
      DROP TRIGGER pipeline_run_transitions_no_delete;
      DROP TABLE pipeline_run_transitions;
      DROP TABLE pipeline_runs;
      DROP TABLE research_shortlists;
      DROP TABLE human_approval_decisions; DELETE FROM schema_migrations WHERE version = 25; DROP TABLE quality_control_findings; DROP TABLE quality_control_reports; DELETE FROM schema_migrations WHERE version = 24; DROP TABLE subtitle_cues; DROP TABLE subtitle_tracks; DELETE FROM schema_migrations WHERE version = 23; DELETE FROM schema_migrations WHERE version = 22;
      DELETE FROM schema_migrations WHERE version = 21;
      DELETE FROM schema_migrations WHERE version = 20;
      DELETE FROM schema_migrations WHERE version = 19;
      DELETE FROM schema_migrations WHERE version = 18;
      DELETE FROM schema_migrations WHERE version = 17;
      DELETE FROM schema_migrations WHERE version = 16;
      DELETE FROM schema_migrations WHERE version = 15;
      DELETE FROM schema_migrations WHERE version = 14;
      DELETE FROM schema_migrations WHERE version = 13;
      DELETE FROM schema_migrations WHERE version = 12;
      DELETE FROM schema_migrations WHERE version = 11;
      DELETE FROM schema_migrations WHERE version = 10;
      DELETE FROM schema_migrations WHERE version = 9;
      DELETE FROM schema_migrations WHERE version = 8;
      DELETE FROM schema_migrations WHERE version = 7;
      PRAGMA user_version = 6;
    `);
    raw.close();

    const migrated = new TrendCatalogStore(path);
    assert.equal(migrated.getRun("run-2026-09-26").candidates.length, 1);
    assert.equal(migrated.getResearchShortlistByPipeline("pipeline-inexistente"), null);
    migrated.close();
  });
});

test("deduplica por ID em dias diferentes e preserva snapshots e reaparição", () => {
  withStore((store) => {
    store.recordOperation(batch({ key: "day:1", at: DAY_ONE, views: 100, position: 10 }));
    store.recordOperation(batch({
      key: "day:2", at: DAY_TWO, views: 340, runId: "run-2026-09-27",
      candidateId: "candidate-from-second-adapter", snapshotId: "snapshot-2",
      reason: "RETURNED_TO_RANKING", previousPosition: 10, position: 4,
    }));
    const history = store.getCandidateHistory("candidate-1");
    assert.equal(history.candidate.reappearanceCount, 2);
    assert.equal(history.candidate.firstSeenAt, DAY_ONE);
    assert.equal(history.candidate.lastSeenAt, DAY_TWO);
    assert.deepEqual(history.candidate.snapshotIds, ["snapshot-1", "snapshot-2"]);
    assert.equal(history.appearances[1].reason, "RETURNED_TO_RANKING");
    assert.equal(history.appearances[1].positionChange, 6);
    assert.deepEqual(history.velocities[0].result, {
      availability: "AVAILABLE",
      metric: "views",
      valuePerHour: 10,
      elapsedHours: 24,
      evidenceSnapshotIds: ["snapshot-1", "snapshot-2"],
    });
    assert.equal(store.getRun("run-2026-09-27").candidates[0].id, "candidate-1");
  });
});

test("retry com a mesma chave não duplica entidades e rejeita conteúdo divergente", () => {
  withStore((store) => {
    const input = batch({ key: "retry-key", at: DAY_ONE, views: 100 });
    store.recordOperation(input);
    store.recordOperation(input);
    assert.equal(store.getCandidateHistory("candidate-1").snapshots.length, 1);
    const catalog = store.getRun("run-2026-09-26");
    assert.deepEqual([catalog.sourceRuns.length, catalog.candidates.length, catalog.snapshots.length], [1, 1, 1]);
    assert.throws(
      () => store.recordOperation(batch({ key: "retry-key", at: DAY_ONE, views: 101 })),
      (error) => error instanceof TrendStoreError && error.code === "IDEMPOTENCY_KEY_REUSED",
    );
  });
});

test("IDs de plataforma distintos têm precedência mesmo quando a URL coincide", () => {
  withStore((store) => {
    store.recordOperation(batch({ key: "id:1", at: DAY_ONE, views: 50, platformVideoId: "video-1" }));
    store.recordOperation(batch({
      key: "id:2", at: DAY_TWO, views: 70, runId: "run-2026-09-27",
      candidateId: "candidate-2", snapshotId: "snapshot-2", platformVideoId: "video-2",
    }));
    assert.equal(store.getCandidateHistory("candidate-1").snapshots.length, 1);
    assert.equal(store.getCandidateHistory("candidate-2").snapshots.length, 1);
  });
});

test("URL canônica equivalente deduplica fallback e identidade é promovida quando surge ID", () => {
  withStore((store) => {
    store.recordOperation(batch({
      key: "url:1", at: DAY_ONE, views: 50, platformVideoId: undefined,
      canonicalUrl: "https://www.youtube.com/watch?v=video-1&utm_source=test#fragment",
    }));
    store.recordOperation(batch({
      key: "url:2", at: DAY_TWO, views: 90, runId: "run-2026-09-27",
      candidateId: "candidate-with-id", snapshotId: "snapshot-2", platformVideoId: "video-1",
      canonicalUrl: "https://youtube.com/watch?v=video-1",
    }));
    const history = store.getCandidateHistory("candidate-1");
    assert.equal(history.candidate.identityKey, "YOUTUBE:video-1");
    assert.equal(history.candidate.platformVideoId, "video-1");
    assert.equal(history.snapshots.length, 2);
  });
});

test("métrica ausente e contador incompatível mantêm velocidade indisponível", () => {
  withStore((store) => {
    store.recordOperation(batch({ key: "metrics:1", at: DAY_ONE, views: undefined }));
    store.recordOperation(batch({
      key: "metrics:2", at: DAY_TWO, views: 20, runId: "run-2026-09-27",
      candidateId: "candidate-2", snapshotId: "snapshot-2",
    }));
    assert.equal(store.getCandidateHistory("candidate-1").velocities[0].result.reason, "MISSING_METRICS");
  });
  withStore((store) => {
    store.recordOperation(batch({ key: "counter:1", at: DAY_ONE, views: 100 }));
    store.recordOperation(batch({
      key: "counter:2", at: DAY_TWO, views: 20, runId: "run-2026-09-27",
      candidateId: "candidate-2", snapshotId: "snapshot-2",
    }));
    assert.equal(store.getCandidateHistory("candidate-1").velocities[0].result.reason, "INCOMPARABLE_COUNTER");
  });
});

test("recupera run completa com cobertura, cluster e score preservados", () => {
  withStore((store) => {
    const input = batch({ key: "complete", at: DAY_ONE, views: 100, sourceStatus: "PARTIAL" });
    input.topicClusters = [cluster()];
    input.scores = [score()];
    const catalog = store.recordOperation(input);
    assert.equal(catalog.run.state, "COMPLETED_WITH_GAPS");
    assert.equal(catalog.sourceRuns[0].status, "PARTIAL");
    assert.equal(catalog.topicClusters[0].id, "cluster-1");
    assert.equal(catalog.scores[0].components.velocity.availability, "AVAILABLE");
  });
});

test("anexa análise atomicamente e retry não duplica clusters ou scores", () => {
  withStore((store) => {
    store.recordOperation(batch({ key: "collection", at: DAY_ONE, views: 100 }));
    const analysis = { idempotencyKey: "analysis", runId: "run-2026-09-26", topicClusters: [cluster()], scores: [score()] };
    store.recordAnalysis(analysis);
    store.recordAnalysis(analysis);
    assert.deepEqual(store.getRun("run-2026-09-26").topicClusters.map(({ id }) => id), ["cluster-1"]);
    assert.deepEqual(store.getRun("run-2026-09-26").scores.map(({ id }) => id), ["score-1"]);

    const conflictingCluster = { ...cluster(), id: "cluster-rollback", label: "Outro assunto" };
    assert.throws(
      () => store.recordAnalysis({
        idempotencyKey: "analysis-conflict",
        runId: "run-2026-09-26",
        topicClusters: [conflictingCluster],
        scores: [{ ...score(), value: 51 }],
      }),
      (error) => error instanceof TrendStoreError && error.code === "ENTITY_CONFLICT",
    );
    assert.equal(store.getRun("run-2026-09-26").topicClusters.some(({ id }) => id === "cluster-rollback"), false);
  });
});

for (const status of ["PARTIAL", "BLOCKED_BY_PROVIDER", "FAILED"]) {
  test(`preserva cobertura ${status} ao recuperar a run`, () => {
    withStore((store) => {
      const catalog = store.recordOperation(batch({ key: `coverage:${status}`, at: DAY_ONE, views: 100, sourceStatus: status }));
      assert.equal(catalog.sourceRuns[0].status, status);
      assert.equal(catalog.run.state, "COMPLETED_WITH_GAPS");
      assert.equal(catalog.sourceRuns[0].coverage.complete, false);
    });
  });
}

test("snapshot gravado não pode ser substituído por outra observação", () => {
  withStore((store) => {
    store.recordOperation(batch({ key: "immutable:1", at: DAY_ONE, views: 100 }));
    const collision = batch({
      key: "immutable:2", at: DAY_ONE, views: 101, runId: "run-2026-09-27",
      candidateId: "candidate-2", snapshotId: "snapshot-other",
    });
    assert.throws(
      () => store.recordOperation(collision),
      (error) => error instanceof TrendStoreError && error.code === "IMMUTABLE_SNAPSHOT_CONFLICT",
    );
    assert.equal(store.getRun("run-2026-09-27"), null);
    assert.equal(store.getCandidateHistory("candidate-1").snapshots[0].metrics.views.value, 100);
  });
});

test("falha por chave estrangeira reverte toda a transação com código estável", () => {
  withStore((store) => {
    const input = batch({ key: "broken", at: DAY_ONE, views: 100 });
    input.sourceRuns[0] = { ...input.sourceRuns[0], trendRunId: "missing-run" };
    assert.throws(
      () => store.recordOperation(input),
      (error) => error instanceof TrendStoreError && error.code === "FOREIGN_KEY_VIOLATION",
    );
    assert.equal(store.getRun("run-2026-09-26"), null);
  });
});

test("rejeita versão futura do catálogo com código estável", () => {
  withDatabase((path) => {
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA user_version = 33");
    raw.close();
    assert.throws(
      () => new TrendCatalogStore(path),
      (error) => error instanceof TrendStoreError && error.code === "CATALOG_VERSION_UNSUPPORTED",
    );
  });
});

function batch({
  key, at, views, runId = "run-2026-09-26", candidateId = "candidate-1",
  snapshotId = "snapshot-1", platformVideoId = "video-1",
  canonicalUrl = "https://youtube.com/watch?v=video-1", reason = "FIRST_SEEN",
  previousPosition, position = 10, sourceStatus = "SUCCESS",
}) {
  const identityKey = canonicalTrendIdentity({ platform: "YOUTUBE", platformVideoId, canonicalUrl });
  const hasGap = sourceStatus !== "SUCCESS";
  const candidate = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: candidateId,
    identityKey,
    platform: "YOUTUBE",
    ...(platformVideoId === undefined ? {} : { platformVideoId }),
    canonicalUrl,
    state: "ACTIVE",
    firstSeenAt: at,
    lastSeenAt: at,
    reappearanceCount: 1,
    durationSeconds: 45,
    publishedAt: "2026-09-25T12:00:00.000Z",
    region: "BR",
    language: "pt-BR",
    usageCondition: "REFERENCE_ONLY",
    snapshotIds: [snapshotId],
    topicClusterIds: [],
  };
  const snapshot = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: snapshotId,
    candidateId,
    capturedAt: at,
    metrics: {
      views: metric(views),
      likes: metric(10),
      comments: { availability: "UNAVAILABLE", reason: "NOT_RETURNED" },
      shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
    },
  };
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `source-${runId}`,
    trendRunId: runId,
    platform: "YOUTUBE",
    status: sourceStatus,
    startedAt: at,
    completedAt: at,
    capabilities: { discovery: "GLOBAL_TRENDS", metrics: ["VIEWS", "LIKES"], supportsRegions: true, limitations: hasGap ? ["quota"] : [] },
    coverage: { requestedRegions: ["BR", "US"], coveredRegions: hasGap ? ["BR"] : ["BR", "US"], complete: !hasGap },
    gaps: hasGap ? ["US_UNAVAILABLE"] : [],
    ...(sourceStatus === "FAILED" || sourceStatus === "BLOCKED_BY_PROVIDER" ? { errorCode: "PROVIDER_ERROR" } : {}),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: hasGap ? "COMPLETED_WITH_GAPS" : "COMPLETED",
    createdAt: at,
    updatedAt: at,
    sourceRunIds: [sourceRun.id],
    candidateIds: [candidateId],
    rankingConfigVersion: "trend-ranking/1.0.0",
  };
  return {
    idempotencyKey: key,
    run,
    sourceRuns: [sourceRun],
    observations: [{ candidate, snapshot, reappearanceReason: reason, previousPosition, currentPosition: position }],
  };
}

function metric(value) {
  return value === undefined
    ? { availability: "UNAVAILABLE", reason: "NOT_RETURNED" }
    : { availability: "AVAILABLE", value };
}

function cluster() {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "cluster-1",
    label: "Assunto",
    niche: "entretenimento",
    subtheme: "vídeos curtos",
    likelyAudience: "público brasileiro",
    narrativePattern: "explicação direta",
    localization: "adaptável ao contexto brasileiro",
    candidateIds: ["candidate-1"],
    evidenceSnapshotIds: ["snapshot-1"],
    createdBy: "HUMAN",
    explanation: "Agrupamento manual baseado na observação.",
  };
}

function score() {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "score-1",
    candidateId: "candidate-1",
    formulaVersion: "trend-score/1.0.0",
    calculatedAt: DAY_ONE,
    value: 50,
    confidence: 0.75,
    components: {
      velocity: { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: ["snapshot-1"] },
      engagement: { availability: "UNAVAILABLE", reason: "MISSING_METRICS", evidenceSnapshotIds: ["snapshot-1"] },
      recency: { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: ["snapshot-1"] },
      recurrence: { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: ["snapshot-1"] },
    },
    explanation: "Score persistido, não calculado neste tópico.",
  };
}

function withStore(callback) {
  withDatabase((path) => {
    const store = new TrendCatalogStore(path);
    try {
      callback(store);
    } finally {
      store.close();
    }
  });
}

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-trends-"));
  try {
    callback(join(directory, "catalog.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
