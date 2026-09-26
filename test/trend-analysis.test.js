import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import {
  calculateTrendScores,
  DEFAULT_TREND_RANKING_CONFIG,
  rankTrendCandidates,
} from "../src/domain/ranking.js";
import { analyzeTrendRun } from "../src/trend-analysis.js";
import { TrendCatalogStore } from "../src/trend-store.js";

const DAY_ONE = "2026-09-25T12:00:00.000Z";
const DAY_TWO = "2026-09-26T12:00:00.000Z";

test("agrupa evidências persistidas, calcula ranking reproduzível e persiste retry sem chamar IA", async () => {
  await withStore(async (store) => {
    store.recordOperation(collection("run-1", "collect-1", DAY_ONE, 20, 100));
    store.recordOperation(collection("run-2", "collect-2", DAY_TWO, 20, 340));
    let calls = 0;
    const clusterer = async ({ evidence }) => {
      calls += 1;
      assert.equal(evidence.length, 20);
      assert.equal(Object.hasOwn(evidence[0], "canonicalUrl"), false);
      return [proposal("tecnologia prática", evidence.slice(0, 10)), proposal("entretenimento global", evidence.slice(10))];
    };
    const input = {
      store,
      runId: "run-2",
      idempotencyKey: "analysis-2",
      model: "modelo-teste",
      now: DAY_TWO,
      clusterer,
    };
    const first = await analyzeTrendRun(input);
    const second = await analyzeTrendRun(input);
    assert.equal(calls, 1);
    assert.equal(first.ranked.length, 20);
    assert.equal(first.top.length, 5);
    assert.ok(Math.max(...Object.values(Object.groupBy(first.top, ({ topicId }) => topicId)).map(({ length }) => length)) <= 4);
    assert.deepEqual(first.ranked.map(({ candidate }) => candidate.id), second.ranked.map(({ candidate }) => candidate.id));
    assert.ok(first.gaps.includes("DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE"));
    assert.equal(first.catalog.topicClusters.length, 2);
    assert.equal(first.catalog.scores.length, 20);
    assert.equal(first.catalog.scores[0].components.velocity.availability, "AVAILABLE");
    assert.ok(first.catalog.scores.every(({ explanation }) => explanation.includes("snapshot-run-1-")));
  });
});

test("desempata de forma estável por publicação e ID", () => {
  const candidates = [makeCandidate(2, DAY_TWO), makeCandidate(1, DAY_TWO)];
  const scores = candidates.map(({ id }) => ({ candidateId: id, value: 50, confidence: 0.5 }));
  const result = rankTrendCandidates({ candidates, scores, clusters: [] });
  assert.deepEqual(result.ranked.map(({ candidate }) => candidate.id), ["candidate-1", "candidate-2"]);
});

test("rejeita campos e evidências inventadas pela IA antes de persistir", async () => {
  await withStore(async (store) => {
    store.recordOperation(collection("run-1", "collect-1", DAY_ONE, 1, 100));
    const invalidClusterer = async ({ evidence }) => [{ ...proposal("assunto", evidence), score: 99 }];
    await assert.rejects(
      () => analyzeTrendRun({
        store, runId: "run-1", idempotencyKey: "invalid-analysis", model: "teste",
        now: DAY_ONE, clusterer: invalidClusterer,
      }),
      (error) => error.code === "AI_EVIDENCE_MUTATION",
    );
    assert.equal(store.getRun("run-1").scores.length, 0);
    assert.equal(store.getRun("run-1").topicClusters.length, 0);
  });
});

