import { createHash } from "node:crypto";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../domain/contracts.js";
import { TREND_RANKING_CONFIG_VERSION } from "../domain/ranking.js";

const GRAPH_HOST = "graph.threads.net";
const MEDIA_FIELDS = "id,media_type,permalink,timestamp,username,text";
const REQUIRED_ELIGIBILITY = [
  ["basicGranted", "THREADS_BASIC_PERMISSION_REQUIRED"],
  ["keywordSearchGranted", "THREADS_KEYWORD_SEARCH_PERMISSION_REQUIRED"],
  ["appAccessApproved", "THREADS_APP_ACCESS_NOT_APPROVED"],
];

export function deriveThreadsQueries(clusters, maxQueries = 30) {
  if (!Array.isArray(clusters) || clusters.length === 0) throw new Error("clusters persistidos são obrigatórios");
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) throw new Error("maxQueries deve ser inteiro entre 1 e 30");
  const queries = [];
  for (const cluster of [...clusters].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const field of ["label", "niche", "subtheme"]) {
      const query = normalizeQuery(cluster[field]);
      if (!query) throw new Error(`cluster ${cluster.id} não produz consulta válida em ${field}`);
      if (!queries.includes(query)) queries.push(query);
      if (queries.length === maxQueries) return queries;
    }
  }
  return queries;
}

export function normalizeThreadsVideo(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const platformVideoId = String(value.id ?? "");
    if (!/^\d{5,64}$/.test(platformVideoId) || value.media_type !== "VIDEO") throw new Error();
    if (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) throw new Error();
    const canonicalUrl = canonicalThreadsUrl(value.permalink);
    return {
      platformVideoId,
      canonicalUrl,
      publishedAt: new Date(value.timestamp).toISOString(),
      durationSeconds: unavailable("NOT_EXPOSED_BY_THREADS_API"),
      ...(nonBlank(value.username) ? { author: value.username } : {}),
      ...(nonBlank(value.text) ? { title: value.text } : {}),
      metrics: {
        views: unavailable("NOT_EXPOSED_BY_THREADS_KEYWORD_SEARCH"),
        likes: unavailable("NOT_EXPOSED_BY_THREADS_KEYWORD_SEARCH"),
        comments: unavailable("NOT_EXPOSED_BY_THREADS_KEYWORD_SEARCH"),
        shares: unavailable("NOT_EXPOSED_BY_THREADS_KEYWORD_SEARCH"),
      },
    };
  } catch {
    throw new Error("vídeo Threads inválido");
  }
}

