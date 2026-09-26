import { createHash } from "node:crypto";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../domain/contracts.js";
import { TREND_RANKING_CONFIG_VERSION } from "../domain/ranking.js";

const RESEARCH_VIDEO_URL = "https://open.tiktokapis.com/v2/research/video/query/";
const RESEARCH_FIELDS = [
  "id", "video_description", "create_time", "region_code", "share_count",
  "view_count", "like_count", "comment_count", "username", "video_duration",
  "hashtag_names",
].join(",");
const RESEARCH_ELIGIBILITY = [
  ["eligibleOrganization", "TIKTOK_RESEARCH_ELIGIBLE_ORGANIZATION_REQUIRED"],
  ["nonCommercialResearch", "TIKTOK_RESEARCH_NON_COMMERCIAL_REQUIRED"],
  ["ethicalReviewApproved", "TIKTOK_RESEARCH_ETHICAL_REVIEW_REQUIRED"],
  ["researchProjectApproved", "TIKTOK_RESEARCH_PROJECT_NOT_APPROVED"],
  ["researchScopeGranted", "TIKTOK_RESEARCH_SCOPE_NOT_GRANTED"],
  ["retentionControlsApproved", "TIKTOK_RESEARCH_RETENTION_CONTROLS_REQUIRED"],
];

export function deriveTikTokResearchQueries(clusters, regions, maxQueries = 30) {
  if (!Array.isArray(clusters) || clusters.length === 0) throw new Error("clusters persistidos são obrigatórios");
  validateRegions(regions);
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 100) {
    throw new Error("maxQueries deve ser inteiro entre 1 e 100");
  }
  const hashtags = [];
  for (const cluster of [...clusters].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const field of ["label", "niche", "subtheme"]) {
      const hashtag = normalizeHashtag(cluster[field]);
      if (!hashtag) throw new Error(`cluster ${cluster.id} não produz termo válido em ${field}`);
      if (!hashtags.includes(hashtag)) hashtags.push(hashtag);
    }
  }
  const queries = [];
  for (const region of regions) {
    for (const hashtag of hashtags) {
      queries.push({ region, hashtag });
      if (queries.length === maxQueries) return queries;
    }
  }
  return queries;
}

export function normalizeTikTokResearchVideo(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const id = String(value.id ?? "");
    if (!/^\d{5,32}$/.test(id)) throw new Error();
    if (typeof value.username !== "string" || !/^[A-Za-z0-9._]{1,24}$/.test(value.username)) throw new Error();
    if (typeof value.region_code !== "string" || !/^[A-Z]{2}$/.test(value.region_code)) throw new Error();
    if (!Number.isSafeInteger(value.create_time) || value.create_time <= 0) throw new Error();
    if (!Number.isFinite(value.video_duration) || value.video_duration <= 0) throw new Error();
    const publishedAt = new Date(value.create_time * 1000).toISOString();
    const canonicalUrl = `https://www.tiktok.com/@${value.username}/video/${id}`;
    return {
      platformVideoId: id,
      canonicalUrl,
      author: value.username,
      region: value.region_code,
      publishedAt,
      durationSeconds: value.video_duration,
      ...(nonBlank(value.video_description) ? { title: value.video_description } : {}),
      metrics: {
        views: metric(value.view_count),
        likes: metric(value.like_count),
        comments: metric(value.comment_count),
        shares: metric(value.share_count),
      },
    };
  } catch {
    throw new Error("vídeo TikTok inválido");
  }
}