test("mantém regressão, histórico insuficiente e denominador zero como UNAVAILABLE", () => {
  const candidate = makeCandidate(1, DAY_TWO);
  const snapshots = [makeSnapshot(1, "old", DAY_ONE, 100, 0), makeSnapshot(1, "new", DAY_TWO, 0, 0)];
  const [score] = calculateTrendScores({
    candidates: [candidate],
    histories: new Map([[candidate.id, { snapshots }]]),
    clusters: [],
    now: DAY_TWO,
  });
  assert.deepEqual(score.components.velocity, {
    availability: "UNAVAILABLE",
    reason: "INCOMPARABLE_COUNTER",
    evidenceSnapshotIds: ["snapshot-old-1", "snapshot-new-1"],
  });
  assert.equal(score.components.engagement.reason, "MISSING_VALID_DENOMINATOR");
  assert.equal(score.components.recurrence.reason, "NO_TOPIC_CLUSTER");
  assert.equal(score.confidence, DEFAULT_TREND_RANKING_CONFIG.componentWeights.recency);
});

function collection(runId, key, at, count, baseViews) {
  const observations = Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const candidate = makeCandidate(position, at);
    const snapshot = makeSnapshot(position, runId, at, baseViews + position, 10);
    return { candidate, snapshot, reappearanceReason: runId === "run-1" ? "FIRST_SEEN" : "RETURNED_TO_RANKING", currentPosition: position };
  });
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `source-${runId}`,
    trendRunId: runId,
    platform: "YOUTUBE",
    status: "SUCCESS",
    startedAt: at,
    completedAt: at,
    capabilities: { discovery: "GLOBAL_TRENDS", metrics: ["VIEWS", "LIKES", "COMMENTS"], supportsRegions: true, limitations: [] },
    coverage: { requestedRegions: ["BR", "US"], coveredRegions: ["BR", "US"], complete: true },
    gaps: [],
  };
  return {
    idempotencyKey: key,
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: runId,
      state: "COMPLETED",
      createdAt: at,
      updatedAt: at,
      sourceRunIds: [sourceRun.id],
      candidateIds: observations.map(({ candidate }) => candidate.id),
      rankingConfigVersion: "trend-ranking/1.0.0",
    },
    sourceRuns: [sourceRun],
    observations,
  };
}

function makeCandidate(position, at) {
  const id = `video-${position}`;
  const canonicalUrl = `https://www.youtube.com/watch?v=${id}`;
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `candidate-${position}`,
    identityKey: canonicalTrendIdentity({ platform: "YOUTUBE", platformVideoId: id, canonicalUrl }),
    platform: "YOUTUBE",
    platformVideoId: id,
    canonicalUrl,
    state: "ACTIVE",
    firstSeenAt: at,
    lastSeenAt: at,
    reappearanceCount: 1,
    durationSeconds: 60,
    publishedAt: DAY_ONE,
    region: position % 2 === 0 ? "BR" : "US",
    language: "pt-BR",
    usageCondition: "REFERENCE_ONLY",
    snapshotIds: [],
    topicClusterIds: [],
    author: `Canal ${position}`,
    title: `Título público ${position}`,
    category: position <= 10 ? "ciência e tecnologia" : "entretenimento",
  };
}

function makeSnapshot(position, suffix, at, views, likes) {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `snapshot-${suffix}-${position}`,
    candidateId: `candidate-${position}`,
    capturedAt: at,
    metrics: {
      views: { availability: "AVAILABLE", value: views },
      likes: { availability: "AVAILABLE", value: likes },
      comments: { availability: "AVAILABLE", value: 0 },
      shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
    },
  };
}

function proposal(label, evidence) {
  return {
    label,
    niche: label.includes("tecnologia") ? "tecnologia" : "entretenimento",
    subtheme: `${label} em vídeos curtos`,
    likelyAudience: "operadores brasileiros de perfis temáticos",
    narrativePattern: "explicação curta com contexto",
    ptBrLocalization: "contextualizar exemplos e vocabulário para o Brasil",
    candidateIds: evidence.map(({ candidateId }) => candidateId),
    evidenceSnapshotIds: evidence.flatMap(({ snapshots }) => snapshots.slice(-1).map(({ id }) => id)),
    explanation: `Agrupamento sustentado por ${evidence.length} vídeos observados.`,
  };
}

async function withStore(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-analysis-"));
  const store = new TrendCatalogStore(join(directory, "catalog.sqlite"));
  try {
    await callback(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
