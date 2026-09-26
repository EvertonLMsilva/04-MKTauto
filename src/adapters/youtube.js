import { createHash } from "node:crypto";
import {
  RADAR_CONTRACT_VERSION,
  canonicalTrendIdentity,
} from "../domain/contracts.js";
import {
  DEFAULT_TREND_REGIONS,
  TREND_RANKING_CONFIG_VERSION,
} from "../domain/ranking.js";

const YOUTUBE_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_PARTS = "snippet,contentDetails,statistics";
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 180;
const CATEGORY_LABELS = {
  "1": "cinema e animação",
  "2": "automóveis",
  "10": "música",
  "15": "animais",
  "17": "esportes",
  "20": "jogos",
  "24": "entretenimento",
  "25": "notícias e política",
  "26": "estilo e conhecimento prático",
  "27": "educação",
  "28": "ciência e tecnologia",
};

export async function fetchPopularYouTubeSignals({
  apiKey,
  regionCode,
  maxResults,
  categoryIds = [null],
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY não configurada");
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    throw new Error("Ao menos uma categoria de sinais é obrigatória");
  }
  const resultsPerCategory = Math.max(1, Math.min(50, Math.ceil(maxResults / categoryIds.length)));
  const batches = await Promise.all(categoryIds.map(async (categoryId) => {
  const url = new URL(YOUTUBE_URL);
    const params = {
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode,
      maxResults: String(resultsPerCategory),
    key: apiKey,
    };
    if (categoryId) params.videoCategoryId = categoryId;
    url.search = new URLSearchParams(params);

  const response = await fetchImpl(url);
  if (response.status === 404 && categoryId) return [];
  if (!response.ok) {
    throw new Error(`YouTube Data API respondeu ${response.status}`);
  }
  const body = await response.json();
    return body.items ?? [];
  }));

  const unique = new Map();
  for (const item of batches.flat()) unique.set(item.id, item);
  return [...unique.values()].slice(0, maxResults).map((item) => ({
    id: `youtube:${item.id}`,
    platform: "youtube",
    title: item.snippet?.title ?? "Sem título",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    sourceCategory: CATEGORY_LABELS[item.snippet?.categoryId] ?? "geral",
    publishedAt: item.snippet?.publishedAt ?? null,
    tags: (item.snippet?.tags ?? []).slice(0, 12),
    metrics: {
      views: Number(item.statistics?.viewCount ?? 0),
      likes: Number(item.statistics?.likeCount ?? 0),
      comments: Number(item.statistics?.commentCount ?? 0),
    },
    sourceUrl: `https://www.youtube.com/watch?v=${item.id}`,
    rightsState: "unknown",
  }));
}

export function parseYouTubeDuration(value) {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || match.slice(1).every((part) => part === undefined)) return null;
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match;
  const total = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) ? total : null;
}

