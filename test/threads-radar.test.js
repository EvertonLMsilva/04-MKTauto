import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectThreadsKeywordCoverage, deriveThreadsQueries, normalizeThreadsVideo } from "../src/adapters/threads.js";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { TrendCatalogStore } from "../src/trend-store.js";

const AT = "2026-09-26T12:00:00.000Z";
const ELIGIBLE = { basicGranted: true, keywordSearchGranted: true, appAccessApproved: true };

test("deriva consultas Threads reproduzíveis dos clusters", () => {
  assert.deepEqual(deriveThreadsQueries([cluster("b", "Ciência prática"), cluster("a", "Jogos & cultura")], 3), [
    "Jogos cultura", "entretenimento", "subtema",
  ]);
});

test("normaliza vídeo Threads sem inventar duração ou métricas", () => {
  const value = normalizeThreadsVideo(threadVideo("18000000000000123"));
  assert.equal(value.canonicalUrl, "https://threads.net/@conta.oficial/post/ABC_123");
  assert.deepEqual(value.durationSeconds, { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_THREADS_API" });
  assert.equal(value.metrics.views.availability, "UNAVAILABLE");
  assert.throws(() => normalizeThreadsVideo({ ...threadVideo("18000000000000123"), permalink: "https://example.com/x" }), /Threads inválido/);
});

test("busca posts oficiais, lista vídeos e sanitiza token", async () => {
  await withStore(async (store) => {
    seed(store);
    const requests = [];
    const input = {
      accessToken: "threads-ultrassecreto", apiVersion: "v1.0", eligibility: ELIGIBLE,
      store, clusterRunId: "cluster-run", idempotencyKey: "threads-coverage", capturedAt: AT,
      maxQueries: 1,
      fetchImpl: async (input, options) => {
        requests.push({ url: new URL(input), options });
        return response({ data: [threadVideo("18000000000000123"), { ...threadVideo("18000000000000124"), media_type: "IMAGE" }] });
      },
    };
    const catalog = await collectThreadsKeywordCoverage(input);
    assert.deepEqual(await collectThreadsKeywordCoverage(input), catalog);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.hostname, "graph.threads.net");
    assert.equal(requests[0].url.searchParams.get("search_type"), "TOP");
    assert.equal(requests[0].url.searchParams.get("fields"), "id,media_type,permalink,timestamp,username,text");
    assert.equal(catalog.candidates.length, 1);
    assert.equal(catalog.candidates[0].platform, "THREADS");
    assert.equal(catalog.sourceRuns[0].status, "PARTIAL");
    assert.ok(catalog.sourceRuns[0].gaps.includes("DURATION_UNAVAILABLE:THREADS_KEYWORD_MEDIA"));
    assert.doesNotMatch(JSON.stringify(catalog), /ultrassecreto|Authorization/);
  });
});

test("Threads sem permissão registra bloqueio sem chamada externa", async () => {
  await withStore(async (store) => {
    seed(store);
    const catalog = await collectThreadsKeywordCoverage({
      accessToken: "token", eligibility: { ...ELIGIBLE, keywordSearchGranted: false },
      store, clusterRunId: "cluster-run", idempotencyKey: "threads-blocked", capturedAt: AT,
      fetchImpl: async () => assert.fail("não deveria chamar o provedor"),
    });
    assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
    assert.equal(catalog.sourceRuns[0].errorCode, "THREADS_KEYWORD_SEARCH_PERMISSION_REQUIRED");
  });
});

function threadVideo(id) {
  return {
    id, media_type: "VIDEO", permalink: "https://www.threads.net/@conta.oficial/post/ABC_123/",
    timestamp: "2026-09-26T10:00:00+0000", username: "conta.oficial", text: "Vídeo público",
  };
}

function cluster(id, label) {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION, id, label, niche: "entretenimento", subtheme: "subtema",
    likelyAudience: "público", narrativePattern: "padrão", localization: "localização",
    candidateIds: ["seed-candidate"], evidenceSnapshotIds: ["seed-snapshot"], createdBy: "OLLAMA", explanation: "evidência",
  };
}

function seed(store) {
  const candidate = {
    schemaVersion: RADAR_CONTRACT_VERSION, id: "seed-candidate", identityKey: "YOUTUBE:seed-video", platform: "YOUTUBE",
    platformVideoId: "seed-video", canonicalUrl: "https://youtube.com/watch?v=seed-video", state: "DISCOVERED",
    firstSeenAt: AT, lastSeenAt: AT, reappearanceCount: 1, durationSeconds: 30,
    publishedAt: "2026-09-25T10:00:00.000Z", usageCondition: "REFERENCE_ONLY", snapshotIds: [], topicClusterIds: [],
  };
  const snapshot = {
    schemaVersion: RADAR_CONTRACT_VERSION, id: "seed-snapshot", candidateId: candidate.id, capturedAt: AT,
    metrics: {
      views: { availability: "AVAILABLE", value: 10 }, likes: { availability: "AVAILABLE", value: 1 },
      comments: { availability: "AVAILABLE", value: 0 }, shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
    },
  };
  store.recordOperation({
    idempotencyKey: "seed", run: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: "cluster-run", state: "COMPLETED", createdAt: AT, updatedAt: AT,
      sourceRunIds: [], candidateIds: [candidate.id], rankingConfigVersion: "trend-ranking/1.0.0",
    }, observations: [{ candidate, snapshot }], topicClusters: [cluster("cluster-a", "Jogos & cultura")],
  });
}

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

async function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-threads-"));
  const store = new TrendCatalogStore(join(directory, "trends.sqlite"));
  try { await run(store); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}
