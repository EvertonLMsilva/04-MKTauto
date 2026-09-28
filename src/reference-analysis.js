import { createHash } from "node:crypto";
import { analyzeInstagramReference } from "./adapters/instagram.js";
import { analyzeThreadsReference } from "./adapters/threads.js";
import { analyzeTikTokReference } from "./adapters/tiktok.js";
import { analyzeYouTubeReference } from "./adapters/youtube.js";
import {
  REFERENCE_ANALYSIS_POLICY_VERSION,
  REFERENCE_INSIGHT_CONTRACT_VERSION,
  createReferenceInsight,
} from "./domain/reference-insight-contracts.js";
import { createResearchInput } from "./domain/research-contracts.js";

const MAX_ITEMS = 25;
const LOOKBACK_DAYS = 30;
const DEFAULT_PROVIDERS = Object.freeze({
  instagram: analyzeInstagramReference,
  threads: analyzeThreadsReference,
  tiktok: analyzeTikTokReference,
  youtube: analyzeYouTubeReference,
});

export class ReferenceAnalysisError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ReferenceAnalysisError";
    this.code = code;
  }
}

export async function analyzeStrategicReferences({
  researchInput: input,
  store,
  providers = DEFAULT_PROVIDERS,
  providerConfig = {},
  clock = () => new Date().toISOString(),
}) {
  requireStore(store);
  const researchInput = createResearchInput(input);
  const references = planReferences(researchInput.projectSnapshot.references);
  const timezone = researchInput.projectSnapshot.channel.publishing.timezone;
  const analysisWindow = analysisWindowFor(researchInput.window.logicalDate, timezone);
  const researchInputHash = stableHash(researchInput);
  const projectSnapshotHash = stableHash(researchInput.projectSnapshot);
  const configHash = stableHash({
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    maxItemsPerReference: MAX_ITEMS,
    providers: Object.keys(providers).sort(),
  });
  const identity = [researchInput.execution.pipelineRunId, researchInput.execution.projectId,
    researchInput.execution.projectVersion, researchInput.window.logicalDate].join("|");
  const runId = stableId("reference-analysis", identity);
  const existingArtifact = store.getReferenceInsight(runId);
  if (existingArtifact) return existingArtifact;
  const startedAt = clock();
  store.beginReferenceAnalysisRun({
    id: runId,
    pipelineRunId: researchInput.execution.pipelineRunId,
    projectId: researchInput.execution.projectId,
    projectVersion: researchInput.execution.projectVersion,
    logicalDate: researchInput.window.logicalDate,
    timezone,
    researchInputHash,
    projectSnapshotHash,
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    configHash,
    startedAt,
  });

  const results = [];
  for (const planned of references) {
    const prior = store.getReferenceAnalysisStep(runId, planned.referenceKey);
    if (prior?.state === "COMPLETED") {
      results.push(prior.result);
      continue;
    }
    const stepStartedAt = clock();
    store.startReferenceAnalysisStep({ referenceAnalysisRunId: runId, referenceKey: planned.referenceKey, startedAt: stepStartedAt });
    const provider = providers[planned.platform];
    let result;
    if (!provider) {
      result = completedReference(planned, "UNSUPPORTED", "UNAVAILABLE", [], [
        planned.platform === "facebook" ? "FACEBOOK_PROVIDER_OUT_OF_SCOPE" : "REFERENCE_PROVIDER_UNAVAILABLE",
      ]);
    } else {
      try {
        const response = await provider({
          handle: planned.configuredHandle,
          maxItems: MAX_ITEMS,
          ...(providerConfig[planned.platform] ?? {}),
        });
        result = normalizeProviderResult(planned, response, analysisWindow, researchInput.projectSnapshot, clock());
      } catch (error) {
        result = completedReference(planned, "FAILED", "UNAVAILABLE", [], [safeErrorCode(error)]);
      }
    }
    const stepCompletedAt = clock();
    store.finishReferenceAnalysisStep({
      referenceAnalysisRunId: runId,
      referenceKey: planned.referenceKey,
      state: "COMPLETED",
      completedAt: stepCompletedAt,
      durationMs: elapsed(stepStartedAt, stepCompletedAt),
      result,
    });
    results.push(result);
  }

  const patterns = aggregatePatterns(results);
  const gaps = results.flatMap((result) => result.gaps.map((gap) => `${result.referenceKey}:${gap}`));
  if (references.length === 0) gaps.push("NO_CONFIGURED_REFERENCES");
  if (results.some((result) => result.evidence.length > 0) && patterns.length === 0) gaps.push("INSUFFICIENT_AGGREGATE_SAMPLE");
  const state = gaps.length === 0 && results.every(({ status }) => status === "SUCCESS")
    ? "COMPLETED" : "COMPLETED_WITH_GAPS";
  const createdAt = clock();
  const content = {
    schemaVersion: REFERENCE_INSIGHT_CONTRACT_VERSION,
    artifactType: "strategic_reference_analysis",
    artifactId: stableId("reference-insight", identity),
    revision: 1,
    pipelineRunId: researchInput.execution.pipelineRunId,
    projectId: researchInput.execution.projectId,
    projectVersion: researchInput.execution.projectVersion,
    logicalDate: researchInput.window.logicalDate,
    researchInputHash,
    projectSnapshotHash,
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    analysisWindow,
    createdAt,
    createdBy: "SYSTEM",
    state,
    references: results.map(({ signals, ...reference }) => reference),
    patterns,
    gaps,
    rights: {
      usageCondition: "strategic_reference_only",
      grantsUsageRights: false,
      mediaDownloaded: false,
      sourceTextStored: false,
      republicationAllowed: false,
    },
  };
  const artifact = createReferenceInsight({ ...content, contentHash: stableHash(content) });
  const stored = store.recordReferenceInsight({ referenceAnalysisRunId: runId, artifact });
  const completedAt = clock();
  store.finishReferenceAnalysisRun({
    id: runId, state, completedAt, durationMs: elapsed(startedAt, completedAt),
    result: { artifactId: stored.artifactId, contentHash: stored.contentHash },
  });
  return stored;
}

