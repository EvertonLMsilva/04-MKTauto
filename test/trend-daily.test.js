import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import { runDailyTrendCatalog } from "../src/trend-daily.js";
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
    assert.equal(first.catalog.sourceRuns.length, 3);
    assert.equal(first.catalog.candidates.length, 2);
    assert.equal(first.catalog.scores.length, 2);
    assert.deepEqual(calls, { youtube: 1, instagram: 1, tiktok: 1, clusters: 2 });
    for (const file of ["catalog.json", "ranking.csv", "report.html"]) assert.equal(existsSync(join(output, DATE, file)), true);
    assert.equal(existsSync(join(output, DATE, "candidates", "youtube%3Avideo-1", "candidate.json")), true);
    await runDailyTrendCatalog(args);
    assert.deepEqual(calls, { youtube: 1, instagram: 1, tiktok: 1, clusters: 2 });
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
    assert.deepEqual(calls, { youtube: 1, instagram: 0, tiktok: 0, clusters: 2 });
    assert.equal(result.catalog.candidates.length, 1);
    assert.equal(result.dailyRun.state, "COMPLETED_WITH_GAPS");
    assert.deepEqual(result.catalog.sourceRuns.map(({ status }) => status), ["BLOCKED_BY_PROVIDER", "BLOCKED_BY_PROVIDER", "SUCCESS"]);
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
    for (const secret of ["youtube-secret", "instagram-secret", "tiktok-secret"]) assert.equal(catalog.includes(secret), false);
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
  const canonicalUrl = platform === "YOUTUBE" ? `https://youtube.com/watch?v=${id}` : `https://www.tiktok.com/@public/video/${id}`;
  const candidateId = `${platform.toLowerCase()}:${id}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: candidateId,
      identityKey: canonicalTrendIdentity({ platform, platformVideoId: id, canonicalUrl }), platform, platformVideoId: id,
      canonicalUrl, state: "DISCOVERED", firstSeenAt: capturedAt, lastSeenAt: capturedAt, reappearanceCount: 1,
      durationSeconds: 45, publishedAt: "2026-09-25T12:00:00.000Z", region: "BR", language: "pt-BR",
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
    tiktok: {
      product: "RESEARCH_API", accessToken: "tiktok-secret",
      eligibility: { eligibleOrganization: true, nonCommercialResearch: true, ethicalReviewApproved: true, researchProjectApproved: true, researchScopeGranted: true, retentionControlsApproved: true },
    },
  };
}

function counters() { return { youtube: 0, instagram: 0, tiktok: 0, clusters: 0 }; }
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
