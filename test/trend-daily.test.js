import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import { retryClustering, runDailyTrendCatalog } from "../src/trend-daily.js";
import { exportDailyCatalog, renderHtml } from "../src/trend-export.js";
import { TrendCatalogStore, TrendStoreError } from "../src/trend-store.js";

const DATE = "2026-09-26";
const AT = "2026-09-26T12:00:00.000Z";

test("execução diária consolida fontes, ranking e artefatos sem repetir etapas no retry", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const args = { store, logicalDate: DATE, timezone: "America/Sao_Paulo", outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() };
    const first = await runDailyTrendCatalog(args);
    assert.equal(first.dailyRun.state, "COMPLETED_WITH_GAPS");
    assert.deepEqual(first.dailyRun.result.rankedCandidateIds, ["tiktok:90001", "youtube:video-1"]);
    assert.equal(first.catalog.sourceRuns.length, 4);
    assert.equal(first.catalog.candidates.length, 3);
    assert.equal(first.catalog.scores.length, 3);
    assert.deepEqual(calls, { youtube: 1, instagram: 1, threads: 1, tiktok: 1, clusters: 2 });
    for (const file of ["catalog.json", "ranking.csv", "report.html"]) assert.equal(existsSync(join(output, DATE, file)), true);
    assert.equal(existsSync(join(output, DATE, "candidates", "youtube%3Avideo-1", "candidate.json")), true);
    await runDailyTrendCatalog(args);
    assert.deepEqual(calls, { youtube: 1, instagram: 1, threads: 1, tiktok: 1, clusters: 2 });
    assert.equal(store.getCandidateHistory("youtube:video-1").snapshots.length, 1);
  });
});

test("mesma data rejeita mudança material de configuração", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    await runDailyTrendCatalog({ store, logicalDate: DATE, timezone: "UTC", outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    await assert.rejects(
      runDailyTrendCatalog({ store, logicalDate: DATE, timezone: "UTC", outputRoot: output, config: { ...fullConfig(), regions: ["BR", "US"] }, ...dependencies, clock: fixedClock() }),
      (error) => error instanceof TrendStoreError && error.code === "DAILY_CONFIG_CONFLICT",
    );
  });
});

test("fontes sem configuração não são chamadas e preservam resultado válido do YouTube", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const result = await runDailyTrendCatalog({
      store, logicalDate: DATE, timezone: "UTC", outputRoot: output,
      config: { youtube: { apiKey: "configured" }, ollama: { model: "local" }, regions: ["BR"] },
      ...dependencies, clock: fixedClock(),
    });
    assert.deepEqual(calls, { youtube: 1, instagram: 0, threads: 0, tiktok: 0, clusters: 2 });
    assert.equal(result.catalog.candidates.length, 1);
    assert.equal(result.dailyRun.state, "COMPLETED_WITH_GAPS");
    assert.deepEqual(result.catalog.sourceRuns.map(({ status }) => status), ["BLOCKED_BY_PROVIDER", "BLOCKED_BY_PROVIDER", "BLOCKED_BY_PROVIDER", "SUCCESS"]);
  });
});

test("CSV neutraliza fórmula, HTML escapa conteúdo e catálogo não expõe segredos", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters(), "=HYPERLINK(\"x\")<script>alert(1)</script>");
    await runDailyTrendCatalog({ store, logicalDate: DATE, timezone: "UTC", outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    const csv = readFileSync(join(output, DATE, "ranking.csv"), "utf8");
    const html = readFileSync(join(output, DATE, "report.html"), "utf8");
    const catalog = readFileSync(join(output, DATE, "catalog.json"), "utf8");
    assert.match(csv, /'=HYPERLINK/);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    for (const secret of ["youtube-secret", "instagram-secret", "threads-secret", "tiktok-secret"]) assert.equal(catalog.includes(secret), false);
  });
});

