import test from "node:test";
import assert from "node:assert/strict";
import {
  ContractValidationError,
  RADAR_CONTRACT_VERSION,
  TREND_CATALOG_LAYOUT,
  canonicalTrendIdentity,
  serializePublicTrendCatalog,
  validateAiTopicProposal,
  validateSourceRun,
  validateTrendCandidate,
  validateTrendRun,
  validateTrendScore,
  validateTrendSnapshot,
} from "../src/domain/contracts.js";

const NOW = "2026-09-26T12:00:00.000Z";

function candidate(platform, platformVideoId, canonicalUrl, overrides = {}) {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `candidate-${platform.toLowerCase()}`,
    identityKey: `${platform}:${platformVideoId}`,
    platform,
    platformVideoId,
    canonicalUrl,
    state: "ACTIVE",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    reappearanceCount: 1,
    durationSeconds: 45,
    publishedAt: "2026-09-25T12:00:00.000Z",
    region: "BR",
    language: "pt-BR",
    usageCondition: "REFERENCE_ONLY",
    snapshotIds: [`snapshot-${platform.toLowerCase()}`],
    topicClusterIds: [],
    ...overrides,
  };
}

function sourceRun(platform, status = "SUCCESS") {
  const hasGap = status !== "SUCCESS";
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `source-${platform.toLowerCase()}`,
    trendRunId: "run-1",
    platform,
    status,
    startedAt: NOW,
    completedAt: NOW,
    capabilities: {
      discovery: platform === "YOUTUBE" ? "GLOBAL_TRENDS" : "HASHTAG_SEARCH",
      metrics: ["VIEWS", "LIKES", "COMMENTS"],
      supportsRegions: true,
      limitations: hasGap ? ["Cobertura limitada"] : [],
    },
    coverage: {
      requestedRegions: ["BR", "US"],
      coveredRegions: hasGap ? ["BR"] : ["BR", "US"],
      complete: !hasGap,
    },
    gaps: hasGap ? ["US_UNAVAILABLE"] : [],
    ...(status === "BLOCKED_BY_PROVIDER" ? { errorCode: "PROVIDER_ACCESS_REQUIRED" } : {}),
  };
}

test("aceita candidatos válidos das quatro plataformas e duração indisponível", () => {
  const values = [
    candidate("YOUTUBE", "yt_1", "https://www.youtube.com/watch?v=yt_1"),
    candidate("INSTAGRAM", "ig_1", "https://www.instagram.com/reel/ig_1/"),
    candidate("THREADS", "th_1", "https://www.threads.net/@autor/post/th_1", {
      durationSeconds: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_THREADS_API" },
    }),
    candidate("TIKTOK", "tt_1", "https://www.tiktok.com/@autor/video/tt_1"),
  ];
  assert.deepEqual(values.map((value) => validateTrendCandidate(value).platform), [
    "YOUTUBE",
    "INSTAGRAM",
    "THREADS",
    "TIKTOK",
  ]);
  assert.equal(validateTrendCandidate({ ...values[0], schemaVersion: "trend-contracts/1.0.0" }).platform, "YOUTUBE");
});

test("usa platform + platformVideoId e aceita URL canônica validada como fallback", () => {
  assert.equal(canonicalTrendIdentity({ platform: "YOUTUBE", platformVideoId: "abc-123" }), "YOUTUBE:abc-123");
  assert.equal(
    canonicalTrendIdentity({ platform: "INSTAGRAM", canonicalUrl: "https://instagram.com/reel/ABC/?utm_source=x#foo" }),
    "INSTAGRAM:url:https://instagram.com/reel/ABC",
  );
  assert.equal(
    canonicalTrendIdentity({ platform: "YOUTUBE", canonicalUrl: "https://youtube.com/watch?v=abc-123&utm_source=x" }),
    "YOUTUBE:url:https://youtube.com/watch?v=abc-123",
  );
  assert.throws(
    () => canonicalTrendIdentity({ platform: "TIKTOK", canonicalUrl: "https://example.com/video/1" }),
    (error) => error instanceof ContractValidationError && error.code === "INVALID_URL",
  );
});

test("rejeita ID, URL, duração, data e métrica inválidos com códigos estáveis", () => {
  const valid = candidate("YOUTUBE", "yt_1", "https://youtube.com/watch?v=yt_1");
  const cases = [
    [{ ...valid, platformVideoId: "id inválido" }, "INVALID_ID"],
    [{ ...valid, canonicalUrl: "http://youtube.com/watch?v=yt_1" }, "INVALID_URL"],
    [{ ...valid, durationSeconds: 181 }, "INVALID_DURATION"],
    [{ ...valid, publishedAt: "ontem" }, "INVALID_DATETIME"],
  ];
  for (const [value, code] of cases) {
    assert.throws(() => validateTrendCandidate(value), (error) => error.code === code);
  }
  assert.throws(
    () => validateTrendSnapshot({
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: "snapshot-1",
      candidateId: valid.id,
      capturedAt: NOW,
      metrics: {
        views: { availability: "AVAILABLE", value: -1 },
        likes: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
        comments: { availability: "AVAILABLE", value: 0 },
        shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
      },
    }),
    (error) => error.code === "INVALID_METRIC",
  );
});

