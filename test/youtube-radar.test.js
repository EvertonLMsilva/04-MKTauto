import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPopularYouTubeTrends,
  parseYouTubeDuration,
} from "../src/adapters/youtube.js";
import { DEFAULT_TREND_REGIONS } from "../src/domain/ranking.js";
import { TrendCatalogStore } from "../src/trend-store.js";

const CAPTURED_AT = "2026-09-26T12:00:00.000Z";

test("interpreta duração ISO 8601 e preserva os limites inclusivos", () => {
  assert.equal(parseYouTubeDuration("PT15S"), 15);
  assert.equal(parseYouTubeDuration("PT3M"), 180);
  assert.equal(parseYouTubeDuration("PT1H2M3.5S"), 3723.5);
  assert.equal(parseYouTubeDuration("inválida"), null);
});

test("consulta todas as regiões com parâmetros oficiais e filtra 15–180 segundos", async () => {
  await withStore(async (store) => {
    const urls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      urls.push(url);
      const region = url.searchParams.get("regionCode");
      return response({ items: [
        video(`${region}-14`, "PT14S"),
        video(`${region}-15`, "PT15S"),
        video(`${region}-180`, "PT3M"),
        video(`${region}-181`, "PT3M1S"),
      ] });
    };

    const catalog = await collectPopularYouTubeTrends({
      apiKey: "segredo",
      store,
      idempotencyKey: "youtube-2026-09-26",
      capturedAt: CAPTURED_AT,
      fetchImpl,
    });

    assert.deepEqual(urls.map((url) => url.searchParams.get("regionCode")), DEFAULT_TREND_REGIONS);
    for (const url of urls) {
      assert.equal(url.pathname, "/youtube/v3/videos");
      assert.equal(url.searchParams.get("part"), "snippet,contentDetails,statistics");
      assert.equal(url.searchParams.get("chart"), "mostPopular");
      assert.equal(url.searchParams.get("maxResults"), "50");
      assert.equal(url.searchParams.get("key"), "segredo");
    }
    assert.equal(catalog.candidates.length, DEFAULT_TREND_REGIONS.length * 2);
    assert.ok(catalog.candidates.every(({ durationSeconds }) => [15, 180].includes(durationSeconds)));
    assert.equal(catalog.sourceRuns[0].status, "SUCCESS");
    assert.deepEqual(catalog.sourceRuns[0].coverage.coveredRegions, DEFAULT_TREND_REGIONS);
  });
});

test("pagina com limite explícito e registra páginas e custo conhecido", async () => {
  await withStore(async (store) => {
    const urls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      urls.push(url);
      return response(url.searchParams.has("pageToken")
        ? { items: [video("p2", "PT30S")] }
        : { items: [video("p1", "PT30S")], nextPageToken: "token-2" });
    };

    const catalog = await collectPopularYouTubeTrends({
      apiKey: "segredo",
      store,
      regions: ["BR"],
      maxResultsPerRegion: 2,
      maxPagesPerRegion: 2,
      idempotencyKey: "paginação",
      capturedAt: CAPTURED_AT,
      fetchImpl,
    });

    assert.equal(urls.length, 2);
    assert.equal(urls[0].searchParams.get("maxResults"), "2");
    assert.equal(urls[1].searchParams.get("maxResults"), "1");
    assert.equal(urls[1].searchParams.get("pageToken"), "token-2");
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("PAGES_FETCHED:2"));
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("KNOWN_QUOTA_COST_UNITS:2"));
  });
});

test("normaliza identidade, URL, dados oficiais e métricas ausentes", async () => {
  await withStore(async (store) => {
    const fetchImpl = async () => response({ items: [video("abc_123", "PT1M", {
      snippet: {
        publishedAt: "2026-09-25T10:00:00Z",
        defaultAudioLanguage: "pt-BR",
        channelTitle: "Canal público",
        categoryId: "24",
      },
      statistics: { viewCount: "123", likeCount: "7" },
    })] });

    const catalog = await collectPopularYouTubeTrends({
      apiKey: "segredo", store, regions: ["BR"], idempotencyKey: "normalização",
      capturedAt: CAPTURED_AT, fetchImpl,
    });
    const candidate = catalog.candidates[0];
    const snapshot = catalog.snapshots[0];

    assert.equal(candidate.identityKey, "YOUTUBE:abc_123");
    assert.equal(candidate.canonicalUrl, "https://www.youtube.com/watch?v=abc_123");
    assert.equal(candidate.author, "Canal público");
    assert.equal(candidate.title, "Vídeo abc_123");
    assert.equal(candidate.category, "entretenimento");
    assert.equal(candidate.language, "pt-BR");
    assert.equal(candidate.publishedAt, "2026-09-25T10:00:00Z");
    assert.deepEqual(snapshot.metrics.views, { availability: "AVAILABLE", value: 123 });
    assert.deepEqual(snapshot.metrics.comments, { availability: "UNAVAILABLE", reason: "NOT_RETURNED_BY_PROVIDER" });
    assert.deepEqual(snapshot.metrics.shares, { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_YOUTUBE_DATA_API" });
  });
});

test("deduplica vídeo entre páginas e regiões e retry não consome quota nem duplica dados", async () => {
  await withStore(async (store) => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return response({ items: [video("repetido", "PT45S")] });
    };
    const input = {
      apiKey: "segredo", store, regions: ["BR", "US"], idempotencyKey: "retry",
      capturedAt: CAPTURED_AT, fetchImpl,
    };

    const first = await collectPopularYouTubeTrends(input);
    const second = await collectPopularYouTubeTrends(input);

    assert.equal(calls, 2);
    assert.equal(first.candidates.length, 1);
    assert.equal(first.snapshots.length, 1);
    assert.deepEqual(second, first);
    assert.equal(first.appearances.length, 1);
  });
});

