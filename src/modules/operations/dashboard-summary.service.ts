import {
  measuredKeys,
  summaryScope,
  type Availability,
  type DashboardSummary,
  type DashboardSummaryReader,
  type Measurement,
  type MeasuredKey,
  type MetricKey,
} from './dashboard-summary.contract.js';

function normalized(metric: Measurement): Measurement {
  return metric.reason === null &&
    Number.isSafeInteger(metric.value) &&
    metric.value !== null &&
    metric.value >= 0
    ? { value: metric.value, reason: null }
    : { value: null, reason: metric.reason ?? 'INVALID_AGGREGATE' };
}

export class DashboardSummaryService {
  constructor(private readonly reader: DashboardSummaryReader) {}

  summary(): DashboardSummary {
    const snapshot = this.reader.read();
    const measured = Object.fromEntries(
      measuredKeys.map((key) => [key, normalized(snapshot[key])]),
    ) as Record<MeasuredKey, Measurement>;
    let approved = measured.qcApproved;
    let evaluated = measured.qcEvaluated;
    if (
      approved.value === null ||
      evaluated.value === null ||
      approved.value > evaluated.value
    ) {
      const reason = approved.reason ?? evaluated.reason ?? 'INVALID_AGGREGATE';
      approved = evaluated = { value: null, reason };
    }
    const rate: Measurement =
      approved.value === null || evaluated.value === null
        ? { value: null, reason: approved.reason ?? evaluated.reason }
        : evaluated.value === 0
          ? { value: null, reason: 'NO_QC_EVALUATIONS' }
          : { value: (100 * approved.value) / evaluated.value, reason: null };
    const all: Record<MetricKey, Measurement> = {
      ...measured,
      qcApproved: approved,
      qcEvaluated: evaluated,
      qcApprovalRate: rate,
      activeCampaigns: {
        value: null,
        reason: 'ACTIVE_CAMPAIGN_DEFINITION_REQUIRED',
      },
      completedPublications: {
        value: null,
        reason: 'COMBINED_PUBLICATIONS_UNDEFINED',
      },
    };
    const values = Object.fromEntries(
      Object.entries(all).map(([key, metric]) => [key, metric.value]),
    ) as Record<MetricKey, number | null>;
    const availability = Object.fromEntries(
      Object.entries(all).map(([key, metric]) => [
        key,
        {
          status: metric.value === null ? 'UNAVAILABLE' : 'AVAILABLE',
          reason: metric.reason,
        },
      ]),
    ) as Record<MetricKey, Availability>;
    return {
      schemaVersion: 'operations-dashboard-summary/1.0.0',
      generatedAt: snapshot.generatedAt,
      scope: { ...summaryScope, publicationMode: snapshot.publicationMode },
      ...values,
      availability,
    };
  }
}