test("mantém métrica ausente indisponível e zero real como disponível", () => {
  const snapshot = validateTrendSnapshot({
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "snapshot-1",
    candidateId: "candidate-youtube",
    capturedAt: NOW,
    metrics: {
      views: { availability: "AVAILABLE", value: 0 },
      likes: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
      comments: { availability: "UNAVAILABLE", reason: "NOT_RETURNED" },
      shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
    },
  });
  assert.deepEqual(snapshot.metrics.views, { availability: "AVAILABLE", value: 0 });
  assert.equal(snapshot.metrics.likes.availability, "UNAVAILABLE");
  assert.equal("value" in snapshot.metrics.likes, false);
});

test("expõe cobertura parcial ou bloqueada na run", () => {
  const youtube = sourceRun("YOUTUBE");
  const instagram = sourceRun("INSTAGRAM", "PARTIAL");
  const tiktok = sourceRun("TIKTOK", "BLOCKED_BY_PROVIDER");
  [youtube, instagram, tiktok].forEach(validateSourceRun);
  const run = validateTrendRun({
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "run-1",
    state: "COMPLETED_WITH_GAPS",
    createdAt: NOW,
    updatedAt: NOW,
    sourceRunIds: [youtube.id, instagram.id, tiktok.id],
    candidateIds: ["candidate-youtube"],
    rankingConfigVersion: "trend-ranking/1.0.0",
  }, [youtube, instagram, tiktok]);
  assert.equal(run.state, "COMPLETED_WITH_GAPS");
});

test("liga vários snapshots à mesma identidade sem duplicar candidato", () => {
  const value = candidate("YOUTUBE", "yt_1", "https://youtube.com/watch?v=yt_1", {
    snapshotIds: ["snapshot-1", "snapshot-2"],
    reappearanceCount: 2,
    lastSeenAt: "2026-09-27T12:00:00.000Z",
  });
  assert.equal(validateTrendCandidate(value).identityKey, "YOUTUBE:yt_1");
  assert.equal(new Set(value.snapshotIds).size, 2);
});

test("IA só referencia evidências conhecidas e não pode fornecer IDs, métricas ou score", () => {
  const proposal = validateAiTopicProposal({
    label: "Receitas rápidas",
    niche: "alimentação",
    subtheme: "receitas práticas",
    likelyAudience: "adultos com pouco tempo",
    narrativePattern: "passo a passo curto",
    localization: "ingredientes disponíveis no Brasil",
    candidateIds: ["candidate-youtube"],
    evidenceSnapshotIds: ["snapshot-1"],
    explanation: "O assunto reaparece nas evidências.",
  }, ["candidate-youtube"], ["snapshot-1"]);
  assert.equal(proposal.label, "Receitas rápidas");
  assert.throws(
    () => validateAiTopicProposal({ ...proposal, score: 99 }, ["candidate-youtube"], ["snapshot-1"]),
    (error) => error.code === "AI_EVIDENCE_MUTATION",
  );
  assert.throws(
    () => validateAiTopicProposal({ ...proposal, candidateIds: ["inventado"] }, ["candidate-youtube"], ["snapshot-1"]),
    (error) => error.code === "UNKNOWN_EVIDENCE",
  );
});

test("score versionado preserva componente indisponível e confiança reduzida", () => {
  const score = validateTrendScore({
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "score-1",
    candidateId: "candidate-youtube",
    formulaVersion: "trend-score/1.0.0",
    calculatedAt: NOW,
    value: 72,
    confidence: 0.75,
    components: {
      velocity: { availability: "AVAILABLE", value: 80, evidenceSnapshotIds: ["snapshot-1"] },
      engagement: { availability: "UNAVAILABLE", reason: "MISSING_METRICS", evidenceSnapshotIds: ["snapshot-1"] },
      recency: { availability: "AVAILABLE", value: 70, evidenceSnapshotIds: ["snapshot-1"] },
      recurrence: { availability: "AVAILABLE", value: 60, evidenceSnapshotIds: ["snapshot-1"] },
    },
    explanation: "Engajamento indisponível reduziu a confiança.",
  });
  assert.equal(score.components.engagement.availability, "UNAVAILABLE");
  assert.equal(score.confidence, 0.75);
});

test("serialização pública usa allowlist e publica o layout lógico sem dados internos", () => {
  const youtube = sourceRun("YOUTUBE");
  const publicCatalog = serializePublicTrendCatalog({
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: "run-1",
      state: "COMPLETED",
      createdAt: NOW,
      updatedAt: NOW,
      sourceRunIds: [youtube.id],
      candidateIds: ["candidate-youtube"],
      rankingConfigVersion: "trend-ranking/1.0.0",
      internalNotes: "não publicar",
    },
    sourceRuns: [{ ...youtube, providerRequestId: "segredo" }],
    candidates: [candidate("YOUTUBE", "yt_1", "https://youtube.com/watch?v=yt_1", { rawProviderPayload: { token: "x" } })],
    snapshots: [],
    topicClusters: [],
    scores: [],
  });
  assert.equal(JSON.stringify(publicCatalog).includes("segredo"), false);
  assert.equal(JSON.stringify(publicCatalog).includes("rawProviderPayload"), false);
  assert.equal(TREND_CATALOG_LAYOUT.root, "data/trends/<project-id>/v<project-version>/<YYYY-MM-DD>/<pipeline-run-id>");
  assert.equal(TREND_CATALOG_LAYOUT.legacyRoot, "data/trends/<YYYY-MM-DD>");
  assert.deepEqual(TREND_CATALOG_LAYOUT.files, ["catalog.json", "ranking.csv", "report.html"]);
});
