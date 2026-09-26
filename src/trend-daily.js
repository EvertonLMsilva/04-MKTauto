import { createHash } from "node:crypto";
import { collectInstagramHashtagCoverage } from "./adapters/instagram.js";
import { proposeTopicClusters } from "./adapters/ollama.js";
import { collectTikTokOfficialCoverage } from "./adapters/tiktok.js";
import { collectPopularYouTubeTrends } from "./adapters/youtube.js";
import { RADAR_CONTRACT_VERSION } from "./domain/contracts.js";
import { DEFAULT_TREND_RANKING_CONFIG, TREND_RANKING_CONFIG_VERSION } from "./domain/ranking.js";
import { analyzeTrendRun } from "./trend-analysis.js";
import { exportDailyCatalog } from "./trend-export.js";

const STEP = Object.freeze({
  youtube: "10-youtube",
  seed: "20-seed-clustering",
  instagram: "30-instagram",
  tiktok: "40-tiktok",
  consolidate: "50-consolidate",
  analysis: "60-final-analysis",
  export: "70-export",
});

export async function runDailyTrendCatalog({
  store,
  logicalDate,
  timezone,
  config,
  clock = () => new Date(),
  fetchImpl = fetch,
  fileSystem,
  outputRoot = "data/trends",
  collectors = {},
  clusterer,
  sleep = defaultSleep,
}) {
  validateDailyInput({ store, logicalDate, timezone, config });
  const publicConfig = sanitizeConfig(config);
  const configHash = stableHash(configFingerprint(config));
  const dailyId = `daily:${logicalDate}:${configHash.slice(0, 16)}`;
  const startedAt = iso(clock());
  let daily = store.beginDailyRun({ id: dailyId, logicalDate, timezone, configHash, config: publicConfig, startedAt });
  if (["COMPLETED", "COMPLETED_WITH_GAPS", "FAILED"].includes(daily.state)) {
    return resultForExisting({ store, daily, outputRoot, fileSystem });
  }

  const youtubeBatch = await providerStep({
    store, dailyId, stepKey: STEP.youtube, platform: "YOUTUBE", clock, capturedAt: startedAt,
    ready: Boolean(config.youtube?.apiKey),
    blockCode: "YOUTUBE_API_KEY_MISSING",
    discovery: "GLOBAL_TRENDS",
    collect: () => captureOperation(collectors.youtube ?? collectPopularYouTubeTrends, {
      apiKey: config.youtube?.apiKey,
      regions: config.regions ?? DEFAULT_TREND_RANKING_CONFIG.regions,
      maxResultsPerRegion: config.youtube?.maxResultsPerRegion ?? 50,
      maxPagesPerRegion: config.youtube?.maxPagesPerRegion ?? 1,
      capturedAt: startedAt,
      idempotencyKey: `${dailyId}:youtube`,
      fetchImpl,
    }),
  });

  let seedCatalog;
  let seedGap;
  if (youtubeBatch.observations.length === 0) {
    seedGap = "CLUSTERING_SKIPPED:NO_YOUTUBE_EVIDENCE";
    await skippedStep(store, dailyId, STEP.seed, clock, seedGap);
  } else if (!config.ollama?.model && !clusterer) {
    seedGap = "CLUSTERING_BLOCKED:OLLAMA_MODEL_MISSING";
    await skippedStep(store, dailyId, STEP.seed, clock, seedGap);
  } else {
    try {
      const seed = await persistedStep(store, dailyId, STEP.seed, clock, async () => {
        const memory = memoryAnalysisStore(batchToCatalog(youtubeBatch));
        const retried = await analyzeWithClusteringRetries({
          analyze: collectors.analyze ?? analyzeTrendRun,
          clusterer,
          sleep,
          args: {
            store: memory,
            runId: youtubeBatch.run.id,
            idempotencyKey: `${dailyId}:seed-analysis`,
            model: config.ollama?.model,
            config: config.ranking ?? DEFAULT_TREND_RANKING_CONFIG,
            now: startedAt,
            fetchImpl,
          },
        });
        return { topicClusters: retried.value.catalog.topicClusters, clusteringAttempts: retried.attempts };
      });
      seedCatalog = { ...batchToCatalog(youtubeBatch), topicClusters: seed.topicClusters };
    } catch (error) {
      seedGap = `CLUSTERING_FAILED:${safeErrorCode(error)}`;
    }
  }

  const instagramBatch = await providerStep({
    store, dailyId, stepKey: STEP.instagram, platform: "INSTAGRAM", clock, capturedAt: startedAt,
    ready: instagramReady(config.instagram) && Boolean(seedCatalog),
    blockCode: seedCatalog ? instagramBlock(config.instagram) : "DEPENDENCY_CLUSTERING_UNAVAILABLE",
    discovery: "HASHTAG_SEARCH",
    collect: () => captureOperation(collectors.instagram ?? collectInstagramHashtagCoverage, {
      ...config.instagram,
      storeCatalog: seedCatalog,
      clusterRunId: youtubeBatch.run.id,
      idempotencyKey: `${dailyId}:instagram`,
      capturedAt: startedAt,
      fetchImpl,
    }),
  });

  const tiktokNeedsClusters = (config.tiktok?.product ?? "RESEARCH_API") === "RESEARCH_API";
  const tiktokBatch = await providerStep({
    store, dailyId, stepKey: STEP.tiktok, platform: "TIKTOK", clock, capturedAt: startedAt,
    ready: tiktokReady(config.tiktok) && (!tiktokNeedsClusters || Boolean(seedCatalog)),
    blockCode: tiktokNeedsClusters && !seedCatalog ? "DEPENDENCY_CLUSTERING_UNAVAILABLE" : tiktokBlock(config.tiktok),
    discovery: config.tiktok?.product === "DISPLAY_API" ? "AUTHORIZED_ONLY" : "PUBLIC_QUERY",
    collect: () => captureOperation(collectors.tiktok ?? collectTikTokOfficialCoverage, {
      ...config.tiktok,
      storeCatalog: seedCatalog,
      clusterRunId: youtubeBatch.run.id,
      idempotencyKey: `${dailyId}:tiktok`,
      capturedAt: startedAt,
      startDate: config.tiktok?.startDate ?? compactDate(logicalDate),
      endDate: config.tiktok?.endDate ?? compactDate(logicalDate),
      regions: config.regions ?? DEFAULT_TREND_RANKING_CONFIG.regions,
      fetchImpl,
    }),
  });

  const batches = [youtubeBatch, instagramBatch, tiktokBatch];
  const trendRunId = `trend:${logicalDate}:${configHash.slice(0, 16)}`;
  const consolidated = await persistedStep(store, dailyId, STEP.consolidate, clock, async () => {
    const sourceRuns = batches.flatMap((batch) => batch.sourceRuns).map((source) => ({ ...source, trendRunId }));
    const observations = deduplicateObservations(batches.flatMap((batch) => batch.observations));
    const hasSourceGap = sourceRuns.some(({ status }) => status !== "SUCCESS");
    const state = observations.length === 0 ? "FAILED" : hasSourceGap ? "COMPLETED_WITH_GAPS" : "COMPLETED";
    const run = {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: trendRunId,
      state,
      createdAt: startedAt,
      updatedAt: startedAt,
      sourceRunIds: sourceRuns.map(({ id }) => id),
      candidateIds: observations.map(({ candidate }) => candidate.id),
      rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
    };
    store.recordOperation({ idempotencyKey: `${dailyId}:consolidate`, run, sourceRuns, observations });
    return { trendRunId, state, candidateCount: observations.length };
  });

  let ranking = { ranked: [], top: [], gaps: [] };
  const operationalGaps = [seedGap].filter(Boolean);
  if (consolidated.candidateCount === 0) {
    operationalGaps.push("ANALYSIS_SKIPPED:NO_VALID_EVIDENCE");
    await skippedStep(store, dailyId, STEP.analysis, clock, "NO_VALID_EVIDENCE");
  } else if (!config.ollama?.model && !clusterer) {
    operationalGaps.push("ANALYSIS_BLOCKED:OLLAMA_MODEL_MISSING");
    await skippedStep(store, dailyId, STEP.analysis, clock, "OLLAMA_MODEL_MISSING");
  } else {
    try {
      ranking = await persistedStep(store, dailyId, STEP.analysis, clock, async () => {
        const retried = await analyzeWithClusteringRetries({
          analyze: collectors.analyze ?? analyzeTrendRun,
          clusterer,
          sleep,
          args: {
            store,
            runId: trendRunId,
            idempotencyKey: `${dailyId}:final-analysis`,
            model: config.ollama?.model,
            config: config.ranking ?? DEFAULT_TREND_RANKING_CONFIG,
            now: startedAt,
            fetchImpl,
          },
        });
        const result = retried.value;
        return { ranked: result.ranked, top: result.top, gaps: result.gaps, clusteringAttempts: retried.attempts };
      });
      operationalGaps.push(...ranking.gaps);
    } catch (error) {
      operationalGaps.push(`ANALYSIS_FAILED:${safeErrorCode(error)}`);
    }
  }

  const catalog = store.getRun(trendRunId);
  const sourceGaps = catalog.sourceRuns.flatMap(({ gaps }) => gaps);
  const gaps = [...new Set([...sourceGaps, ...operationalGaps])];
  const finalState = catalog.candidates.length === 0 ? "FAILED" : gaps.length > 0 ? "COMPLETED_WITH_GAPS" : "COMPLETED";
  const completedAt = iso(clock());
  daily = store.finishDailyRun({
    logicalDate,
    state: finalState,
    trendRunId,
    completedAt,
    durationMs: elapsedMs(startedAt, completedAt),
    result: {
      gaps,
      rankedCandidateIds: ranking.ranked.map(({ candidate }) => candidate.id),
      topCandidateIds: ranking.top.map(({ candidate }) => candidate.id),
    },
  });
  const exported = await persistedStep(store, dailyId, STEP.export, clock, async () => exportDailyCatalog({
    store, logicalDate, outputRoot, fileSystem,
  }));
  return { dailyRun: store.getDailyRun(logicalDate), catalog: store.getRun(trendRunId), exported };
}

