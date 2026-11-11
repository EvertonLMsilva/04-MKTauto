import { createHash } from 'node:crypto';
import { TrendStoreError } from '../domain/research.errors.js';
import {
  serializePublicTrendCatalog,
  validateSourceRun,
  validateTopicCluster,
  validateTrendCandidate,
  validateTrendRun,
  validateTrendScore,
  validateTrendSnapshot,
} from '../domain/research-record-contracts.js';

export function remapCluster(cluster: any, candidateMap: any): any {
  return {
    ...cluster,
    candidateIds: cluster.candidateIds.map(
      (id: any): any => candidateMap.get(id) ?? id,
    ),
  };
}
export function rowsAsPayload(rows: any): any {
  return rows.map(({ payload_json }: any): any => JSON.parse(payload_json));
}
export function researchDailyRunFromRow(row: any): any {
  return {
    id: row.id,
    pipelineRunId: row.pipeline_run_id,
    projectId: row.project_id,
    projectVersion: row.project_version,
    logicalDate: row.logical_date,
    timezone: row.timezone,
    researchInputHash: row.research_input_hash,
    configHash: row.config_hash,
    config: JSON.parse(row.config_json),
    sourcePlan: JSON.parse(row.source_plan_json),
    state: row.state,
    trendRunId: row.trend_run_id ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}
export function referenceAnalysisRunFromRow(row: any): any {
  return {
    id: row.id,
    pipelineRunId: row.pipeline_run_id,
    projectId: row.project_id,
    projectVersion: row.project_version,
    logicalDate: row.logical_date,
    timezone: row.timezone,
    researchInputHash: row.research_input_hash,
    projectSnapshotHash: row.project_snapshot_hash,
    policyVersion: row.policy_version,
    configHash: row.config_hash,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}
export function referenceStepFromRow(row: any): any {
  return {
    referenceAnalysisRunId: row.reference_analysis_run_id,
    referenceKey: row.reference_key,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}
export function toAppearance(row: any): any {
  return {
    trendRunId: row.trend_run_id,
    candidateId: row.candidate_id,
    observedAt: row.observed_at,
    reason: row.reason,
    previousPosition: row.previous_position ?? undefined,
    currentPosition: row.current_position ?? undefined,
    positionChange:
      row.previous_position === null ||
      row.previous_position === undefined ||
      row.current_position === null ||
      row.current_position === undefined
        ? undefined
        : row.previous_position - row.current_position,
  };
}
export function stableHash(value: any): any {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function stableJson(value: any): any {
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
export function json(value: any): any {
  return JSON.stringify(value);
}
export function requireKey(value: any): any {
  if (typeof value !== 'string' || value.trim() === '')
    throw new TrendStoreError(
      'INVALID_IDEMPOTENCY_KEY',
      'chave explícita obrigatória',
    );
}
export function rejectReferenceSourceFields(value: any): any {
  const forbidden: any =
    /^(?:(?:access|refresh)?token|api[_-]?key|authorization|secret|password|caption|title|description|biography|bio|text|source[_-]?text|transcript|thumbnail|media[_-]?url)$/i;
  const seen: any = new WeakSet();
  function visit(current: any, path: any): any {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of entries(current)) {
      const childPath: any = path ? `${path}.${key}` : key;
      if (forbidden.test(key))
        throw new TrendStoreError('FORBIDDEN_REFERENCE_STEP_FIELD', childPath);
      visit(child, childPath);
    }
  }
  visit(value, 'result');
}
export function minDate(left: any, right: any): any {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}
export function maxDate(left: any, right: any): any {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
export function entries(value: any): [string, any][] {
  return Object.entries(value);
}

export function dailyStepFromRow(row: any): any {
  return {
    stepKey: row.step_key,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}

export function operationHash({
  idempotencyKey,
  run,
  sourceRuns = [],
  observations = [],
  topicClusters = [],
  scores = [],
}: any): any {
  requireKey(idempotencyKey);
  validateTrendRun(run, sourceRuns);
  sourceRuns.forEach(validateSourceRun);
  const candidateIds: any = observations.map(
    ({ candidate }: any): any => validateTrendCandidate(candidate).id,
  );
  const snapshotIds: any = observations.map(
    ({ snapshot }: any): any => validateTrendSnapshot(snapshot).id,
  );
  topicClusters.forEach((cluster: any): any =>
    validateTopicCluster(cluster, candidateIds, snapshotIds),
  );
  scores.forEach(validateTrendScore);
  const input: any = { run, sourceRuns, observations, topicClusters, scores };
  const payloadHash: any = stableHash(input);
  return payloadHash;
}

export function assertAnalysisReferences(
  catalog: any,
  topicClusters: any,
  scores: any,
  histories: any,
): void {
  const candidateIds: any = catalog.candidates.map(({ id }: any): any => id);
  const candidateSet: any = new Set(candidateIds);
  const snapshotOwner: any = new Map(
    [...histories.entries()].flatMap(([candidateId, history]: any): any =>
      history.snapshots.map(({ id }: any): any => [id, candidateId]),
    ),
  );
  const snapshotIds: any = [...snapshotOwner.keys()];
  for (const cluster of topicClusters) {
    validateTopicCluster(cluster, candidateIds, snapshotIds);
    for (const snapshotId of cluster.evidenceSnapshotIds) {
      if (!cluster.candidateIds.includes(snapshotOwner.get(snapshotId))) {
        throw new TrendStoreError(
          'INVALID_REFERENCE',
          `snapshot ${snapshotId} não pertence aos candidatos do cluster`,
        );
      }
    }
  }
  for (const score of scores) {
    validateTrendScore(score);
    if (!candidateSet.has(score.candidateId))
      throw new TrendStoreError(
        'INVALID_REFERENCE',
        `score referencia candidato fora da run: ${score.candidateId}`,
      );
    for (const [componentName, component] of entries(score.components)) {
      for (const snapshotId of component.evidenceSnapshotIds) {
        if (
          !snapshotOwner.has(snapshotId) ||
          (componentName !== 'recurrence' &&
            snapshotOwner.get(snapshotId) !== score.candidateId)
        ) {
          throw new TrendStoreError(
            'INVALID_REFERENCE',
            `score usa snapshot de outro candidato: ${snapshotId}`,
          );
        }
      }
    }
  }
}

export function assertDailyRunRetry(priorByPipeline: any, value: any): any {
  const same: any =
    priorByPipeline.id === value.id &&
    priorByPipeline.project_id === value.projectId &&
    priorByPipeline.project_version === value.projectVersion &&
    priorByPipeline.logical_date === value.logicalDate;
  if (!same)
    throw new TrendStoreError(
      'PIPELINE_RUN_ID_REUSED',
      'pipelineRunId já pertence a outra execução',
    );
  if (
    priorByPipeline.research_input_hash !== value.researchInputHash ||
    priorByPipeline.config_hash !== value.configHash ||
    priorByPipeline.timezone !== value.timezone
  ) {
    throw new TrendStoreError(
      'RESEARCH_RUN_CONFLICT',
      'retry diverge da entrada original',
    );
  }
}

export function assertReferenceRunRetry(prior: any, value: any): any {
  const sameIdentity: any =
    prior.id === value.id &&
    prior.project_id === value.projectId &&
    prior.project_version === value.projectVersion &&
    prior.logical_date === value.logicalDate;
  if (!sameIdentity)
    throw new TrendStoreError(
      'PIPELINE_RUN_ID_REUSED',
      'pipelineRunId já pertence a outra análise',
    );
  const sameInput: any =
    prior.research_input_hash === value.researchInputHash &&
    prior.project_snapshot_hash === value.projectSnapshotHash &&
    prior.policy_version === value.policyVersion &&
    prior.config_hash === value.configHash &&
    prior.timezone === value.timezone;
  if (!sameInput)
    throw new TrendStoreError(
      'REFERENCE_ANALYSIS_CONFLICT',
      'retry diverge da entrada original',
    );
}

export function assertResearchArtifactLineage(validated: any, daily: any): any {
  if (!daily)
    throw new TrendStoreError(
      'RESEARCH_RUN_NOT_FOUND',
      'execução de Research inexistente',
    );
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion']) {
    if (validated[field] !== daily[field]) {
      throw new TrendStoreError(
        'RESEARCH_ARTIFACT_REFERENCE_MISMATCH',
        `artifact.${field} diverge da execução`,
      );
    }
  }
}

export function assertResearchArtifactContent(
  validated: any,
  catalogExists: boolean,
): any {
  if (!catalogExists) {
    throw new TrendStoreError(
      'RESEARCH_ARTIFACT_REFERENCE_MISMATCH',
      'artifact.trendRunId não existe no catálogo',
    );
  }
  const { contentHash, ...content } = validated;
  if (stableHash(content) !== contentHash) {
    throw new TrendStoreError(
      'RESEARCH_ARTIFACT_HASH_MISMATCH',
      'contentHash diverge do conteúdo',
    );
  }
}

export function requireResearchDailyRun(daily: any): void {
  if (!daily)
    throw new TrendStoreError(
      'RESEARCH_RUN_NOT_FOUND',
      'execução de Research inexistente',
    );
}

export function assertShortlistSource(validated: any, source: any): void {
  if (
    !source ||
    source.artifactId !== validated.researchTopicCatalogArtifactId ||
    source.contentHash !== validated.researchTopicCatalogHash ||
    source.trendRunId !== validated.trendRunId
  ) {
    throw new TrendStoreError(
      'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
      'shortlist diverge do catálogo persistido',
    );
  }
  for (const field of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'logicalDate',
    'timezone',
    'researchInputHash',
  ]) {
    if (validated[field] !== source[field])
      throw new TrendStoreError(
        'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
        `shortlist.${field} diverge do catálogo`,
      );
  }
}

export function assertShortlistCatalog(validated: any, catalog: any): any {
  const publicCatalog: any = catalog
    ? serializePublicTrendCatalog(catalog)
    : null;
  if (
    !publicCatalog ||
    stableHash(publicCatalog) !== validated.trendCatalogHash
  ) {
    throw new TrendStoreError(
      'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
      'trendCatalogHash diverge do catálogo persistido',
    );
  }
  const candidates: any = new Map(
    publicCatalog.candidates.map((item: any): any => [item.id, item]),
  );
  const clusters: any = new Map(
    publicCatalog.topicClusters.map((item: any): any => [item.id, item]),
  );
  const scores: any = new Map(
    publicCatalog.scores.map((item: any): any => [item.id, item]),
  );
  for (const item of validated.orderedCandidates) {
    if (
      !candidates.has(item.candidate.id) ||
      !clusters.has(item.cluster.id) ||
      !scores.has(item.score.id) ||
      stableHash(candidates.get(item.candidate.id)) !==
        stableHash(item.candidate) ||
      stableHash(clusters.get(item.cluster.id)) !== stableHash(item.cluster) ||
      stableHash(scores.get(item.score.id)) !== stableHash(item.score)
    ) {
      throw new TrendStoreError(
        'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
        `dados divergentes para ${item.candidate.id}`,
      );
    }
  }
  const catalogCandidateIds: any = publicCatalog.candidates
    .map(({ id }: any): any => id)
    .sort();
  const decisionCandidateIds: any = validated.decisions
    .map(({ candidateId }: any): any => candidateId)
    .sort();
  if (
    stableHash(catalogCandidateIds) !== stableHash(decisionCandidateIds) ||
    stableHash(publicCatalog.sourceRuns) !== stableHash(validated.coverage)
  ) {
    throw new TrendStoreError(
      'RESEARCH_SHORTLIST_LINEAGE_MISMATCH',
      'decisões ou cobertura divergem do catálogo',
    );
  }
  const { contentHash, ...content } = validated;
  if (stableHash(content) !== contentHash)
    throw new TrendStoreError(
      'RESEARCH_SHORTLIST_HASH_MISMATCH',
      'contentHash diverge do conteúdo',
    );
}

export function assertReferenceInsightLineage(validated: any, run: any): any {
  if (!run)
    throw new TrendStoreError(
      'REFERENCE_ANALYSIS_RUN_NOT_FOUND',
      'análise de referências inexistente',
    );
  for (const field of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'logicalDate',
    'researchInputHash',
    'projectSnapshotHash',
    'policyVersion',
  ]) {
    if (validated[field] !== run[field]) {
      throw new TrendStoreError(
        'REFERENCE_INSIGHT_LINEAGE_MISMATCH',
        `artifact.${field} diverge da execução`,
      );
    }
  }
  const { contentHash, ...content } = validated;
  if (stableHash(content) !== contentHash)
    throw new TrendStoreError(
      'REFERENCE_INSIGHT_HASH_MISMATCH',
      'contentHash diverge do conteúdo',
    );
}

export function assertResearchState(
  kind: 'dailyStep' | 'dailyRun' | 'referenceStep' | 'referenceRun',
  state: any,
): void {
  const rules = {
    dailyStep: {
      allowed: ['COMPLETED', 'SKIPPED', 'FAILED'],
      code: 'INVALID_DAILY_STEP_STATE',
    },
    dailyRun: {
      allowed: ['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'],
      code: 'INVALID_DAILY_RUN_STATE',
    },
    referenceStep: {
      allowed: ['COMPLETED', 'FAILED'],
      code: 'INVALID_REFERENCE_STEP_STATE',
    },
    referenceRun: {
      allowed: ['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'],
      code: 'INVALID_REFERENCE_RUN_STATE',
    },
  };
  if (!rules[kind].allowed.includes(state))
    throw new TrendStoreError(rules[kind].code, state);
}

export function assertObservationReference(candidate: any, snapshot: any): any {
  if (snapshot.candidateId !== candidate.id) {
    throw new TrendStoreError(
      'INVALID_REFERENCE',
      'snapshot.candidateId não referencia o candidato observado',
    );
  }
}
