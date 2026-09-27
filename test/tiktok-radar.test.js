import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectTikTokOfficialCoverage,
  deriveTikTokResearchQueries,
  normalizeTikTokDisplayVideo,
  normalizeTikTokResearchVideo,
} from "../src/adapters/tiktok.js";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { calculateTrendScores, rankTrendCandidates } from "../src/domain/ranking.js";
import { TrendCatalogStore } from "../src/trend-store.js";

const CAPTURED_AT = "2026-09-26T12:00:00.000Z";
const RESEARCH_ELIGIBLE = {
  eligibleOrganization: true,
  nonCommercialResearch: true,
  ethicalReviewApproved: true,
  researchProjectApproved: true,
  researchScopeGranted: true,
  retentionControlsApproved: true,
};

test("deriva consultas reproduzíveis somente de clusters persistidos e regiões explícitas", () => {
  assert.deepEqual(deriveTikTokResearchQueries([
    cluster("cluster-2", "Ciência prática", "Tecnologia doméstica"),
    cluster("cluster-1", "Jogos & cultura", "Jogos competitivos"),
  ], ["BR", "US"], 3), [
    { region: "BR", hashtag: "jogoscultura" },
    { region: "BR", hashtag: "entretenimento" },
    { region: "BR", hashtag: "jogoscompetitivos" },
  ]);
  assert.throws(() => deriveTikTokResearchQueries([
    { ...cluster("x", "válido", "válido"), label: "###" },
  ], ["BR"], 3), /termo válido/);
});

test("normaliza somente campos oficiais, mantém zero e rejeita identidade inventada", () => {
  const value = normalizeTikTokResearchVideo({
    id: "7412345678901234567",
    username: "conta.oficial",
    region_code: "BR",
    video_description: "Descrição pública",
    create_time: 1790413200,
    video_duration: 30,
    view_count: 0,
    like_count: 8,
    comment_count: 2,
  });

  assert.equal(value.platformVideoId, "7412345678901234567");
  assert.equal(value.canonicalUrl, "https://www.tiktok.com/@conta.oficial/video/7412345678901234567");
  assert.deepEqual(value.metrics.views, { availability: "AVAILABLE", value: 0 });
  assert.deepEqual(value.metrics.shares, { availability: "UNAVAILABLE", reason: "NOT_RETURNED_BY_PROVIDER" });
  assert.equal(value.durationSeconds, 30);
  assert.equal(Object.hasOwn(value, "rawProviderPayload"), false);

  assert.throws(() => normalizeTikTokResearchVideo({
    id: "inventado!", username: "conta", region_code: "BR", create_time: 1790413200, video_duration: 30,
  }), /vídeo TikTok inválido/);
  assert.throws(() => normalizeTikTokResearchVideo({
    id: "7412345678901234567", username: "../conta", region_code: "BR", create_time: 1790413200, video_duration: 30,
  }), /vídeo TikTok inválido/);
});

test("normaliza vídeo da conta autorizada pela Display API", () => {
  const value = normalizeTikTokDisplayVideo(displayVideo("7412345678901234567"));
  assert.equal(value.canonicalUrl, "https://www.tiktok.com/@conta.oficial/video/7412345678901234567");
  assert.equal(value.durationSeconds, 30);
  assert.deepEqual(value.metrics.views, { availability: "AVAILABLE", value: 100 });
});

test("Research API pagina, persiste candidatos oficiais e os torna elegíveis ao ranking determinístico", async () => {
  await withStore(async (store) => {
    seedClusters(store);
    const requests = [];
    const fetchImpl = async (input, options) => {
      requests.push({ url: new URL(input), options, body: JSON.parse(options.body) });
      const page = requests.length;
      return page === 1
        ? response({ data: { videos: [researchVideo("7412345678901234567")], cursor: 1, has_more: true, search_id: "search-1" }, error: { code: "ok" } })
        : response({ data: { videos: [researchVideo("7412345678901234568", { share_count: 0 })], cursor: 2, has_more: false, search_id: "search-1" }, error: { code: "ok" } });
    };

    const catalog = await collectTikTokOfficialCoverage({
      product: "RESEARCH_API",
      accessToken: "token-ultrassecreto",
      eligibility: RESEARCH_ELIGIBLE,
      store,
      clusterRunId: "cluster-run",
      idempotencyKey: "tiktok-research",
      capturedAt: CAPTURED_AT,
      startDate: "20260920",
      endDate: "20260926",
      regions: ["BR"],
      maxQueries: 1,
      maxPagesPerQuery: 2,
      fetchImpl,
    });

    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ url }) => url.href.startsWith("https://open.tiktokapis.com/v2/research/video/query/")));
    assert.equal(requests[0].body.query.and[0].field_name, "region_code");
    assert.equal(requests[0].body.query.and[1].field_name, "hashtag_name");
    assert.equal(requests[1].body.search_id, "search-1");
    assert.equal(catalog.sourceRuns[0].status, "SUCCESS");
    assert.equal(catalog.sourceRuns[0].capabilities.discovery, "PUBLIC_QUERY");
    assert.equal(catalog.candidates.length, 2);
    assert.ok(catalog.snapshots.some(({ metrics }) => metrics.shares.availability === "AVAILABLE" && metrics.shares.value === 0));

    const histories = new Map(catalog.candidates.map((candidate) => [candidate.id, store.getCandidateHistory(candidate.id)]));
    const scores = calculateTrendScores({ candidates: catalog.candidates, histories, clusters: [], now: CAPTURED_AT });
    const ranked = rankTrendCandidates({ candidates: catalog.candidates, scores, clusters: [] });
    assert.deepEqual(ranked.ranked.map(({ candidate }) => candidate.platform), ["TIKTOK", "TIKTOK"]);
    assert.doesNotMatch(JSON.stringify(catalog), /ultrassecreto|search-1|Authorization|rawProviderPayload/);
  });
});

