import { createHash } from "node:crypto";
import { serializePublicTrendCatalog } from "./domain/contracts.js";
import { createResearchArtifact } from "./domain/research-artifact-contracts.js";
import { createResearchInput } from "./domain/research-contracts.js";
import {
  createResearchShortlist,
  DEFAULT_RESEARCH_SHORTLIST_POLICY,
  RESEARCH_SHORTLIST_CONTRACT_VERSION,
  validateResearchShortlistPolicy,
} from "./domain/research-shortlist-contracts.js";
import { TrendStoreError } from "./trend-store.js";

export function buildResearchShortlist({ store, researchInput, researchTopicCatalog, policy = DEFAULT_RESEARCH_SHORTLIST_POLICY, clock = () => new Date() }) {
  if (!store || typeof store.getRun !== "function" || typeof store.recordResearchShortlist !== "function") throw new Error("TrendCatalogStore inválido");
  const input = createResearchInput(researchInput);
  const source = createResearchArtifact(researchTopicCatalog);
  validateResearchShortlistPolicy(policy);
  const researchInputHash = stableHash(input);
  const { pipelineRunId, projectId, projectVersion } = input.execution;
  const logicalDate = input.window.logicalDate;
  const timezone = input.projectSnapshot.channel.publishing.timezone;
  verifySourceHash(source);
  for (const [field, expected] of Object.entries({ pipelineRunId, projectId, projectVersion, logicalDate, timezone, researchInputHash })) {
    if (source[field] !== expected) throw new TrendStoreError("RESEARCH_SHORTLIST_LINEAGE_MISMATCH", `ResearchTopicCatalog.${field} diverge do ResearchInput`);
  }
  const daily = store.getResearchDailyRunByPipeline(pipelineRunId);
  if (!daily) throw new TrendStoreError("RESEARCH_RUN_NOT_FOUND", "execução exata de Research inexistente");
  const storedSource = store.getResearchArtifact(daily.id);
  if (!storedSource || stableHash(storedSource) !== stableHash(source) || daily.trendRunId !== source.trendRunId
    || daily.projectId !== projectId || daily.projectVersion !== projectVersion || daily.logicalDate !== logicalDate
    || daily.researchInputHash !== researchInputHash) {
    throw new TrendStoreError("RESEARCH_SHORTLIST_LINEAGE_MISMATCH", "catálogo não pertence à execução exata");
  }
  const storedCatalog = store.getRun(source.trendRunId);
  if (!storedCatalog) throw new TrendStoreError("RUN_NOT_FOUND", `catálogo inexistente: ${source.trendRunId}`);
  const catalog = serializePublicTrendCatalog(storedCatalog);
  const trendCatalogHash = stableHash(catalog);
  const identity = {
    pipelineRunId, projectId, projectVersion, logicalDate, researchInputHash,
    researchTopicCatalogHash: source.contentHash, trendCatalogHash, policyVersion: policy.version, revision: 1,
  };
  const storedPrior = store.getResearchShortlistByPipeline(pipelineRunId);
  if (storedPrior) {
    const prior = createResearchShortlist(storedPrior);
    for (const [field, expected] of Object.entries({
      projectId, projectVersion, logicalDate, researchInputHash,
      researchTopicCatalogHash: source.contentHash, trendCatalogHash,
    })) if (prior[field] !== expected) throw new TrendStoreError("RESEARCH_SHORTLIST_CONFLICT", `retry diverge em ${field}`);
    if (prior.policy.version !== policy.version) throw new TrendStoreError("RESEARCH_SHORTLIST_CONFLICT", "retry diverge em policyVersion");
    return prior;
  }

  const selection = selectResearchShortlistCandidates(catalog, source.state, policy);
  const inheritedGaps = [...source.gaps, ...catalog.sourceRuns.flatMap(({ gaps }) => gaps)];
  const gaps = [...new Set([...inheritedGaps, ...selection.gaps])];
  const state = source.state === "FAILED" ? "FAILED" : (source.state === "COMPLETED_WITH_GAPS" || gaps.length > 0 ? "COMPLETED_WITH_GAPS" : "COMPLETED");
  const base = {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION,
    artifactId: `research-shortlist:${stableHash(identity).slice(0, 24)}`,
    artifactType: "research_shortlist",
    revision: 1,
    pipelineRunId, projectId, projectVersion, logicalDate, timezone,
    createdAt: new Date(clock()).toISOString(),
    createdBy: "SYSTEM",
    researchInputHash,
    researchTopicCatalogArtifactId: source.artifactId,
    researchTopicCatalogHash: source.contentHash,
    trendRunId: source.trendRunId,
    trendCatalogHash,
    policy: structuredClone(policy),
    state,
    orderedCandidates: selection.orderedCandidates,
    decisions: selection.decisions,
    coverage: catalog.sourceRuns,
    gaps,
    rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
  };
  return store.recordResearchShortlist(createResearchShortlist({ ...base, contentHash: stableHash(base) }));
}