async function resultForExisting({ store, daily, outputRoot, fileSystem }) {
  const exported = exportDailyCatalog({ store, logicalDate: daily.logicalDate, outputRoot, fileSystem });
  return { dailyRun: store.getDailyRun(daily.logicalDate), catalog: daily.trendRunId ? store.getRun(daily.trendRunId) : null, exported };
}

async function persistedStep(store, dailyRunId, stepKey, clock, operation) {
  const prior = store.getDailyStep(dailyRunId, stepKey);
  if (["COMPLETED", "SKIPPED"].includes(prior?.state)) return prior.result;
  const startedAt = iso(clock());
  store.startDailyStep({ dailyRunId, stepKey, startedAt });
  try {
    const result = await operation();
    const completedAt = iso(clock());
    store.finishDailyStep({ dailyRunId, stepKey, state: "COMPLETED", completedAt, durationMs: elapsedMs(startedAt, completedAt), result });
    return result;
  } catch (error) {
    const completedAt = iso(clock());
    store.finishDailyStep({
      dailyRunId, stepKey, state: "FAILED", completedAt, durationMs: elapsedMs(startedAt, completedAt),
      result: { errorCode: safeErrorCode(error), ...(Number.isInteger(error?.attempts) ? { attempts: error.attempts } : {}) },
    });
    throw error;
  }
}

