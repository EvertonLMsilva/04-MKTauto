import {
  remapCluster,
  rowsAsPayload,
  researchDailyRunFromRow,
  referenceAnalysisRunFromRow,
  referenceStepFromRow,
  toAppearance,
  stableHash,
  json,
  requireKey,
  rejectReferenceSourceFields,
  minDate,
  maxDate,
  entries,
  dailyStepFromRow,
  operationHash,
  assertAnalysisReferences,
  assertDailyRunRetry,
  assertReferenceRunRetry,
  assertResearchArtifactLineage,
  assertResearchArtifactContent,
  requireResearchDailyRun,
  assertShortlistSource,
  assertShortlistCatalog,
  assertReferenceInsightLineage,
  assertResearchState,
  assertObservationReference,
} from './research-repository.rules.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import {
  PostgresDatabase,
  PostgresError,
} from '../../../infrastructure/database/postgres/index.js';
import {
  canonicalTrendIdentity,
  validateTrendRun,
} from '../domain/research-record-contracts.js';
import { calculateHistoricalVelocity } from '../domain/velocity.js';
import { createResearchArtifact } from '../domain/research-artifact-contracts.js';
import { createReferenceInsight } from '../domain/reference-insight-contracts.js';
import { createResearchShortlist } from '../domain/research-shortlist-contracts.js';
export { TrendStoreError } from '../domain/research.errors.js';
import { TrendStoreError } from '../domain/research.errors.js';
import { ResearchReadError } from './sqlite-research.reader.js';
export class PostgresResearchRepository {
  readonly #context = new AsyncLocalStorage<{
    client: PoolClient;
    writable: boolean;
    active: boolean;
  }>();
  #closed = false;
  readonly #readOnly: boolean;
  constructor(
    private readonly database: PostgresDatabase,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) {
    this.#readOnly = readOnly;
  }
  async getShortlist(id: string): Promise<any> {
    const row = await this.#get(
      'SELECT payload_json::text AS payload_json FROM research.research_shortlists WHERE artifact_id = $1',
      id,
    );
    if (!row) return null;
    try {
      return createResearchShortlist(JSON.parse(row.payload_json));
    } catch {
      throw new ResearchReadError(
        'INVALID_PERSISTED_RESEARCH_SHORTLIST',
        'researchShortlistId',
      );
    }
  }
  async getInsight(id: string): Promise<any> {
    const row = await this.#get(
      'SELECT payload_json::text AS payload_json FROM research.reference_insights WHERE artifact_id = $1',
      id,
    );
    if (!row) return null;
    try {
      return createReferenceInsight(JSON.parse(row.payload_json));
    } catch {
      throw new ResearchReadError(
        'INVALID_PERSISTED_REFERENCE_INSIGHT',
        'referenceInsightId',
      );
    }
  }
  async recordOperation(value: any): Promise<any> {
    return await this.atomic(async () => await this.#recordOperationRaw(value));
  }
  async recordAnalysis(value: any): Promise<any> {
    return await this.atomic(async () => await this.#recordAnalysisRaw(value));
  }
  async beginResearchDailyRun(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#beginResearchDailyRunRaw(value),
    );
  }
  async startResearchDailyStep(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#startResearchDailyStepRaw(value),
    );
  }
  async finishResearchDailyStep(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#finishResearchDailyStepRaw(value),
    );
  }
  async finishResearchDailyRun(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#finishResearchDailyRunRaw(value),
    );
  }
  async recordResearchArtifact(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#recordResearchArtifactRaw(value),
    );
  }
  async recordResearchShortlist(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#recordResearchShortlistRaw(value),
    );
  }
  async beginReferenceAnalysisRun(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#beginReferenceAnalysisRunRaw(value),
    );
  }
  async startReferenceAnalysisStep(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#startReferenceAnalysisStepRaw(value),
    );
  }
  async finishReferenceAnalysisStep(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#finishReferenceAnalysisStepRaw(value),
    );
  }
  async finishReferenceAnalysisRun(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#finishReferenceAnalysisRunRaw(value),
    );
  }
  async recordReferenceInsight(value: any): Promise<any> {
    return await this.atomic(
      async () => await this.#recordReferenceInsightRaw(value),
    );
  }
  async atomic<T>(operation: () => T | Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#readOnly)
      throw new TrendStoreError(
        'RESEARCH_READ_ONLY',
        'repositório somente leitura',
      );
    const current = this.#context.getStore();
    if (current) {
      if (!current.active)
        throw new TrendStoreError(
          'RESEARCH_TRANSACTION_CLOSED',
          'transação encerrada',
        );
      if (!current.writable)
        throw new TrendStoreError(
          'RESEARCH_READ_ONLY',
          'snapshot somente leitura',
        );
      return operation();
    }
    try {
      return await this.database.transaction(async (client) => {
        await client.query(
          'SELECT pg_catalog.pg_advisory_xact_lock($1::integer,$2::integer)',
          [1296782401, 2],
        );
        const context = { client, writable: true, active: true };
        return this.#context.run(context, async () => {
          try {
            this.#assertOpen();
            return await operation();
          } finally {
            context.active = false;
          }
        });
      });
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
  async #recordOperationRaw({
    idempotencyKey,
    run,
    sourceRuns = [],
    observations = [],
    topicClusters = [],
    scores = [],
  }: any): Promise<any> {
    const payloadHash: any = operationHash({
      idempotencyKey,
      run,
      sourceRuns,
      observations,
      topicClusters,
      scores,
    });
    const prior: any = await this.#get(
      `SELECT payload_hash, trend_run_id FROM research.trend_operations WHERE idempotency_key = $1`,
      idempotencyKey,
    );
    if (prior) {
      if (prior.payload_hash !== payloadHash)
        throw new TrendStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'a chave já foi usada com outro conteúdo',
        );
      return await this.getRun(prior.trend_run_id);
    }
    try {
      await this.#insertRun(run);
      for (const sourceRun of sourceRuns)
        await this.#insertExact(
          'source_runs',
          sourceRun.id,
          sourceRun,
          async (): Promise<any> => {
            await this.#execute(
              `INSERT INTO research.source_runs
          (id, trend_run_id, platform, status, started_at, completed_at, payload_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              sourceRun.id,
              sourceRun.trendRunId,
              sourceRun.platform,
              sourceRun.status,
              sourceRun.startedAt,
              sourceRun.completedAt,
              json(sourceRun),
            );
          },
        );
      const candidateMap: any = new Map();
      for (const observation of observations) {
        const storedId: any = await this.#recordObservation(
          run.id,
          observation,
        );
        candidateMap.set(observation.candidate.id, storedId);
      }
      for (const cluster of topicClusters)
        await this.#insertCluster(run.id, remapCluster(cluster, candidateMap));
      for (const score of scores)
        await this.#insertScore(run.id, {
          ...score,
          candidateId: candidateMap.get(score.candidateId) ?? score.candidateId,
        });
      await this.#execute(
        `INSERT INTO research.trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES ($1, $2, $3, $4)`,
        idempotencyKey,
        payloadHash,
        run.id,
        new Date().toISOString(),
      );
      return await this.getRun(run.id);
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
  async #recordAnalysisRaw({
    idempotencyKey,
    runId,
    topicClusters,
    scores,
  }: any): Promise<any> {
    requireKey(idempotencyKey);
    const catalog: any = await this.getRun(runId);
    if (!catalog)
      throw new TrendStoreError('RUN_NOT_FOUND', `run inexistente: ${runId}`);
    const histories: any = new Map();
    for (const { id } of catalog.candidates)
      histories.set(id, await this.getCandidateHistory(id));
    assertAnalysisReferences(catalog, topicClusters, scores, histories);
    const input: any = { runId, topicClusters, scores };
    const payloadHash: any = stableHash(input);
    const prior: any = await this.#get(
      `SELECT payload_hash, trend_run_id FROM research.trend_operations WHERE idempotency_key = $1`,
      idempotencyKey,
    );
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.trend_run_id !== runId) {
        throw new TrendStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'a chave já foi usada com outro conteúdo',
        );
      }
      return await this.getRun(runId);
    }
    try {
      for (const cluster of topicClusters)
        await this.#insertCluster(runId, cluster);
      for (const score of scores) await this.#insertScore(runId, score);
      await this.#execute(
        `INSERT INTO research.trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES ($1, $2, $3, $4)`,
        idempotencyKey,
        payloadHash,
        runId,
        new Date().toISOString(),
      );
      return await this.getRun(runId);
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
  async getOperation(idempotencyKey: any): Promise<any> {
    return this.#snapshot(async () => {
      requireKey(idempotencyKey);
      const operation: any = await this.#get(
        `SELECT trend_run_id FROM research.trend_operations WHERE idempotency_key = $1`,
        idempotencyKey,
      );
      return operation ? await this.getRun(operation.trend_run_id) : null;
    });
  }
  async getRun(runId: any): Promise<any> {
    return this.#snapshot(async () => {
      const row: any = await this.#get(
        `SELECT payload_json::text AS payload_json FROM research.trend_runs WHERE id = $1`,
        runId,
      );
      if (!row) return null;
      const appearances: any = await this.#all(
        `SELECT candidate_id, observed_at, reason,
      previous_position, current_position FROM research.candidate_appearances
      WHERE trend_run_id = $1 ORDER BY observed_at, candidate_id`,
        runId,
      );
      const candidateIds: any = appearances.map(
        (item: any): any => item.candidate_id,
      );
      const run: any = JSON.parse(row.payload_json);
      const candidates: any[] = [];
      for (const id of candidateIds) candidates.push(await this.#candidate(id));
      return {
        run: {
          ...run,
          sourceRunIds: (
            await this.#all(
              `SELECT id FROM research.source_runs WHERE trend_run_id = $1 ORDER BY id`,
              runId,
            )
          ).map(({ id }: any): any => id),
          candidateIds,
        },
        sourceRuns: rowsAsPayload(
          await this.#all(
            `SELECT payload_json::text AS payload_json FROM research.source_runs WHERE trend_run_id = $1 ORDER BY id`,
            runId,
          ),
        ),
        candidates,
        snapshots: rowsAsPayload(
          await this.#all(
            `SELECT payload_json::text AS payload_json FROM research.trend_snapshots WHERE trend_run_id = $1 ORDER BY captured_at, id`,
            runId,
          ),
        ),
        topicClusters: rowsAsPayload(
          await this.#all(
            `SELECT payload_json::text AS payload_json FROM research.topic_clusters WHERE trend_run_id = $1 ORDER BY id`,
            runId,
          ),
        ),
        scores: rowsAsPayload(
          await this.#all(
            `SELECT payload_json::text AS payload_json FROM research.trend_scores WHERE trend_run_id = $1 ORDER BY id`,
            runId,
          ),
        ),
        appearances: appearances.map(toAppearance),
      };
    });
  }
  async getCandidateHistory(candidateId: any): Promise<any> {
    return this.#snapshot(async () => {
      const candidate: any = await this.#candidate(candidateId);
      if (!candidate) return null;
      const snapshots: any = rowsAsPayload(
        await this.#all(
          `SELECT payload_json::text AS payload_json FROM research.trend_snapshots WHERE candidate_id = $1 ORDER BY captured_at, id`,
          candidateId,
        ),
      );
      const appearances: any = (
        await this.#all(
          `SELECT trend_run_id, observed_at, reason,
      previous_position, current_position FROM research.candidate_appearances
      WHERE candidate_id = $1 ORDER BY observed_at, trend_run_id`,
          candidateId,
        )
      ).map(toAppearance);
      return {
        candidate,
        snapshots,
        appearances,
        velocities: calculateHistoricalVelocity(snapshots),
      };
    });
  }
  async getCandidateResearchHistory(
    candidateId: any,
    { runId, projectId, projectVersion }: any,
  ): Promise<any> {
    return this.#snapshot(async () => {
      const candidate: any = await this.#candidate(candidateId);
      if (!candidate) return null;
      const snapshots: any = rowsAsPayload(
        await this.#all(
          `SELECT ts.payload_json::text AS payload_json
      FROM research.trend_snapshots ts
      LEFT JOIN research.research_daily_runs rr ON rr.trend_run_id = ts.trend_run_id
      WHERE ts.candidate_id = $1
        AND (ts.trend_run_id = $2 OR (rr.project_id = $3 AND rr.project_version = $4))
      ORDER BY ts.captured_at, ts.id`,
          candidateId,
          runId,
          projectId,
          projectVersion,
        ),
      );
      return {
        candidate,
        snapshots,
        appearances: [],
        velocities: calculateHistoricalVelocity(snapshots),
      };
    });
  }
  async #beginResearchDailyRunRaw(value: any): Promise<any> {
    const priorByPipeline: any = await this.#get(
      `SELECT *, config_json::text AS config_json, source_plan_json::text AS source_plan_json, result_json::text AS result_json FROM research.research_daily_runs WHERE pipeline_run_id = $1`,
      value.pipelineRunId,
    );
    if (priorByPipeline) {
      assertDailyRunRetry(priorByPipeline, value);
      return await this.getResearchDailyRun(value.id);
    }
    await this.#execute(
      `INSERT INTO research.research_daily_runs
      (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
       research_input_hash, config_hash, config_json, source_plan_json, state, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'RUNNING', $11)`,
      value.id,
      value.pipelineRunId,
      value.projectId,
      value.projectVersion,
      value.logicalDate,
      value.timezone,
      value.researchInputHash,
      value.configHash,
      json(value.config),
      json(value.sourcePlan),
      value.startedAt,
    );
    return await this.getResearchDailyRun(value.id);
  }
  async getResearchDailyRun(id: any): Promise<any> {
    return this.#snapshot(async () => {
      const row: any = await this.#get(
        `SELECT *, config_json::text AS config_json, source_plan_json::text AS source_plan_json, result_json::text AS result_json FROM research.research_daily_runs WHERE id = $1`,
        id,
      );
      if (!row) return null;
      const value: any = researchDailyRunFromRow(row);
      value.steps = (
        await this.#all(
          `SELECT *, result_json::text AS result_json FROM research.research_daily_steps WHERE research_daily_run_id = $1 ORDER BY step_key`,
          id,
        )
      ).map(dailyStepFromRow);
      return value;
    });
  }
  async getResearchDailyRunByPipeline(pipelineRunId: any): Promise<any> {
    return this.#snapshot(async () => {
      const row: any = await this.#get(
        `SELECT *, config_json::text AS config_json, source_plan_json::text AS source_plan_json, result_json::text AS result_json FROM research.research_daily_runs WHERE pipeline_run_id = $1`,
        pipelineRunId,
      );
      return row ? await this.getResearchDailyRun(row.id) : null;
    });
  }
  async getResearchDailyStep(
    researchDailyRunId: any,
    stepKey: any,
  ): Promise<any> {
    const row: any = await this.#get(
      `SELECT *, result_json::text AS result_json FROM research.research_daily_steps WHERE research_daily_run_id = $1 AND step_key = $2`,
      researchDailyRunId,
      stepKey,
    );
    return row ? dailyStepFromRow(row) : null;
  }
  async #startResearchDailyStepRaw({
    researchDailyRunId,
    stepKey,
    startedAt,
  }: any): Promise<any> {
    await this.#execute(
      `INSERT INTO research.research_daily_steps (research_daily_run_id, step_key, state, started_at)
      VALUES ($1, $2, 'RUNNING', $3) ON CONFLICT(research_daily_run_id, step_key) DO NOTHING`,
      researchDailyRunId,
      stepKey,
      startedAt,
    );
    return await this.getResearchDailyStep(researchDailyRunId, stepKey);
  }
  async #finishResearchDailyStepRaw({
    researchDailyRunId,
    stepKey,
    state,
    completedAt,
    durationMs,
    result,
  }: any): Promise<any> {
    assertResearchState('dailyStep', state);
    await this.#execute(
      `UPDATE research.research_daily_steps SET state = $1, completed_at = $2, duration_ms = $3, result_json = $4
      WHERE research_daily_run_id = $5 AND step_key = $6`,
      state,
      completedAt,
      durationMs,
      json(result),
      researchDailyRunId,
      stepKey,
    );
    return await this.getResearchDailyStep(researchDailyRunId, stepKey);
  }
  async #finishResearchDailyRunRaw({
    id,
    state,
    trendRunId,
    completedAt,
    durationMs,
    result,
  }: any): Promise<any> {
    assertResearchState('dailyRun', state);
    await this.#execute(
      `UPDATE research.research_daily_runs SET state = $1, trend_run_id = $2, completed_at = $3, duration_ms = $4, result_json = $5
      WHERE id = $6`,
      state,
      trendRunId ?? null,
      completedAt,
      durationMs,
      json(result),
      id,
    );
    return await this.getResearchDailyRun(id);
  }
  async #recordResearchArtifactRaw({
    researchDailyRunId,
    artifact,
  }: any): Promise<any> {
    const validated: any = createResearchArtifact(artifact);
    const daily: any = await this.getResearchDailyRun(researchDailyRunId);
    assertResearchArtifactLineage(validated, daily);
    assertResearchArtifactContent(
      validated,
      Boolean(await this.getRun(validated.trendRunId)),
    );
    const prior: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.research_artifacts WHERE research_daily_run_id = $1`,
      researchDailyRunId,
    );
    if (prior) {
      const stored: any = JSON.parse(prior.payload_json);
      if (stableHash(stored) !== stableHash(validated))
        throw new TrendStoreError(
          'RESEARCH_ARTIFACT_CONFLICT',
          'artefato já persistido com outro conteúdo',
        );
      return stored;
    }
    await this.#execute(
      `INSERT INTO research.research_artifacts
      (artifact_id, schema_version, research_daily_run_id, trend_run_id, pipeline_run_id,
       project_id, project_version, content_hash, payload_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      validated.artifactId,
      validated.schemaVersion,
      researchDailyRunId,
      validated.trendRunId,
      validated.pipelineRunId,
      validated.projectId,
      validated.projectVersion,
      validated.contentHash,
      json(validated),
      validated.createdAt,
    );
    return validated;
  }
  async getResearchArtifact(researchDailyRunId: any): Promise<any> {
    const row: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.research_artifacts WHERE research_daily_run_id = $1`,
      researchDailyRunId,
    );
    return row ? JSON.parse(row.payload_json) : null;
  }
  async #recordResearchShortlistRaw(artifact: any): Promise<any> {
    const validated: any = createResearchShortlist(artifact);
    const daily: any = await this.getResearchDailyRunByPipeline(
      validated.pipelineRunId,
    );
    requireResearchDailyRun(daily);
    const source: any = await this.getResearchArtifact(daily.id);
    assertShortlistSource(validated, source);
    const catalog: any = await this.getRun(validated.trendRunId);
    assertShortlistCatalog(validated, catalog);
    const prior: any = await this.getResearchShortlistByPipeline(
      validated.pipelineRunId,
    );
    if (prior) {
      if (stableHash(prior) !== stableHash(validated))
        throw new TrendStoreError(
          'RESEARCH_SHORTLIST_CONFLICT',
          'shortlist já persistida com outro conteúdo',
        );
      return createResearchShortlist(prior);
    }
    try {
      await this.#execute(
        `INSERT INTO research.research_shortlists
        (artifact_id, schema_version, revision, pipeline_run_id, project_id, project_version,
         logical_date, research_artifact_id, trend_run_id, research_input_hash,
         research_topic_catalog_hash, trend_catalog_hash, policy_version, state,
         content_hash, payload_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        validated.artifactId,
        validated.schemaVersion,
        validated.revision,
        validated.pipelineRunId,
        validated.projectId,
        validated.projectVersion,
        validated.logicalDate,
        validated.researchTopicCatalogArtifactId,
        validated.trendRunId,
        validated.researchInputHash,
        validated.researchTopicCatalogHash,
        validated.trendCatalogHash,
        validated.policy.version,
        validated.state,
        validated.contentHash,
        json(validated),
        validated.createdAt,
      );
      return validated;
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
  async getResearchShortlistByPipeline(pipelineRunId: any): Promise<any> {
    const row: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.research_shortlists WHERE pipeline_run_id = $1`,
      pipelineRunId,
    );
    return row ? JSON.parse(row.payload_json) : null;
  }
  async #beginReferenceAnalysisRunRaw(value: any): Promise<any> {
    const prior: any = await this.#get(
      `SELECT *, result_json::text AS result_json FROM research.reference_analysis_runs WHERE pipeline_run_id = $1`,
      value.pipelineRunId,
    );
    if (prior) {
      assertReferenceRunRetry(prior, value);
      return await this.getReferenceAnalysisRun(value.id);
    }
    await this.#execute(
      `INSERT INTO research.reference_analysis_runs
      (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
       research_input_hash, project_snapshot_hash, policy_version, config_hash, state, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'RUNNING', $11)`,
      value.id,
      value.pipelineRunId,
      value.projectId,
      value.projectVersion,
      value.logicalDate,
      value.timezone,
      value.researchInputHash,
      value.projectSnapshotHash,
      value.policyVersion,
      value.configHash,
      value.startedAt,
    );
    return await this.getReferenceAnalysisRun(value.id);
  }
  async getReferenceAnalysisRun(id: any): Promise<any> {
    return this.#snapshot(async () => {
      const row: any = await this.#get(
        `SELECT *, result_json::text AS result_json FROM research.reference_analysis_runs WHERE id = $1`,
        id,
      );
      if (!row) return null;
      const value: any = referenceAnalysisRunFromRow(row);
      value.steps = (
        await this.#all(
          `SELECT *, result_json::text AS result_json FROM research.reference_analysis_steps
      WHERE reference_analysis_run_id = $1 ORDER BY reference_key`,
          id,
        )
      ).map(referenceStepFromRow);
      return value;
    });
  }
  async getReferenceAnalysisStep(
    referenceAnalysisRunId: any,
    referenceKey: any,
  ): Promise<any> {
    const row: any = await this.#get(
      `SELECT *, result_json::text AS result_json FROM research.reference_analysis_steps
      WHERE reference_analysis_run_id = $1 AND reference_key = $2`,
      referenceAnalysisRunId,
      referenceKey,
    );
    return row ? referenceStepFromRow(row) : null;
  }
  async #startReferenceAnalysisStepRaw({
    referenceAnalysisRunId,
    referenceKey,
    startedAt,
  }: any): Promise<any> {
    await this.#execute(
      `INSERT INTO research.reference_analysis_steps
      (reference_analysis_run_id, reference_key, state, started_at)
      VALUES ($1, $2, 'RUNNING', $3) ON CONFLICT(reference_analysis_run_id, reference_key) DO NOTHING`,
      referenceAnalysisRunId,
      referenceKey,
      startedAt,
    );
    return await this.getReferenceAnalysisStep(
      referenceAnalysisRunId,
      referenceKey,
    );
  }
  async #finishReferenceAnalysisStepRaw({
    referenceAnalysisRunId,
    referenceKey,
    state,
    completedAt,
    durationMs,
    result,
  }: any): Promise<any> {
    assertResearchState('referenceStep', state);
    rejectReferenceSourceFields(result);
    await this.#execute(
      `UPDATE research.reference_analysis_steps
      SET state = $1, completed_at = $2, duration_ms = $3, result_json = $4
      WHERE reference_analysis_run_id = $5 AND reference_key = $6`,
      state,
      completedAt,
      durationMs,
      json(result),
      referenceAnalysisRunId,
      referenceKey,
    );
    return await this.getReferenceAnalysisStep(
      referenceAnalysisRunId,
      referenceKey,
    );
  }
  async #finishReferenceAnalysisRunRaw({
    id,
    state,
    completedAt,
    durationMs,
    result,
  }: any): Promise<any> {
    assertResearchState('referenceRun', state);
    await this.#execute(
      `UPDATE research.reference_analysis_runs
      SET state = $1, completed_at = $2, duration_ms = $3, result_json = $4 WHERE id = $5`,
      state,
      completedAt,
      durationMs,
      json(result),
      id,
    );
    return await this.getReferenceAnalysisRun(id);
  }
  async #recordReferenceInsightRaw({
    referenceAnalysisRunId,
    artifact,
  }: any): Promise<any> {
    const validated: any = createReferenceInsight(artifact);
    const run: any = await this.getReferenceAnalysisRun(referenceAnalysisRunId);
    assertReferenceInsightLineage(validated, run);
    const prior: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.reference_insights WHERE reference_analysis_run_id = $1`,
      referenceAnalysisRunId,
    );
    if (prior) {
      const stored: any = JSON.parse(prior.payload_json);
      if (stableHash(stored) !== stableHash(validated))
        throw new TrendStoreError(
          'REFERENCE_INSIGHT_CONFLICT',
          'artefato já persistido com outro conteúdo',
        );
      return stored;
    }
    await this.#execute(
      `INSERT INTO research.reference_insights
      (artifact_id, schema_version, reference_analysis_run_id, pipeline_run_id,
       project_id, project_version, content_hash, payload_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      validated.artifactId,
      validated.schemaVersion,
      referenceAnalysisRunId,
      validated.pipelineRunId,
      validated.projectId,
      validated.projectVersion,
      validated.contentHash,
      json(validated),
      validated.createdAt,
    );
    return validated;
  }
  async getReferenceInsight(referenceAnalysisRunId: any): Promise<any> {
    const row: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.reference_insights WHERE reference_analysis_run_id = $1`,
      referenceAnalysisRunId,
    );
    return row ? JSON.parse(row.payload_json) : null;
  }
  async updateRunState(runId: any, state: any, updatedAt: any): Promise<any> {
    return this.atomic(async () => {
      const catalog: any = await this.getRun(runId);
      if (!catalog)
        throw new TrendStoreError('RUN_NOT_FOUND', `run inexistente: ${runId}`);
      const run: any = validateTrendRun(
        { ...catalog.run, state, updatedAt },
        catalog.sourceRuns,
      );
      await this.#execute(
        `UPDATE research.trend_runs SET state = $1, updated_at = $2, payload_json = $3 WHERE id = $4`,
        state,
        updatedAt,
        json(run),
        runId,
      );
      return await this.getRun(runId);
    });
  }
  async close(): Promise<void> {
    this.#closed = true;
  }
  async #insertRun(run: any): Promise<any> {
    await this.#insertExact(
      'trend_runs',
      run.id,
      run,
      async (): Promise<any> => {
        await this.#execute(
          `INSERT INTO research.trend_runs
        (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          run.id,
          run.schemaVersion,
          run.state,
          run.createdAt,
          run.updatedAt,
          run.rankingConfigVersion,
          json(run),
        );
      },
    );
  }
  async #recordObservation(
    runId: any,
    {
      candidate,
      snapshot,
      reappearanceReason = 'FIRST_SEEN',
      previousPosition,
      currentPosition,
    }: any,
  ): Promise<any> {
    assertObservationReference(candidate, snapshot);
    const canonicalUrlKey: any = canonicalTrendIdentity({
      platform: candidate.platform,
      canonicalUrl: candidate.canonicalUrl,
    }).slice(`${candidate.platform}:url:`.length);
    let existing: any =
      candidate.platformVideoId === undefined
        ? null
        : await this.#get(
            `SELECT *, payload_json::text AS payload_json FROM research.trend_candidates WHERE platform = $1 AND platform_video_id = $2`,
            candidate.platform,
            candidate.platformVideoId,
          );
    if (!existing) {
      const byUrl: any = await this.#get(
        `SELECT *, payload_json::text AS payload_json FROM research.trend_candidates WHERE platform = $1 AND canonical_url_key = $2 ORDER BY platform_video_id IS NULL DESC LIMIT 1`,
        candidate.platform,
        canonicalUrlKey,
      );
      if (
        byUrl &&
        (candidate.platformVideoId === undefined ||
          byUrl.platform_video_id === null)
      )
        existing = byUrl;
    }
    if (!existing) {
      await this.#execute(
        `INSERT INTO research.trend_candidates
        (id, identity_key, platform, platform_video_id, canonical_url_key, state,
         first_seen_at, last_seen_at, appearance_count, payload_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
        candidate.id,
        candidate.identityKey,
        candidate.platform,
        candidate.platformVideoId ?? null,
        canonicalUrlKey,
        candidate.state,
        candidate.firstSeenAt,
        candidate.lastSeenAt,
        json(candidate),
      );
      existing = await this.#get(
        `SELECT *, payload_json::text AS payload_json FROM research.trend_candidates WHERE id = $1`,
        candidate.id,
      );
    } else if (
      existing.platform_video_id === null &&
      candidate.platformVideoId !== undefined
    ) {
      const promoted: any = {
        ...candidate,
        id: existing.id,
        firstSeenAt: minDate(existing.first_seen_at, candidate.firstSeenAt),
      };
      await this.#execute(
        `UPDATE research.trend_candidates SET identity_key = $1, platform_video_id = $2,
        canonical_url_key = $3, state = $4, last_seen_at = $5, payload_json = $6 WHERE id = $7`,
        candidate.identityKey,
        candidate.platformVideoId,
        canonicalUrlKey,
        candidate.state,
        maxDate(existing.last_seen_at, candidate.lastSeenAt),
        json(promoted),
        existing.id,
      );
    }
    const storedId: any = existing.id;
    await this.#execute(
      `INSERT INTO research.candidate_appearances
      (trend_run_id, candidate_id, observed_at, reason, previous_position, current_position)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (trend_run_id,candidate_id) DO NOTHING`,
      runId,
      storedId,
      candidate.lastSeenAt,
      reappearanceReason,
      previousPosition ?? null,
      currentPosition ?? null,
    );
    await this.#execute(
      `UPDATE research.trend_candidates SET state = $1, first_seen_at = $2, last_seen_at = $3,
      appearance_count = (SELECT COUNT(*) FROM research.candidate_appearances WHERE candidate_id = $4), payload_json = $5 WHERE id = $6`,
      candidate.state,
      minDate(existing.first_seen_at, candidate.firstSeenAt),
      maxDate(existing.last_seen_at, candidate.lastSeenAt),
      storedId,
      json({ ...candidate, id: storedId }),
      storedId,
    );
    const storedSnapshot: any = { ...snapshot, candidateId: storedId };
    await this.#insertExact(
      'trend_snapshots',
      snapshot.id,
      storedSnapshot,
      async (): Promise<any> => {
        await this.#execute(
          `INSERT INTO research.trend_snapshots
        (id, trend_run_id, candidate_id, captured_at, metrics_json, payload_json)
        VALUES ($1, $2, $3, $4, $5, $6)`,
          snapshot.id,
          runId,
          storedId,
          snapshot.capturedAt,
          json(snapshot.metrics),
          json(storedSnapshot),
        );
      },
      'IMMUTABLE_SNAPSHOT_CONFLICT',
    );
    return storedId;
  }
  async #insertCluster(runId: any, cluster: any): Promise<any> {
    await this.#insertExact(
      'topic_clusters',
      cluster.id,
      cluster,
      async (): Promise<any> => {
        await this.#execute(
          `INSERT INTO research.topic_clusters (id, trend_run_id, payload_json) VALUES ($1, $2, $3)`,
          cluster.id,
          runId,
          json(cluster),
        );
        for (const id of cluster.candidateIds)
          await this.#execute(
            `INSERT INTO research.topic_cluster_candidates (cluster_id, candidate_id) VALUES ($1, $2)`,
            cluster.id,
            id,
          );
        for (const id of cluster.evidenceSnapshotIds)
          await this.#execute(
            `INSERT INTO research.topic_cluster_snapshots (cluster_id, snapshot_id) VALUES ($1, $2)`,
            cluster.id,
            id,
          );
      },
    );
  }
  async #insertScore(runId: any, score: any): Promise<any> {
    await this.#insertExact(
      'trend_scores',
      score.id,
      score,
      async (): Promise<any> => {
        await this.#execute(
          `INSERT INTO research.trend_scores
        (id, trend_run_id, candidate_id, formula_version, calculated_at, payload_json)
        VALUES ($1, $2, $3, $4, $5, $6)`,
          score.id,
          runId,
          score.candidateId,
          score.formulaVersion,
          score.calculatedAt,
          json(score),
        );
        for (const [component, value] of entries(score.components)) {
          for (const snapshotId of value.evidenceSnapshotIds) {
            await this.#execute(
              `INSERT INTO research.trend_score_snapshots
            (score_id, snapshot_id, component) VALUES ($1, $2, $3)`,
              score.id,
              snapshotId,
              component,
            );
          }
        }
      },
    );
  }
  async #insertExact(
    table: any,
    id: any,
    value: any,
    insert: any,
    conflictCode: any = 'ENTITY_CONFLICT',
  ): Promise<any> {
    const prior: any = await this.#get(
      `SELECT payload_json::text AS payload_json FROM research.${table} WHERE id = $1`,
      id,
    );
    if (!prior) return insert();
    if (prior.payload_json !== json(value))
      throw new TrendStoreError(
        conflictCode,
        `${table}.${id} já existe com outro conteúdo`,
      );
  }
  async #candidate(candidateId: any): Promise<any> {
    const row: any = await this.#get(
      `SELECT *, payload_json::text AS payload_json FROM research.trend_candidates WHERE id = $1`,
      candidateId,
    );
    if (!row) return null;
    const value: any = JSON.parse(row.payload_json);
    const snapshotIds: any = (
      await this.#all(
        `SELECT id FROM research.trend_snapshots WHERE candidate_id = $1 ORDER BY captured_at, id`,
        candidateId,
      )
    ).map(({ id }: any): any => id);
    const topicClusterIds: any = (
      await this.#all(
        `SELECT cluster_id FROM research.topic_cluster_candidates WHERE candidate_id = $1 ORDER BY cluster_id`,
        candidateId,
      )
    ).map(({ cluster_id }: any): any => cluster_id);
    return {
      ...value,
      id: row.id,
      identityKey: row.identity_key,
      platformVideoId: row.platform_video_id ?? undefined,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      reappearanceCount: row.appearance_count,
      snapshotIds,
      topicClusterIds,
    };
  }
  #assertOpen(): void {
    if (this.#closed)
      throw new TrendStoreError(
        'RESEARCH_REPOSITORY_CLOSED',
        'repositório encerrado',
      );
    const current = this.#context.getStore();
    if (current && !current.active)
      throw new TrendStoreError(
        'RESEARCH_TRANSACTION_CLOSED',
        'transação encerrada',
      );
  }
  async #snapshot<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#context.getStore()) return operation();
    return this.database.transaction(async (client) => {
      await client.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      const context = { client, writable: false, active: true };
      return this.#context.run(context, async () => {
        try {
          return await operation();
        } finally {
          context.active = false;
        }
      });
    });
  }
  async #query(text: string, values: any[]): Promise<any> {
    this.#assertOpen();
    try {
      const current = this.#context.getStore();
      return current
        ? await current.client.query(text, values)
        : await this.database.query(text, values);
    } catch (error) {
      throw mapPostgresError(error, true);
    }
  }
  async #get(text: string, ...values: any[]): Promise<any> {
    return (await this.#all(text, ...values))[0];
  }
  async #all(text: string, ...values: any[]): Promise<any[]> {
    return (await this.#query(text, values)).rows.map(normalizeRow);
  }
  async #execute(text: string, ...values: any[]): Promise<void> {
    await this.#query(text, values);
  }
}

function normalizeRow(row: any): any {
  for (const key of ['project_version', 'appearance_count', 'revision']) {
    if (row[key] === null || row[key] === undefined) continue;
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value))
      throw new TrendStoreError('INVALID_PERSISTED_RESEARCH_NUMBER', key);
    row[key] = value;
  }
  for (const key of ['duration_ms', 'previous_position', 'current_position']) {
    if (row[key] === null || row[key] === undefined) continue;
    const value = Number(row[key]);
    if (!Number.isFinite(value))
      throw new TrendStoreError('INVALID_PERSISTED_RESEARCH_NUMBER', key);
    row[key] = value;
  }
  return row;
}
function mapPostgresError(error: unknown, sanitizeUnknown = false): unknown {
  if (error instanceof TrendStoreError || error instanceof ResearchReadError)
    return error;
  const value =
    error && typeof error === 'object'
      ? (error as { sqlState?: unknown; code?: unknown; constraint?: unknown })
      : {};
  const state =
    typeof value.sqlState === 'string'
      ? value.sqlState
      : typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code)
        ? value.code
        : undefined;
  let mapped: TrendStoreError | undefined;
  if (state === '23503')
    mapped = new TrendStoreError(
      'FOREIGN_KEY_VIOLATION',
      'referência inexistente',
    );
  if (
    state === 'P2001' ||
    (state === '23505' &&
      typeof value.constraint === 'string' &&
      [
        'trend_snapshots_candidate_captured_unique',
        'trend_snapshots_pkey',
      ].includes(value.constraint))
  )
    mapped = new TrendStoreError(
      'IMMUTABLE_SNAPSHOT_CONFLICT',
      'snapshots não podem ser alterados',
    );
  if (state === '23505' && !mapped)
    mapped = new TrendStoreError(
      'ENTITY_CONFLICT',
      'identificador ou identidade já existe',
    );
  if (mapped) {
    Object.defineProperty(mapped, 'sqlState', {
      value: state,
      enumerable: true,
    });
    return mapped;
  }
  return sanitizeUnknown
    ? new PostgresError('POSTGRES_QUERY_FAILED', state)
    : error;
}
