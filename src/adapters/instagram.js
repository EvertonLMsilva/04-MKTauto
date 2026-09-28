import { createHash } from "node:crypto";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../domain/contracts.js";
import { TREND_RANKING_CONFIG_VERSION } from "../domain/ranking.js";

const GRAPH_HOST = "graph.facebook.com";
const MEDIA_FIELDS = [
  "id", "media_type", "media_product_type", "permalink", "timestamp",
  "username", "caption", "like_count", "comments_count",
].join(",");
const REQUIRED_ELIGIBILITY = [
  ["professionalAccount", "INSTAGRAM_PROFESSIONAL_ACCOUNT_REQUIRED"],
  ["facebookPageLinked", "INSTAGRAM_FACEBOOK_PAGE_LINK_REQUIRED"],
  ["permissionsGranted", "INSTAGRAM_PERMISSIONS_REQUIRED"],
  ["appAccessApproved", "INSTAGRAM_APP_ACCESS_NOT_APPROVED"],
];

export function deriveInstagramHashtags(clusters, maxHashtags = 30) {
  if (!Array.isArray(clusters) || clusters.length === 0) throw new Error("clusters persistidos são obrigatórios");
  if (!Number.isInteger(maxHashtags) || maxHashtags < 1 || maxHashtags > 30) {
    throw new Error("maxHashtags deve ser inteiro entre 1 e 30");
  }
  const hashtags = [];
  for (const cluster of [...clusters].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const field of ["label", "niche", "subtheme"]) {
      const hashtag = normalizeHashtag(cluster[field]);
      if (!hashtag) throw new Error(`cluster ${cluster.id} não produz hashtag válida em ${field}`);
      if (!hashtags.includes(hashtag)) hashtags.push(hashtag);
      if (hashtags.length === maxHashtags) return hashtags;
    }
  }
  if (hashtags.length === 0) throw new Error("nenhuma hashtag válida foi derivada dos clusters");
  return hashtags;
}

export function normalizeInstagramHashtagMedia(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    if (typeof value.id !== "string" || !/^\d{5,64}$/.test(value.id)) throw new Error();
    if (!["VIDEO", "IMAGE", "CAROUSEL_ALBUM"].includes(value.media_type)) throw new Error();
    if (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) throw new Error();
    const canonicalUrl = canonicalInstagramUrl(value.permalink);
    return {
      platformVideoId: value.id,
      canonicalUrl,
      mediaType: value.media_type,
      ...(nonBlank(value.media_product_type) ? { mediaProductType: value.media_product_type } : {}),
      publishedAt: new Date(value.timestamp).toISOString(),
      ...(nonBlank(value.username) ? { author: value.username } : {}),
      ...(nonBlank(value.caption) ? { caption: value.caption } : {}),
      metrics: {
        views: unavailable("NOT_EXPOSED_BY_INSTAGRAM_HASHTAG_API"),
        likes: metric(value.like_count),
        comments: metric(value.comments_count),
        shares: unavailable("NOT_EXPOSED_BY_INSTAGRAM_HASHTAG_API"),
      },
      durationSeconds: unavailable("NOT_EXPOSED_BY_INSTAGRAM_HASHTAG_API"),
    };
  } catch {
    throw new Error("mídia Instagram inválida");
  }
}

