import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { createCostLedger, validateCostEvent } from "./domain/cost-event-contracts.js";
import { ArtifactLineageRepository } from "./artifact-lineage-repository.js";

export class CostLedgerRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "CostLedgerRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class CostLedgerRepository extends ArtifactLineageRepository {
  registerCostEvent(value) {
    const event = validateCostEvent(value);
    const identityHash = stableHash(event);
    return this.#transaction(() => {
      const prior = this.db.prepare("SELECT identity_hash FROM cost_events WHERE cost_event_id = ?")
        .get(event.costEventId);
      if (prior) {
        if (prior.identity_hash !== identityHash) {
          throw failure("COST_EVENT_ID_REUSED", "costEventId", "identidade já usada com custo incompatível");
        }
        return this.getCostEvent(event.costEventId);
      }

      const run = this.getRun(event.pipelineRunId);
      if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
      if (run.projectId !== event.projectId || run.projectVersion !== event.projectVersion) {
        const field = run.projectId !== event.projectId ? "projectId" : "projectVersion";
        throw failure("COST_EVENT_RUN_SCOPE_MISMATCH", field, "custo diverge do escopo da execução");
      }
      this.#validateArtifact(event);

      this.db.prepare(`INSERT INTO cost_events
        (cost_event_id, schema_version, identity_hash, category, pipeline_run_id,
         project_id, project_version, content_identity, artifact_id, amount, currency,
         occurred_at, origin, attribution_rule_version, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.costEventId, event.schemaVersion, identityHash, event.category,
          event.pipelineRunId, event.projectId, event.projectVersion, event.contentIdentity,
          event.artifactId, event.amount, event.currency, event.occurredAt, event.origin,
          event.attributionRuleVersion, event.recordedAt);
      return this.getCostEvent(event.costEventId);
    });
  }

  getCostEvent(costEventId) {
    requireIdentifier(costEventId, "costEventId");
    const row = this.db.prepare("SELECT * FROM cost_events WHERE cost_event_id = ?").get(costEventId);
    if (!row) return null;
    try {
      const event = validateCostEvent({
        schemaVersion: row.schema_version,
        costEventId: row.cost_event_id,
        category: row.category,
        pipelineRunId: row.pipeline_run_id,
        projectId: row.project_id,
        projectVersion: row.project_version,
        contentIdentity: row.content_identity,
        artifactId: row.artifact_id,
        amount: row.amount,
        currency: row.currency,
        occurredAt: row.occurred_at,
        origin: row.origin,
        attributionRuleVersion: row.attribution_rule_version,
        recordedAt: row.recorded_at,
      });
      if (stableHash(event) !== row.identity_hash) {
        throw failure("INVALID_PERSISTED_COST_EVENT", "costEventId", "integridade do custo persistido inválida");
      }
      return event;
    } catch (caught) {
      if (caught instanceof CostLedgerRepositoryError) throw caught;
      if (caught instanceof ContractValidationError) {
        throw failure("INVALID_PERSISTED_COST_EVENT", "costEventId", "evento persistido inválido", { cause: caught });
      }
      throw caught;
    }
  }

  listCostEventsByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT cost_event_id FROM cost_events
      WHERE pipeline_run_id = ? ORDER BY occurred_at, cost_event_id`).all(pipelineRunId)
      .map(({ cost_event_id: costEventId }) => this.getCostEvent(costEventId));
  }

  getCostLedgerByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    const run = this.getRun(pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    return createCostLedger({
      pipelineRunId: run.pipelineRunId,
      projectId: run.projectId,
      projectVersion: run.projectVersion,
      events: this.listCostEventsByPipelineRun(pipelineRunId),
    });
  }

  #validateArtifact(event) {
    if (event.artifactId === null) return;
    const artifact = this.getArtifact(event.artifactId);
    if (!artifact) throw failure("COST_EVENT_ARTIFACT_NOT_FOUND", "artifactId", "artefato não encontrado");
    if (artifact.pipelineRunId !== event.pipelineRunId
      || artifact.projectId !== event.projectId
      || artifact.projectVersion !== event.projectVersion) {
      throw failure("COST_EVENT_ARTIFACT_SCOPE_MISMATCH", "artifactId", "artefato pertence a outro escopo");
    }
    if (event.contentIdentity !== null && artifact.contentIdentity !== event.contentIdentity) {
      throw failure("COST_EVENT_CONTENT_MISMATCH", "contentIdentity", "conteúdo diverge do artefato");
    }
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(caught);
    }
  }
}

function requireIdentifier(value, field) {
  if (typeof value !== "string" || value.length > 200 || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) {
    throw failure("INVALID_IDENTIFIER", field, "identificador inválido");
  }
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapSqliteError(caught) {
  if (caught instanceof CostLedgerRepositoryError) return caught;
  const message = String(caught?.message);
  if (message.includes("COST_EVENT_RUN_SCOPE_MISMATCH")) {
    return failure("COST_EVENT_RUN_SCOPE_MISMATCH", "projectVersion", "custo diverge do escopo da execução", { cause: caught });
  }
  if (message.includes("COST_EVENT_ARTIFACT_SCOPE_MISMATCH")) {
    return failure("COST_EVENT_ARTIFACT_SCOPE_MISMATCH", "artifactId", "artefato pertence a outro escopo", { cause: caught });
  }
  if (message.includes("IMMUTABLE_COST_EVENT")) {
    return failure("IMMUTABLE_COST_EVENT", "costEventId", "evento de custo é imutável", { cause: caught });
  }
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) {
    return failure("COST_EVENT_PERSISTENCE_FAILED", "costEvent", "não foi possível persistir o custo", { cause: caught });
  }
  return caught;
}

function failure(code, field, message, options) {
  return new CostLedgerRepositoryError(code, field, message, options);
}