export function canonicalReferenceHandle(platform, value) {
  if (typeof value !== "string") throw new ReferenceAnalysisError("INVALID_REFERENCE_HANDLE", "handle inválido");
  const handle = value.normalize("NFKC").trim().replace(/^@/, "").toLocaleLowerCase("en-US");
  const limits = { facebook: 80, instagram: 30, threads: 30, tiktok: 24, youtube: 100 };
  const pattern = platform === "youtube" ? /^[\p{L}\p{N}._-]+$/u : /^[a-z0-9._-]+$/;
  if (!limits[platform] || handle.length < 1 || handle.length > limits[platform]
    || !pattern.test(handle)) {
    throw new ReferenceAnalysisError("INVALID_REFERENCE_HANDLE", `${platform}:${value}`);
  }
  return handle;
}

function planReferences(references) {
  const targets = new Map();
  return references.map((reference) => {
    const canonicalHandle = canonicalReferenceHandle(reference.platform, reference.handle);
    const target = `${reference.platform}:${canonicalHandle}`;
    if (targets.has(target)) throw new ReferenceAnalysisError("DUPLICATE_REFERENCE_TARGET", target);
    targets.set(target, true);
    return {
      referenceKey: stableId("reference", target),
      platform: reference.platform,
      configuredHandle: reference.handle,
      purpose: reference.purpose,
      usage: reference.usage,
      grantsUsageRights: reference.grantsUsageRights,
    };
  });
}