export async function collectTikTokOfficialCoverage({
  product = "RESEARCH_API",
  accessToken,
  eligibility = {},
  displayAccess = {},
  authorizedAccountContext,
  store,
  clusterRunId,
  idempotencyKey,
  capturedAt = new Date().toISOString(),
  startDate,
  endDate,
  regions = ["BR"],
  maxQueries = 30,
  maxResultsPerPage = 100,
  maxPagesPerQuery = 1,
  fetchImpl = fetch,
}) {
  validateBaseInput({ product, store, idempotencyKey, capturedAt });
  const prior = store.getOperation?.(idempotencyKey);
  if (prior) return prior;
  if (product === "DISPLAY_API") {
    return recordDisplayCoverage({ displayAccess, authorizedAccountContext, store, idempotencyKey, capturedAt });
  }
  if (product === "CONTENT_POSTING_API") {
    return recordNonDiscoveryProduct({ store, idempotencyKey, capturedAt });
  }

  validateResearchInput({ clusterRunId, startDate, endDate, regions, maxQueries, maxResultsPerPage, maxPagesPerQuery });
  const origin = store.getRun(clusterRunId);
  if (!origin) throw new Error(`Run de clusters não encontrada: ${clusterRunId}`);
  const queries = deriveTikTokResearchQueries(origin.topicClusters, regions, maxQueries);
  const requested = queries.map(queryLabel);
  const runId = stableId("tiktok-run", idempotencyKey);
  const sourceRunId = stableId("tiktok-source", idempotencyKey);
  const block = researchConfigurationBlock({ accessToken, eligibility });
  const covered = [];
  const errors = [];
  const uniqueVideos = new Map();
  let requestsAttempted = 0;
  let pagesFetched = 0;
  let invalidVideos = 0;
  let outsideDurationWindow = 0;

  if (block) {
    errors.push({ query: "ALL", code: block, blocking: true });
  } else {
    for (let index = 0; index < queries.length; index += 1) {
      const query = queries[index];
      try {
        const videos = await fetchResearchQuery({
          query, accessToken, startDate, endDate, maxResultsPerPage, maxPagesPerQuery, fetchImpl,
          onAttempt: () => { requestsAttempted += 1; },
          onPage: () => { pagesFetched += 1; },
        });
        for (const item of videos) if (!uniqueVideos.has(String(item?.id ?? ""))) uniqueVideos.set(String(item?.id ?? ""), item);
        covered.push(queryLabel(query));
      } catch (error) {
        const normalized = normalizeProviderError(error);
        errors.push({ query: queryLabel(query), ...normalized });
        if (normalized.blocking) {
          for (const skipped of queries.slice(index + 1)) errors.push({ query: queryLabel(skipped), code: normalized.code, blocking: true });
          break;
        }
      }
    }
  }

  const observations = [];
  for (const item of uniqueVideos.values()) {
    try {
      const normalized = normalizeTikTokResearchVideo(item);
      if (normalized.durationSeconds < 15 || normalized.durationSeconds > 180) {
        outsideDurationWindow += 1;
        continue;
      }
      observations.push(toObservation({ normalized, capturedAt, runId }));
    } catch {
      invalidVideos += 1;
    }
  }

  const status = sourceStatus(covered, requested, errors);
  const gaps = errors.map(({ query, code }) => `QUERY_UNAVAILABLE:${query}:${code}`);
  const limitations = [
    "OFFICIAL_API_ONLY:TikTok_Research_API_v2",
    "DISCOVERY_METHOD:research.video.query",
    "ACCESS_SCOPE:APPROVED_NON_COMMERCIAL_RESEARCH_PROJECT",
    "RESULTS_ARE_PUBLIC_QUERY_MATCHES_NOT_GLOBAL_TREND_RANKING",
    "REGION_MEANS_CREATOR_ACCOUNT_REGISTRATION_REGION",
    "RESEARCH_DATA_MAY_LAG:VIDEOS_UP_TO_48_HOURS:METRICS_UP_TO_10_DAYS",
    "RETENTION_REQUIRES_REFRESH_AT_LEAST_EVERY_30_DAYS_AND_DELETION_IF_UNAVAILABLE",
    "DAILY_DEFAULT_LIMIT:1000_REQUESTS_AND_100000_RECORDS",
    `REQUESTS_ATTEMPTED:${requestsAttempted}`,
    `PAGES_FETCHED:${pagesFetched}`,
    `MAX_QUERIES:${maxQueries}`,
    `MAX_RESULTS_PER_PAGE:${maxResultsPerPage}`,
  ];
  if (invalidVideos > 0) limitations.push(`INVALID_VIDEOS_DISCARDED:${invalidVideos}`);
  if (outsideDurationWindow > 0) limitations.push(`OUTSIDE_DURATION_WINDOW:${outsideDurationWindow}`);
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform: "TIKTOK",
    status,
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: {
      discovery: block ? "UNAVAILABLE" : "PUBLIC_QUERY",
      metrics: ["VIEWS", "LIKES", "COMMENTS", "SHARES"],
      supportsRegions: true,
      limitations,
    },
    coverage: { requestedRegions: requested, coveredRegions: covered, complete: covered.length === requested.length },
    gaps,
    ...(status === "SUCCESS" ? {} : { errorCode: sourceErrorCode(status, errors) }),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: status === "SUCCESS" ? "COMPLETED" : status === "FAILED" && observations.length === 0 ? "FAILED" : "COMPLETED_WITH_GAPS",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    sourceRunIds: [sourceRunId],
    candidateIds: observations.map(({ candidate }) => candidate.id),
    rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
  };
  return store.recordOperation({ idempotencyKey, run, sourceRuns: [sourceRun], observations });
}