export async function collectPopularYouTubeTrends({
  apiKey,
  store,
  idempotencyKey,
  regions = DEFAULT_TREND_REGIONS,
  maxResultsPerRegion = 50,
  maxPagesPerRegion = 1,
  capturedAt = new Date().toISOString(),
  fetchImpl = fetch,
}) {
  validateCollectionInput({ store, idempotencyKey, regions, maxResultsPerRegion, maxPagesPerRegion, capturedAt });
  const prior = store.getOperation?.(idempotencyKey);
  if (prior) return prior;

  const runId = stableId("youtube-run", idempotencyKey);
  const sourceRunId = stableId("youtube-source", idempotencyKey);
  const requestedRegions = [...regions];
  const coveredRegions = [];
  const regionErrors = [];
  const uniqueVideos = new Map();
  let requestsAttempted = 0;
  let pagesFetched = 0;
  let knownQuotaCostUnits = 0;

  if (!apiKey) {
    for (const region of requestedRegions) {
      regionErrors.push({ region, code: "YOUTUBE_API_KEY_MISSING", blocking: true });
    }
  } else {
    for (let index = 0; index < requestedRegions.length; index += 1) {
      const region = requestedRegions[index];
      try {
        const result = await fetchRegion({
          apiKey, region, maxResultsPerRegion, maxPagesPerRegion, fetchImpl,
          onAttempt: () => { requestsAttempted += 1; },
          onResponse: () => { knownQuotaCostUnits += 1; },
          onPage: () => { pagesFetched += 1; },
        });
        coveredRegions.push(region);
        for (const item of result.items) {
          if (!uniqueVideos.has(item.id)) uniqueVideos.set(item.id, { item, region });
        }
      } catch (error) {
        const normalized = normalizeProviderError(error);
        regionErrors.push({ region, ...normalized });
        if (normalized.blocking) {
          for (const skipped of requestedRegions.slice(index + 1)) {
            regionErrors.push({ region: skipped, code: normalized.code, blocking: true });
          }
          break;
        }
      }
    }
  }

  const observations = [];
  let ineligibleDurationCount = 0;
  let invalidItemCount = 0;
  for (const { item, region } of uniqueVideos.values()) {
    const durationSeconds = parseYouTubeDuration(item.contentDetails?.duration);
    if (durationSeconds === null || !isPlatformVideoId(item.id) || !isDateTime(item.snippet?.publishedAt)) {
      invalidItemCount += 1;
      continue;
    }
    if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
      ineligibleDurationCount += 1;
      continue;
    }
    observations.push(toObservation({ item, region, durationSeconds, capturedAt, runId }));
  }

  const sourceStatus = sourceStatusFor(coveredRegions, requestedRegions, regionErrors);
  const gaps = regionErrors.map(({ region, code }) => `REGION_UNAVAILABLE:${region}:${code}`);
  const limitations = [
    "OFFICIAL_API_ONLY:YouTube_Data_API_v3",
    "DISCOVERY_METHOD:videos.list:mostPopular",
    "SHARES_METRIC_NOT_EXPOSED",
    `REQUESTS_ATTEMPTED:${requestsAttempted}`,
    `PAGES_FETCHED:${pagesFetched}`,
    `KNOWN_QUOTA_COST_UNITS:${knownQuotaCostUnits}`,
    `MAX_RESULTS_PER_REGION:${maxResultsPerRegion}`,
  ];
  if (ineligibleDurationCount > 0) limitations.push(`OUTSIDE_DURATION_WINDOW:${ineligibleDurationCount}`);
  if (invalidItemCount > 0) limitations.push(`INVALID_ITEMS_DISCARDED:${invalidItemCount}`);

  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform: "YOUTUBE",
    status: sourceStatus,
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: {
      discovery: "GLOBAL_TRENDS",
      metrics: ["VIEWS", "LIKES", "COMMENTS"],
      supportsRegions: true,
      limitations,
    },
    coverage: {
      requestedRegions,
      coveredRegions,
      complete: coveredRegions.length === requestedRegions.length,
    },
    gaps,
    ...(sourceStatus === "SUCCESS" ? {} : { errorCode: sourceErrorCode(sourceStatus, regionErrors, coveredRegions) }),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: sourceStatus === "SUCCESS"
      ? "COMPLETED"
      : sourceStatus === "FAILED" && observations.length === 0 ? "FAILED" : "COMPLETED_WITH_GAPS",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    sourceRunIds: [sourceRunId],
    candidateIds: observations.map(({ candidate }) => candidate.id),
    rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
  };

  return store.recordOperation({ idempotencyKey, run, sourceRuns: [sourceRun], observations });
}

async function fetchRegion({
  apiKey, region, maxResultsPerRegion, maxPagesPerRegion, fetchImpl,
  onAttempt, onResponse, onPage,
}) {
  const items = [];
  let pageToken;
  let pagesFetched = 0;
  while (items.length < maxResultsPerRegion && pagesFetched < maxPagesPerRegion) {
    const url = new URL(YOUTUBE_URL);
    url.search = new URLSearchParams({
      part: YOUTUBE_PARTS,
      chart: "mostPopular",
      regionCode: region,
      maxResults: String(Math.min(50, maxResultsPerRegion - items.length)),
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });
    let response;
    try {
      onAttempt();
      response = await fetchImpl(url);
    } catch (cause) {
      throw providerError("YOUTUBE_NETWORK_ERROR", false, cause);
    }
    onResponse();
    pagesFetched += 1;
    const body = await safeJson(response);
    if (!response.ok) throw errorFromResponse(response.status, body);
    onPage();
    const pageItems = Array.isArray(body?.items) ? body.items : [];
    items.push(...pageItems.slice(0, maxResultsPerRegion - items.length));
    pageToken = typeof body?.nextPageToken === "string" ? body.nextPageToken : undefined;
    if (!pageToken || pageItems.length === 0) break;
  }
  return { items, pagesFetched };
}