function normalizeProviderResult(planned, response, window, snapshot, observedAt) {
  if (!response || typeof response !== "object" || !Array.isArray(response.items) || !Array.isArray(response.gaps)) {
    return completedReference(planned, "FAILED", "UNAVAILABLE", [], ["INVALID_PROVIDER_RESPONSE"]);
  }
  const allowedStates = ["SUCCESS", "PARTIAL", "BLOCKED_BY_PROVIDER", "UNSUPPORTED", "FAILED"];
  const status = allowedStates.includes(response.status) ? response.status : "FAILED";
  const gaps = sanitizeCodes(response.gaps);
  const items = response.items.filter((item) => Number.isFinite(Date.parse(item?.publishedAt)))
    .filter((item) => Date.parse(item.publishedAt) >= Date.parse(window.start) && Date.parse(item.publishedAt) < Date.parse(window.end))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, window.maxItemsPerReference);
  const evidence = [];
  const signals = [];
  for (const item of items) {
    if (!validProviderItem(item, planned.platform)) continue;
    const evidenceId = stableId("evidence", `${planned.platform}:${item.providerContentId}`);
    const durationBand = durationBandFor(item.durationSeconds);
    evidence.push({
      evidenceId,
      providerContentId: item.providerContentId,
      canonicalUrl: item.canonicalUrl,
      publishedAt: new Date(item.publishedAt).toISOString(),
      observedAt: new Date(observedAt).toISOString(),
      mediaType: normalizeLabel(item.mediaType, "OTHER"),
      durationBand,
    });
    signals.push({
      evidenceId,
      mediaType: normalizeLabel(item.mediaType, "OTHER"),
      durationBand,
      openingForm: openingForm(item.sourceText),
      ctaStyles: ctaStyles(item.sourceText),
      topics: configuredTopics(item.sourceText, snapshot),
    });
  }
  if (response.items.length > 0 && evidence.length === 0) gaps.push("NO_ITEMS_IN_ANALYSIS_WINDOW");
  if (evidence.length !== items.length) gaps.push("INVALID_ITEMS_DISCARDED");
  const effectiveStatus = status === "SUCCESS" && gaps.length > 0 ? "PARTIAL" : status;
  return completedReference(planned, effectiveStatus, safeCapability(response.capability), evidence, [...new Set(gaps)], signals);
}

function completedReference(planned, status, capability, evidence, gaps, signals = []) {
  return {
    ...planned,
    capability,
    status,
    observedItems: evidence.length,
    evidence,
    gaps,
    signals,
  };
}

function aggregatePatterns(results) {
  const groups = new Map();
  function add(dimension, value, referenceKey, evidenceIds) {
    if (!value || evidenceIds.length === 0) return;
    const key = `${dimension}|${value}`;
    const group = groups.get(key) ?? { dimension, value, referenceKeys: new Set(), evidenceIds: new Set() };
    group.referenceKeys.add(referenceKey);
    evidenceIds.forEach((id) => group.evidenceIds.add(id));
    groups.set(key, group);
  }
  for (const result of results) {
    for (const signal of result.signals) {
      add("FORMAT_MIX", signal.mediaType, result.referenceKey, [signal.evidenceId]);
      if (signal.durationBand !== "UNAVAILABLE") add("DURATION_BAND", signal.durationBand, result.referenceKey, [signal.evidenceId]);
      add("CAPTION_OPENING_FORM", signal.openingForm, result.referenceKey, [signal.evidenceId]);
      signal.ctaStyles.forEach((value) => add("CTA_STYLE", value, result.referenceKey, [signal.evidenceId]));
      signal.topics.forEach((value) => add("PROJECT_TOPIC_AFFINITY", value, result.referenceKey, [signal.evidenceId]));
    }
    if (result.evidence.length >= 3) {
      add("PUBLISHING_CADENCE", cadenceFor(result.evidence.length), result.referenceKey,
        result.evidence.map(({ evidenceId }) => evidenceId));
    }
  }
  return [...groups.values()].filter((group) => group.evidenceIds.size >= 3).map((group) => ({
    dimension: group.dimension,
    value: group.value,
    itemCount: group.evidenceIds.size,
    referenceCount: group.referenceKeys.size,
    referenceKeys: [...group.referenceKeys].sort(),
    evidenceIds: [...group.evidenceIds].sort(),
  })).sort((left, right) => `${left.dimension}:${left.value}`.localeCompare(`${right.dimension}:${right.value}`));
}

function configuredTopics(sourceText, snapshot) {
  const normalized = normalizeText(sourceText);
  if (!normalized) return [];
  return [snapshot.project.niche, ...snapshot.project.subniches].flatMap((topic) => {
    const target = normalizeText(topic);
    return target && normalized.includes(target) ? [`TOPIC:${slug(topic)}`] : [];
  });
}