async function skippedStep(store, dailyRunId, stepKey, clock, reason) {
  const prior = store.getDailyStep(dailyRunId, stepKey);
  if (prior) return prior.result;
  const at = iso(clock());
  store.startDailyStep({ dailyRunId, stepKey, startedAt: at });
  return store.finishDailyStep({ dailyRunId, stepKey, state: "SKIPPED", completedAt: at, durationMs: 0, result: { reason } }).result;
}

async function providerStep({ store, dailyId, stepKey, platform, clock, capturedAt, ready, blockCode, discovery, collect }) {
  if (!ready) {
    const batch = blockedBatch({ platform, dailyId, capturedAt, blockCode, discovery });
    const prior = store.getDailyStep(dailyId, stepKey);
    if (prior?.state === "COMPLETED") return prior.result;
    const at = iso(clock());
    store.startDailyStep({ dailyRunId: dailyId, stepKey, startedAt: at });
    store.finishDailyStep({ dailyRunId: dailyId, stepKey, state: "COMPLETED", completedAt: at, durationMs: 0, result: batch });
    return batch;
  }
  try {
    return await persistedStep(store, dailyId, stepKey, clock, collect);
  } catch (error) {
    return blockedBatch({ platform, dailyId, capturedAt, blockCode: safeErrorCode(error), discovery, failed: true });
  }
}