export async function collectThreadsKeywordCoverage({
  accessToken,
  apiVersion = "v1.0",
  eligibility = {},
  store,
  clusterRunId,
  idempotencyKey,
  capturedAt = new Date().toISOString(),
  searchType = "TOP",
  maxQueries = 30,
  maxResultsPerQuery = 50,
  maxPagesPerQuery = 1,
  fetchImpl = fetch,
}) {
  validateInput({ store, clusterRunId, idempotencyKey, capturedAt, apiVersion, searchType, maxQueries, maxResultsPerQuery, maxPagesPerQuery });
  const prior = store.getOperation?.(idempotencyKey);
  if (prior) return prior;
  const origin = store.getRun(clusterRunId);
  if (!origin) throw new Error(`Run de clusters não encontrada: ${clusterRunId}`);
  const queries = deriveThreadsQueries(origin.topicClusters, maxQueries);
  const requested = queries.map((query) => `QUERY:${query}`);
  const runId = stableId("threads-run", idempotencyKey);
  const sourceRunId = stableId("threads-source", idempotencyKey);
  const block = configurationBlock({ accessToken, eligibility });
  const covered = [];
  const errors = [];
  const uniqueVideos = new Map();
  let requestsAttempted = 0;
  let pagesFetched = 0;
  let invalidMedia = 0;
  let nonVideoMedia = 0;

  if (block) {
    errors.push({ query: "ALL", code: block, blocking: true });
  } else {
    for (let index = 0; index < queries.length; index += 1) {
      const query = queries[index];
      try {
        const items = await fetchKeywordResults({
          query, searchType, apiVersion, accessToken, maxResultsPerQuery, maxPagesPerQuery, fetchImpl,
          onAttempt: () => { requestsAttempted += 1; },
          onPage: () => { pagesFetched += 1; },
        });
        for (const item of items) {
          if (item?.media_type !== "VIDEO") {
            nonVideoMedia += 1;
            continue;
          }
          try {
            const normalized = normalizeThreadsVideo(item);
            if (!uniqueVideos.has(normalized.platformVideoId)) uniqueVideos.set(normalized.platformVideoId, normalized);
          } catch {
            invalidMedia += 1;
          }
        }
        covered.push(`QUERY:${query}`);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        errors.push({ query, ...normalized });
        if (normalized.blocking) {
          for (const skipped of queries.slice(index + 1)) errors.push({ query: skipped, code: normalized.code, blocking: true });
          break;
        }
      }
    }
  }

  const observations = [...uniqueVideos.values()].map((normalized) => toObservation({ normalized, capturedAt, runId }));
  const status = sourceStatus(covered, errors);
  const gaps = errors.map(({ query, code }) => `QUERY_UNAVAILABLE:${query}:${code}`);
  if (covered.length > 0) gaps.push("DURATION_UNAVAILABLE:THREADS_KEYWORD_MEDIA");
  const limitations = [
    "OFFICIAL_API_ONLY:Threads_API",
    `DISCOVERY_METHOD:keyword_search:${searchType}`,
    "DISCOVERY_SCOPE:PUBLIC_KEYWORD_MATCHES_NOT_GLOBAL_TRENDS",
    "REGION_FILTER_NOT_SUPPORTED",
    "METRICS_DURATION_NOT_EXPOSED",
    `REQUESTS_ATTEMPTED:${requestsAttempted}`,
    `PAGES_FETCHED:${pagesFetched}`,
    `PUBLIC_VIDEOS_LISTED:${observations.length}`,
  ];
  if (nonVideoMedia > 0) limitations.push(`NON_VIDEO_MEDIA_DISCARDED:${nonVideoMedia}`);
  if (invalidMedia > 0) limitations.push(`INVALID_MEDIA_DISCARDED:${invalidMedia}`);
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform: "THREADS",
    status,
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: { discovery: block ? "UNAVAILABLE" : "PUBLIC_QUERY", metrics: [], supportsRegions: false, limitations },
    coverage: { requestedRegions: requested, coveredRegions: covered, complete: false },
    gaps,
    ...(status === "PARTIAL" ? { errorCode: errors.length > 0 ? "THREADS_KEYWORD_PARTIAL_FAILURE" : "THREADS_MEDIA_DURATION_UNAVAILABLE" } : {}),
    ...(["BLOCKED_BY_PROVIDER", "FAILED"].includes(status) ? { errorCode: errors[0]?.code ?? "THREADS_PROVIDER_ERROR" } : {}),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: status === "FAILED" && observations.length === 0 ? "FAILED" : "COMPLETED_WITH_GAPS",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    sourceRunIds: [sourceRunId],
    candidateIds: observations.map(({ candidate }) => candidate.id),
    rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
  };
  return store.recordOperation({ idempotencyKey, run, sourceRuns: [sourceRun], observations });
}

