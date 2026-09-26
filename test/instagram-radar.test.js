import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectInstagramHashtagCoverage,
  deriveInstagramHashtags,
  normalizeInstagramHashtagMedia,
} from "../src/adapters/instagram.js";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import { TrendCatalogStore } from "../src/trend-store.js";

const CAPTURED_AT = "2026-09-26T12:00:00.000Z";
const ELIGIBLE = {
  professionalAccount: true,
  facebookPageLinked: true,
  permissionsGranted: true,
  appAccessApproved: true,
};

test("deriva hashtags determinísticas somente de clusters persistidos", () => {
  assert.deepEqual(deriveInstagramHashtags([
    cluster("cluster-2", "Ciência prática", "Tecnologia doméstica"),
    cluster("cluster-1", "Jogos & cultura", "Jogos competitivos"),
  ], 4), ["jogoscultura", "entretenimento", "jogoscompetitivos", "cienciapratica"]);
  assert.throws(() => deriveInstagramHashtags([{ ...cluster("x", "válido", "válido"), label: "###" }], 3), /hashtag válida/);
});

test("normaliza somente campos oficiais e preserva métricas ausentes", () => {
  const result = normalizeInstagramHashtagMedia({
    id: "18000000000000123",
    media_type: "VIDEO",
    media_product_type: "REELS",
    permalink: "https://www.instagram.com/reel/ABC_123/",
    timestamp: "2026-09-26T10:00:00+0000",
    username: "conta_publica",
    caption: "Legenda pública",
    like_count: 0,
  });

  assert.equal(result.platformVideoId, "18000000000000123");
  assert.equal(result.canonicalUrl, "https://instagram.com/reel/ABC_123");
  assert.deepEqual(result.metrics.likes, { availability: "AVAILABLE", value: 0 });
  assert.deepEqual(result.metrics.comments, { availability: "UNAVAILABLE", reason: "NOT_RETURNED_BY_PROVIDER" });
  assert.deepEqual(result.metrics.views, { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_INSTAGRAM_HASHTAG_API" });
  assert.deepEqual(result.durationSeconds, { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_INSTAGRAM_HASHTAG_API" });
  assert.equal(Object.hasOwn(result, "mediaUrl"), false);

  assert.throws(() => normalizeInstagramHashtagMedia({
    id: "inventado!", media_type: "VIDEO", permalink: "https://example.com/reel/x/", timestamp: CAPTURED_AT,
  }), /mídia Instagram inválida/);
});

test("consulta hashtags derivadas, limita paginação e registra cobertura parcial sem inventar duração", async () => {
  await withStore(async (store) => {
    seedClusters(store);
    const urls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      urls.push(url);
      if (url.pathname === "/v24.0/ig_hashtag_search") {
        return response({ data: [{ id: "17890000000000123" }] });
      }
      return response({
        data: [{
          id: "18000000000000123", media_type: "VIDEO", media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/ABC_123/", timestamp: "2026-09-26T10:00:00+0000",
          username: "conta_publica", like_count: "7", comments_count: "2",
        }],
        paging: { cursors: { after: "nao-seguir-alem-do-limite" } },
      });
    };

    const catalog = await collectInstagramHashtagCoverage({
      accessToken: "token-secreto",
      igUserId: "17841400000000123",
      apiVersion: "v24.0",
      eligibility: ELIGIBLE,
      store,
      clusterRunId: "cluster-run",
      idempotencyKey: "instagram-coverage",
      capturedAt: CAPTURED_AT,
      maxHashtags: 2,
      maxPagesPerHashtag: 1,
      fetchImpl,
    });

    assert.equal(urls.length, 4);
    assert.ok(urls.every((url) => url.hostname === "graph.facebook.com"));
    assert.ok(urls.filter((url) => url.pathname.endsWith("/recent_media"))
      .every((url) => url.searchParams.get("fields") === "id,media_type,media_product_type,permalink,timestamp,username,caption,like_count,comments_count"));
    assert.equal(catalog.candidates.length, 0);
    assert.equal(catalog.sourceRuns[0].status, "PARTIAL");
    assert.equal(catalog.sourceRuns[0].errorCode, "INSTAGRAM_PUBLIC_MEDIA_NOT_RANKABLE");
    assert.ok(catalog.sourceRuns[0].gaps.includes("DURATION_UNAVAILABLE:INSTAGRAM_HASHTAG_MEDIA"));
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("PUBLIC_MEDIA_NORMALIZED:2"));
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("UNRANKABLE_WITHOUT_DURATION:2"));
    assert.doesNotMatch(JSON.stringify(catalog), /token-secreto|paging|media_url/);
  });
});

test("isola falha por hashtag e retry não repete chamadas", async () => {
  await withStore(async (store) => {
    seedClusters(store);
    let calls = 0;
    const fetchImpl = async (input) => {
      calls += 1;
      const url = new URL(input);
      if (url.pathname === "/v24.0/ig_hashtag_search") {
        const tag = url.searchParams.get("q");
        return tag === "jogoscultura"
          ? response({ data: [{ id: "17890000000000123" }] })
          : response({ error: { message: "não persistir payload", code: 2 } }, 400);
      }
      return response({ data: [] });
    };
    const input = {
      accessToken: "token-secreto", igUserId: "17841400000000123", apiVersion: "v24.0",
      eligibility: ELIGIBLE, store, clusterRunId: "cluster-run", idempotencyKey: "retry-instagram",
      capturedAt: CAPTURED_AT, maxHashtags: 2, fetchImpl,
    };

    const first = await collectInstagramHashtagCoverage(input);
    const second = await collectInstagramHashtagCoverage(input);

    assert.equal(calls, 3);
    assert.deepEqual(second, first);
    assert.equal(first.sourceRuns[0].status, "PARTIAL");
    assert.ok(first.sourceRuns[0].gaps.some((gap) => gap.includes("INSTAGRAM_REQUEST_REJECTED")));
    assert.doesNotMatch(JSON.stringify(first), /token-secreto|não persistir/);
  });
});

test("ausência de credencial ou elegibilidade gera bloqueio acionável sem chamada externa", async () => {
  for (const [overrides, expectedCode] of [
    [{ accessToken: undefined }, "INSTAGRAM_ACCESS_TOKEN_MISSING"],
    [{ eligibility: { ...ELIGIBLE, appAccessApproved: false } }, "INSTAGRAM_APP_ACCESS_NOT_APPROVED"],
  ]) {
    await withStore(async (store) => {
      seedClusters(store);
      const catalog = await collectInstagramHashtagCoverage({
        accessToken: "token", igUserId: "17841400000000123", apiVersion: "v24.0",
        eligibility: ELIGIBLE, store, clusterRunId: "cluster-run",
        idempotencyKey: `blocked-${expectedCode}`, capturedAt: CAPTURED_AT,
        fetchImpl: async () => assert.fail("fetch não deveria ser chamado"),
        ...overrides,
      });
      assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
      assert.equal(catalog.sourceRuns[0].errorCode, expectedCode);
      assert.equal(catalog.run.state, "COMPLETED_WITH_GAPS");
      assert.equal(store.getRun("cluster-run").candidates.length, 2);
    });
  }
});

test("erro de autenticação do provedor é sanitizado e bloqueia hashtags restantes", async () => {
  await withStore(async (store) => {
    seedClusters(store);
    let calls = 0;
    const catalog = await collectInstagramHashtagCoverage({
      accessToken: "token-ultrassecreto", igUserId: "17841400000000123", apiVersion: "v24.0",
      eligibility: ELIGIBLE, store, clusterRunId: "cluster-run", idempotencyKey: "oauth-block",
      capturedAt: CAPTURED_AT, maxHashtags: 3,
      fetchImpl: async () => {
        calls += 1;
        return response({ error: { type: "OAuthException", message: "token-ultrassecreto" } }, 401);
      },
    });
    assert.equal(calls, 1);
    assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
    assert.equal(catalog.sourceRuns[0].errorCode, "INSTAGRAM_AUTHENTICATION_FAILED");
    assert.doesNotMatch(JSON.stringify(catalog), /ultrassecreto|OAuthException/);
  });
});

test("classifica permissão/revisão e quota com códigos estáveis", async () => {
  for (const [status, providerCode, expectedCode] of [
    [403, 10, "INSTAGRAM_PERMISSION_OR_REVIEW_REQUIRED"],
    [429, 4, "INSTAGRAM_RATE_OR_QUOTA_LIMITED"],
  ]) {
    await withStore(async (store) => {
      seedClusters(store);
      const catalog = await collectInstagramHashtagCoverage({
        accessToken: "token", igUserId: "17841400000000123", apiVersion: "v24.0",
        eligibility: ELIGIBLE, store, clusterRunId: "cluster-run",
        idempotencyKey: `provider-block-${providerCode}`, capturedAt: CAPTURED_AT,
        fetchImpl: async () => response({ error: { code: providerCode, message: "detalhe privado" } }, status),
      });
      assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
      assert.equal(catalog.sourceRuns[0].errorCode, expectedCode);
      assert.doesNotMatch(JSON.stringify(catalog), /detalhe privado/);
    });
  }
});

function seedClusters(store) {
  const clusters = [
    cluster("cluster-1", "Jogos & cultura", "Jogos competitivos"),
    cluster("cluster-2", "Ciência prática", "Tecnologia doméstica"),
  ];
  const observations = [1, 2].map(seedObservation);
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: "cluster-run",
    state: "COMPLETED",
    createdAt: CAPTURED_AT,
    updatedAt: CAPTURED_AT,
    sourceRunIds: [],
    candidateIds: observations.map(({ candidate }) => candidate.id),
    rankingConfigVersion: "trend-ranking/1.0.0",
  };
  store.recordOperation({ idempotencyKey: "seed-clusters", run, observations, topicClusters: clusters });
}