function toObservation({ item, region, durationSeconds, capturedAt, runId }) {
  const candidateId = `youtube:${item.id}`;
  const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;
  const candidate = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: candidateId,
    identityKey: canonicalTrendIdentity({ platform: "YOUTUBE", platformVideoId: item.id, canonicalUrl }),
    platform: "YOUTUBE",
    platformVideoId: item.id,
    canonicalUrl,
    state: "DISCOVERED",
    firstSeenAt: capturedAt,
    lastSeenAt: capturedAt,
    reappearanceCount: 1,
    durationSeconds,
    publishedAt: item.snippet.publishedAt,
    region,
    ...(nonBlank(item.snippet.defaultAudioLanguage) || nonBlank(item.snippet.defaultLanguage)
      ? { language: nonBlank(item.snippet.defaultAudioLanguage) ?? nonBlank(item.snippet.defaultLanguage) } : {}),
    usageCondition: "REFERENCE_ONLY",
    snapshotIds: [],
    topicClusterIds: [],
    ...(nonBlank(item.snippet.channelTitle) ? { author: item.snippet.channelTitle } : {}),
  };
  const snapshot = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: stableId("youtube-snapshot", `${runId}:${item.id}`),
    candidateId,
    capturedAt,
    metrics: {
      views: metric(item.statistics?.viewCount),
      likes: metric(item.statistics?.likeCount),
      comments: metric(item.statistics?.commentCount),
      shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_YOUTUBE_DATA_API" },
    },
  };
  return { candidate, snapshot, reappearanceReason: "MOST_POPULAR_CHART" };
}

function metric(value) {
  if (value === undefined || value === null || value === "") {
    return { availability: "UNAVAILABLE", reason: "NOT_RETURNED_BY_PROVIDER" };
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    return { availability: "UNAVAILABLE", reason: "INVALID_PROVIDER_VALUE" };
  }
  return { availability: "AVAILABLE", value: number };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFromResponse(status, body) {
  const reason = body?.error?.errors?.[0]?.reason;
  if (["quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"].includes(reason)) {
    return providerError("YOUTUBE_QUOTA_EXCEEDED", true);
  }
  if (status === 401 || ["keyInvalid", "accessNotConfigured", "forbidden"].includes(reason)) {
    return providerError("YOUTUBE_AUTHENTICATION_FAILED", true);
  }
  if (status === 429) return providerError("YOUTUBE_RATE_LIMITED", true);
  if (status >= 500) return providerError("YOUTUBE_PROVIDER_ERROR", false);
  return providerError("YOUTUBE_REQUEST_REJECTED", false);
}

function providerError(code, blocking, cause) {
  return Object.assign(new Error(code, { cause }), { code, blocking });
}

function normalizeProviderError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "YOUTUBE_PROVIDER_ERROR",
    blocking: error?.blocking === true,
  };
}

function sourceStatusFor(covered, requested, errors) {
  if (covered.length === requested.length) return "SUCCESS";
  if (covered.length > 0) return "PARTIAL";
  return errors.some(({ blocking }) => blocking) ? "BLOCKED_BY_PROVIDER" : "FAILED";
}

function sourceErrorCode(status, errors, covered) {
  if (status === "PARTIAL" || covered.length > 0) return "YOUTUBE_REGION_FAILURE";
  return errors[0]?.code ?? "YOUTUBE_PROVIDER_ERROR";
}

function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isPlatformVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function isDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function validateCollectionInput({ store, idempotencyKey, regions, maxResultsPerRegion, maxPagesPerRegion, capturedAt }) {
  if (!store || typeof store.recordOperation !== "function") throw new Error("TrendCatalogStore é obrigatório");
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") throw new Error("idempotencyKey explícita é obrigatória");
  if (!Array.isArray(regions) || regions.length === 0 || new Set(regions).size !== regions.length
    || regions.some((region) => typeof region !== "string" || !/^[A-Z]{2}$/.test(region))) {
    throw new Error("regions deve conter códigos ISO 3166-1 alpha-2 únicos");
  }
  if (!Number.isInteger(maxResultsPerRegion) || maxResultsPerRegion < 1) throw new Error("maxResultsPerRegion deve ser inteiro positivo");
  if (!Number.isInteger(maxPagesPerRegion) || maxPagesPerRegion < 1) throw new Error("maxPagesPerRegion deve ser inteiro positivo");
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt deve ser ISO 8601 válido");
}