test("nova execução do mesmo vídeo preserva identidade e acrescenta reaparição", async () => {
  await withStore(async (store) => {
    const fetchImpl = async () => response({ items: [video("recorrente", "PT45S")] });
    const first = await collectPopularYouTubeTrends({
      apiKey: "segredo", store, regions: ["BR"], idempotencyKey: "dia-1",
      capturedAt: "2026-09-25T12:00:00.000Z", fetchImpl,
    });
    await collectPopularYouTubeTrends({
      apiKey: "segredo", store, regions: ["US"], idempotencyKey: "dia-2",
      capturedAt: CAPTURED_AT, fetchImpl,
    });

    const history = store.getCandidateHistory(first.candidates[0].id);
    assert.equal(history.candidate.reappearanceCount, 2);
    assert.equal(history.snapshots.length, 2);
    assert.equal(history.appearances.length, 2);
  });
});

test("isola falha regional, mantém resultados e produz PARTIAL", async () => {
  await withStore(async (store) => {
    const fetchImpl = async (input) => new URL(input).searchParams.get("regionCode") === "US"
      ? response({ error: { errors: [{ reason: "backendError" }] } }, 503)
      : response({ items: [video("br-ok", "PT30S")] });

    const catalog = await collectPopularYouTubeTrends({
      apiKey: "segredo", store, regions: ["BR", "US"], idempotencyKey: "parcial",
      capturedAt: CAPTURED_AT, fetchImpl,
    });

    assert.equal(catalog.candidates.length, 1);
    assert.equal(catalog.sourceRuns[0].status, "PARTIAL");
    assert.deepEqual(catalog.sourceRuns[0].coverage.coveredRegions, ["BR"]);
    assert.equal(catalog.sourceRuns[0].errorCode, "YOUTUBE_REGION_FAILURE");
    assert.ok(catalog.sourceRuns[0].gaps.includes("REGION_UNAVAILABLE:US:YOUTUBE_PROVIDER_ERROR"));
    assert.equal(catalog.run.state, "COMPLETED_WITH_GAPS");
  });
});

test("classifica autenticação e quota como bloqueio do provedor sem expor chave ou payload", async () => {
  for (const [reason, expectedCode] of [
    ["keyInvalid", "YOUTUBE_AUTHENTICATION_FAILED"],
    ["quotaExceeded", "YOUTUBE_QUOTA_EXCEEDED"],
  ]) {
    await withStore(async (store) => {
      const fetchImpl = async () => response({
        error: { message: `não persistir segredo-chave-${reason}`, errors: [{ reason }] },
      }, 403);
      const catalog = await collectPopularYouTubeTrends({
        apiKey: `segredo-${reason}`, store, regions: ["BR", "US"],
        idempotencyKey: `bloqueio-${reason}`, capturedAt: CAPTURED_AT, fetchImpl,
      });
      const serialized = JSON.stringify(catalog);

      assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
      assert.equal(catalog.sourceRuns[0].errorCode, expectedCode);
      assert.deepEqual(catalog.sourceRuns[0].coverage.coveredRegions, []);
      assert.doesNotMatch(serialized, /segredo|não persistir/);
    });
  }
});

test("falha operacional sem cobertura produz FAILED e código estável", async () => {
  await withStore(async (store) => {
    const catalog = await collectPopularYouTubeTrends({
      apiKey: "segredo", store, regions: ["BR"], idempotencyKey: "falha-total",
      capturedAt: CAPTURED_AT, fetchImpl: async () => response(null, 503),
    });
    assert.equal(catalog.sourceRuns[0].status, "FAILED");
    assert.equal(catalog.sourceRuns[0].errorCode, "YOUTUBE_PROVIDER_ERROR");
    assert.equal(catalog.run.state, "FAILED");
    assert.ok(catalog.sourceRuns[0].capabilities.limitations.includes("KNOWN_QUOTA_COST_UNITS:1"));
  });
});

test("ausência de chave persiste bloqueio explícito sem chamar fetch", async () => {
  await withStore(async (store) => {
    const catalog = await collectPopularYouTubeTrends({
      store, regions: ["BR"], idempotencyKey: "sem-chave", capturedAt: CAPTURED_AT,
      fetchImpl: async () => assert.fail("fetch não deveria ser chamado"),
    });
    assert.equal(catalog.sourceRuns[0].status, "BLOCKED_BY_PROVIDER");
    assert.equal(catalog.sourceRuns[0].errorCode, "YOUTUBE_API_KEY_MISSING");
  });
});

function video(id, duration, overrides = {}) {
  return {
    id,
    snippet: {
      title: `Vídeo ${id}`,
      channelId: "channel-id",
      channelTitle: "Canal",
      categoryId: "24",
      publishedAt: "2026-09-25T10:00:00Z",
      defaultLanguage: "en",
      ...overrides.snippet,
    },
    contentDetails: { duration, ...overrides.contentDetails },
    statistics: overrides.statistics ?? { viewCount: "10", likeCount: "2", commentCount: "1" },
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-youtube-"));
  const store = new TrendCatalogStore(join(directory, "trends.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