export async function collectInstagramHashtagCoverage({
  accessToken,
  igUserId,
  apiVersion,
  eligibility = {},
  store,
  clusterRunId,
  idempotencyKey,
  capturedAt = new Date().toISOString(),
  maxHashtags = 30,
  maxResultsPerHashtag = 50,
  maxPagesPerHashtag = 1,
  fetchImpl = fetch,
}) {
  validateInput({ store, clusterRunId, idempotencyKey, capturedAt, maxResultsPerHashtag, maxPagesPerHashtag });
  const prior = store.getOperation?.(idempotencyKey);
  if (prior) return prior;
  const origin = store.getRun(clusterRunId);
  if (!origin) throw new Error(`Run de clusters não encontrada: ${clusterRunId}`);
  const hashtags = deriveInstagramHashtags(origin.topicClusters, maxHashtags);
  const requested = hashtags.map((hashtag) => `HASHTAG:${hashtag}`);
  const runId = stableId("instagram-run", idempotencyKey);
  const sourceRunId = stableId("instagram-source", idempotencyKey);
  const blockingConfiguration = configurationBlock({ accessToken, igUserId, apiVersion, eligibility });

  const covered = [];
  const errors = [];
  let requestsAttempted = 0;
  let pagesFetched = 0;
  let normalizedMedia = 0;
  let videoMediaWithoutDuration = 0;
  let nonVideoMedia = 0;
  let invalidMedia = 0;
  const uniqueVideos = new Map();

  if (blockingConfiguration) {
    errors.push({ hashtag: "ALL", code: blockingConfiguration, blocking: true });
  } else {
    for (let index = 0; index < hashtags.length; index += 1) {
      const hashtag = hashtags[index];
      try {
        const hashtagId = await findHashtagId({
          hashtag, igUserId, apiVersion, accessToken, fetchImpl,
          onAttempt: () => { requestsAttempted += 1; },
        });
        const items = await fetchRecentMedia({
          hashtagId, igUserId, apiVersion, accessToken, fetchImpl,
          maxResultsPerHashtag, maxPagesPerHashtag,
          onAttempt: () => { requestsAttempted += 1; },
          onPage: () => { pagesFetched += 1; },
        });
        for (const item of items) {
          try {
            const media = normalizeInstagramHashtagMedia(item);
            normalizedMedia += 1;
            if (media.mediaType === "VIDEO") {
              videoMediaWithoutDuration += 1;
              if (!uniqueVideos.has(media.platformVideoId)) uniqueVideos.set(media.platformVideoId, media);
            }
            else nonVideoMedia += 1;
          } catch {
            invalidMedia += 1;
          }
        }
        covered.push(`HASHTAG:${hashtag}`);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        errors.push({ hashtag, ...normalized });
        if (normalized.blocking) {
          for (const skipped of hashtags.slice(index + 1)) {
            errors.push({ hashtag: skipped, code: normalized.code, blocking: true });
          }
          break;
        }
      }
    }
  }

  const status = sourceStatus(covered, errors);
  const observations = [...uniqueVideos.values()].map((normalized) => toObservation({ normalized, capturedAt, runId }));
  const gaps = errors.map(({ hashtag, code }) => `HASHTAG_UNAVAILABLE:${hashtag}:${code}`);
  if (status === "PARTIAL") gaps.push("DURATION_UNAVAILABLE:INSTAGRAM_HASHTAG_MEDIA");
  const limitations = [
    "OFFICIAL_API_ONLY:Instagram_API_with_Facebook_Login",
    "DISCOVERY_METHOD:ig_hashtag_search+recent_media",
    "DISCOVERY_SCOPE:PUBLIC_HASHTAG_MEDIA_NOT_GLOBAL_TRENDS",
    "QUERY_ACCOUNT_SCOPE:AUTHORIZED_PROFESSIONAL_ACCOUNT",
    `QUERY_ACCOUNT_ID:${igUserId && /^\d{5,64}$/.test(igUserId) ? igUserId : "UNAVAILABLE"}`,
    "ORDERING_NOT_GUARANTEED",
    "REGION_FILTER_NOT_SUPPORTED",
    "VIEWS_SHARES_DURATION_NOT_EXPOSED",
    `REQUESTS_ATTEMPTED:${requestsAttempted}`,
    `PAGES_FETCHED:${pagesFetched}`,
    `MAX_HASHTAGS:${maxHashtags}`,
    `MAX_RESULTS_PER_HASHTAG:${maxResultsPerHashtag}`,
    `PUBLIC_MEDIA_NORMALIZED:${normalizedMedia}`,
    `UNRANKABLE_WITHOUT_DURATION:${videoMediaWithoutDuration}`,
  ];
  if (nonVideoMedia > 0) limitations.push(`NON_VIDEO_MEDIA_DISCARDED:${nonVideoMedia}`);
  if (invalidMedia > 0) limitations.push(`INVALID_MEDIA_DISCARDED:${invalidMedia}`);

  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform: "INSTAGRAM",
    status,
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: {
      discovery: blockingConfiguration ? "UNAVAILABLE" : "HASHTAG_SEARCH",
      metrics: ["LIKES", "COMMENTS"],
      supportsRegions: false,
      limitations,
    },
    // O contrato 1.0.0 nomeia a dimensão como regiões. R02E preserva a versão
    // e usa valores tipados HASHTAG:<termo> até uma futura evolução contratual.
    coverage: { requestedRegions: requested, coveredRegions: covered, complete: false },
    gaps,
    ...(status === "PARTIAL" ? {
      errorCode: errors.length > 0 ? "INSTAGRAM_HASHTAG_PARTIAL_FAILURE" : "INSTAGRAM_PUBLIC_MEDIA_DURATION_UNAVAILABLE",
    } : {}),
    ...(["BLOCKED_BY_PROVIDER", "FAILED"].includes(status) ? {
      errorCode: errors[0]?.code ?? "INSTAGRAM_PROVIDER_ERROR",
    } : {}),
  };
  const run = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: runId,
    state: status === "FAILED" ? "FAILED" : "COMPLETED_WITH_GAPS",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    sourceRunIds: [sourceRunId],
    candidateIds: observations.map(({ candidate }) => candidate.id),
    rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
  };
  return store.recordOperation({ idempotencyKey, run, sourceRuns: [sourceRun], observations });
}