export function selectResearchShortlistCandidates(catalog, sourceState, policy = DEFAULT_RESEARCH_SHORTLIST_POLICY) {
  validateResearchShortlistPolicy(policy);
  if (sourceState === "FAILED") return {
    orderedCandidates: [],
    decisions: catalog.candidates.map(({ id }) => ({ candidateId: id, decision: "EXCLUDED", position: null, reasons: ["SOURCE_CATALOG_FAILED"] })),
    gaps: ["SOURCE_CATALOG_FAILED"],
  };
  const scores = Object.groupBy(catalog.scores, ({ candidateId }) => candidateId);
  const clusters = Object.groupBy(catalog.topicClusters.flatMap((cluster) => cluster.candidateIds.map((candidateId) => ({ candidateId, cluster }))), ({ candidateId }) => candidateId);
  const decisions = new Map();
  const eligible = [];
  for (const candidate of catalog.candidates) {
    const reasons = [];
    if (candidate.rankingExclusionReason) reasons.push("CATALOG_EXCLUSION");
    if (!scores[candidate.id]) reasons.push("MISSING_SCORE");
    else if (scores[candidate.id].length !== 1) reasons.push("AMBIGUOUS_SCORE");
    if (!clusters[candidate.id]) reasons.push("MISSING_CLUSTER");
    else if (clusters[candidate.id].length !== 1) reasons.push("AMBIGUOUS_CLUSTER");
    const duration = durationValue(candidate.durationSeconds);
    if (duration === null) reasons.push("DURATION_UNAVAILABLE");
    else if (duration < 15 || duration > 180) reasons.push("DURATION_OUT_OF_RANGE");
    if (reasons.length > 0) decisions.set(candidate.id, excluded(candidate.id, reasons));
    else eligible.push({ candidate, score: scores[candidate.id][0], cluster: clusters[candidate.id][0].cluster });
  }
  eligible.sort((left, right) => right.score.value - left.score.value
    || right.score.confidence - left.score.confidence
    || Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt)
    || left.candidate.id.localeCompare(right.candidate.id));
  const selected = [];
  const deferred = [];
  const counts = { cluster: new Map(), platform: new Map(), region: new Map() };
  for (const item of eligible) {
    if (selected.length >= policy.shortlistLimit) {
      decisions.set(item.candidate.id, excluded(item.candidate.id, ["SHORTLIST_LIMIT_REACHED"]));
      continue;
    }
    if (permitted(item, counts, policy)) add(item, selected, counts, false);
    else deferred.push(item);
  }
  let relaxed = false;
  for (const item of deferred) {
    if (selected.length < policy.shortlistLimit) {
      add(item, selected, counts, true);
      relaxed = true;
    } else decisions.set(item.candidate.id, excluded(item.candidate.id, ["DIVERSITY_DEFERRED"]));
  }
  const orderedCandidates = selected.map(({ candidate, cluster, score, relaxed: itemRelaxed }, index) => ({
    position: index + 1, candidate, cluster, score,
    inclusionReasons: ["BASE_RANK", itemRelaxed ? "DIVERSITY_RELAXED" : "DIVERSITY_ACCEPTED"],
  }));
  for (const item of orderedCandidates) decisions.set(item.candidate.id, {
    candidateId: item.candidate.id, decision: "INCLUDED", position: item.position, reasons: item.inclusionReasons,
  });
  const gaps = [];
  if (relaxed) gaps.push("DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE");
  if (selected.length < policy.shortlistLimit) gaps.push(`INSUFFICIENT_ELIGIBLE_CANDIDATES:${selected.length}/${policy.shortlistLimit}`);
  return { orderedCandidates, decisions: catalog.candidates.map(({ id }) => decisions.get(id)), gaps };
}

function permitted(item, counts, policy) {
  return (counts.cluster.get(item.cluster.id) ?? 0) < policy.maxPerCluster
    && (counts.platform.get(item.candidate.platform) ?? 0) < policy.maxPerPlatform
    && (counts.region.get(item.candidate.region ?? "UNAVAILABLE") ?? 0) < policy.maxPerRegion;
}
function add(item, selected, counts, relaxed) { selected.push({ ...item, relaxed }); for (const [dimension, value] of [["cluster", item.cluster.id], ["platform", item.candidate.platform], ["region", item.candidate.region ?? "UNAVAILABLE"]]) counts[dimension].set(value, (counts[dimension].get(value) ?? 0) + 1); }
function excluded(candidateId, reasons) { return { candidateId, decision: "EXCLUDED", position: null, reasons }; }
function durationValue(value) { if (Number.isFinite(value)) return value; return value?.availability === "AVAILABLE" && Number.isFinite(value.value) ? value.value : null; }
function verifySourceHash(source) { const { contentHash, ...content } = source; if (stableHash(content) !== contentHash) throw new TrendStoreError("RESEARCH_ARTIFACT_HASH_MISMATCH", "contentHash diverge do catálogo"); }
function stableHash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