test("falha isolável produz PARTIAL e retry não repete chamadas nem duplica evidência", async () => {
  await withStore(async (store) => {
    seedClusters(store);
    let calls = 0;
    const input = {
      product: "RESEARCH_API",
      accessToken: "token",
      eligibility: RESEARCH_ELIGIBLE,
      store,
      clusterRunId: "cluster-run",
      idempotencyKey: "tiktok-partial-retry",
      capturedAt: CAPTURED_AT,
      startDate: "20260920",
      endDate: "20260926",
      regions: ["BR"],
      maxQueries: 2,
      fetchImpl: async (_url, options) => {
        calls += 1;
        const hashtag = JSON.parse(options.body).query.and[1].field_values[0];
        return hashtag === "jogoscultura"
          ? response({ data: { videos: [researchVideo("7412345678901234567")], has_more: false }, error: { code: "ok" } })
          : response({ error: { code: "invalid_params", message: "payload privado" } }, 400);
      },
    };

    const first = await collectTikTokOfficialCoverage(input);
    const second = await collectTikTokOfficialCoverage(input);
    assert.equal(calls, 2);
    assert.deepEqual(second, first);
    assert.equal(first.sourceRuns[0].status, "PARTIAL");
    assert.equal(first.candidates.length, 1);
    assert.match(first.sourceRuns[0].gaps[0], /TIKTOK_REQUEST_REJECTED/);
    assert.doesNotMatch(JSON.stringify(first), /payload privado/);
  });
});

test("Research API sem elegibilidade registra BLOCKED_BY_PROVIDER antes de chamar o provedor", async () => {
  for (const [overrides, code] of [
    [{ accessToken: undefined }, "TIKTOK_RESEARCH_ACCESS_TOKEN_MISSING"],
    [{ eligibility: { ...RESEARCH_ELIGIBLE, researchProjectApproved: false } }, "TIKTOK_RESEARCH_PROJECT_NOT_APPROVED"],
    [{ eligibility: { ...RESEARCH_ELIGIBLE, nonCommercialResearch: false } }, "TIKTOK_RESEARCH_NON_COMMERCIAL_REQUIRED"],
    [{ eligibility: { ...RESEARCH_ELIGIBLE, retentionControlsApproved: false } }, "TIKTOK_RESEARCH_RETENTION_CONTROLS_REQUIRED"],
  ]) {
    await withStore(async (store) => {
      seedClusters(store);
      const catalog = await collectTikTokOfficialCoverage({
        product: "RESEARCH_API",
        accessToken: "token",
        eligibility: RESEARCH_ELIGIBLE,
        store,
        clusterRunId: "cluster-run",
        idempotencyKey: `blocked-${code}`,
        capturedAt: CAPTURED_AT,
        startDate: "20260920",
        endDate: "20260926",
        regions: ["BR"],
        fetchImpl: async () => assert.fail("fetch não deveria ser chamado"),
        ...overrides,
      });
      assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
      assert.equal(catalog.sourceRuns[0].errorCode, code);
      assert.equal(catalog.candidates.length, 0);
    });
  }
});

test("Display API lista vídeos autorizados sem colocá-los no ranking público", async () => {
  await withStore(async (store) => {
    const catalog = await collectTikTokOfficialCoverage({
      product: "DISPLAY_API",
      accessToken: "display-ultrassecreto",
      displayAccess: { accountAuthorized: true, appApproved: true, videoListScopeGranted: true },
      authorizedAccountContext: "account:configured",
      store,
      idempotencyKey: "tiktok-display-only",
      capturedAt: CAPTURED_AT,
      fetchImpl: async (input, options) => {
        assert.equal(new URL(input).pathname, "/v2/video/list/");
        assert.equal(JSON.parse(options.body).max_count, 20);
        return response({ data: { videos: [displayVideo("7412345678901234567")], has_more: false }, error: { code: "ok" } });
      },
    });
    assert.equal(catalog.sourceRuns[0].status, "PARTIAL");
    assert.equal(catalog.sourceRuns[0].capabilities.discovery, "AUTHORIZED_ONLY");
    assert.equal(catalog.sourceRuns[0].errorCode, "TIKTOK_AUTHORIZED_CONTENT_NOT_PUBLIC_TREND");
    assert.equal(catalog.candidates.length, 1);
    assert.equal(catalog.candidates[0].rankingExclusionReason, "AUTHORIZED_ACCOUNT_CONTENT_NOT_PUBLIC_TREND");
    const histories = new Map(catalog.candidates.map((candidate) => [candidate.id, store.getCandidateHistory(candidate.id)]));
    const scores = calculateTrendScores({ candidates: catalog.candidates, histories, clusters: [], now: CAPTURED_AT });
    assert.equal(rankTrendCandidates({ candidates: catalog.candidates, scores, clusters: [] }).ranked.length, 0);
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("AUTHORIZED_ACCOUNT_CONTEXT:account:configured"));
    assert.doesNotMatch(JSON.stringify(catalog), /ultrassecreto|Authorization/);
  });
});

