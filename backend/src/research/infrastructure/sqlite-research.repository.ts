import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  canonicalTrendIdentity,
  serializePublicTrendCatalog,
  validateSourceRun,
  validateTopicCluster,
  validateTrendCandidate,
  validateTrendRun,
  validateTrendScore,
  validateTrendSnapshot,
} from '../domain/research-record-contracts.js';
import { calculateHistoricalVelocity } from '../domain/velocity.js';
import { createResearchArtifact } from '../domain/research-artifact-contracts.js';
import { createReferenceInsight } from '../domain/reference-insight-contracts.js';
import { createResearchShortlist } from '../domain/research-shortlist-contracts.js';
export { TrendStoreError } from '../domain/research.errors.js';
import { TrendStoreError } from '../domain/research.errors.js';
import { SqliteResearchReader } from './sqlite-research.reader.js';
export class SqliteResearchRepository {
  readonly db: any;
  constructor(path: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    const preflight: any = new DatabaseSync(path, { readOnly: true });
    try {
      preflight.exec('PRAGMA busy_timeout=5000;');
      if (
        ![39, 40, 41, 42].includes(
          Number(preflight.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(preflight.prepare('PRAGMA user_version').get()?.user_version) >=
          41 &&
          preflight
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw new Error('RESEARCH_SCHEMA_VERSION_UNSUPPORTED');
    } finally {
      preflight.close();
    }
    this.db = new DatabaseSync(path, { readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec(
        readOnly ? 'PRAGMA query_only=ON;' : 'PRAGMA foreign_keys=ON;',
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  getShortlist(id: string) {
    return new SqliteResearchReader(this.db).getShortlist(id);
  }
  getInsight(id: string) {
    return new SqliteResearchReader(this.db).getInsight(id);
  }
  recordOperation(value: any): any {
    return this.db.isTransaction
      ? this.#recordOperationRaw(value)
      : this.atomic(() => this.#recordOperationRaw(value));
  }
  recordAnalysis(value: any): any {
    return this.db.isTransaction
      ? this.#recordAnalysisRaw(value)
      : this.atomic(() => this.#recordAnalysisRaw(value));
  }
  beginResearchDailyRun(value: any): any {
    return this.db.isTransaction
      ? this.#beginResearchDailyRunRaw(value)
      : this.atomic(() => this.#beginResearchDailyRunRaw(value));
  }
  startResearchDailyStep(value: any): any {
    return this.db.isTransaction
      ? this.#startResearchDailyStepRaw(value)
      : this.atomic(() => this.#startResearchDailyStepRaw(value));
  }
  finishResearchDailyStep(value: any): any {
    return this.db.isTransaction
      ? this.#finishResearchDailyStepRaw(value)
      : this.atomic(() => this.#finishResearchDailyStepRaw(value));
  }
  finishResearchDailyRun(value: any): any {
    return this.db.isTransaction
      ? this.#finishResearchDailyRunRaw(value)
      : this.atomic(() => this.#finishResearchDailyRunRaw(value));
  }
  recordResearchArtifact(value: any): any {
    return this.db.isTransaction
      ? this.#recordResearchArtifactRaw(value)
      : this.atomic(() => this.#recordResearchArtifactRaw(value));
  }
  recordResearchShortlist(value: any): any {
    return this.db.isTransaction
      ? this.#recordResearchShortlistRaw(value)
      : this.atomic(() => this.#recordResearchShortlistRaw(value));
  }
  beginReferenceAnalysisRun(value: any): any {
    return this.db.isTransaction
      ? this.#beginReferenceAnalysisRunRaw(value)
      : this.atomic(() => this.#beginReferenceAnalysisRunRaw(value));
  }
  startReferenceAnalysisStep(value: any): any {
    return this.db.isTransaction
      ? this.#startReferenceAnalysisStepRaw(value)
      : this.atomic(() => this.#startReferenceAnalysisStepRaw(value));
  }
  finishReferenceAnalysisStep(value: any): any {
    return this.db.isTransaction
      ? this.#finishReferenceAnalysisStepRaw(value)
      : this.atomic(() => this.#finishReferenceAnalysisStepRaw(value));
  }
  finishReferenceAnalysisRun(value: any): any {
    return this.db.isTransaction
      ? this.#finishReferenceAnalysisRunRaw(value)
      : this.atomic(() => this.#finishReferenceAnalysisRunRaw(value));
  }
  recordReferenceInsight(value: any): any {
    return this.db.isTransaction
      ? this.#recordReferenceInsightRaw(value)
      : this.atomic(() => this.#recordReferenceInsightRaw(value));
  }
  atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result: any = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  #recordOperationRaw({
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
    const prior: any = this.db
      .prepare(
        'SELECT payload_hash, trend_run_id FROM trend_operations WHERE idempotency_key = ?',
      )
      .get(idempotencyKey);
    if (prior) {
      if (prior.payload_hash !== payloadHash)
        throw new TrendStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'a chave já foi usada com outro conteúdo',
        );
      return this.getRun(prior.trend_run_id);
    }

    const ownsTransaction: any = !this.db.isTransaction;
    try {
      if (ownsTransaction) this.db.exec('BEGIN IMMEDIATE');
      this.#insertRun(run);
      for (const sourceRun of sourceRuns)
        this.#insertExact('source_runs', sourceRun.id, sourceRun, (): any => {
          this.db
            .prepare(
              `INSERT INTO source_runs
          (id, trend_run_id, platform, status, started_at, completed_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              sourceRun.id,
              sourceRun.trendRunId,
              sourceRun.platform,
              sourceRun.status,
              sourceRun.startedAt,
              sourceRun.completedAt,
              json(sourceRun),
            );
        });

      const candidateMap: any = new Map();
      for (const observation of observations) {
        const storedId: any = this.#recordObservation(run.id, observation);
        candidateMap.set(observation.candidate.id, storedId);
      }
      for (const cluster of topicClusters)
        this.#insertCluster(run.id, remapCluster(cluster, candidateMap));
      for (const score of scores)
        this.#insertScore(run.id, {
          ...score,
          candidateId: candidateMap.get(score.candidateId) ?? score.candidateId,
        });
      this.db
        .prepare(
          `INSERT INTO trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(idempotencyKey, payloadHash, run.id, new Date().toISOString());
      if (ownsTransaction) this.db.exec('COMMIT');
      return this.getRun(run.id);
    } catch (error) {
      if (ownsTransaction && this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapSqliteError(error);
    }
  }
  #recordAnalysisRaw({
    idempotencyKey,
    runId,
    topicClusters,
    scores,
  }: any): any {
    requireKey(idempotencyKey);
    const catalog: any = this.getRun(runId);
    if (!catalog)
      throw new TrendStoreError('RUN_NOT_FOUND', `run inexistente: ${runId}`);
    const candidateIds: any = catalog.candidates.map(({ id }: any): any => id);
    const candidateSet: any = new Set(candidateIds);
    const histories: any = new Map(
      catalog.candidates.map(({ id }: any): any => [
        id,
        this.getCandidateHistory(id),
      ]),
    );
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
    const input: any = { runId, topicClusters, scores };
    const payloadHash: any = stableHash(input);
    const prior: any = this.db
      .prepare(
        'SELECT payload_hash, trend_run_id FROM trend_operations WHERE idempotency_key = ?',
      )
      .get(idempotencyKey);
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.trend_run_id !== runId) {
        throw new TrendStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'a chave já foi usada com outro conteúdo',
        );
      }
      return this.getRun(runId);
    }
    const ownsTransaction: any = !this.db.isTransaction;
    try {
      if (ownsTransaction) this.db.exec('BEGIN IMMEDIATE');
      for (const cluster of topicClusters) this.#insertCluster(runId, cluster);
      for (const score of scores) this.#insertScore(runId, score);
      this.db
        .prepare(
          `INSERT INTO trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(idempotencyKey, payloadHash, runId, new Date().toISOString());
      if (ownsTransaction) this.db.exec('COMMIT');
      return this.getRun(runId);
    } catch (error) {
      if (ownsTransaction && this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapSqliteError(error);
    }
  }
  getOperation(idempotencyKey: any): any {
    requireKey(idempotencyKey);
    const operation: any = this.db
      .prepare(
        'SELECT trend_run_id FROM trend_operations WHERE idempotency_key = ?',
      )
      .get(idempotencyKey);
    return operation ? this.getRun(operation.trend_run_id) : null;
  }
  getRun(runId: any): any {
    const row: any = this.db
      .prepare('SELECT payload_json FROM trend_runs WHERE id = ?')
      .get(runId);
    if (!row) return null;
    const appearances: any = this.db
      .prepare(
        `SELECT candidate_id, observed_at, reason,
      previous_position, current_position FROM candidate_appearances
      WHERE trend_run_id = ? ORDER BY observed_at, candidate_id`,
      )
      .all(runId);
    const candidateIds: any = appearances.map(
      (item: any): any => item.candidate_id,
    );
    const run: any = JSON.parse(row.payload_json);
    return {
      run: {
        ...run,
        sourceRunIds: this.db
          .prepare(
            'SELECT id FROM source_runs WHERE trend_run_id = ? ORDER BY id',
          )
          .all(runId)
          .map(({ id }: any): any => id),
        candidateIds,
      },
      sourceRuns: rowsAsPayload(
        this.db
          .prepare(
            'SELECT payload_json FROM source_runs WHERE trend_run_id = ? ORDER BY id',
          )
          .all(runId),
      ),
      candidates: candidateIds.map((id: any): any => this.#candidate(id)),
      snapshots: rowsAsPayload(
        this.db
          .prepare(
            'SELECT payload_json FROM trend_snapshots WHERE trend_run_id = ? ORDER BY captured_at, id',
          )
          .all(runId),
      ),
      topicClusters: rowsAsPayload(
        this.db
          .prepare(
            'SELECT payload_json FROM topic_clusters WHERE trend_run_id = ? ORDER BY id',
          )
          .all(runId),
      ),
      scores: rowsAsPayload(
        this.db
          .prepare(
            'SELECT payload_json FROM trend_scores WHERE trend_run_id = ? ORDER BY id',
          )
          .all(runId),
      ),
      appearances: appearances.map(toAppearance),
    };
  }
  getCandidateHistory(candidateId: any): any {
    const candidate: any = this.#candidate(candidateId);
    if (!candidate) return null;
    const snapshots: any = rowsAsPayload(
      this.db
        .prepare(
          'SELECT payload_json FROM trend_snapshots WHERE candidate_id = ? ORDER BY captured_at, id',
        )
        .all(candidateId),
    );
    const appearances: any = this.db
      .prepare(
        `SELECT trend_run_id, observed_at, reason,
      previous_position, current_position FROM candidate_appearances
      WHERE candidate_id = ? ORDER BY observed_at, trend_run_id`,
      )
      .all(candidateId)
      .map(toAppearance);
    return {
      candidate,
      snapshots,
      appearances,
      velocities: calculateHistoricalVelocity(snapshots),
    };
  }
  getCandidateResearchHistory(
    candidateId: any,
    { runId, projectId, projectVersion }: any,
  ): any {
    const candidate: any = this.#candidate(candidateId);
    if (!candidate) return null;
    const snapshots: any = rowsAsPayload(
      this.db
        .prepare(
          `SELECT ts.payload_json
      FROM trend_snapshots ts
      LEFT JOIN research_daily_runs rr ON rr.trend_run_id = ts.trend_run_id
      WHERE ts.candidate_id = ?
        AND (ts.trend_run_id = ? OR (rr.project_id = ? AND rr.project_version = ?))
      ORDER BY ts.captured_at, ts.id`,
        )
        .all(candidateId, runId, projectId, projectVersion),
    );
    return {
      candidate,
      snapshots,
      appearances: [],
      velocities: calculateHistoricalVelocity(snapshots),
    };
  }
  #beginResearchDailyRunRaw(value: any): any {
    const priorByPipeline: any = this.db
      .prepare('SELECT * FROM research_daily_runs WHERE pipeline_run_id = ?')
      .get(value.pipelineRunId);
    if (priorByPipeline) {
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
      return this.getResearchDailyRun(value.id);
    }
    this.db
      .prepare(
        `INSERT INTO research_daily_runs
      (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
       research_input_hash, config_hash, config_json, source_plan_json, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)`,
      )
      .run(
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
    return this.getResearchDailyRun(value.id);
  }
  getResearchDailyRun(id: any): any {
    const row: any = this.db
      .prepare('SELECT * FROM research_daily_runs WHERE id = ?')
      .get(id);
    if (!row) return null;
    const value: any = researchDailyRunFromRow(row);
    value.steps = this.db
      .prepare(
        'SELECT * FROM research_daily_steps WHERE research_daily_run_id = ? ORDER BY step_key',
      )
      .all(id)
      .map(dailyStepFromRow);
    return value;
  }
  getResearchDailyRunByPipeline(pipelineRunId: any): any {
    const row: any = this.db
      .prepare('SELECT * FROM research_daily_runs WHERE pipeline_run_id = ?')
      .get(pipelineRunId);
    return row ? this.getResearchDailyRun(row.id) : null;
  }
  getResearchDailyStep(researchDailyRunId: any, stepKey: any): any {
    const row: any = this.db
      .prepare(
        'SELECT * FROM research_daily_steps WHERE research_daily_run_id = ? AND step_key = ?',
      )
      .get(researchDailyRunId, stepKey);
    return row ? dailyStepFromRow(row) : null;
  }
  #startResearchDailyStepRaw({
    researchDailyRunId,
    stepKey,
    startedAt,
  }: any): any {
    this.db
      .prepare(
        `INSERT INTO research_daily_steps (research_daily_run_id, step_key, state, started_at)
      VALUES (?, ?, 'RUNNING', ?) ON CONFLICT(research_daily_run_id, step_key) DO NOTHING`,
      )
      .run(researchDailyRunId, stepKey, startedAt);
    return this.getResearchDailyStep(researchDailyRunId, stepKey);
  }
  #finishResearchDailyStepRaw({
    researchDailyRunId,
    stepKey,
    state,
    completedAt,
    durationMs,
    result,
  }: any): any {
    if (!['COMPLETED', 'SKIPPED', 'FAILED'].includes(state))
      throw new TrendStoreError('INVALID_DAILY_STEP_STATE', state);
    this.db
      .prepare(
        `UPDATE research_daily_steps SET state = ?, completed_at = ?, duration_ms = ?, result_json = ?
      WHERE research_daily_run_id = ? AND step_key = ?`,
      )
      .run(
        state,
        completedAt,
        durationMs,
        json(result),
        researchDailyRunId,
        stepKey,
      );
    return this.getResearchDailyStep(researchDailyRunId, stepKey);
  }
  #finishResearchDailyRunRaw({
    id,
    state,
    trendRunId,
    completedAt,
    durationMs,
    result,
  }: any): any {
    if (!['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'].includes(state))
      throw new TrendStoreError('INVALID_DAILY_RUN_STATE', state);
    this.db
      .prepare(
        `UPDATE research_daily_runs SET state = ?, trend_run_id = ?, completed_at = ?, duration_ms = ?, result_json = ?
      WHERE id = ?`,
      )
      .run(
        state,
        trendRunId ?? null,
        completedAt,
        durationMs,
        json(result),
        id,
      );
    return this.getResearchDailyRun(id);
  }
  #recordResearchArtifactRaw({ researchDailyRunId, artifact }: any): any {
    const validated: any = createResearchArtifact(artifact);
    const daily: any = this.getResearchDailyRun(researchDailyRunId);
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
    if (!this.getRun(validated.trendRunId)) {
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
    const prior: any = this.db
      .prepare(
        'SELECT payload_json FROM research_artifacts WHERE research_daily_run_id = ?',
      )
      .get(researchDailyRunId);
    if (prior) {
      const stored: any = JSON.parse(prior.payload_json);
      if (stableHash(stored) !== stableHash(validated))
        throw new TrendStoreError(
          'RESEARCH_ARTIFACT_CONFLICT',
          'artefato já persistido com outro conteúdo',
        );
      return stored;
    }
    this.db
      .prepare(
        `INSERT INTO research_artifacts
      (artifact_id, schema_version, research_daily_run_id, trend_run_id, pipeline_run_id,
       project_id, project_version, content_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
  getResearchArtifact(researchDailyRunId: any): any {
    const row: any = this.db
      .prepare(
        'SELECT payload_json FROM research_artifacts WHERE research_daily_run_id = ?',
      )
      .get(researchDailyRunId);
    return row ? JSON.parse(row.payload_json) : null;
  }
  #recordResearchShortlistRaw(artifact: any): any {
    const validated: any = createResearchShortlist(artifact);
    const daily: any = this.getResearchDailyRunByPipeline(
      validated.pipelineRunId,
    );
    if (!daily)
      throw new TrendStoreError(
        'RESEARCH_RUN_NOT_FOUND',
        'execução de Research inexistente',
      );
    const source: any = this.getResearchArtifact(daily.id);
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
    const catalog: any = this.getRun(validated.trendRunId);
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
        stableHash(clusters.get(item.cluster.id)) !==
          stableHash(item.cluster) ||
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
    const prior: any = this.getResearchShortlistByPipeline(
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
      this.db
        .prepare(
          `INSERT INTO research_shortlists
        (artifact_id, schema_version, revision, pipeline_run_id, project_id, project_version,
         logical_date, research_artifact_id, trend_run_id, research_input_hash,
         research_topic_catalog_hash, trend_catalog_hash, policy_version, state,
         content_hash, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
      throw mapSqliteError(error);
    }
  }
  getResearchShortlistByPipeline(pipelineRunId: any): any {
    const row: any = this.db
      .prepare(
        'SELECT payload_json FROM research_shortlists WHERE pipeline_run_id = ?',
      )
      .get(pipelineRunId);
    return row ? JSON.parse(row.payload_json) : null;
  }
  #beginReferenceAnalysisRunRaw(value: any): any {
    const prior: any = this.db
      .prepare(
        'SELECT * FROM reference_analysis_runs WHERE pipeline_run_id = ?',
      )
      .get(value.pipelineRunId);
    if (prior) {
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
      return this.getReferenceAnalysisRun(value.id);
    }
    this.db
      .prepare(
        `INSERT INTO reference_analysis_runs
      (id, pipeline_run_id, project_id, project_version, logical_date, timezone,
       research_input_hash, project_snapshot_hash, policy_version, config_hash, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)`,
      )
      .run(
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
    return this.getReferenceAnalysisRun(value.id);
  }
  getReferenceAnalysisRun(id: any): any {
    const row: any = this.db
      .prepare('SELECT * FROM reference_analysis_runs WHERE id = ?')
      .get(id);
    if (!row) return null;
    const value: any = referenceAnalysisRunFromRow(row);
    value.steps = this.db
      .prepare(
        `SELECT * FROM reference_analysis_steps
      WHERE reference_analysis_run_id = ? ORDER BY reference_key`,
      )
      .all(id)
      .map(referenceStepFromRow);
    return value;
  }
  getReferenceAnalysisStep(
    referenceAnalysisRunId: any,
    referenceKey: any,
  ): any {
    const row: any = this.db
      .prepare(
        `SELECT * FROM reference_analysis_steps
      WHERE reference_analysis_run_id = ? AND reference_key = ?`,
      )
      .get(referenceAnalysisRunId, referenceKey);
    return row ? referenceStepFromRow(row) : null;
  }
  #startReferenceAnalysisStepRaw({
    referenceAnalysisRunId,
    referenceKey,
    startedAt,
  }: any): any {
    this.db
      .prepare(
        `INSERT INTO reference_analysis_steps
      (reference_analysis_run_id, reference_key, state, started_at)
      VALUES (?, ?, 'RUNNING', ?) ON CONFLICT(reference_analysis_run_id, reference_key) DO NOTHING`,
      )
      .run(referenceAnalysisRunId, referenceKey, startedAt);
    return this.getReferenceAnalysisStep(referenceAnalysisRunId, referenceKey);
  }
  #finishReferenceAnalysisStepRaw({
    referenceAnalysisRunId,
    referenceKey,
    state,
    completedAt,
    durationMs,
    result,
  }: any): any {
    if (!['COMPLETED', 'FAILED'].includes(state))
      throw new TrendStoreError('INVALID_REFERENCE_STEP_STATE', state);
    rejectReferenceSourceFields(result);
    this.db
      .prepare(
        `UPDATE reference_analysis_steps
      SET state = ?, completed_at = ?, duration_ms = ?, result_json = ?
      WHERE reference_analysis_run_id = ? AND reference_key = ?`,
      )
      .run(
        state,
        completedAt,
        durationMs,
        json(result),
        referenceAnalysisRunId,
        referenceKey,
      );
    return this.getReferenceAnalysisStep(referenceAnalysisRunId, referenceKey);
  }
  #finishReferenceAnalysisRunRaw({
    id,
    state,
    completedAt,
    durationMs,
    result,
  }: any): any {
    if (!['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'].includes(state)) {
      throw new TrendStoreError('INVALID_REFERENCE_RUN_STATE', state);
    }
    this.db
      .prepare(
        `UPDATE reference_analysis_runs
      SET state = ?, completed_at = ?, duration_ms = ?, result_json = ? WHERE id = ?`,
      )
      .run(state, completedAt, durationMs, json(result), id);
    return this.getReferenceAnalysisRun(id);
  }
  #recordReferenceInsightRaw({ referenceAnalysisRunId, artifact }: any): any {
    const validated: any = createReferenceInsight(artifact);
    const run: any = this.getReferenceAnalysisRun(referenceAnalysisRunId);
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
    const prior: any = this.db
      .prepare(
        'SELECT payload_json FROM reference_insights WHERE reference_analysis_run_id = ?',
      )
      .get(referenceAnalysisRunId);
    if (prior) {
      const stored: any = JSON.parse(prior.payload_json);
      if (stableHash(stored) !== stableHash(validated))
        throw new TrendStoreError(
          'REFERENCE_INSIGHT_CONFLICT',
          'artefato já persistido com outro conteúdo',
        );
      return stored;
    }
    this.db
      .prepare(
        `INSERT INTO reference_insights
      (artifact_id, schema_version, reference_analysis_run_id, pipeline_run_id,
       project_id, project_version, content_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
  getReferenceInsight(referenceAnalysisRunId: any): any {
    const row: any = this.db
      .prepare(
        'SELECT payload_json FROM reference_insights WHERE reference_analysis_run_id = ?',
      )
      .get(referenceAnalysisRunId);
    return row ? JSON.parse(row.payload_json) : null;
  }
  updateRunState(runId: any, state: any, updatedAt: any): any {
    const catalog: any = this.getRun(runId);
    if (!catalog)
      throw new TrendStoreError('RUN_NOT_FOUND', `run inexistente: ${runId}`);
    const run: any = validateTrendRun(
      { ...catalog.run, state, updatedAt },
      catalog.sourceRuns,
    );
    this.db
      .prepare(
        'UPDATE trend_runs SET state = ?, updated_at = ?, payload_json = ? WHERE id = ?',
      )
      .run(state, updatedAt, json(run), runId);
    return this.getRun(runId);
  }
  close(): any {
    this.db.close();
  }
  #insertRun(run: any): any {
    this.#insertExact('trend_runs', run.id, run, (): any => {
      this.db
        .prepare(
          `INSERT INTO trend_runs
        (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.schemaVersion,
          run.state,
          run.createdAt,
          run.updatedAt,
          run.rankingConfigVersion,
          json(run),
        );
    });
  }
  #recordObservation(
    runId: any,
    {
      candidate,
      snapshot,
      reappearanceReason = 'FIRST_SEEN',
      previousPosition,
      currentPosition,
    }: any,
  ): any {
    if (snapshot.candidateId !== candidate.id) {
      throw new TrendStoreError(
        'INVALID_REFERENCE',
        'snapshot.candidateId não referencia o candidato observado',
      );
    }
    const canonicalUrlKey: any = canonicalTrendIdentity({
      platform: candidate.platform,
      canonicalUrl: candidate.canonicalUrl,
    }).slice(`${candidate.platform}:url:`.length);
    let existing: any =
      candidate.platformVideoId === undefined
        ? null
        : this.db
            .prepare(
              'SELECT * FROM trend_candidates WHERE platform = ? AND platform_video_id = ?',
            )
            .get(candidate.platform, candidate.platformVideoId);
    if (!existing) {
      const byUrl: any = this.db
        .prepare(
          'SELECT * FROM trend_candidates WHERE platform = ? AND canonical_url_key = ? ORDER BY platform_video_id IS NULL DESC LIMIT 1',
        )
        .get(candidate.platform, canonicalUrlKey);
      if (
        byUrl &&
        (candidate.platformVideoId === undefined ||
          byUrl.platform_video_id === null)
      )
        existing = byUrl;
    }
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO trend_candidates
        (id, identity_key, platform, platform_video_id, canonical_url_key, state,
         first_seen_at, last_seen_at, appearance_count, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
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
      existing = this.db
        .prepare('SELECT * FROM trend_candidates WHERE id = ?')
        .get(candidate.id);
    } else if (
      existing.platform_video_id === null &&
      candidate.platformVideoId !== undefined
    ) {
      const promoted: any = {
        ...candidate,
        id: existing.id,
        firstSeenAt: minDate(existing.first_seen_at, candidate.firstSeenAt),
      };
      this.db
        .prepare(
          `UPDATE trend_candidates SET identity_key = ?, platform_video_id = ?,
        canonical_url_key = ?, state = ?, last_seen_at = ?, payload_json = ? WHERE id = ?`,
        )
        .run(
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
    this.db
      .prepare(
        `INSERT OR IGNORE INTO candidate_appearances
      (trend_run_id, candidate_id, observed_at, reason, previous_position, current_position)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        storedId,
        candidate.lastSeenAt,
        reappearanceReason,
        previousPosition ?? null,
        currentPosition ?? null,
      );
    this.db
      .prepare(
        `UPDATE trend_candidates SET state = ?, first_seen_at = ?, last_seen_at = ?,
      appearance_count = (SELECT COUNT(*) FROM candidate_appearances WHERE candidate_id = ?), payload_json = ? WHERE id = ?`,
      )
      .run(
        candidate.state,
        minDate(existing.first_seen_at, candidate.firstSeenAt),
        maxDate(existing.last_seen_at, candidate.lastSeenAt),
        storedId,
        json({ ...candidate, id: storedId }),
        storedId,
      );
    const storedSnapshot: any = { ...snapshot, candidateId: storedId };
    this.#insertExact(
      'trend_snapshots',
      snapshot.id,
      storedSnapshot,
      (): any => {
        this.db
          .prepare(
            `INSERT INTO trend_snapshots
        (id, trend_run_id, candidate_id, captured_at, metrics_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
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
  #insertCluster(runId: any, cluster: any): any {
    this.#insertExact('topic_clusters', cluster.id, cluster, (): any => {
      this.db
        .prepare(
          'INSERT INTO topic_clusters (id, trend_run_id, payload_json) VALUES (?, ?, ?)',
        )
        .run(cluster.id, runId, json(cluster));
      for (const id of cluster.candidateIds)
        this.db
          .prepare(
            'INSERT INTO topic_cluster_candidates (cluster_id, candidate_id) VALUES (?, ?)',
          )
          .run(cluster.id, id);
      for (const id of cluster.evidenceSnapshotIds)
        this.db
          .prepare(
            'INSERT INTO topic_cluster_snapshots (cluster_id, snapshot_id) VALUES (?, ?)',
          )
          .run(cluster.id, id);
    });
  }
  #insertScore(runId: any, score: any): any {
    this.#insertExact('trend_scores', score.id, score, (): any => {
      this.db
        .prepare(
          `INSERT INTO trend_scores
        (id, trend_run_id, candidate_id, formula_version, calculated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          score.id,
          runId,
          score.candidateId,
          score.formulaVersion,
          score.calculatedAt,
          json(score),
        );
      for (const [component, value] of entries(score.components)) {
        for (const snapshotId of value.evidenceSnapshotIds) {
          this.db
            .prepare(
              `INSERT INTO trend_score_snapshots
            (score_id, snapshot_id, component) VALUES (?, ?, ?)`,
            )
            .run(score.id, snapshotId, component);
        }
      }
    });
  }
  #insertExact(
    table: any,
    id: any,
    value: any,
    insert: any,
    conflictCode: any = 'ENTITY_CONFLICT',
  ): any {
    const prior: any = this.db
      .prepare(`SELECT payload_json FROM ${table} WHERE id = ?`)
      .get(id);
    if (!prior) return insert();
    if (prior.payload_json !== json(value))
      throw new TrendStoreError(
        conflictCode,
        `${table}.${id} já existe com outro conteúdo`,
      );
  }
  #candidate(candidateId: any): any {
    const row: any = this.db
      .prepare('SELECT * FROM trend_candidates WHERE id = ?')
      .get(candidateId);
    if (!row) return null;
    const value: any = JSON.parse(row.payload_json);
    const snapshotIds: any = this.db
      .prepare(
        'SELECT id FROM trend_snapshots WHERE candidate_id = ? ORDER BY captured_at, id',
      )
      .all(candidateId)
      .map(({ id }: any): any => id);
    const topicClusterIds: any = this.db
      .prepare(
        'SELECT cluster_id FROM topic_cluster_candidates WHERE candidate_id = ? ORDER BY cluster_id',
      )
      .all(candidateId)
      .map(({ cluster_id }: any): any => cluster_id);
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
}
function remapCluster(cluster: any, candidateMap: any): any {
  return {
    ...cluster,
    candidateIds: cluster.candidateIds.map(
      (id: any): any => candidateMap.get(id) ?? id,
    ),
  };
}
function rowsAsPayload(rows: any): any {
  return rows.map(({ payload_json }: any): any => JSON.parse(payload_json));
}
function researchDailyRunFromRow(row: any): any {
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
function referenceAnalysisRunFromRow(row: any): any {
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
function referenceStepFromRow(row: any): any {
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
function toAppearance(row: any): any {
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
function json(value: any): any {
  return JSON.stringify(value);
}
function requireKey(value: any): any {
  if (typeof value !== 'string' || value.trim() === '')
    throw new TrendStoreError(
      'INVALID_IDEMPOTENCY_KEY',
      'chave explícita obrigatória',
    );
}
function rejectReferenceSourceFields(value: any): any {
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
function minDate(left: any, right: any): any {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}
function maxDate(left: any, right: any): any {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
function mapSqliteError(error: any): any {
  if (error instanceof TrendStoreError) return error;
  if (String(error.message).includes('FOREIGN KEY constraint failed')) {
    return new TrendStoreError(
      'FOREIGN_KEY_VIOLATION',
      'referência inexistente',
      { cause: error },
    );
  }
  if (String(error.message).includes('IMMUTABLE_SNAPSHOT')) {
    return new TrendStoreError(
      'IMMUTABLE_SNAPSHOT_CONFLICT',
      'snapshots não podem ser alterados',
      { cause: error },
    );
  }
  if (
    String(error.message).includes('UNIQUE constraint failed: trend_snapshots')
  ) {
    return new TrendStoreError(
      'IMMUTABLE_SNAPSHOT_CONFLICT',
      'já existe uma observação nesse instante',
      { cause: error },
    );
  }
  if (String(error.message).includes('UNIQUE constraint failed')) {
    return new TrendStoreError(
      'ENTITY_CONFLICT',
      'identificador ou identidade já existe',
      { cause: error },
    );
  }
  return error;
}
function entries(value: any): [string, any][] {
  return Object.entries(value);
}

function dailyStepFromRow(row: any): any {
  return {
    stepKey: row.step_key,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}