test("shortlist e seleção são explícitas, únicas, auditáveis e reexportáveis", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    await runDailyTrendCatalog({ store, logicalDate: DATE, timezone: "UTC", outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    store.changeCandidateState({ logicalDate: DATE, candidateId: "youtube:video-1", nextState: "SHORTLISTED", actor: "operador", changedAt: AT });
    store.changeCandidateState({ logicalDate: DATE, candidateId: "youtube:video-1", nextState: "SELECTED", actor: "operador", changedAt: AT });
    store.changeCandidateState({ logicalDate: DATE, candidateId: "tiktok:90001", nextState: "SELECTED", actor: "operador", changedAt: AT });
    assert.equal(store.getCandidateHistory("youtube:video-1").candidate.state, "SHORTLISTED");
    assert.equal(store.getCandidateHistory("tiktok:90001").candidate.state, "SELECTED");
    assert.equal(store.getCandidateStateEvents(DATE).length, 4);
    assert.throws(
      () => store.changeCandidateState({ logicalDate: DATE, candidateId: "missing", nextState: "SELECTED", actor: "operador", changedAt: AT }),
      (error) => error.code === "CANDIDATE_NOT_ELIGIBLE",
    );
    exportDailyCatalog({ store, logicalDate: DATE, outputRoot: output });
    const catalog = JSON.parse(readFileSync(join(output, DATE, "catalog.json"), "utf8"));
    assert.equal(catalog.candidates.find(({ id }) => id === "tiktok:90001").state, "SELECTED");
    assert.equal(catalog.selectionAudit.length, 4);
  });
});

test("falha de escrita não substitui catálogo anterior", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    await runDailyTrendCatalog({ store, logicalDate: DATE, timezone: "UTC", outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    writeFileSync(join(output, DATE, "sentinel.txt"), "preservar", "utf8");
    const fileSystem = {
      exists: existsSync,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      write: () => { throw new Error("DISK_FULL"); },
      rename: () => assert.fail("rename não deve ocorrer antes da escrita completa"),
      rm: (path) => rmSync(path, { recursive: true, force: true }),
    };
    assert.throws(() => exportDailyCatalog({ store, logicalDate: DATE, outputRoot: output, fileSystem }), /DISK_FULL/);
    assert.equal(readFileSync(join(output, DATE, "sentinel.txt"), "utf8"), "preservar");
  });
});

test("relatório mantém links dos candidatos quando o ranking está indisponível", () => {
  const candidate = observation({ platform: "YOUTUBE", id: "video-1", title: "Vídeo sem ranking <script>", capturedAt: AT, runId: "run" }).candidate;
  const html = renderHtml({
    dailyRun: { logicalDate: DATE, timezone: "UTC", state: "COMPLETED_WITH_GAPS", gaps: ["ANALYSIS_FAILED"] },
    sourceRuns: [],
    candidates: [candidate],
    ranking: [],
  });
  assert.match(html, /Candidatos sem ranking/);
  assert.match(html, /Vídeo sem ranking/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /https:\/\/youtube\.com\/watch\?v=video-1/);
  assert.doesNotMatch(html, /<td>1<\/td>/);
});

test("relatório exibe views e dia publicado para candidatos ranqueados e sem ranking", () => {
  const ranked = observation({ platform: "YOUTUBE", id: "video-1", title: "Ranqueado", capturedAt: AT, runId: "run" });
  const unranked = observation({ platform: "TIKTOK", id: "90001", title: "Sem ranking", capturedAt: AT, runId: "run" });
  ranked.snapshot.metrics.views = { availability: "AVAILABLE", value: 1_234_567 };
  unranked.snapshot.metrics.views = { availability: "UNAVAILABLE", reason: "NOT_RETURNED" };
  unranked.candidate.publishedAt = "2026-09-24T23:30:00.000Z";
  unranked.candidate.durationSeconds = { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_PROVIDER" };
  const html = renderHtml({
    dailyRun: { logicalDate: DATE, timezone: "UTC", state: "COMPLETED_WITH_GAPS", gaps: [] },
    sourceRuns: [],
    candidates: [ranked.candidate, unranked.candidate],
    snapshots: [ranked.snapshot, unranked.snapshot],
    ranking: [{
      position: 1,
      top5: true,
      candidate: ranked.candidate,
      score: { value: 80, confidence: 0.75 },
    }],
  });
  assert.match(html, /Visualizações/);
  assert.match(html, /Publicado em/);
  assert.match(html, /1\.234\.567/);
  assert.match(html, /indisponível/);
  assert.match(html, /25\/09\/2026/);
  assert.match(html, /24\/09\/2026/);
  assert.match(html, /duração indisponível: NOT_EXPOSED_BY_PROVIDER/);
});

test("clustering usa no máximo cinco tentativas com backoff injetável", async () => {
  let calls = 0;
  const delays = [];
  const result = await retryClustering(async () => {
    calls += 1;
    if (calls < 5) throw new SyntaxError("resposta estruturada inválida");
    return "clusters válidos";
  }, {
    maxAttempts: 5,
    baseDelayMs: 100,
    sleep: async (delay) => delays.push(delay),
  });
  assert.deepEqual(result, { value: "clusters válidos", attempts: 5 });
  assert.deepEqual(delays, [100, 200, 400, 800]);
});

test("clustering não repete erro de configuração ou HTTP 4xx", async () => {
  let calls = 0;
  await assert.rejects(retryClustering(async () => {
    calls += 1;
    throw new Error("Ollama respondeu 400");
  }, { sleep: async () => assert.fail("não deve aguardar") }), /Ollama respondeu 400/);
  assert.equal(calls, 1);
});

test("clustering registra exaustão após cinco tentativas", async () => {
  let calls = 0;
  await assert.rejects(retryClustering(async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }, { sleep: async () => {} }), (error) => error.code === "OLLAMA_RETRY_EXHAUSTED" && error.attempts === 5);
  assert.equal(calls, 5);
});