test("autenticação, scope e quota do provedor geram códigos sanitizados", async () => {
  for (const [status, providerCode, expected] of [
    [401, "access_token_invalid", "TIKTOK_AUTHENTICATION_FAILED"],
    [401, "scope_not_authorized", "TIKTOK_RESEARCH_SCOPE_OR_APPROVAL_REQUIRED"],
    [429, "rate_limit_exceeded", "TIKTOK_RATE_OR_QUOTA_LIMITED"],
  ]) {
    await withStore(async (store) => {
      seedClusters(store);
      const catalog = await collectTikTokOfficialCoverage({
        product: "RESEARCH_API", accessToken: "segredo", eligibility: RESEARCH_ELIGIBLE,
        store, clusterRunId: "cluster-run", idempotencyKey: `provider-${providerCode}`,
        capturedAt: CAPTURED_AT, startDate: "20260920", endDate: "20260926", regions: ["BR"],
        fetchImpl: async () => response({ error: { code: providerCode, message: "segredo interno", log_id: "log-secreto" } }, status),
      });
      assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
      assert.equal(catalog.sourceRuns[0].errorCode, expected);
      assert.doesNotMatch(JSON.stringify(catalog), /segredo interno|log-secreto|segredo/);
    });
  }
});

function researchVideo(id, overrides = {}) {
  return {
    id,
    username: "conta.oficial",
    region_code: "BR",
    video_description: `Vídeo ${id}`,
    create_time: 1790413200,
    video_duration: 30,
    view_count: 100,
    like_count: 8,
    comment_count: 2,
    ...overrides,
  };
}

function displayVideo(id, overrides = {}) {
  return {
    id,
    title: `Vídeo ${id}`,
    create_time: 1790413200,
    duration: 30,
    share_url: `https://www.tiktok.com/@conta.oficial/video/${id}`,
    view_count: 100,
    like_count: 8,
    comment_count: 2,
    share_count: 1,
    ...overrides,
  };
}

function seedClusters(store) {
  const observations = [1, 2].map(seedObservation);
  store.recordOperation({
    idempotencyKey: "seed-clusters",
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: "cluster-run",
      state: "COMPLETED",
      createdAt: CAPTURED_AT,
      updatedAt: CAPTURED_AT,
      sourceRunIds: [],
      candidateIds: observations.map(({ candidate }) => candidate.id),
      rankingConfigVersion: "trend-ranking/1.0.0",
    },
    observations,
    topicClusters: [
      cluster("cluster-1", "Jogos & cultura", "Jogos competitivos"),
      cluster("cluster-2", "Ciência prática", "Tecnologia doméstica"),
    ],
  });
}

function cluster(id, label, subtheme) {
  const suffix = id.endsWith("1") ? 1 : 2;
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id,
    label,
    niche: "entretenimento",
    subtheme,
    likelyAudience: "operadores brasileiros",
    narrativePattern: "explicação curta",
    ptBrLocalization: "vocabulário brasileiro",
    candidateIds: [`seed-candidate-${suffix}`],
    evidenceSnapshotIds: [`seed-snapshot-${suffix}`],
    createdBy: "OLLAMA",
    explanation: "cluster persistido e validado em R02D",
  };
}

function seedObservation(index) {
  const candidateId = `seed-candidate-${index}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: candidateId,
      identityKey: `YOUTUBE:seed-${index}`,
      platform: "YOUTUBE",
      platformVideoId: `seed-${index}`,
      canonicalUrl: `https://youtube.com/watch?v=seed-${index}`,
      state: "DISCOVERED",
      firstSeenAt: CAPTURED_AT,
      lastSeenAt: CAPTURED_AT,
      reappearanceCount: 1,
      durationSeconds: 30,
      publishedAt: "2026-09-25T10:00:00.000Z",
      region: "BR",
      usageCondition: "REFERENCE_ONLY",
      snapshotIds: [],
      topicClusterIds: [],
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: `seed-snapshot-${index}`,
      candidateId,
      capturedAt: CAPTURED_AT,
      metrics: {
        views: { availability: "AVAILABLE", value: 10 },
        likes: { availability: "AVAILABLE", value: 1 },
        comments: { availability: "AVAILABLE", value: 0 },
        shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" },
      },
    },
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-tiktok-"));
  const store = new TrendCatalogStore(join(directory, "trends.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