function openingForm(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^(como|how)\b/.test(text)) return "HOW_TO";
  if (/^(por que|porque|why|what|qual|quais|voce sabia)\b/.test(text) || text.includes("?")) return "QUESTION";
  if (/^\d+[ .):-]/.test(String(value).trim())) return "LIST";
  return "STATEMENT";
}

function ctaStyles(value) {
  const text = normalizeText(value);
  const matches = [];
  if (/\b(siga|seguir|follow|inscreva|subscribe)\b/.test(text)) matches.push("FOLLOW");
  if (/\b(comente|comment)\b/.test(text)) matches.push("COMMENT");
  if (/\b(salve|save)\b/.test(text)) matches.push("SAVE");
  if (/\b(compartilhe|share)\b/.test(text)) matches.push("SHARE");
  if (/\b(link|bio)\b/.test(text)) matches.push("VISIT_LINK");
  return matches;
}

function validProviderItem(item, platform) {
  if (!item || typeof item.providerContentId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(item.providerContentId)
    || typeof item.canonicalUrl !== "string" || typeof item.mediaType !== "string") return false;
  try {
    const url = new URL(item.canonicalUrl);
    const hosts = {
      instagram: ["instagram.com"], threads: ["threads.net", "threads.com"],
      tiktok: ["tiktok.com"], youtube: ["youtube.com", "youtu.be"],
    };
    return url.protocol === "https:" && hosts[platform]?.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
  } catch { return false; }
}

function analysisWindowFor(logicalDate, timezone) {
  const endDate = addUtcDays(logicalDate, 1);
  const startDate = addUtcDays(logicalDate, -(LOOKBACK_DAYS - 1));
  return {
    start: zonedMidnight(startDate, timezone),
    end: zonedMidnight(endDate, timezone),
    timezone,
    maxItemsPerReference: MAX_ITEMS,
  };
}

function zonedMidnight(date, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const localTarget = Date.UTC(year, month - 1, day);
  let instant = localTarget;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant)).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant -= represented - localTarget;
  }
  return new Date(instant).toISOString();
}

function addUtcDays(date, days) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function durationBandFor(value) { if (!Number.isFinite(value) || value < 0) return "UNAVAILABLE"; if (value < 15) return "UNDER_15S"; if (value <= 30) return "15_30S"; if (value <= 60) return "31_60S"; if (value <= 180) return "61_180S"; return "OVER_180S"; }
function cadenceFor(count) { if (count >= 30) return "DAILY_OR_MORE"; if (count >= 13) return "THREE_TO_SIX_PER_WEEK"; if (count >= 4) return "WEEKLY"; return "LESS_THAN_WEEKLY"; }
function safeCapability(value) { return typeof value === "string" && /^[A-Z0-9_:-]{2,100}$/.test(value) ? value : "UNAVAILABLE"; }
function safeErrorCode(error) { return typeof error?.code === "string" && /^[A-Z0-9_:-]{2,100}$/.test(error.code) ? error.code : "REFERENCE_PROVIDER_ERROR"; }
function sanitizeCodes(values) { return values.map((value) => typeof value === "string" && /^[A-Z0-9_:-]{2,150}$/.test(value) ? value : "REFERENCE_PROVIDER_ERROR"); }
function normalizeLabel(value, fallback) { const label = typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "_") : ""; return label || fallback; }
function normalizeText(value) { return typeof value === "string" ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim() : ""; }
function slug(value) { return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase(); }
function elapsed(start, end) { return Math.max(0, Date.parse(end) - Date.parse(start)); }
function stableId(prefix, value) { return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`; }
function stableHash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function requireStore(store) { for (const method of ["getReferenceInsight", "beginReferenceAnalysisRun", "getReferenceAnalysisStep", "startReferenceAnalysisStep", "finishReferenceAnalysisStep", "recordReferenceInsight", "finishReferenceAnalysisRun"]) if (typeof store?.[method] !== "function") throw new ReferenceAnalysisError("INVALID_STORE", method); }

export { analysisWindowFor, stableHash };
