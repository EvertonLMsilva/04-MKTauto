import { createHash } from 'node:crypto';
import { serializePublicTrendCatalog } from '../domain/research-record-contracts.js';
import { createResearchArtifact } from '../domain/research-artifact-contracts.js';
import { createResearchInput } from '../domain/research-contracts.js';
import {
  createResearchShortlist,
  DEFAULT_RESEARCH_SHORTLIST_POLICY,
  RESEARCH_SHORTLIST_CONTRACT_VERSION,
  validateResearchShortlistPolicy,
} from '../domain/research-shortlist-contracts.js';
import { TrendStoreError } from '../domain/research.errors.js';

export function buildResearchShortlist({
  store,
  researchInput,
  researchTopicCatalog,
  policy = DEFAULT_RESEARCH_SHORTLIST_POLICY,
  clock = (): any => new Date(),
}: any): any {
  if (
    !store ||
    typeof store.getRun !== 'function' ||
    typeof store.recordResearchShortlist !== 'function'
  )
    throw new Error('TrendCatalogStore inválido');
  const input: any = createResearchInput(researchInput);
  const source: any = createResearchArtifact(researchTopicCatalog);
  validateResearchShortlistPolicy(policy);
  const researchInputHash: any = stableHash(input);
  const { pipelineRunId, projectId, projectVersion } = input.execution;
  const logicalDate: any = input.window.logicalDate;
  const timezone: any = input.projectSnapshot.channel.publishing.timezone;
  verifySourceHash(source);
  for (const [field, expected] of entries({
    pipelineRunId,
    projectId,
    projectVersion,
    logicalDate,
    timezone,
    researchInputHash,
  })) {
    if (source[field] !== expected)
      throw new TrendStoreError(
        'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
        `ResearchTopicCatalog.${field} diverge do ResearchInput`,
      );
  }
  const daily: any = store.getResearchDailyRunByPipeline(pipelineRunId);
  if (!daily)
    throw new TrendStoreError(
      'RESEARCH_RUN_NOT_FOUND',
      'execução exata de Research inexistente',
    );
  const storedSource: any = store.getResearchArtifact(daily.id);
  if (
    !storedSource ||
    stableHash(storedSource) !== stableHash(source) ||
    daily.trendRunId !== source.trendRunId ||
    daily.projectId !== projectId ||
    daily.projectVersion !== projectVersion ||
    daily.logicalDate !== logicalDate ||
    daily.researchInputHash !== researchInputHash
  ) {
    throw new TrendStoreError(
      'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
      'catálogo não pertence à execução exata',
    );
  }
  const storedCatalog: any = store.getRun(source.trendRunId);
  if (!storedCatalog)
    throw new TrendStoreError(
      'RUN_NOT_FOUND',
      `catálogo inexistente: ${source.trendRunId}`,
    );
  const catalog: any = serializePublicTrendCatalog(storedCatalog);
  const trendCatalogHash: any = stableHash(catalog);
  const identity: any = {
    pipelineRunId,
    projectId,
    projectVersion,
    logicalDate,
    researchInputHash,
    researchTopicCatalogHash: source.contentHash,
    trendCatalogHash,
    policyVersion: policy.version,
    revision: 1,
  };
  const storedPrior: any = store.getResearchShortlistByPipeline(pipelineRunId);
  if (storedPrior) {
    const prior: any = createResearchShortlist(storedPrior);
    for (const [field, expected] of entries({
      projectId,
      projectVersion,
      logicalDate,
      researchInputHash,
      researchTopicCatalogHash: source.contentHash,
      trendCatalogHash,
    }))
      if (prior[field] !== expected)
        throw new TrendStoreError(
          'RESEARCH_SHORTLIST_CONFLICT',
          `retry diverge em ${field}`,
        );
    if (prior.policy.version !== policy.version)
      throw new TrendStoreError(
        'RESEARCH_SHORTLIST_CONFLICT',
        'retry diverge em policyVersion',
      );
    return prior;
  }

  const selection: any = selectResearchShortlistCandidates(
    catalog,
    source.state,
    policy,
  );
  const inheritedGaps: any = [
    ...source.gaps,
    ...catalog.sourceRuns.flatMap(({ gaps }: any): any => gaps),
  ];
  const gaps: any = [...new Set([...inheritedGaps, ...selection.gaps])];
  const state: any =
    source.state === 'FAILED'
      ? 'FAILED'
      : source.state === 'COMPLETED_WITH_GAPS' || gaps.length > 0
        ? 'COMPLETED_WITH_GAPS'
        : 'COMPLETED';
  const base: any = {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION,
    artifactId: `research-shortlist:${stableHash(identity).slice(0, 24)}`,
    artifactType: 'research_shortlist',
    revision: 1,
    pipelineRunId,
    projectId,
    projectVersion,
    logicalDate,
    timezone,
    createdAt: new Date(clock()).toISOString(),
    createdBy: 'SYSTEM',
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
    rights: {
      usageCondition: 'REFERENCE_ONLY',
      mediaDownloaded: false,
      republicationAllowed: false,
    },
  };
  return store.recordResearchShortlist(
    createResearchShortlist({ ...base, contentHash: stableHash(base) }),
  );
}