test("execução diária recupera clustering transitório e registra tentativas", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const delays = [];
    let attempts = 0;
    const clusterer = async (input) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("cluster incompleto");
        error.code = "INVALID_CLUSTER_MEMBERSHIP";
        error.retryFeedback = "Inclua os aliases ausentes: C002.";
        throw error;
      }
      if (attempts === 2) assert.equal(input.validationFeedback, "Inclua os aliases ausentes: C002.");
      if (attempts < 5) throw new SyntaxError("JSON incompleto");
      return dependencies.clusterer(input);
    };
    const result = await runDailyTrendCatalog({
      store, logicalDate: DATE, timezone: "UTC", outputRoot: output,
      config: fullConfig(), collectors: dependencies.collectors, clusterer,
      sleep: async (delay) => delays.push(delay), clock: fixedClock(),
    });
    assert.equal(result.catalog.scores.length, 3);
    assert.equal(result.dailyRun.steps.find(({ stepKey }) => stepKey === "20-seed-clustering").result.clusteringAttempts, 5);
    assert.equal(result.dailyRun.steps.find(({ stepKey }) => stepKey === "60-final-analysis").result.clusteringAttempts, 1);
    assert.deepEqual(delays, [250, 500, 1000, 2000]);
    assert.equal(attempts, 6);
  });
});

function fixtureDependencies(calls, title = "Vídeo útil") {
  const collectors = {
    youtube: async ({ store, idempotencyKey, capturedAt }) => {
      calls.youtube += 1;
      return store.recordOperation(batch({ platform: "YOUTUBE", id: "video-1", title, idempotencyKey, capturedAt, status: "SUCCESS" }));
    },
    instagram: async ({ store, idempotencyKey, capturedAt }) => {
      calls.instagram += 1;
      return store.recordOperation(batch({ platform: "INSTAGRAM", idempotencyKey, capturedAt, status: "PARTIAL", noCandidate: true }));
    },
    threads: async ({ store, idempotencyKey, capturedAt }) => {
      calls.threads += 1;
      return store.recordOperation(batch({ platform: "THREADS", id: "18000000000000123", title: "Threads público", idempotencyKey, capturedAt, status: "PARTIAL" }));
    },
    tiktok: async ({ store, idempotencyKey, capturedAt }) => {
      calls.tiktok += 1;
      return store.recordOperation(batch({ platform: "TIKTOK", id: "90001", title: "TikTok público", idempotencyKey, capturedAt, status: "SUCCESS" }));
    },
  };
  const clusterer = async ({ evidence }) => {
    calls.clusters += 1;
    return [{
      label: "Assunto público", niche: "educação", subtheme: "explicação", likelyAudience: "público brasileiro",
      narrativePattern: "explicação direta", ptBrLocalization: "aplicável ao Brasil",
      candidateIds: evidence.map(({ candidateId }) => candidateId),
      evidenceSnapshotIds: evidence.flatMap(({ snapshots }) => snapshots.map(({ id }) => id)),
      explanation: "Agrupamento baseado somente nas evidências fornecidas.",
    }];
  };
  return { collectors, clusterer };
}