async function captureOperation(collector, args) {
  let captured;
  const store = {
    getOperation: () => null,
    getRun: () => args.storeCatalog ?? null,
    recordOperation: (input) => { captured = input; return batchToCatalog(input); },
  };
  await collector({ ...args, store });
  if (!captured) throw new Error("COLLECTOR_DID_NOT_RECORD_OPERATION");
  return captured;
}

function memoryAnalysisStore(catalog) {
  const histories = new Map(catalog.candidates.map((candidate) => [candidate.id, {
    candidate,
    snapshots: catalog.snapshots.filter(({ candidateId }) => candidateId === candidate.id),
    appearances: [], velocities: [],
  }]));
  return {
    getOperation: () => null,
    getRun: () => catalog,
    getCandidateHistory: (id) => histories.get(id),
    recordAnalysis: ({ topicClusters, scores }) => Object.assign(catalog, { topicClusters, scores }),
  };
}

function batchToCatalog(batch) {
  return {
    run: batch.run,
    sourceRuns: batch.sourceRuns ?? [],
    candidates: (batch.observations ?? []).map(({ candidate }) => candidate),
    snapshots: (batch.observations ?? []).map(({ snapshot }) => snapshot),
    topicClusters: batch.topicClusters ?? [],
    scores: batch.scores ?? [],
    appearances: [],
  };
}

function blockedBatch({ platform, dailyId, capturedAt, blockCode, discovery, failed = false }) {
  const sourceRunId = `${platform.toLowerCase()}-source:${stableHash(`${dailyId}:${blockCode}`).slice(0, 24)}`;
  const runId = `${platform.toLowerCase()}-blocked:${stableHash(dailyId).slice(0, 24)}`;
  const sourceRun = {
    schemaVersion: RADAR_CONTRACT_VERSION,
    id: sourceRunId,
    trendRunId: runId,
    platform,
    status: failed ? "FAILED" : "BLOCKED_BY_PROVIDER",
    startedAt: capturedAt,
    completedAt: capturedAt,
    capabilities: {
      discovery: "UNAVAILABLE",
      metrics: [],
      supportsRegions: platform !== "INSTAGRAM",
      limitations: [`REQUEST_SKIPPED:${blockCode}`, `INTENDED_DISCOVERY:${discovery}`],
    },
    coverage: { requestedRegions: [discovery], coveredRegions: [], complete: false },
    gaps: [`SOURCE_UNAVAILABLE:${blockCode}`],
    errorCode: blockCode,
  };
  return {
    idempotencyKey: `${dailyId}:${platform.toLowerCase()}:blocked`,
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: runId, state: "COMPLETED_WITH_GAPS",
      createdAt: capturedAt, updatedAt: capturedAt, sourceRunIds: [sourceRunId], candidateIds: [],
      rankingConfigVersion: TREND_RANKING_CONFIG_VERSION,
    },
    sourceRuns: [sourceRun], observations: [],
  };
}

function deduplicateObservations(observations) {
  const values = new Map();
  for (const observation of observations) {
    const key = `${observation.candidate.identityKey}|${observation.snapshot.capturedAt}`;
    if (!values.has(key)) values.set(key, observation);
  }
  return [...values.values()];
}