async function fetchResearchQuery({
  query, accessToken, startDate, endDate, maxResultsPerPage, maxPagesPerQuery, fetchImpl, onAttempt, onPage,
}) {
  const videos = [];
  let cursor;
  let searchId;
  for (let page = 0; page < maxPagesPerQuery; page += 1) {
    const url = new URL(RESEARCH_VIDEO_URL);
    url.searchParams.set("fields", RESEARCH_FIELDS);
    const body = {
      query: { and: [
        { operation: "IN", field_name: "region_code", field_values: [query.region] },
        { operation: "EQ", field_name: "hashtag_name", field_values: [query.hashtag] },
      ] },
      start_date: startDate,
      end_date: endDate,
      max_count: maxResultsPerPage,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(searchId ? { search_id: searchId } : {}),
    };
    let response;
    try {
      onAttempt();
      response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw providerError("TIKTOK_NETWORK_ERROR", false, cause);
    }
    const responseBody = await safeJson(response);
    if (!response.ok || (responseBody?.error?.code && responseBody.error.code !== "ok")) {
      throw errorFromResponse(response.status, responseBody);
    }
    onPage();
    const pageVideos = Array.isArray(responseBody?.data?.videos) ? responseBody.data.videos : [];
    videos.push(...pageVideos);
    if (responseBody?.data?.has_more !== true || pageVideos.length === 0) break;
    if (!Number.isSafeInteger(responseBody?.data?.cursor) || !nonBlank(responseBody?.data?.search_id)) {
      throw providerError("TIKTOK_INVALID_PAGINATION", false);
    }
    cursor = responseBody.data.cursor;
    searchId = responseBody.data.search_id;
  }
  return videos;
}