function batch({ platform, id, title, idempotencyKey, capturedAt, status, noCandidate = false }) {
  const runId = `${platform.toLowerCase()}-run`;
  const sourceId = `${platform.toLowerCase()}-source`;
  const hasGap = status !== "SUCCESS";
  const observations = noCandidate ? [] : [observation({ platform, id, title, capturedAt, runId })];
  return {
    idempotencyKey,
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: runId, state: hasGap ? "COMPLETED_WITH_GAPS" : "COMPLETED",
      createdAt: capturedAt, updatedAt: capturedAt, sourceRunIds: [sourceId],
      candidateIds: observations.map(({ candidate }) => candidate.id), rankingConfigVersion: "trend-ranking/1.0.0",
    },
    sourceRuns: [{
      schemaVersion: RADAR_CONTRACT_VERSION, id: sourceId, trendRunId: runId, platform, status,
      startedAt: capturedAt, completedAt: capturedAt,
      capabilities: { discovery: platform === "YOUTUBE" ? "GLOBAL_TRENDS" : platform === "INSTAGRAM" ? "HASHTAG_SEARCH" : "PUBLIC_QUERY", metrics: ["VIEWS", "LIKES"], supportsRegions: platform !== "INSTAGRAM", limitations: hasGap ? ["DURATION_UNAVAILABLE"] : [] },
      coverage: { requestedRegions: ["BR"], coveredRegions: hasGap ? [] : ["BR"], complete: !hasGap },
      gaps: hasGap ? ["PUBLIC_MEDIA_NOT_RANKABLE"] : [],
      ...(status === "PARTIAL" ? { errorCode: "PUBLIC_MEDIA_NOT_RANKABLE" } : {}),
    }],
    observations,
  };
}

function observation({ platform, id, title, capturedAt, runId }) {
  const canonicalUrl = platform === "YOUTUBE" ? `https://youtube.com/watch?v=${id}`
    : platform === "THREADS" ? `https://www.threads.net/@public/post/${id}`
      : `https://www.tiktok.com/@public/video/${id}`;
  const candidateId = `${platform.toLowerCase()}:${id}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: candidateId,
      identityKey: canonicalTrendIdentity({ platform, platformVideoId: id, canonicalUrl }), platform, platformVideoId: id,
      canonicalUrl, state: "DISCOVERED", firstSeenAt: capturedAt, lastSeenAt: capturedAt, reappearanceCount: 1,
      durationSeconds: platform === "THREADS" ? { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_THREADS_API" } : 45,
      publishedAt: "2026-09-25T12:00:00.000Z", region: "BR", language: "pt-BR",
      usageCondition: "REFERENCE_ONLY", snapshotIds: [], topicClusterIds: [], title, author: "autor público",
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: `${platform.toLowerCase()}-snapshot:${runId}:${id}`, candidateId, capturedAt,
      metrics: {
        views: { availability: "AVAILABLE", value: platform === "YOUTUBE" ? 1000 : 500 },
        likes: { availability: "AVAILABLE", value: 100 }, comments: { availability: "AVAILABLE", value: 10 },
        shares: platform === "YOUTUBE" ? { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" } : { availability: "AVAILABLE", value: 5 },
      },
    },
    reappearanceReason: "PUBLIC_DISCOVERY",
  };
}

function fullConfig() {
  return {
    regions: ["BR"], youtube: { apiKey: "youtube-secret" }, ollama: { model: "local-model" },
    instagram: {
      accessToken: "instagram-secret", igUserId: "12345", apiVersion: "v24.0",
      eligibility: { professionalAccount: true, facebookPageLinked: true, permissionsGranted: true, appAccessApproved: true },
    },
    threads: {
      accessToken: "threads-secret", apiVersion: "v1.0", searchType: "TOP",
      eligibility: { basicGranted: true, keywordSearchGranted: true, appAccessApproved: true },
    },
    tiktok: {
      product: "RESEARCH_API", accessToken: "tiktok-secret",
      eligibility: { eligibleOrganization: true, nonCommercialResearch: true, ethicalReviewApproved: true, researchProjectApproved: true, researchScopeGranted: true, retentionControlsApproved: true },
    },
  };
}

function counters() { return { youtube: 0, instagram: 0, threads: 0, tiktok: 0, clusters: 0 }; }
function fixedClock() { return () => new Date(AT); }

async function withWorkspace(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-daily-"));
  const store = new TrendCatalogStore(join(directory, "catalog.sqlite"));
  try {
    await callback({ store, output: join(directory, "trends") });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