function sanitizeConfig(config) {
  return {
    regions: [...(config.regions ?? DEFAULT_TREND_RANKING_CONFIG.regions)],
    ranking: config.ranking ?? DEFAULT_TREND_RANKING_CONFIG,
    youtube: {
      configured: Boolean(config.youtube?.apiKey),
      maxResultsPerRegion: config.youtube?.maxResultsPerRegion ?? 50,
      maxPagesPerRegion: config.youtube?.maxPagesPerRegion ?? 1,
    },
    ollama: { configured: Boolean(config.ollama?.model), model: config.ollama?.model ?? "UNAVAILABLE" },
    instagram: {
      configured: instagramReady(config.instagram), apiVersion: config.instagram?.apiVersion ?? "UNAVAILABLE",
      eligibility: booleanMap(config.instagram?.eligibility),
    },
    tiktok: {
      configured: tiktokReady(config.tiktok), product: config.tiktok?.product ?? "RESEARCH_API",
      eligibility: booleanMap(config.tiktok?.eligibility), displayAccess: booleanMap(config.tiktok?.displayAccess),
    },
  };
}

function configFingerprint(config) {
  return {
    ...sanitizeConfig(config),
    credentials: {
      youtube: secretMarker(config.youtube?.apiKey),
      instagram: secretMarker(config.instagram?.accessToken),
      tiktok: secretMarker(config.tiktok?.accessToken),
      instagramAccount: secretMarker(config.instagram?.igUserId),
      tiktokAccount: secretMarker(config.tiktok?.authorizedAccountContext),
    },
  };
}

function instagramReady(value) { return instagramBlock(value) === null; }
function instagramBlock(value = {}) {
  if (!value.accessToken) return "INSTAGRAM_ACCESS_TOKEN_MISSING";
  if (!/^\d{5,64}$/.test(value.igUserId ?? "")) return "INSTAGRAM_PROFESSIONAL_ACCOUNT_ID_MISSING";
  if (!/^v\d+\.\d+$/.test(value.apiVersion ?? "")) return "INSTAGRAM_API_VERSION_MISSING";
  for (const [field, code] of [
    ["professionalAccount", "INSTAGRAM_PROFESSIONAL_ACCOUNT_REQUIRED"],
    ["facebookPageLinked", "INSTAGRAM_FACEBOOK_PAGE_LINK_REQUIRED"],
    ["permissionsGranted", "INSTAGRAM_PERMISSIONS_REQUIRED"],
    ["appAccessApproved", "INSTAGRAM_APP_ACCESS_NOT_APPROVED"],
  ]) {
    if (value.eligibility?.[field] !== true) return code;
  }
  return null;
}

function tiktokReady(value) { return tiktokBlock(value) === null; }
function tiktokBlock(value = {}) {
  const product = value.product ?? "RESEARCH_API";
  if (product === "DISPLAY_API") {
    for (const [field, code] of [
      ["accountAuthorized", "TIKTOK_DISPLAY_ACCOUNT_AUTHORIZATION_REQUIRED"],
      ["appApproved", "TIKTOK_DISPLAY_APP_APPROVAL_REQUIRED"],
      ["videoListScopeGranted", "TIKTOK_DISPLAY_VIDEO_LIST_SCOPE_REQUIRED"],
    ]) if (value.displayAccess?.[field] !== true) return code;
    if (!value.authorizedAccountContext) return "TIKTOK_DISPLAY_ACCOUNT_CONTEXT_REQUIRED";
    return null;
  }
  if (product !== "RESEARCH_API") return "TIKTOK_PRODUCT_NOT_DISCOVERY";
  if (!value.accessToken) return "TIKTOK_RESEARCH_ACCESS_TOKEN_MISSING";
  for (const [field, code] of [
    ["eligibleOrganization", "TIKTOK_RESEARCH_ELIGIBLE_ORGANIZATION_REQUIRED"],
    ["nonCommercialResearch", "TIKTOK_RESEARCH_NON_COMMERCIAL_REQUIRED"],
    ["ethicalReviewApproved", "TIKTOK_RESEARCH_ETHICAL_REVIEW_REQUIRED"],
    ["researchProjectApproved", "TIKTOK_RESEARCH_PROJECT_NOT_APPROVED"],
    ["researchScopeGranted", "TIKTOK_RESEARCH_SCOPE_NOT_GRANTED"],
    ["retentionControlsApproved", "TIKTOK_RESEARCH_RETENTION_CONTROLS_REQUIRED"],
  ]) {
    if (value.eligibility?.[field] !== true) return code;
  }
  return null;
}

