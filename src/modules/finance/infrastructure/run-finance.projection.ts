import type {
  RunFinanceReadiness,
  RunFinancialOperation,
} from '../domain/finance.types.js';
import { usdUnits, usdAmount } from '../domain/video-financial-contracts.js';
import { ttsHash } from '../domain/tts-financial-contracts.js';
import { CostLedgerRepository } from './cost-ledger.repository.js';
import { CostAdjustmentsRepository } from './cost-adjustments.repository.js';
import {
  SqliteVideoFinancialCommitmentsReader,
  SqliteFinancialAttributionReader,
  SqliteTtsFinancialCommitmentsReader,
} from './financial-readers.sqlite.js';

// One read snapshot over existing ledgers and evidence; no independent accounting store.
export class RunFinanceProjection {
  constructor(private readonly repository: CostLedgerRepository) {}
  read(id: string): RunFinanceReadiness {
    const db = this.repository.db;
    db.exec('BEGIN');
    try {
      const ledger = new CostAdjustmentsRepository(this.repository).ledgerV2(
        id,
      );
      const run = this.repository.getRun(id);
      const operations: RunFinancialOperation[] = [];
      const ttsReader = new SqliteTtsFinancialCommitmentsReader(db);
      for (const statement of ledger.reconciliations) {
        const op = ttsReader.getTts(statement.operationId);
        operations.push({
          source: 'TTS',
          operationId: statement.operationId,
          requestHash: op.requestHash,
          state: statement.state,
          currency: 'USD',
          actualCostUsd: statement.billing?.actualCostUsd ?? null,
          evidenceReference: statement.billing?.evidenceReference ?? null,
          reconciled: statement.reconciliationState === 'RECONCILED',
          costEventIds:
            statement.originalCost?.currency === 'USD' &&
            statement.originalCost.origin === 'openai' &&
            statement.originalCost.category === 'voice_cost' &&
            statement.originalCost.costEventId ===
              `tts_cost:${statement.operationId}`
              ? [statement.originalCost.costEventId]
              : [],
        });
      }
      const attribution = new SqliteFinancialAttributionReader(db);
      for (const row of db
        .prepare(
          "SELECT * FROM global_paid_operations WHERE json_extract(proof_json,'$.pipelineRunId')=? ORDER BY operation_id",
        )
        .all(id)) {
        const proof = JSON.parse(row.proof_json);
        // A manual wrapper refers to the same TTS liability and evidence.
        if (
          proof.kind === 'MANUAL_TTS_RESERVATION' &&
          ledger.reconciliations.some(
            (s) => s.operationId === proof.sourceTtsId,
          )
        )
          continue;
        const ids = attribution
          .costEvents(
            row.provider,
            proof.bodyHash ?? row.request_hash,
            proof.telemetryOccurredAt ?? null,
          )
          .map((v) => v.cost_event_id);
        const fal =
          proof.kind === 'FIRST_FAL_RISK_ACCEPTED'
            ? attribution.falSettlement(id, proof.risk.requestHash)
            : null;
        operations.push({
          source: 'GLOBAL',
          operationId: row.operation_id,
          requestHash: row.request_hash,
          state: row.state,
          currency: 'USD',
          actualCostUsd: row.actual_usd,
          evidenceReference: row.billing_reference,
          reconciled:
            row.state === 'COMPLETED' &&
            row.actual_usd !== null &&
            !!row.billing_reference,
          costEventIds: fal?.costEventIds ?? ids,
        });
      }
      const videoReader = new SqliteVideoFinancialCommitmentsReader(db);
      for (const row of db
        .prepare(
          "SELECT generation_request_id FROM video_generation_operations WHERE pipeline_run_id=? AND state!='CANCELLED' ORDER BY generation_request_id",
        )
        .all(id)) {
        const op = videoReader.getOperation(row.generation_request_id);
        operations.push({
          source: 'VIDEO',
          operationId: row.generation_request_id,
          requestHash: op.requestHash,
          state: op.state,
          currency: 'USD',
          actualCostUsd: op.billing?.actualCostUsd ?? null,
          evidenceReference: op.billing?.evidenceReference ?? null,
          reconciled: op.state === 'COMPLETED' && !!op.billing,
          costEventIds: op.costEventId ? [op.costEventId] : [],
        });
      }
      const recorded = new Map<string, bigint>(),
        proven = new Map<string, bigint>();
      const missing = new Set<string>(),
        evidence = new Set<string>();
      const pending = new Set<string>(['RUN_COST_COVERAGE_UNVERIFIED']);
      const unknown: string[] = [];
      const netById = new Map(
        ledger.events.map((event) => [
          event.costEventId,
          usdUnits(event.amount) +
            ledger.adjustments
              .filter((a) => a.originalCostEventId === event.costEventId)
              .reduce((sum, a) => sum + BigInt(a.deltaUnits), 0n),
        ]),
      );
      const provenIds = new Set<string>();
      for (const op of operations) {
        const key = `${op.source}:${op.operationId}`;
        if (op.evidenceReference) evidence.add(op.evidenceReference);
        else missing.add(key);
        if (
          op.actualCostUsd === null ||
          ['UNKNOWN', 'SUBMITTING', 'SUBMITTED'].includes(op.state)
        )
          unknown.push(key);
        if (!op.reconciled) pending.add(`RECONCILIATION_REQUIRED:${key}`);
        if (op.reconciled && op.actualCostUsd !== null) {
          const ids = new Set(op.costEventIds);
          const linked = ledger.events.filter((event) =>
            ids.has(event.costEventId),
          );
          const matches =
            linked.length === ids.size &&
            linked.every((event) => event.currency === op.currency) &&
            linked.reduce(
              (sum, event) => sum + netById.get(event.costEventId)!,
              0n,
            ) === usdUnits(op.actualCostUsd);
          if (matches)
            for (const event of linked) provenIds.add(event.costEventId);
          else pending.add(`COST_EVENT_LINK_REQUIRED:${key}`);
        }
      }
      for (const s of ledger.reconciliations)
        if (s.reconciliationReference) evidence.add(s.reconciliationReference);
      for (const a of ledger.adjustments) evidence.add(a.evidenceReference);
      const entries = ledger.events.map((event) => {
        const net = netById.get(event.costEventId)!;
        recorded.set(
          event.currency,
          (recorded.get(event.currency) ?? 0n) + usdUnits(event.amount),
        );
        const reconciled = provenIds.has(event.costEventId);
        if (reconciled)
          proven.set(event.currency, (proven.get(event.currency) ?? 0n) + net);
        else {
          missing.add(`cost-event:${event.costEventId}`);
          pending.add(`COST_EVIDENCE_REQUIRED:${event.costEventId}`);
        }
        return {
          costEventId: event.costEventId,
          currency: event.currency,
          netAmount: usdAmount(net),
          reconciled,
        };
      });
      if (!ledger.events.length && !operations.some((op) => op.reconciled))
        pending.add('NO_RECORDED_COSTS');
      const totals = (map: Map<string, bigint>) =>
        [...map]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, units]) => ({ currency, amount: usdAmount(units) }));
      const result: RunFinanceReadiness = {
        schemaVersion: 'run-finance-readiness/1.0.0',
        pipelineRunId: id,
        runIdentityHash: ttsHash(run),
        scope: 'RECORDED_FINANCE_DATA',
        status: unknown.length
          ? 'UNKNOWN'
          : pending.size > 1
            ? 'PENDING'
            : 'RECONCILED',
        totalRunCost: null,
        ledger,
        recordedTotalsByCurrency: totals(recorded),
        provenEventTotalsByCurrency: totals(proven),
        entries,
        operations: operations.sort(
          (a, b) =>
            a.source.localeCompare(b.source) ||
            a.operationId.localeCompare(b.operationId),
        ),
        evidence: [...evidence].sort(),
        missingEvidence: [...missing].sort(),
        unknownCosts: unknown.sort(),
        pendingClosure: [...pending].sort(),
      };
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
}
