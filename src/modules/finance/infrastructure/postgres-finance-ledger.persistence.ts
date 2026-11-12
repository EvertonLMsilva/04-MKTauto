import {
  PostgresDatabase,
  PostgresError,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import {
  validateCostEvent,
  createCostLedger,
} from '../domain/cost-event-contracts.js';
import {
  validateAdjustment,
  type CostAdjustmentV2,
} from '../domain/cost-adjustment-contracts.js';
import type { CostEvent, CostLedger } from '../domain/finance.types.js';
import { FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY } from './postgres-finance-ledger.migrations.js';
import {
  PostgresFinanceLedgerSession,
  financeLedgerFailure,
  financeLedgerHash,
  financeLedgerStorageFailure,
} from './postgres-finance-ledger.session.js';

function identifier(value: string, field: string): void {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw financeLedgerFailure(
      'INVALID_IDENTIFIER',
      field,
      'identificador inválido',
    );
}
function eventFromRow(row: Record<string, any>): CostEvent {
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
    if (financeLedgerHash(event) !== row.identity_hash)
      throw new Error('INVALID_HASH');
    return event;
  } catch {
    throw financeLedgerFailure(
      'INVALID_PERSISTED_COST_EVENT',
      'costEventId',
      'evento persistido inválido',
    );
  }
}
export interface FinanceLedgerReceipt {
  costEventId: string;
  identityHash: string;
  resultHash: string;
  result: CostEvent;
}
export class PostgresFinanceLedgerRepository {
  constructor(private readonly session: PostgresFinanceLedgerSession) {}
  async close(): Promise<void> {
    this.session.close();
  }
  async registerCostEvent(value: unknown): Promise<CostEvent> {
    const event = validateCostEvent(value);
    const identity = financeLedgerHash(event);
    return this.session.transaction(async () => {
      const prior = await this.getCostEvent(event.costEventId);
      if (prior) {
        if (financeLedgerHash(prior) !== identity)
          throw financeLedgerFailure(
            'COST_EVENT_ID_REUSED',
            'costEventId',
            'identidade já usada com custo incompatível',
          );
        const receipt = await this.getReceipt(event.costEventId);
        if (!receipt)
          throw financeLedgerFailure(
            'INVALID_PERSISTED_COST_EVENT',
            'costEventId',
            'recibo ausente',
          );
        return receipt.result;
      }
      if (!(await this.session.getRun(event.pipelineRunId)))
        throw financeLedgerFailure(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
          'execução não encontrada',
        );
      if (event.artifactId !== null)
        await this.session.verifyArtifact(event.artifactId);
      // Relational constraints enforce the existing run/artifact scope rules; no new financial policy.
      await this.session.query(
        `INSERT INTO finance.cost_events
        (cost_event_id,schema_version,identity_hash,category,pipeline_run_id,project_id,project_version,content_identity,artifact_id,amount,currency,occurred_at,origin,attribution_rule_version,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          event.costEventId,
          event.schemaVersion,
          identity,
          event.category,
          event.pipelineRunId,
          event.projectId,
          event.projectVersion,
          event.contentIdentity,
          event.artifactId,
          event.amount,
          event.currency,
          event.occurredAt,
          event.origin,
          event.attributionRuleVersion,
          event.recordedAt,
        ],
      );
      await this.session.query(
        'INSERT INTO finance.ledger_receipts(cost_event_id,identity_hash,result_hash,result_json) VALUES($1,$2,$3,$4)',
        [event.costEventId, identity, identity, JSON.stringify(event)],
      );
      return (await this.getCostEvent(event.costEventId))!;
    }, true);
  }
  async getCostEvent(id: string): Promise<CostEvent | null> {
    identifier(id, 'costEventId');
    return this.session.transaction(async () => {
      const row = (
        await this.session.query(
          'SELECT * FROM finance.cost_events WHERE cost_event_id=$1',
          [id],
        )
      ).rows[0];
      return row ? eventFromRow(row) : null;
    });
  }
  async listCostEventsByPipelineRun(id: string): Promise<CostEvent[]> {
    identifier(id, 'pipelineRunId');
    return this.session.transaction(async () =>
      (
        await this.session.query(
          'SELECT * FROM finance.cost_events WHERE pipeline_run_id=$1 ORDER BY occurred_at,cost_event_id',
          [id],
        )
      ).rows.map(eventFromRow),
    );
  }
  async getCostLedgerByPipelineRun(id: string): Promise<CostLedger> {
    identifier(id, 'pipelineRunId');
    return this.session.transaction(async () => {
      const run = await this.session.getRun(id);
      if (!run)
        throw financeLedgerFailure(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
          'execução não encontrada',
        );
      return createCostLedger({
        pipelineRunId: run.pipelineRunId,
        projectId: run.projectId,
        projectVersion: run.projectVersion,
        events: await this.listCostEventsByPipelineRun(id),
      });
    });
  }
  async getReceipt(id: string): Promise<FinanceLedgerReceipt | null> {
    identifier(id, 'costEventId');
    return this.session.transaction(async () => {
      const row = (
        await this.session.query(
          'SELECT * FROM finance.ledger_receipts WHERE cost_event_id=$1',
          [id],
        )
      ).rows[0];
      if (!row) return null;
      let result: CostEvent;
      try {
        result = validateCostEvent(JSON.parse(row.result_json));
      } catch {
        throw financeLedgerFailure(
          'INVALID_PERSISTED_COST_EVENT',
          'costEventId',
          'recibo persistido inválido',
        );
      }
      const event = await this.getCostEvent(id);
      if (
        !event ||
        result.costEventId !== id ||
        financeLedgerHash(result) !== row.result_hash ||
        row.identity_hash !== row.result_hash ||
        financeLedgerHash(event) !== row.identity_hash
      )
        throw financeLedgerFailure(
          'INVALID_PERSISTED_COST_EVENT',
          'costEventId',
          'recibo persistido inválido',
        );
      return Object.freeze({
        costEventId: id,
        identityHash: row.identity_hash,
        resultHash: row.result_hash,
        result,
      });
    });
  }
  /** Historical records only. No TTS reconciliation, write approval or adjusted-total assertion. */
  async listAdjustmentRecords(originalId: string): Promise<CostAdjustmentV2[]> {
    identifier(originalId, 'originalCostEventId');
    return this.session.transaction(async () =>
      (
        await this.session.query(
          'SELECT * FROM finance.cost_adjustments WHERE original_cost_event_id=$1 ORDER BY created_at,adjustment_id',
          [originalId],
        )
      ).rows.map((row) =>
        validateAdjustment({
          schemaVersion: 'cost-adjustment/2.0.0',
          adjustmentId: row.adjustment_id,
          originalCostEventId: row.original_cost_event_id,
          ttsOperationId: row.tts_operation_id,
          deltaUnits: row.delta_units,
          currency: row.currency,
          evidenceReference: row.evidence_reference,
          evidenceHash: row.evidence_hash,
          idempotencyKey: row.idempotency_key,
          createdAt: row.created_at,
          contentHash: row.identity_hash,
        }),
      ),
    );
  }
}
export class PostgresFinanceLedgerPersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<PostgresFinanceLedgerRepository> {
    let history;
    try {
      history = (
        await this.database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows;
    } catch (error) {
      if (error instanceof PostgresError && error.sqlState === '42P01')
        throw financeLedgerFailure(
          'FINANCE_LEDGER_SCHEMA_VERSION_UNSUPPORTED',
          'schemaVersion',
          'migration Finance requerida',
        );
      throw financeLedgerStorageFailure(error);
    }
    if (
      FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY.some(
        (migration) =>
          !history.some(
            (row) =>
              row.version === migration.version &&
              row.name === migration.name &&
              row.checksum === postgresMigrationChecksum(migration.sql),
          ),
      )
    )
      throw financeLedgerFailure(
        'FINANCE_LEDGER_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'migration Finance requerida',
      );
    return new PostgresFinanceLedgerRepository(
      new PostgresFinanceLedgerSession(this.database, readOnly),
    );
  }
}