function booleanMap(value) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, item]) => [key, item === true]));
}

function secretMarker(value) {
  return typeof value === "string" && value !== "" ? stableHash(value).slice(0, 16) : "UNAVAILABLE";
}

function compactDate(value) { return value.replaceAll("-", ""); }
function iso(value) { return (value instanceof Date ? value : new Date(value)).toISOString(); }
function elapsedMs(start, end) { return Math.max(0, Date.parse(end) - Date.parse(start)); }
function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_.:-]{2,159}$/.test(code) ? code : "OPERATION_FAILED";
}
function stableHash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateDailyInput({ store, logicalDate, timezone, config }) {
  if (!store || typeof store.beginDailyRun !== "function") throw new Error("TrendCatalogStore diário é obrigatório");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logicalDate) || new Date(`${logicalDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== logicalDate) throw new Error("logicalDate deve usar YYYY-MM-DD válido");
  if (typeof timezone !== "string" || timezone.trim() === "") throw new Error("timezone explícito é obrigatório");
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(); } catch { throw new Error("timezone IANA inválido"); }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("config é obrigatória");
}

export async function retryClustering(operation, {
  maxAttempts = 5,
  baseDelayMs = 250,
  sleep = defaultSleep,
} = {}) {
  if (typeof operation !== "function") throw new Error("operação de clustering obrigatória");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error("maxAttempts deve estar entre 1 e 5");
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) throw new Error("baseDelayMs deve ser inteiro não negativo");
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!isRetryableClusteringError(error)) throw error;
      if (attempt === maxAttempts) break;
      await sleep(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
  const exhausted = new Error(`clustering falhou após ${maxAttempts} tentativas`, { cause: lastError });
  exhausted.code = "OLLAMA_RETRY_EXHAUSTED";
  exhausted.attempts = maxAttempts;
  throw exhausted;
}

async function analyzeWithClusteringRetries({ analyze, args, clusterer, sleep }) {
  let validationFeedback;
  const baseClusterer = clusterer ?? proposeTopicClusters;
  return retryClustering(async () => {
    try {
      return await analyze({
        ...args,
        clusterer: (input) => baseClusterer({
          ...input,
          ...(validationFeedback ? { validationFeedback } : {}),
        }),
      });
    } catch (error) {
      validationFeedback = typeof error?.retryFeedback === "string" ? error.retryFeedback : undefined;
      throw error;
    }
  }, { sleep });
}

function isRetryableClusteringError(error) {
  if (error instanceof SyntaxError) return true;
  if (error?.name === "ContractValidationError") return true;
  if (["AI_EVIDENCE_MUTATION", "UNKNOWN_EVIDENCE", "INVALID_CLUSTER_MEMBERSHIP"].includes(error?.code)) return true;
  const message = String(error?.message ?? "");
  if (error instanceof TypeError && /fetch|network/i.test(message)) return true;
  const httpStatus = /Ollama respondeu (\d{3})/.exec(message)?.[1];
  if (httpStatus) return Number(httpStatus) === 408 || Number(httpStatus) === 429 || Number(httpStatus) >= 500;
  return [
    "message.content",
    "clusters[]",
    "não retornou clusters",
    "Candidato presente em mais de um cluster",
    "Candidatos sem cluster",
    "não pertence aos candidatos",
  ].some((fragment) => message.includes(fragment));
}

function defaultSleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export { STEP as DAILY_STEPS };
