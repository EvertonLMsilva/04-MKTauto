import type { CostEvent } from '../domain/finance.types.js';
import {
  adjustmentHash,
  validateAdjustment,
  type CostAdjustmentV2,
  type TtsFinancialStatementV2,
  type CostLedgerV2,
} from '../domain/cost-adjustment-contracts.js';
import { ttsFail, ttsHash } from '../domain/tts-financial-contracts.js';
import { usdAmount, usdUnits } from '../domain/video-financial-contracts.js';
import { CostLedgerRepository } from './cost-ledger.repository.js';
import { SqliteTtsFinancialCommitmentsReader } from './financial-readers.sqlite.js';

export class CostAdjustmentsRepository {
  constructor(private readonly ledger: CostLedgerRepository) {}
  private get db() {
    return this.ledger.db;
  }
  enabled(): boolean {
    return (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) === 40
    );
  }
  private schema() {
    if (
      !this.enabled() ||
      !this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='cost_adjustments'")
        .get()
    )
      ttsFail('COST_ADJUSTMENT_SCHEMA_REQUIRED');
  }
  list(originalId: string): CostAdjustmentV2[] {
    if (!this.enabled()) return [];
    this.schema();
    return this.db
      .prepare(
        'SELECT * FROM cost_adjustments WHERE original_cost_event_id=? ORDER BY created_at,adjustment_id',
      )
      .all(originalId)
      .map((row) => this.read(row));
  }
  private read(row: any): CostAdjustmentV2 {
    return validateAdjustment({
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
    });
  }
  netUnits(original: CostEvent): bigint {
    const linked = this.list(original.costEventId);
    const value = linked.reduce(
      (sum, a) => sum + BigInt(a.deltaUnits),
      usdUnits(original.amount),
    );
    if (value < 0n) ttsFail('COST_ADJUSTMENT_NEGATIVE_BALANCE');
    if (linked.length) {
      const op = new SqliteTtsFinancialCommitmentsReader(this.db).getTts(
        linked[0].ttsOperationId,
      );
      if (
        !op?.billing ||
        linked[0].evidenceHash !== ttsHash(op.billing) ||
        value !== usdUnits(op.billing.actualCostUsd)
      )
        ttsFail('COST_ADJUSTMENT_PERSISTED_INTEGRITY_INVALID');
    }
    return value;
  }
  register(value: unknown): CostAdjustmentV2 {
    const adjustment = validateAdjustment(value);
    const work = () => {
      this.schema();
      const prior = this.db
        .prepare(
          'SELECT * FROM cost_adjustments WHERE adjustment_id=? OR idempotency_key=? OR (original_cost_event_id=? AND tts_operation_id=?)',
        )
        .all(
          adjustment.adjustmentId,
          adjustment.idempotencyKey,
          adjustment.originalCostEventId,
          adjustment.ttsOperationId,
        );
      if (prior.length) {
        if (
          prior.length !== 1 ||
          prior[0].identity_hash !== adjustment.contentHash
        )
          ttsFail('COST_ADJUSTMENT_IDENTITY_CONFLICT');
        return this.read(prior[0]);
      }
      const original = this.ledger.getCostEvent(adjustment.originalCostEventId);
      const operation = new SqliteTtsFinancialCommitmentsReader(this.db).getTts(
        adjustment.ttsOperationId,
      );
      if (
        !original ||
        original.currency !== adjustment.currency ||
        original.category !== 'voice_cost' ||
        original.origin !== 'openai' ||
        original.costEventId !== `tts_cost:${adjustment.ttsOperationId}` ||
        original.pipelineRunId !== operation?.request.operation.pipelineRunId
      )
        ttsFail('COST_ADJUSTMENT_SCOPE_INVALID');
      if (
        !operation?.billing ||
        !operation.reconciliationReference ||
        !['COMPLETED', 'REVIEW_REQUIRED'].includes(operation.state)
      )
        ttsFail('COST_ADJUSTMENT_RECONCILIATION_REQUIRED');
      if (
        adjustment.evidenceHash !== ttsHash(operation.billing) ||
        adjustment.evidenceReference !== operation.billing.evidenceReference
      )
        ttsFail('COST_ADJUSTMENT_EVIDENCE_MISMATCH');
      const net = this.netUnits(original) + BigInt(adjustment.deltaUnits);
      if (net < 0n) ttsFail('COST_ADJUSTMENT_NEGATIVE_BALANCE');
      if (net !== usdUnits(operation.billing.actualCostUsd))
        ttsFail('COST_ADJUSTMENT_BILLING_MISMATCH');
      this.db
        .prepare('INSERT INTO cost_adjustments VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          adjustment.adjustmentId,
          adjustment.originalCostEventId,
          adjustment.ttsOperationId,
          adjustment.deltaUnits,
          adjustment.currency,
          adjustment.evidenceReference,
          adjustment.evidenceHash,
          adjustment.idempotencyKey,
          adjustment.createdAt,
          adjustment.contentHash,
        );
      return adjustment;
    };
    if (this.db.isTransaction) return work();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  reconcileOriginal(
    original: CostEvent,
    id: string,
    billing: { actualCostUsd: string; evidenceReference: string },
  ): CostAdjustmentV2 | null {
    const previous = this.list(original.costEventId);
    if (previous.length) {
      if (
        previous.length !== 1 ||
        previous[0].ttsOperationId !== id ||
        previous[0].evidenceHash !== ttsHash(billing) ||
        this.netUnits(original) !== usdUnits(billing.actualCostUsd)
      )
        ttsFail('COST_ADJUSTMENT_IDENTITY_CONFLICT');
      return previous[0];
    }
    const delta = usdUnits(billing.actualCostUsd) - usdUnits(original.amount);
    if (delta === 0n) return null;
    const identity = ttsHash({
      originalCostEventId: original.costEventId,
      ttsOperationId: id,
      billing,
    });
    const content = {
      schemaVersion: 'cost-adjustment/2.0.0' as const,
      adjustmentId: `cost_adjustment:${identity}`,
      originalCostEventId: original.costEventId,
      ttsOperationId: id,
      deltaUnits: String(delta),
      currency: 'USD' as const,
      evidenceReference: billing.evidenceReference,
      evidenceHash: ttsHash(billing),
      idempotencyKey: `tts_adjustment:${identity}`,
      createdAt: new Date().toISOString(),
    };
    return this.register({ ...content, contentHash: adjustmentHash(content) });
  }
  statement(id: string): TtsFinancialStatementV2 {
    return this.snapshot(() => this.readStatement(id));
  }
  private snapshot<T>(read: () => T): T {
    if (this.db.isTransaction) return read();
    try {
      this.db.exec('BEGIN');
      const value = read();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private readStatement(id: string): TtsFinancialStatementV2 {
    this.schema();
    const op = new SqliteTtsFinancialCommitmentsReader(this.db).getTts(id);
    if (!op) ttsFail('TTS_OPERATION_NOT_FOUND');
    const original = this.ledger.getCostEvent(`tts_cost:${id}`);
    const net = original ? this.netUnits(original) : null;
    const reconciled =
      !!op.billing &&
      !!op.reconciliationReference &&
      ['COMPLETED', 'REVIEW_REQUIRED'].includes(op.state) &&
      (net ?? 0n) === usdUnits(op.billing.actualCostUsd);
    return {
      schemaVersion: 'tts-financial-statement/2.0.0' as const,
      operationId: id,
      monetaryScale: 18,
      originalCost: original,
      originalOccurredAt: original?.occurredAt ?? op.createdAt,
      adjustments: original ? this.list(original.costEventId) : [],
      netCostUsd: net !== null ? usdAmount(net) : reconciled ? '0' : null,
      reconciliationState: reconciled ? 'RECONCILED' : 'UNKNOWN',
      state: op.state,
      billing: op.billing,
      reconciliationReference: op.reconciliationReference,
    };
  }
  ledgerV2(id: string): CostLedgerV2 {
    return this.snapshot(() => this.readLedgerV2(id));
  }
  private readLedgerV2(id: string): CostLedgerV2 {
    this.schema();
    const original = this.ledger.getCostLedgerByPipelineRun(id);
    const totals = new Map<string, bigint>();
    const adjustments: CostAdjustmentV2[] = [];
    for (const event of original.events) {
      const linked = this.list(event.costEventId);
      adjustments.push(...linked);
      totals.set(
        event.currency,
        (totals.get(event.currency) ?? 0n) + this.netUnits(event),
      );
    }
    const reconciliations = this.db
      .prepare(
        "SELECT operation_id FROM tts_operations WHERE json_extract(request_json,'$.operation.pipelineRunId')=? ORDER BY created_at,operation_id",
      )
      .all(id)
      .map((row) => this.statement(row.operation_id));
    return {
      ...original,
      schemaVersion: 'cost-ledger/2.0.0' as const,
      adjustments,
      reconciliations,
      totalsByCurrency: [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, units]) => ({ currency, amount: usdAmount(units) })),
    };
  }
}
