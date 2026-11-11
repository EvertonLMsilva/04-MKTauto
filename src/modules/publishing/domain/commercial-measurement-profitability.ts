import type { CostLedgerV2 } from '../../finance/domain/cost-adjustment-contracts.js';
import {
  subtractMoney,
  unknownValue,
  type CommercialObservation,
  type MoneyValue,
} from './commercial-measurement.js';

type Observation = Pick<
  CommercialObservation,
  'attribution' | 'commissions' | 'commissionStatus'
>;

// Finance exposes typed reconciliation evidence for TTS. A generic CostEvent's
// origin token alone cannot prove whether its value was estimated or billed.
export function projectProfitability(
  observation?: Observation,
  ledger?: CostLedgerV2,
) {
  const reportedCommissionStatus = observation?.commissionStatus ?? 'UNKNOWN';
  const direct = observation?.attribution === 'DIRECT_PUBLICATION';
  const confirmedCommission: MoneyValue =
    direct && reportedCommissionStatus === 'CONFIRMED'
      ? observation!.commissions
      : unknownValue(
          direct ? 'COMMISSION_NOT_CONFIRMED' : 'NOT_DIRECTLY_ATTRIBUTED',
        );
  const reconciliations = ledger?.reconciliations ?? [];
  const costEvidence = (ledger?.events ?? [])
    .filter(
      (event) =>
        !reconciliations.some(
          (r) => r.originalCost?.costEventId === event.costEventId,
        ),
    )
    .map((event) => ({
      status: 'RECORDED_UNCLASSIFIED',
      costEventId: event.costEventId as string | null,
      operationId: null as string | null,
      category: event.category as string,
      recordedAmount: {
        status: 'KNOWN',
        amount: event.amount,
        currency: event.currency,
      } as MoneyValue,
      reconciledAmount: unknownValue('NO_TYPED_RECONCILIATION') as MoneyValue,
      evidenceReference: null as string | null,
      reconciliationReference: null as string | null,
    }));
  let units = 0n;
  let confirmedCount = 0;
  const toUnits = (amount: string) => {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  };
  for (const r of reconciliations) {
    const confirmed =
      r.reconciliationState === 'RECONCILED' &&
      r.netCostUsd !== null &&
      !!r.billing &&
      !!r.reconciliationReference;
    if (confirmed) {
      units += toUnits(r.netCostUsd!);
      confirmedCount++;
    }
    costEvidence.push({
      status: confirmed ? 'RECONCILED_BY_FINANCE' : 'UNRECONCILED',
      costEventId: r.originalCost?.costEventId ?? null,
      operationId: r.operationId,
      category: 'voice_cost',
      recordedAmount: r.originalCost
        ? {
            status: 'KNOWN',
            amount: r.originalCost.amount,
            currency: r.originalCost.currency,
          }
        : unknownValue('NO_ORIGINAL_COST_EVENT'),
      reconciledAmount: confirmed
        ? { status: 'KNOWN', amount: r.netCostUsd!, currency: 'USD' }
        : unknownValue('FINANCE_RECONCILIATION_REQUIRED'),
      evidenceReference: r.billing?.evidenceReference ?? null,
      reconciliationReference: r.reconciliationReference,
    });
  }
  const fraction = (units % 10n ** 18n)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');
  const amount = `${units / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
  const reconciledCostsByCurrency = confirmedCount
    ? [{ currency: 'USD', amount }]
    : [];
  const subtotal: MoneyValue = confirmedCount
    ? { status: 'KNOWN', amount, currency: 'USD' }
    : unknownValue('NO_RECONCILED_COST');
  const partialNetResult = subtractMoney(confirmedCommission, subtotal);
  const pendingEvidence = [
    'TOTAL_COST_COMPLETENESS_REQUIRED',
    'LOCAL_COMPUTE_COST_NOT_MEASURED',
    'PUBLICATION_COST_ALLOCATION_NOT_PROVEN',
  ];
  if (!ledger) pendingEvidence.push('FINANCE_UNAVAILABLE');
  if (!direct) pendingEvidence.push('DIRECT_COMMISSION_ATTRIBUTION_REQUIRED');
  if (confirmedCommission.status !== 'KNOWN')
    pendingEvidence.push('CONFIRMED_COMMISSION_REQUIRED');
  if (!confirmedCount) pendingEvidence.push('RECONCILED_COST_REQUIRED');
  if (costEvidence.some((e) => e.status === 'RECORDED_UNCLASSIFIED'))
    pendingEvidence.push('COST_CLASSIFICATION_REQUIRED');
  if (costEvidence.some((e) => e.status === 'UNRECONCILED'))
    pendingEvidence.push('FINANCE_RECONCILIATION_REQUIRED');
  if (
    partialNetResult.status === 'UNKNOWN' &&
    partialNetResult.reason === 'CURRENCY_MISMATCH'
  )
    pendingEvidence.push('CURRENCY_MISMATCH');
  return {
    status: partialNetResult.status === 'KNOWN' ? 'PARTIAL' : 'NOT_CALCULABLE',
    definitive: false,
    reportedCommissionStatus,
    commissionConfirmationBasis: 'OPERATOR_REPORTED_SOURCE_REFERENCE',
    confirmedCommission,
    costEvidence,
    reconciledCostsByCurrency,
    partialNetResult,
    partialNetResultScope:
      'CONFIRMED_COMMISSION_MINUS_RECONCILED_TTS_COST_SUBTOTAL',
    costAttribution: 'PIPELINE_RUN_NOT_ADDITIVE_ACROSS_PUBLICATIONS',
    netProfit: unknownValue('TOTAL_COST_AND_ALLOCATION_UNKNOWN'),
    margin: unknownValue('TOTAL_COST_AND_ALLOCATION_UNKNOWN'),
    roi: unknownValue('TOTAL_COST_AND_ALLOCATION_UNKNOWN'),
    pendingEvidence,
  };
}
