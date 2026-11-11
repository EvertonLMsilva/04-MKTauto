import { immutable } from '../../affiliate/domain/affiliate-contracts.js';
import type { CostEvent, CostLedger } from './finance.types.js';
import type {
  TtsFinancialOperation,
  TtsBilling,
} from './tts-financial-contracts.js';
import { ttsHash, ttsFail } from './tts-financial-contracts.js';
export interface CostAdjustmentV2 {
  schemaVersion: 'cost-adjustment/2.0.0';
  adjustmentId: string;
  originalCostEventId: string;
  ttsOperationId: string;
  deltaUnits: string;
  currency: 'USD';
  evidenceReference: string;
  evidenceHash: string;
  idempotencyKey: string;
  createdAt: string;
  contentHash: string;
}
export interface TtsFinancialStatementV2 {
  schemaVersion: 'tts-financial-statement/2.0.0';
  operationId: string;
  monetaryScale: 18;
  originalCost: CostEvent | null;
  originalOccurredAt: string;
  adjustments: CostAdjustmentV2[];
  netCostUsd: string | null;
  state: TtsFinancialOperation['state'];
  reconciliationState: 'RECONCILED' | 'UNKNOWN';
  billing: TtsBilling | null;
  reconciliationReference: string | null;
}
export interface CostLedgerV2 extends Omit<CostLedger, 'schemaVersion'> {
  schemaVersion: 'cost-ledger/2.0.0';
  adjustments: CostAdjustmentV2[];
  reconciliations: TtsFinancialStatementV2[];
}
export function adjustmentHash(
  value: Omit<CostAdjustmentV2, 'contentHash'> | CostAdjustmentV2,
): string {
  const { contentHash: _hash, ...content } = value as CostAdjustmentV2;
  return ttsHash(content);
}
export function validateAdjustment(value: any): CostAdjustmentV2 {
  const fields = [
    'schemaVersion',
    'adjustmentId',
    'originalCostEventId',
    'ttsOperationId',
    'deltaUnits',
    'currency',
    'evidenceReference',
    'evidenceHash',
    'idempotencyKey',
    'createdAt',
    'contentHash',
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields.sort().join(',')
  )
    ttsFail('COST_ADJUSTMENT_INVALID_CONTRACT');
  if (
    value.schemaVersion !== 'cost-adjustment/2.0.0' ||
    value.currency !== 'USD'
  )
    ttsFail('COST_ADJUSTMENT_INVALID_CONTRACT');
  for (const key of [
    'adjustmentId',
    'originalCostEventId',
    'ttsOperationId',
    'idempotencyKey',
  ])
    if (
      typeof value[key] !== 'string' ||
      !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value[key])
    )
      ttsFail('COST_ADJUSTMENT_INVALID_IDENTIFIER');
  if (
    typeof value.deltaUnits !== 'string' ||
    !/^-?[1-9]\d{0,57}$/.test(value.deltaUnits)
  )
    ttsFail('COST_ADJUSTMENT_INVALID_DELTA');
  if (
    typeof value.evidenceReference !== 'string' ||
    !value.evidenceReference.trim() ||
    typeof value.evidenceHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.evidenceHash)
  )
    ttsFail('COST_ADJUSTMENT_EVIDENCE_REQUIRED');
  if (
    typeof value.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.createdAt,
    ) ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    ttsFail('COST_ADJUSTMENT_INVALID_TIME');
  if (value.contentHash !== adjustmentHash(value))
    ttsFail('COST_ADJUSTMENT_HASH_MISMATCH');
  return immutable(value);
}