export function selectResearchShortlistCandidates(
  catalog: any,
  sourceState: any,
  policy: any = DEFAULT_RESEARCH_SHORTLIST_POLICY,
): any {
  validateResearchShortlistPolicy(policy);
  if (sourceState === 'FAILED')
    return {
      orderedCandidates: [],
      decisions: catalog.candidates.map(({ id }: any): any => ({
        candidateId: id,
        decision: 'EXCLUDED',
        position: null,
        reasons: ['SOURCE_CATALOG_FAILED'],
      })),
      gaps: ['SOURCE_CATALOG_FAILED'],
    };
  const scores: any = groupBy(
    catalog.scores,
    ({ candidateId }: any): any => candidateId,
  );
  const clusters: any = groupBy(
    catalog.topicClusters.flatMap((cluster: any): any =>
      cluster.candidateIds.map((candidateId: any): any => ({
        candidateId,
        cluster,
      })),
    ),
    ({ candidateId }: any): any => candidateId,
  );
  const decisions: any = new Map();
  const eligible: any = [];
  for (const candidate of catalog.candidates) {
    const reasons: any = [];
    if (candidate.rankingExclusionReason) reasons.push('CATALOG_EXCLUSION');
    if (!scores[candidate.id]) reasons.push('MISSING_SCORE');
    else if (scores[candidate.id].length !== 1) reasons.push('AMBIGUOUS_SCORE');
    if (!clusters[candidate.id]) reasons.push('MISSING_CLUSTER');
    else if (clusters[candidate.id].length !== 1)
      reasons.push('AMBIGUOUS_CLUSTER');
    const duration: any = durationValue(candidate.durationSeconds);
    if (duration === null) reasons.push('DURATION_UNAVAILABLE');
    else if (duration < 15 || duration > 180)
      reasons.push('DURATION_OUT_OF_RANGE');
    if (reasons.length > 0)
      decisions.set(candidate.id, excluded(candidate.id, reasons));
    else
      eligible.push({
        candidate,
        score: scores[candidate.id][0],
        cluster: clusters[candidate.id][0].cluster,
      });
  }
  eligible.sort(
    (left: any, right: any): any =>
      right.score.value - left.score.value ||
      right.score.confidence - left.score.confidence ||
      Date.parse(right.candidate.publishedAt) -
        Date.parse(left.candidate.publishedAt) ||
      left.candidate.id.localeCompare(right.candidate.id),
  );
  const selected: any = [];
  const deferred: any = [];
  const counts: any = {
    cluster: new Map(),
    platform: new Map(),
    region: new Map(),
  };
  for (const item of eligible) {
    if (selected.length >= policy.shortlistLimit) {
      decisions.set(
        item.candidate.id,
        excluded(item.candidate.id, ['SHORTLIST_LIMIT_REACHED']),
      );
      continue;
    }
    if (permitted(item, counts, policy)) add(item, selected, counts, false);
    else deferred.push(item);
  }
  let relaxed: any = false;
  for (const item of deferred) {
    if (selected.length < policy.shortlistLimit) {
      add(item, selected, counts, true);
      relaxed = true;
    } else
      decisions.set(
        item.candidate.id,
        excluded(item.candidate.id, ['DIVERSITY_DEFERRED']),
      );
  }
  const orderedCandidates: any = selected.map(
    (
      { candidate, cluster, score, relaxed: itemRelaxed }: any,
      index: any,
    ): any => ({
      position: index + 1,
      candidate,
      cluster,
      score,
      inclusionReasons: [
        'BASE_RANK',
        itemRelaxed ? 'DIVERSITY_RELAXED' : 'DIVERSITY_ACCEPTED',
      ],
    }),
  );
  for (const item of orderedCandidates)
    decisions.set(item.candidate.id, {
      candidateId: item.candidate.id,
      decision: 'INCLUDED',
      position: item.position,
      reasons: item.inclusionReasons,
    });
  const gaps: any = [];
  if (relaxed) gaps.push('DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE');
  if (selected.length < policy.shortlistLimit)
    gaps.push(
      `INSUFFICIENT_ELIGIBLE_CANDIDATES:${selected.length}/${policy.shortlistLimit}`,
    );
  return {
    orderedCandidates,
    decisions: catalog.candidates.map(({ id }: any): any => decisions.get(id)),
    gaps,
  };
}

function permitted(item: any, counts: any, policy: any): any {
  return (
    (counts.cluster.get(item.cluster.id) ?? 0) < policy.maxPerCluster &&
    (counts.platform.get(item.candidate.platform) ?? 0) <
      policy.maxPerPlatform &&
    (counts.region.get(item.candidate.region ?? 'UNAVAILABLE') ?? 0) <
      policy.maxPerRegion
  );
}
function add(item: any, selected: any, counts: any, relaxed: any): any {
  selected.push({ ...item, relaxed });
  for (const [dimension, value] of [
    ['cluster', item.cluster.id],
    ['platform', item.candidate.platform],
    ['region', item.candidate.region ?? 'UNAVAILABLE'],
  ])
    counts[dimension].set(value, (counts[dimension].get(value) ?? 0) + 1);
}
function excluded(candidateId: any, reasons: any): any {
  return { candidateId, decision: 'EXCLUDED', position: null, reasons };
}
function durationValue(value: any): any {
  if (Number.isFinite(value)) return value;
  return value?.availability === 'AVAILABLE' && Number.isFinite(value.value)
    ? value.value
    : null;
}
function verifySourceHash(source: any): any {
  const { contentHash, ...content } = source;
  if (stableHash(content) !== contentHash)
    throw new TrendStoreError(
      'RESEARCH_ARTIFACT_HASH_MISMATCH',
      'contentHash diverge do catálogo',
    );
}
function stableHash(value: any): any {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
function stableJson(value: any): any {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key: any): any => `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

function entries(value: any): [string, any][] {
  return Object.entries(value);
}

function groupBy(
  values: any[],
  key: (value: any) => string,
): Record<string, any[]> {
  const result: Record<string, any[]> = Object.create(null);
  for (const value of values) (result[key(value)] ??= []).push(value);
  return result;
}