function toObservation({ normalized, capturedAt, runId }) {
  const candidateId = `instagram:${normalized.platformVideoId}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: candidateId,
      identityKey: canonicalTrendIdentity({ platform: "INSTAGRAM", platformVideoId: normalized.platformVideoId, canonicalUrl: normalized.canonicalUrl }),
      platform: "INSTAGRAM",
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
      ...(normalized.caption ? { title: normalized.caption } : {}),
      category: normalized.mediaProductType ?? "INSTAGRAM_VIDEO",
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: stableId("instagram-snapshot", `${runId}:${normalized.platformVideoId}`),
      candidateId,
      capturedAt,
      metrics: normalized.metrics,
    },
    reappearanceReason: "HASHTAG_PUBLIC_QUERY_MATCH",
  };
}

async function findHashtagId({ hashtag, igUserId, apiVersion, accessToken, fetchImpl, onAttempt }) {
  const url = graphUrl(apiVersion, "ig_hashtag_search", { user_id: igUserId, q: hashtag });
  const body = await requestJson({ url, accessToken, fetchImpl, onAttempt });
  const id = body?.data?.[0]?.id;
  if (typeof id !== "string" || !/^\d{5,64}$/.test(id)) {
    throw providerError("INSTAGRAM_HASHTAG_NOT_FOUND", false);
  }
  return id;
}

async function fetchRecentMedia({
  hashtagId, igUserId, apiVersion, accessToken, fetchImpl,
  maxResultsPerHashtag, maxPagesPerHashtag, onAttempt, onPage,
}) {
  const items = [];
  let after;
  let fetchedPages = 0;
  while (items.length < maxResultsPerHashtag && fetchedPages < maxPagesPerHashtag) {
    const url = graphUrl(apiVersion, `${hashtagId}/recent_media`, {
      user_id: igUserId,
      fields: MEDIA_FIELDS,
      limit: String(Math.min(50, maxResultsPerHashtag - items.length)),
      ...(after ? { after } : {}),
    });
    const body = await requestJson({ url, accessToken, fetchImpl, onAttempt });
    onPage();
    fetchedPages += 1;
    const pageItems = Array.isArray(body?.data) ? body.data : [];
    items.push(...pageItems.slice(0, maxResultsPerHashtag - items.length));
    const nextAfter = body?.paging?.cursors?.after;
    after = typeof nextAfter === "string" && nextAfter.length <= 2048 ? nextAfter : undefined;
    if (!after || pageItems.length === 0) break;
  }
  return items;
}

async function requestJson({ url, accessToken, fetchImpl, onAttempt }) {
  let response;
  try {
    onAttempt();
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (cause) {
    throw providerError("INSTAGRAM_NETWORK_ERROR", false, cause);
  }
  const body = await safeJson(response);
  if (!response.ok) throw errorFromResponse(response.status, body);
  return body;
}

function configurationBlock({ accessToken, igUserId, apiVersion, eligibility }) {
  if (!nonBlank(accessToken)) return "INSTAGRAM_ACCESS_TOKEN_MISSING";
  if (typeof igUserId !== "string" || !/^\d{5,64}$/.test(igUserId)) return "INSTAGRAM_PROFESSIONAL_ACCOUNT_ID_MISSING";
  if (typeof apiVersion !== "string" || !/^v\d+\.\d+$/.test(apiVersion)) return "INSTAGRAM_API_VERSION_MISSING";
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
  if (status === 401 || type === "OAuthException" || code === 190) {
    return providerError("INSTAGRAM_AUTHENTICATION_FAILED", true);
  }
  if ([10, 200, 294, 299].includes(code)) return providerError("INSTAGRAM_PERMISSION_OR_REVIEW_REQUIRED", true);
  if (status === 429 || [4, 17, 32, 613].includes(code)) return providerError("INSTAGRAM_RATE_OR_QUOTA_LIMITED", true);
  if (status >= 500) return providerError("INSTAGRAM_PROVIDER_ERROR", false);
  return providerError("INSTAGRAM_REQUEST_REJECTED", false);
}

function normalizeProviderError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "INSTAGRAM_PROVIDER_ERROR",
    blocking: error?.blocking === true,
  };
}

function providerError(code, blocking, cause) {
  return Object.assign(new Error(code, { cause }), { code, blocking });
}

function graphUrl(apiVersion, path, params) {
  const url = new URL(`https://${GRAPH_HOST}/${apiVersion}/${path}`);
  url.search = new URLSearchParams(params);
  return url;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeHashtag(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/^#+/, "").replace(/[^a-z0-9_]/g, "").slice(0, 100);
}

function canonicalInstagramUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || host !== "instagram.com" || url.username || url.password || url.port
    || !/^\/(?:p|reel|tv)\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) throw new Error();
  return `https://instagram.com${url.pathname.replace(/\/$/, "")}`;
}

