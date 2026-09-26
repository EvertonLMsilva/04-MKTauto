import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalTrendIdentity,
  validateSourceRun,
  validateTopicCluster,
  validateTrendCandidate,
  validateTrendRun,
  validateTrendScore,
  validateTrendSnapshot,
} from "./domain/contracts.js";
import { calculateHistoricalVelocity } from "./domain/velocity.js";

const CATALOG_SCHEMA_VERSION = 2;
const MIGRATIONS = new Map([
  [1, ["001_trend_catalog", readFileSync(new URL("./db/migrations/001_trend_catalog.sql", import.meta.url), "utf8")]],
  [2, ["002_daily_catalog", readFileSync(new URL("./db/migrations/002_daily_catalog.sql", import.meta.url), "utf8")]],
]);

export class TrendStoreError extends Error {
  constructor(code, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "TrendStoreError";
    this.code = code;
  }
}

export class TrendCatalogStore {
  constructor(path = resolve("data/trends.sqlite")) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#migrate();
  }

  recordOperation({ idempotencyKey, run, sourceRuns = [], observations = [], topicClusters = [], scores = [] }) {
    requireKey(idempotencyKey);
    validateTrendRun(run, sourceRuns);
    sourceRuns.forEach(validateSourceRun);
    const candidateIds = observations.map(({ candidate }) => validateTrendCandidate(candidate).id);
    const snapshotIds = observations.map(({ snapshot }) => validateTrendSnapshot(snapshot).id);
    topicClusters.forEach((cluster) => validateTopicCluster(cluster, candidateIds, snapshotIds));
    scores.forEach(validateTrendScore);
    const input = { run, sourceRuns, observations, topicClusters, scores };
    const payloadHash = stableHash(input);
    const prior = this.db.prepare("SELECT payload_hash, trend_run_id FROM trend_operations WHERE idempotency_key = ?").get(idempotencyKey);
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw new TrendStoreError("IDEMPOTENCY_KEY_REUSED", "a chave já foi usada com outro conteúdo");
      return this.getRun(prior.trend_run_id);
    }

    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.#insertRun(run);
      for (const sourceRun of sourceRuns) this.#insertExact("source_runs", sourceRun.id, sourceRun, () => {
        this.db.prepare(`INSERT INTO source_runs
          (id, trend_run_id, platform, status, started_at, completed_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(sourceRun.id, sourceRun.trendRunId, sourceRun.platform, sourceRun.status,
            sourceRun.startedAt, sourceRun.completedAt, json(sourceRun));
      });

      const candidateMap = new Map();
      for (const observation of observations) {
        const storedId = this.#recordObservation(run.id, observation);
        candidateMap.set(observation.candidate.id, storedId);
      }
      for (const cluster of topicClusters) this.#insertCluster(run.id, remapCluster(cluster, candidateMap));
      for (const score of scores) this.#insertScore(run.id, { ...score, candidateId: candidateMap.get(score.candidateId) ?? score.candidateId });
      this.db.prepare(`INSERT INTO trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES (?, ?, ?, ?)`)
        .run(idempotencyKey, payloadHash, run.id, new Date().toISOString());
      this.db.exec("COMMIT");
      return this.getRun(run.id);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  recordAnalysis({ idempotencyKey, runId, topicClusters, scores }) {
    requireKey(idempotencyKey);
    const catalog = this.getRun(runId);
    if (!catalog) throw new TrendStoreError("RUN_NOT_FOUND", `run inexistente: ${runId}`);
    const candidateIds = catalog.candidates.map(({ id }) => id);
    const candidateSet = new Set(candidateIds);
    const histories = new Map(catalog.candidates.map(({ id }) => [id, this.getCandidateHistory(id)]));
    const snapshotOwner = new Map([...histories.entries()].flatMap(([candidateId, history]) =>
      history.snapshots.map(({ id }) => [id, candidateId])));
    const snapshotIds = [...snapshotOwner.keys()];
    for (const cluster of topicClusters) {
      validateTopicCluster(cluster, candidateIds, snapshotIds);
      for (const snapshotId of cluster.evidenceSnapshotIds) {
        if (!cluster.candidateIds.includes(snapshotOwner.get(snapshotId))) {
          throw new TrendStoreError("INVALID_REFERENCE", `snapshot ${snapshotId} não pertence aos candidatos do cluster`);
        }
      }
    }
    for (const score of scores) {
      validateTrendScore(score);
      if (!candidateSet.has(score.candidateId)) throw new TrendStoreError("INVALID_REFERENCE", `score referencia candidato fora da run: ${score.candidateId}`);
      for (const [componentName, component] of Object.entries(score.components)) {
        for (const snapshotId of component.evidenceSnapshotIds) {
          if (!snapshotOwner.has(snapshotId) || (componentName !== "recurrence" && snapshotOwner.get(snapshotId) !== score.candidateId)) {
            throw new TrendStoreError("INVALID_REFERENCE", `score usa snapshot de outro candidato: ${snapshotId}`);
          }
        }
      }
    }
    const input = { runId, topicClusters, scores };
    const payloadHash = stableHash(input);
    const prior = this.db.prepare("SELECT payload_hash, trend_run_id FROM trend_operations WHERE idempotency_key = ?").get(idempotencyKey);
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.trend_run_id !== runId) {
        throw new TrendStoreError("IDEMPOTENCY_KEY_REUSED", "a chave já foi usada com outro conteúdo");
      }
      return this.getRun(runId);
    }
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (const cluster of topicClusters) this.#insertCluster(runId, cluster);
      for (const score of scores) this.#insertScore(runId, score);
      this.db.prepare(`INSERT INTO trend_operations
        (idempotency_key, payload_hash, trend_run_id, created_at) VALUES (?, ?, ?, ?)`)
        .run(idempotencyKey, payloadHash, runId, new Date().toISOString());
      this.db.exec("COMMIT");
      return this.getRun(runId);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  getOperation(idempotencyKey) {
    requireKey(idempotencyKey);
    const operation = this.db.prepare(
      "SELECT trend_run_id FROM trend_operations WHERE idempotency_key = ?",
    ).get(idempotencyKey);
    return operation ? this.getRun(operation.trend_run_id) : null;
  }

  getRun(runId) {
    const row = this.db.prepare("SELECT payload_json FROM trend_runs WHERE id = ?").get(runId);
    if (!row) return null;
    const appearances = this.db.prepare(`SELECT candidate_id, observed_at, reason,
      previous_position, current_position FROM candidate_appearances
      WHERE trend_run_id = ? ORDER BY observed_at, candidate_id`).all(runId);
    const candidateIds = appearances.map((item) => item.candidate_id);
    const run = JSON.parse(row.payload_json);
    return {
      run: {
        ...run,
        sourceRunIds: this.db.prepare("SELECT id FROM source_runs WHERE trend_run_id = ? ORDER BY id").all(runId).map(({ id }) => id),
        candidateIds,
      },
      sourceRuns: rowsAsPayload(this.db.prepare("SELECT payload_json FROM source_runs WHERE trend_run_id = ? ORDER BY id").all(runId)),
      candidates: candidateIds.map((id) => this.#candidate(id)),
      snapshots: rowsAsPayload(this.db.prepare("SELECT payload_json FROM trend_snapshots WHERE trend_run_id = ? ORDER BY captured_at, id").all(runId)),
      topicClusters: rowsAsPayload(this.db.prepare("SELECT payload_json FROM topic_clusters WHERE trend_run_id = ? ORDER BY id").all(runId)),
      scores: rowsAsPayload(this.db.prepare("SELECT payload_json FROM trend_scores WHERE trend_run_id = ? ORDER BY id").all(runId)),
      appearances: appearances.map(toAppearance),
    };
  }

  getCandidateHistory(candidateId) {
    const candidate = this.#candidate(candidateId);
    if (!candidate) return null;
    const snapshots = rowsAsPayload(this.db.prepare(
      "SELECT payload_json FROM trend_snapshots WHERE candidate_id = ? ORDER BY captured_at, id").all(candidateId));
    const appearances = this.db.prepare(`SELECT trend_run_id, observed_at, reason,
      previous_position, current_position FROM candidate_appearances
      WHERE candidate_id = ? ORDER BY observed_at, trend_run_id`).all(candidateId).map(toAppearance);
    return { candidate, snapshots, appearances, velocities: calculateHistoricalVelocity(snapshots) };
  }

  beginDailyRun({ id, logicalDate, timezone, configHash, config, startedAt }) {
    const prior = this.db.prepare("SELECT * FROM daily_runs WHERE logical_date = ?").get(logicalDate);
    if (prior) {
      if (prior.config_hash !== configHash || prior.id !== id || prior.timezone !== timezone) {
        throw new TrendStoreError("DAILY_CONFIG_CONFLICT", `a data ${logicalDate} já possui execução com configuração diferente`);
      }
      return dailyRunFromRow(prior);
    }
    this.db.prepare(`INSERT INTO daily_runs
      (logical_date, id, timezone, config_hash, config_json, state, started_at)
      VALUES (?, ?, ?, ?, ?, 'RUNNING', ?)`)
      .run(logicalDate, id, timezone, configHash, json(config), startedAt);
    return this.getDailyRun(logicalDate);
  }

  getDailyRun(logicalDate) {
    const row = this.db.prepare("SELECT * FROM daily_runs WHERE logical_date = ?").get(logicalDate);
    if (!row) return null;
    const value = dailyRunFromRow(row);
    value.steps = this.db.prepare("SELECT * FROM daily_steps WHERE daily_run_id = ? ORDER BY step_key")
      .all(row.id).map(dailyStepFromRow);
    return value;
  }

  getDailyStep(dailyRunId, stepKey) {
    const row = this.db.prepare("SELECT * FROM daily_steps WHERE daily_run_id = ? AND step_key = ?").get(dailyRunId, stepKey);
    return row ? dailyStepFromRow(row) : null;
  }

  startDailyStep({ dailyRunId, stepKey, startedAt }) {
    this.db.prepare(`INSERT INTO daily_steps (daily_run_id, step_key, state, started_at)
      VALUES (?, ?, 'RUNNING', ?)
      ON CONFLICT(daily_run_id, step_key) DO NOTHING`).run(dailyRunId, stepKey, startedAt);
    return this.getDailyStep(dailyRunId, stepKey);
  }

  finishDailyStep({ dailyRunId, stepKey, state, completedAt, durationMs, result }) {
    if (!["COMPLETED", "SKIPPED", "FAILED"].includes(state)) throw new TrendStoreError("INVALID_DAILY_STEP_STATE", state);
    this.db.prepare(`UPDATE daily_steps SET state = ?, completed_at = ?, duration_ms = ?, result_json = ?
      WHERE daily_run_id = ? AND step_key = ?`)
      .run(state, completedAt, durationMs, json(result), dailyRunId, stepKey);
    return this.getDailyStep(dailyRunId, stepKey);
  }

  finishDailyRun({ logicalDate, state, trendRunId, completedAt, durationMs, result }) {
    if (!["COMPLETED", "COMPLETED_WITH_GAPS", "FAILED"].includes(state)) throw new TrendStoreError("INVALID_DAILY_RUN_STATE", state);
    this.db.prepare(`UPDATE daily_runs SET state = ?, trend_run_id = ?, completed_at = ?, duration_ms = ?, result_json = ?
      WHERE logical_date = ?`).run(state, trendRunId ?? null, completedAt, durationMs, json(result), logicalDate);
    return this.getDailyRun(logicalDate);
  }

  updateRunState(runId, state, updatedAt) {
    const catalog = this.getRun(runId);
    if (!catalog) throw new TrendStoreError("RUN_NOT_FOUND", `run inexistente: ${runId}`);
    const run = validateTrendRun({ ...catalog.run, state, updatedAt }, catalog.sourceRuns);
    this.db.prepare("UPDATE trend_runs SET state = ?, updated_at = ?, payload_json = ? WHERE id = ?")
      .run(state, updatedAt, json(run), runId);
    return this.getRun(runId);
  }

  changeCandidateState({ logicalDate, candidateId, nextState, actor, changedAt }) {
    if (!["SHORTLISTED", "SELECTED"].includes(nextState)) throw new TrendStoreError("INVALID_CANDIDATE_STATE", nextState);
    if (typeof actor !== "string" || actor.trim() === "") throw new TrendStoreError("INVALID_ACTOR", "ator explícito obrigatório");
    const daily = this.getDailyRun(logicalDate);
    if (!daily?.trendRunId || !daily.result?.rankedCandidateIds?.includes(candidateId)) {
      throw new TrendStoreError("CANDIDATE_NOT_ELIGIBLE", `candidato não ranqueado na execução ${logicalDate}`);
    }
    const candidate = this.#candidate(candidateId);
    if (!candidate) throw new TrendStoreError("CANDIDATE_NOT_FOUND", candidateId);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      if (nextState === "SELECTED") {
        const priorSelected = this.db.prepare("SELECT id, state, payload_json FROM trend_candidates WHERE state = 'SELECTED' AND id <> ?").get(candidateId);
        if (priorSelected) this.#setCandidateState(daily.id, priorSelected, "SHORTLISTED", actor, changedAt);
      }
      const current = this.db.prepare("SELECT id, state, payload_json FROM trend_candidates WHERE id = ?").get(candidateId);
      if (current.state !== nextState) this.#setCandidateState(daily.id, current, nextState, actor, changedAt);
      this.db.exec("COMMIT");
      return this.#candidate(candidateId);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  getCandidateStateEvents(logicalDate) {
    const daily = this.getDailyRun(logicalDate);
    if (!daily) return [];
    return this.db.prepare(`SELECT candidate_id, previous_state, next_state, actor, changed_at
      FROM candidate_state_events WHERE daily_run_id = ? ORDER BY id`).all(daily.id).map((row) => ({
      candidateId: row.candidate_id, previousState: row.previous_state, nextState: row.next_state,
      actor: row.actor, changedAt: row.changed_at,
    }));
  }

  close() {
    this.db.close();
  }

  #migrate() {
    const current = this.db.prepare("PRAGMA user_version").get().user_version;
    if (current > CATALOG_SCHEMA_VERSION) {
      this.db.close();
      throw new TrendStoreError("CATALOG_VERSION_UNSUPPORTED", `versão ${current}; máximo suportado ${CATALOG_SCHEMA_VERSION}`);
    }
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (let version = current + 1; version <= CATALOG_SCHEMA_VERSION; version += 1) {
        const [name, sql] = MIGRATIONS.get(version) ?? [];
        if (!name) throw new Error(`migração ${version} ausente`);
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
          .run(version, name, new Date().toISOString());
        this.db.exec(`PRAGMA user_version = ${version}`);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(error);
    }
  }

  #insertRun(run) {
    this.#insertExact("trend_runs", run.id, run, () => {
      this.db.prepare(`INSERT INTO trend_runs
        (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(run.id, run.schemaVersion, run.state, run.createdAt, run.updatedAt,
          run.rankingConfigVersion, json(run));
    });
  }

  #recordObservation(runId, { candidate, snapshot, reappearanceReason = "FIRST_SEEN", previousPosition, currentPosition }) {
    if (snapshot.candidateId !== candidate.id) {
      throw new TrendStoreError("INVALID_REFERENCE", "snapshot.candidateId não referencia o candidato observado");
    }
    const canonicalUrlKey = canonicalTrendIdentity({ platform: candidate.platform, canonicalUrl: candidate.canonicalUrl })
      .slice(`${candidate.platform}:url:`.length);
    let existing = candidate.platformVideoId === undefined ? null : this.db.prepare(
      "SELECT * FROM trend_candidates WHERE platform = ? AND platform_video_id = ?").get(candidate.platform, candidate.platformVideoId);
    if (!existing) {
      const byUrl = this.db.prepare(
        "SELECT * FROM trend_candidates WHERE platform = ? AND canonical_url_key = ? ORDER BY platform_video_id IS NULL DESC LIMIT 1")
        .get(candidate.platform, canonicalUrlKey);
      if (byUrl && (candidate.platformVideoId === undefined || byUrl.platform_video_id === null)) existing = byUrl;
    }
    if (!existing) {
      this.db.prepare(`INSERT INTO trend_candidates
        (id, identity_key, platform, platform_video_id, canonical_url_key, state,
         first_seen_at, last_seen_at, appearance_count, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(candidate.id, candidate.identityKey, candidate.platform, candidate.platformVideoId ?? null,
          canonicalUrlKey, candidate.state, candidate.firstSeenAt, candidate.lastSeenAt, json(candidate));
      existing = this.db.prepare("SELECT * FROM trend_candidates WHERE id = ?").get(candidate.id);
    } else if (existing.platform_video_id === null && candidate.platformVideoId !== undefined) {
      const promoted = { ...candidate, id: existing.id, firstSeenAt: minDate(existing.first_seen_at, candidate.firstSeenAt) };
      this.db.prepare(`UPDATE trend_candidates SET identity_key = ?, platform_video_id = ?,
        canonical_url_key = ?, state = ?, last_seen_at = ?, payload_json = ? WHERE id = ?`)
        .run(candidate.identityKey, candidate.platformVideoId, canonicalUrlKey, candidate.state,
          maxDate(existing.last_seen_at, candidate.lastSeenAt), json(promoted), existing.id);
    }
    const storedId = existing.id;
    this.db.prepare(`INSERT OR IGNORE INTO candidate_appearances
      (trend_run_id, candidate_id, observed_at, reason, previous_position, current_position)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(runId, storedId, candidate.lastSeenAt, reappearanceReason, previousPosition ?? null, currentPosition ?? null);
    this.db.prepare(`UPDATE trend_candidates SET state = ?, first_seen_at = ?, last_seen_at = ?,
      appearance_count = (SELECT COUNT(*) FROM candidate_appearances WHERE candidate_id = ?), payload_json = ? WHERE id = ?`)
      .run(candidate.state, minDate(existing.first_seen_at, candidate.firstSeenAt),
        maxDate(existing.last_seen_at, candidate.lastSeenAt), storedId,
        json({ ...candidate, id: storedId }), storedId);
    const storedSnapshot = { ...snapshot, candidateId: storedId };
    this.#insertExact("trend_snapshots", snapshot.id, storedSnapshot, () => {
      this.db.prepare(`INSERT INTO trend_snapshots
        (id, trend_run_id, candidate_id, captured_at, metrics_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(snapshot.id, runId, storedId, snapshot.capturedAt, json(snapshot.metrics), json(storedSnapshot));
    }, "IMMUTABLE_SNAPSHOT_CONFLICT");
    return storedId;
  }

  #insertCluster(runId, cluster) {
    this.#insertExact("topic_clusters", cluster.id, cluster, () => {
      this.db.prepare("INSERT INTO topic_clusters (id, trend_run_id, payload_json) VALUES (?, ?, ?)")
        .run(cluster.id, runId, json(cluster));
      for (const id of cluster.candidateIds) this.db.prepare(
        "INSERT INTO topic_cluster_candidates (cluster_id, candidate_id) VALUES (?, ?)").run(cluster.id, id);
      for (const id of cluster.evidenceSnapshotIds) this.db.prepare(
        "INSERT INTO topic_cluster_snapshots (cluster_id, snapshot_id) VALUES (?, ?)").run(cluster.id, id);
    });
  }

  #insertScore(runId, score) {
    this.#insertExact("trend_scores", score.id, score, () => {
      this.db.prepare(`INSERT INTO trend_scores
        (id, trend_run_id, candidate_id, formula_version, calculated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(score.id, runId, score.candidateId, score.formulaVersion, score.calculatedAt, json(score));
      for (const [component, value] of Object.entries(score.components)) {
        for (const snapshotId of value.evidenceSnapshotIds) {
          this.db.prepare(`INSERT INTO trend_score_snapshots
            (score_id, snapshot_id, component) VALUES (?, ?, ?)`)
            .run(score.id, snapshotId, component);
        }
      }
    });
  }

  #insertExact(table, id, value, insert, conflictCode = "ENTITY_CONFLICT") {
    const prior = this.db.prepare(`SELECT payload_json FROM ${table} WHERE id = ?`).get(id);
    if (!prior) return insert();
    if (prior.payload_json !== json(value)) throw new TrendStoreError(conflictCode, `${table}.${id} já existe com outro conteúdo`);
  }

  #candidate(candidateId) {
    const row = this.db.prepare("SELECT * FROM trend_candidates WHERE id = ?").get(candidateId);
    if (!row) return null;
    const value = JSON.parse(row.payload_json);
    const snapshotIds = this.db.prepare("SELECT id FROM trend_snapshots WHERE candidate_id = ? ORDER BY captured_at, id").all(candidateId).map(({ id }) => id);
    const topicClusterIds = this.db.prepare("SELECT cluster_id FROM topic_cluster_candidates WHERE candidate_id = ? ORDER BY cluster_id").all(candidateId).map(({ cluster_id }) => cluster_id);
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

  #setCandidateState(dailyRunId, row, nextState, actor, changedAt) {
    const payload = { ...JSON.parse(row.payload_json), state: nextState };
    this.db.prepare("UPDATE trend_candidates SET state = ?, payload_json = ? WHERE id = ?")
      .run(nextState, json(payload), row.id);
    this.db.prepare(`INSERT INTO candidate_state_events
      (daily_run_id, candidate_id, previous_state, next_state, actor, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(dailyRunId, row.id, row.state, nextState, actor.trim(), changedAt);
  }
}

function remapCluster(cluster, candidateMap) {
  return { ...cluster, candidateIds: cluster.candidateIds.map((id) => candidateMap.get(id) ?? id) };
}

function rowsAsPayload(rows) {
  return rows.map(({ payload_json }) => JSON.parse(payload_json));
}

function dailyRunFromRow(row) {
  return {
    id: row.id, logicalDate: row.logical_date, timezone: row.timezone,
    configHash: row.config_hash, config: JSON.parse(row.config_json), state: row.state,
    trendRunId: row.trend_run_id ?? undefined, startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined, durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}

function dailyStepFromRow(row) {
  return {
    stepKey: row.step_key, state: row.state, startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined, durationMs: row.duration_ms ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
  };
}

function toAppearance(row) {
  return {
    trendRunId: row.trend_run_id,
    candidateId: row.candidate_id,
    observedAt: row.observed_at,
    reason: row.reason,
    previousPosition: row.previous_position ?? undefined,
    currentPosition: row.current_position ?? undefined,
    positionChange: row.previous_position === null || row.previous_position === undefined || row.current_position === null || row.current_position === undefined
      ? undefined : row.previous_position - row.current_position,
  };
}

function stableHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function json(value) {
  return JSON.stringify(value);
}

function requireKey(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TrendStoreError("INVALID_IDEMPOTENCY_KEY", "chave explícita obrigatória");
}

function minDate(left, right) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxDate(left, right) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function mapSqliteError(error) {
  if (error instanceof TrendStoreError) return error;
  if (String(error.message).includes("FOREIGN KEY constraint failed")) {
    return new TrendStoreError("FOREIGN_KEY_VIOLATION", "referência inexistente", { cause: error });
  }
  if (String(error.message).includes("IMMUTABLE_SNAPSHOT")) {
    return new TrendStoreError("IMMUTABLE_SNAPSHOT_CONFLICT", "snapshots não podem ser alterados", { cause: error });
  }
  if (String(error.message).includes("UNIQUE constraint failed: trend_snapshots")) {
    return new TrendStoreError("IMMUTABLE_SNAPSHOT_CONFLICT", "já existe uma observação nesse instante", { cause: error });
  }
  if (String(error.message).includes("UNIQUE constraint failed")) {
    return new TrendStoreError("ENTITY_CONFLICT", "identificador ou identidade já existe", { cause: error });
  }
  return error;
}

export { CATALOG_SCHEMA_VERSION };