function cluster(id, label, subtheme) {
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id,
    label,
    niche: "entretenimento",
    subtheme,
    likelyAudience: "operadores brasileiros",
    narrativePattern: "explicação curta",
    ptBrLocalization: "vocabulário brasileiro",
    candidateIds: [`seed-candidate-${id.endsWith("1") ? 1 : 2}`],
    evidenceSnapshotIds: [`seed-snapshot-${id.endsWith("1") ? 1 : 2}`],
    createdBy: "OLLAMA",
    explanation: "cluster persistido e validado em R02D",
  };
}

function seedObservation(index) {
  const platformVideoId = `seed-video-${index}`;
  const canonicalUrl = `https://www.youtube.com/watch?v=${platformVideoId}`;
  const candidate = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `seed-candidate-${index}`,
    identityKey: canonicalTrendIdentity({ platform: "YOUTUBE", platformVideoId, canonicalUrl }),
    platform: "YOUTUBE",
    platformVideoId,
    canonicalUrl,
    state: "ACTIVE",
    firstSeenAt: CAPTURED_AT,
    lastSeenAt: CAPTURED_AT,
    reappearanceCount: 1,
    durationSeconds: 60,
    publishedAt: "2026-09-25T12:00:00.000Z",
    region: "BR",
    language: "pt-BR",
    usageCondition: "REFERENCE_ONLY",
    snapshotIds: [],
    topicClusterIds: [],
    title: `Vídeo ${index}`,
  };
  const snapshot = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: `seed-snapshot-${index}`,
    candidateId: candidate.id,
    capturedAt: CAPTURED_AT,
    metrics: {
      views: { availability: "AVAILABLE", value: 100 + index },
      likes: { availability: "AVAILABLE", value: 10 },
      comments: { availability: "AVAILABLE", value: 1 },
      shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
    },
  };
  return { candidate, snapshot, reappearanceReason: "MOST_POPULAR_CHART" };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-instagram-"));
  const store = new TrendCatalogStore(join(directory, "trends.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
