import {
  distributionFail,
  exact,
  publicText,
  validateResults,
} from './manual-distribution-contracts.js';

export interface UnknownValue {
  status: 'UNKNOWN';
  reason: string;
}
export interface KnownCount {
  status: 'KNOWN';
  value: number;
}
export interface KnownMoney {
  status: 'KNOWN';
  amount: string;
  currency: string;
}
export type CountValue = KnownCount | UnknownValue;
export type MoneyValue = KnownMoney | UnknownValue;
export type CommissionStatus =
  'UNKNOWN' | 'EXPECTED' | 'CONFIRMED' | 'CANCELLED';
export const metricNames = [
  'views',
  'reach',
  'impressions',
  'engagement',
] as const;
export type MeasurementTarget = {
  kind: 'execution' | 'operation' | 'publication';
  id: string;
};
export const unknownValue = (reason = 'NOT_REPORTED'): UnknownValue => ({
  status: 'UNKNOWN',
  reason,
});
export interface CommercialObservation {
  periodStart: string;
  periodEnd: string;
  sourceReference: string;
  actor: string;
  attribution: string;
  expectedRevision: number;
  correctionReason: string | null;
  metrics: Record<(typeof metricNames)[number], CountValue>;
  clicks: CountValue;
  sales: CountValue;
  revenue: MoneyValue;
  commissions: MoneyValue;
  commissionStatus?: CommissionStatus;
}
export function validateObservation(
  raw: unknown,
  publicationId: string,
): CommercialObservation {
  const required = ['periodStart', 'periodEnd', 'sourceReference', 'actor'];
  const allowed = [
    ...required,
    'attribution',
    'expectedRevision',
    'correctionReason',
    'metrics',
    'clicks',
    'sales',
    'revenue',
    'commissions',
    'commissionStatus',
  ];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    distributionFail('DISTRIBUTION_INVALID_CONTRACT');
  const value = raw as Record<string, any>;
  if (
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    distributionFail('DISTRIBUTION_INVALID_CONTRACT');
  publicText(value.actor, 'actor', 100);
  const legacy = validateResults({
    publicationId,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    sourceReference: value.sourceReference,
    attribution: value.attribution ?? 'UNATTRIBUTED',
    ...Object.fromEntries(
      ['clicks', 'sales', 'revenue', 'commissions'].map((k) => [
        k,
        Object.hasOwn(value, k) ? value[k] : unknownValue(),
      ]),
    ),
  });
  const expectedRevision = value.expectedRevision ?? 0;
  if (
    Object.hasOwn(value, 'commissionStatus') &&
    (!['UNKNOWN', 'EXPECTED', 'CONFIRMED', 'CANCELLED'].includes(
      value.commissionStatus,
    ) ||
      (value.commissionStatus === 'CONFIRMED' &&
        legacy.commissions.status !== 'KNOWN'))
  )
    distributionFail('DISTRIBUTION_COMMISSION_STATUS_INVALID');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    distributionFail('DISTRIBUTION_REVISION_INVALID');
  const correctionReason = value.correctionReason ?? null;
  if (expectedRevision > 0) publicText(correctionReason, 'correctionReason');
  else if (correctionReason !== null)
    distributionFail('DISTRIBUTION_REVISION_INVALID');
  const metrics = value.metrics ?? {};
  if (
    typeof metrics !== 'object' ||
    Array.isArray(metrics) ||
    Object.keys(metrics).some((k) => !metricNames.includes(k as any))
  )
    distributionFail('DISTRIBUTION_METRIC_INVALID');
  const normalized = Object.fromEntries(
    metricNames.map((name) => {
      const metric = Object.hasOwn(metrics, name)
        ? metrics[name]
        : unknownValue();
      if (metric?.status === 'UNKNOWN') {
        exact(metric, ['status', 'reason']);
        publicText(metric.reason, `${name}.reason`);
      } else {
        exact(metric, ['status', 'value']);
        if (
          metric.status !== 'KNOWN' ||
          !Number.isSafeInteger(metric.value) ||
          metric.value < 0
        )
          distributionFail('DISTRIBUTION_METRIC_INVALID', name);
      }
      return [name, metric];
    }),
  ) as CommercialObservation['metrics'];
  return {
    actor: value.actor,
    expectedRevision,
    correctionReason,
    metrics: normalized,
    periodStart: new Date(legacy.periodStart).toISOString(),
    periodEnd: new Date(legacy.periodEnd).toISOString(),
    sourceReference: legacy.sourceReference,
    attribution: legacy.attribution,
    clicks: legacy.clicks,
    sales: legacy.sales,
    revenue: legacy.revenue,
    commissions: legacy.commissions,
    // Omission must preserve historical input hashes and cross-key replay.
    ...(Object.hasOwn(value, 'commissionStatus')
      ? { commissionStatus: value.commissionStatus as CommissionStatus }
      : {}),
  };
}

// Amounts use the same 18-decimal precision as Finance; never use float or FX.
export function subtractMoney(
  commission: MoneyValue,
  cost: MoneyValue,
): MoneyValue {
  if (commission.status !== 'KNOWN') return unknownValue('COMMISSION_UNKNOWN');
  if (cost.status !== 'KNOWN') return unknownValue('COST_UNKNOWN');
  if (commission.currency !== cost.currency)
    return unknownValue('CURRENCY_MISMATCH');
  const units = (amount: string) => {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  };
  const result = units(commission.amount) - units(cost.amount),
    absolute = result < 0n ? -result : result;
  const fraction = (absolute % 10n ** 18n)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');
  const amount = `${result < 0n ? '-' : ''}${absolute / 10n ** 18n}${fraction ? '.' + fraction : ''}`;
  return { status: 'KNOWN', amount, currency: commission.currency };
}