function toObservation({ normalized, capturedAt, runId }) {
  const candidateId = `tiktok:${normalized.platformVideoId}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: candidateId,
      identityKey: canonicalTrendIdentity({ platform: "TIKTOK", platformVideoId: normalized.platformVideoId, canonicalUrl: normalized.canonicalUrl }),
      platform: "TIKTOK",
      platformVideoId: normalized.platformVideoId,
      canonicalUrl: normalized.canonicalUrl,
      state: "DISCOVERED",
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      reappearanceCount: 1,
      durationSeconds: normalized.durationSeconds,
      publishedAt: normalized.publishedAt,
      region: normalized.region,
      usageCondition: "REFERENCE_ONLY",
      snapshotIds: [],
      topicClusterIds: [],
      author: normalized.author,
      ...(normalized.title ? { title: normalized.title } : {}),
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: stableId("tiktok-snapshot", `${runId}:${normalized.platformVideoId}`),
      candidateId,
      capturedAt,
      metrics: normalized.metrics,
    },
    reappearanceReason: "RESEARCH_PUBLIC_QUERY_MATCH",
  };
}

function recordDisplayCoverage({ displayAccess, authorizedAccountContext, store, idempotencyKey, capturedAt }) {
  const missing = [
    ["accountAuthorized", "TIKTOK_DISPLAY_ACCOUNT_AUTHORIZATION_REQUIRED"],
    ["appApproved", "TIKTOK_DISPLAY_APP_APPROVAL_REQUIRED"],
    ["videoListScopeGranted", "TIKTOK_DISPLAY_VIDEO_LIST_SCOPE_REQUIRED"],
  ].find(([field]) => displayAccess?.[field] !== true)?.[1];
  const context = safeContext(authorizedAccountContext);
  const block = missing ?? (!context ? "TIKTOK_DISPLAY_ACCOUNT_CONTEXT_REQUIRED" : null);
  return recordCoverageOnly({
    store, idempotencyKey, capturedAt,
    discovery: block ? "UNAVAILABLE" : "AUTHORIZED_ONLY",
    status: block ? "BLOCKED_BY_PROVIDER" : "PARTIAL",
    errorCode: block ?? "TIKTOK_AUTHORIZED_CONTENT_NOT_PUBLIC_TREND",
    gap: block ?? "GLOBAL_DISCOVERY_UNAVAILABLE:DISPLAY_API_AUTHORIZED_ACCOUNT_ONLY",
    limitations: [
      "OFFICIAL_API_ONLY:TikTok_Display_API_v2",
      "DISCOVERY_METHOD:AUTHORIZED_ACCOUNT_VIDEO_LIST_ONLY",
      `AUTHORIZED_ACCOUNT_CONTEXT:${context ?? "UNAVAILABLE"}`,
      "AUTHORIZED_CONTENT_MUST_NOT_BE_PRESENTED_AS_PUBLIC_OR_GLOBAL_TREND",
      "NO_PROVIDER_REQUEST_PERFORMED:RADAR_DOES_NOT_INGEST_AUTHORIZED_ONLY_CONTENT",
    ],
  });
}

function recordNonDiscoveryProduct({ store, idempotencyKey, capturedAt }) {
  return recordCoverageOnly({
    store, idempotencyKey, capturedAt,
    discovery: "UNAVAILABLE",
    status: "BLOCKED_BY_PROVIDER",
    errorCode: "TIKTOK_CONTENT_POSTING_IS_NOT_DISCOVERY",
    gap: "GLOBAL_DISCOVERY_UNAVAILABLE:CONTENT_POSTING_API",
    limitations: [
      "OFFICIAL_API_ONLY:TikTok_Content_Posting_API",
      "CAPABILITY:PUBLISH_AUTHORIZED_CONTENT",
      "NOT_A_DISCOVERY_PRODUCT",
    ],
  });
}

function recordCoverageOnly({ store, idempotencyKey, capturedAt, discovery, status, errorCode, gap, limitations }) {
  const runId = stableId("tiktok-run", idempotencyKey);
  const sourceRunId = stableId("tiktok-source", idempotencyKey);
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform: "TIKTOK",
    status,
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: { discovery, metrics: [], supportsRegions: false, limitations },
    coverage: { requestedRegions: ["GLOBAL_DISCOVERY"], coveredRegions: [], complete: false },
    gaps: [gap],
    errorCode,
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: "COMPLETED_WITH_GAPS",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    sourceRunIds: [sourceRunId],
    candidateIds: [],
    rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
  };
  return store.recordOperation({ idempotencyKey, run, sourceRuns: [sourceRun] });
}

function researchConfigurationBlock({ accessToken, eligibility }) {
  if (!nonBlank(accessToken)) return "TIKTOK_RESEARCH_ACCESS_TOKEN_MISSING";
  for (const [field, code] of RESEARCH_ELIGIBILITY) if (eligibility?.[field] !== true) return code;
  return null;
}

function sourceStatus(covered, requested, errors) {
  if (covered.length === requested.length && errors.length === 0) return "SUCCESS";
  if (covered.length > 0) return "PARTIAL";
  if (errors.some(({ blocking }) => blocking)) return "BLOCKED_BY_PROVIDER";
  return "FAILED";
}

function sourceErrorCode(status, errors) {
  if (status === "PARTIAL") return "TIKTOK_RESEARCH_PARTIAL_FAILURE";
  return errors[0]?.code ?? "TIKTOK_PROVIDER_ERROR";
}

function errorFromResponse(status, body) {
  const code = body?.error?.code ?? body?.code;
  if (status === 401 && code === "access_token_invalid") return providerError("TIKTOK_AUTHENTICATION_FAILED", true);
  if (["scope_not_authorized", "scope_permission_missed"].includes(code)) return providerError("TIKTOK_RESEARCH_SCOPE_OR_APPROVAL_REQUIRED", true);
  if (status === 403) return providerError("TIKTOK_RESEARCH_ELIGIBILITY_OR_PERMISSION_REQUIRED", true);
  if (status === 429 || code === "rate_limit_exceeded") return providerError("TIKTOK_RATE_OR_QUOTA_LIMITED", true);
  if (status >= 500) return providerError("TIKTOK_PROVIDER_ERROR", false);
  return providerError("TIKTOK_REQUEST_REJECTED", false);
}

function normalizeProviderError(error) {
  return { code: typeof error?.code === "string" ? error.code : "TIKTOK_PROVIDER_ERROR", blocking: error?.blocking === true };
}

function providerError(code, blocking, cause) {
  return Object.assign(new Error(code, { cause }), { code, blocking });
}

function metric(value) {
  if (value === undefined || value === null || value === "") return { availability: "UNAVAILABLE", reason: "NOT_RETURNED_BY_PROVIDER" };
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return { availability: "UNAVAILABLE", reason: "INVALID_PROVIDER_VALUE" };
  return { availability: "AVAILABLE", value: number };
}

function normalizeHashtag(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/^#+/, "").replace(/[^a-z0-9_]/g, "").slice(0, 100);
}

function queryLabel({ region, hashtag }) {
  return `REGION:${region}|HASHTAG:${hashtag}`;
}

function safeContext(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : undefined;
}

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

async function safeJson(response) {
  try { return await response.json(); } catch { return null; }
}

function validateBaseInput({ product, store, idempotencyKey, capturedAt }) {
  if (!["RESEARCH_API", "DISPLAY_API", "CONTENT_POSTING_API"].includes(product)) throw new Error("produto TikTok inválido");
  if (!store || typeof store.getOperation !== "function" || typeof store.recordOperation !== "function") throw new Error("TrendCatalogStore é obrigatório");
  if (!nonBlank(idempotencyKey)) throw new Error("idempotencyKey explícita é obrigatória");
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt deve ser ISO 8601 válido");
}

function validateResearchInput({ clusterRunId, startDate, endDate, regions, maxQueries, maxResultsPerPage, maxPagesPerQuery }) {
  if (!nonBlank(clusterRunId)) throw new Error("clusterRunId obrigatório para Research API");
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate)) throw new Error("startDate e endDate devem usar YYYYMMDD");
  const start = parseCompactDate(startDate);
  const end = parseCompactDate(endDate);
  const days = (end - start) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days > 30) throw new Error("janela Research API deve ter no máximo 30 dias");
  validateRegions(regions);
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 100) throw new Error("maxQueries deve ser inteiro entre 1 e 100");
  if (!Number.isInteger(maxResultsPerPage) || maxResultsPerPage < 1 || maxResultsPerPage > 100) throw new Error("maxResultsPerPage deve ser inteiro entre 1 e 100");
  if (!Number.isInteger(maxPagesPerQuery) || maxPagesPerQuery < 1 || maxPagesPerQuery > 10) throw new Error("maxPagesPerQuery deve ser inteiro entre 1 e 10");
}

function validateRegions(regions) {
  if (!Array.isArray(regions) || regions.length === 0 || new Set(regions).size !== regions.length
    || regions.some((region) => typeof region !== "string" || !/^[A-Z]{2}$/.test(region))) {
    throw new Error("regions deve conter códigos ISO alfa-2 únicos");
  }
}

function parseCompactDate(value) {
  const parsed = Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`);
  const roundTrip = Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "") : "";
  return roundTrip === value ? parsed : Number.NaN;
}