function metric(value) {
  if (value === undefined || value === null || value === "") return unavailable("NOT_RETURNED_BY_PROVIDER");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return unavailable("INVALID_PROVIDER_VALUE");
  return { availability: "AVAILABLE", value: number };
}

function unavailable(reason) {
  return { availability: "UNAVAILABLE", reason };
}

function nonBlank(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function validateInput({ store, clusterRunId, idempotencyKey, capturedAt, maxResultsPerHashtag, maxPagesPerHashtag }) {
  if (!store || typeof store.getRun !== "function" || typeof store.recordOperation !== "function") throw new Error("TrendCatalogStore é obrigatório");
  if (!nonBlank(clusterRunId)) throw new Error("clusterRunId obrigatório");
  if (!nonBlank(idempotencyKey)) throw new Error("idempotencyKey explícita é obrigatória");
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("capturedAt deve ser ISO 8601 válido");
  if (!Number.isInteger(maxResultsPerHashtag) || maxResultsPerHashtag < 1 || maxResultsPerHashtag > 50) {
    throw new Error("maxResultsPerHashtag deve ser inteiro entre 1 e 50");
  }
  if (!Number.isInteger(maxPagesPerHashtag) || maxPagesPerHashtag < 1 || maxPagesPerHashtag > 10) {
    throw new Error("maxPagesPerHashtag deve ser inteiro entre 1 e 10");
  }
}