async function fetchKeywordResults({ query, searchType, apiVersion, accessToken, maxResultsPerQuery, maxPagesPerQuery, fetchImpl, onAttempt, onPage }) {
  const items = [];
  let after;
  for (let page = 0; page < maxPagesPerQuery && items.length < maxResultsPerQuery; page += 1) {
    const url = new URL(`https://${GRAPH_HOST}/${apiVersion}/keyword_search`);
    url.search = new URLSearchParams({
      q: query,
      search_type: searchType,
      fields: MEDIA_FIELDS,
      limit: String(Math.min(50, maxResultsPerQuery - items.length)),
      ...(after ? { after } : {}),
    });
    let response;
    try {
      onAttempt();
      response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (cause) {
      throw providerError("THREADS_NETWORK_ERROR", false, cause);
    }
    const body = await safeJson(response);
    if (!response.ok) throw errorFromResponse(response.status, body);
    onPage();
    const pageItems = Array.isArray(body?.data) ? body.data : [];
    items.push(...pageItems.slice(0, maxResultsPerQuery - items.length));
    const nextAfter = body?.paging?.cursors?.after;
    after = typeof nextAfter === "string" && nextAfter.length <= 2048 ? nextAfter : undefined;
    if (!after || pageItems.length === 0) break;
  }
  return items;
}

function toObservation({ normalized, capturedAt, runId }) {
  const candidateId = `threads:${normalized.platformVideoId}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: candidateId,
      identityKey: canonicalTrendIdentity({ platform: "THREADS", platformVideoId: normalized.platformVideoId, canonicalUrl: normalized.canonicalUrl }),
      platform: "THREADS",
      platformVideoId: normalized.platformVideoId,
      canonicalUrl: normalized.canonicalUrl,
      state: "DISCOVERED",
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
      reappearanceCount: 1,
      durationSeconds: normalized.durationSeconds,
      publishedAt: normalized.publishedAt,
      usageCondition: "REFERENCE_ONLY",
      snapshotIds: [],
      topicClusterIds: [],
      ...(normalized.author ? { author: normalized.author } : {}),
      ...(normalized.title ? { title: normalized.title } : {}),
      category: "THREADS_VIDEO",
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: stableId("threads-snapshot", `${runId}:${normalized.platformVideoId}`),
      candidateId,
      capturedAt,
      metrics: normalized.metrics,
    },
    reappearanceReason: "THREADS_PUBLIC_KEYWORD_MATCH",
  };
}

function configurationBlock({ accessToken, eligibility }) {
  if (!nonBlank(accessToken)) return "THREADS_ACCESS_TOKEN_MISSING";
  for (const [field, code] of REQUIRED_ELIGIBILITY) if (eligibility?.[field] !== true) return code;
  return null;
}

function sourceStatus(covered, errors) {
  if (covered.length > 0) return "PARTIAL";
  if (errors.some(({ blocking }) => blocking)) return "BLOCKED_BY_PROVIDER";
  return "FAILED";
}

function errorFromResponse(status, body) {
  const code = body?.error?.code;
  const type = body?.error?.type;
  if (status === 401 || type === "OAuthException" || code === 190) return providerError("THREADS_AUTHENTICATION_FAILED", true);
  if (status === 403 || [10, 200, 294, 299].includes(code)) return providerError("THREADS_PERMISSION_OR_REVIEW_REQUIRED", true);
  if (status === 429 || [4, 17, 32, 613].includes(code)) return providerError("THREADS_RATE_OR_QUOTA_LIMITED", true);
  if (status >= 500) return providerError("THREADS_PROVIDER_ERROR", false);
  return providerError("THREADS_REQUEST_REJECTED", false);
}

function normalizeProviderError(error) {
  return { code: typeof error?.code === "string" ? error.code : "THREADS_PROVIDER_ERROR", blocking: error?.blocking === true };
}

function providerError(code, blocking, cause) {
  return Object.assign(new Error(code, { cause }), { code, blocking });
}

function canonicalThreadsUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || host !== "threads.net" || url.username || url.password || url.port
    || !/^\/@[A-Za-z0-9._]{1,30}\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error();
  return `https://threads.net${url.pathname.replace(/\/$/, "")}`;
}

function normalizeQuery(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/[#@]/g, " ").replace(/[^\p{L}\p{N}_ -]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function unavailable(reason) { return { availability: "UNAVAILABLE", reason }; }
function nonBlank(value) { return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined; }
function stableId(prefix, value) { return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`; }
async function safeJson(response) { try { return await response.json(); } catch { return null; } }

function validateInput({ store, clusterRunId, idempotencyKey, capturedAt, apiVersion, searchType, maxQueries, maxResultsPerQuery, maxPagesPerQuery }) {
  if (!store || typeof store.getRun !== "function" || typeof store.recordOperation !== "function") throw new Error("TrendCatalogStore é obrigatório");
  if (!nonBlank(clusterRunId)) throw new Error("clusterRunId obrigatório");
  if (!nonBlank(idempotencyKey)) throw new Error("idempotencyKey explícita é obrigatória");
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt deve ser ISO 8601 válido");
  if (!/^v\d+\.\d+$/.test(apiVersion)) throw new Error("apiVersion Threads inválida");
  if (!["TOP", "RECENT"].includes(searchType)) throw new Error("searchType Threads inválido");
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) throw new Error("maxQueries deve ser inteiro entre 1 e 30");
  if (!Number.isInteger(maxResultsPerQuery) || maxResultsPerQuery < 1 || maxResultsPerQuery > 50) throw new Error("maxResultsPerQuery deve ser inteiro entre 1 e 50");
  if (!Number.isInteger(maxPagesPerQuery) || maxPagesPerQuery < 1 || maxPagesPerQuery > 10) throw new Error("maxPagesPerQuery deve ser inteiro entre 1 e 10");
}
