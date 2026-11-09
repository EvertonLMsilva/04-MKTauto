import type { FinanceService } from '../../finance/application/finance.service.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import {
  distributionFail as fail,
  seal,
} from '../domain/manual-distribution-contracts.js';
import {
  validateObservation,
  unknownValue,
  subtractMoney,
  metricNames,
  type MoneyValue,
  type MeasurementTarget,
} from '../domain/commercial-measurement.js';
import {
  CommercialMeasurementRepository,
  observationId,
} from '../infrastructure/commercial-measurement.repository.js';
import type { ManualDistributionRepository } from '../infrastructure/manual-distribution.repository.js';

export class CommercialMeasurementService {
  readonly repository: CommercialMeasurementRepository;
  constructor(
    records: ManualDistributionRepository,
    private readonly finance?: Pick<
      FinanceService,
      'getLedgerV2ByPipelineRun' | 'getGlobalOperation'
    >,
    private readonly now = () => new Date().toISOString(),
  ) {
    this.repository = new CommercialMeasurementRepository(records);
  }
  record(target: MeasurementTarget, raw: unknown, key: string) {
    // The command's existing write transaction freezes identity, checks revision
    // and appends RESULTS plus its idempotency receipt together.
    return this.repository.records.command(
      'RESULTS',
      { target, raw },
      key,
      () => {
        const { identity } = this.repository.resolve(target);
        const input = validateObservation(raw, identity.publicationId);
        const id = observationId({
          ...input,
          publicationId: identity.publicationId,
        });
        const history = this.repository
          .history(identity)
          .filter((r) => r.observationId === id);
        const revision = input.expectedRevision + 1;
        const existing = history.find((r) => r.revision === revision);
        if (existing) {
          if (existing.inputHash !== affiliateHash(input))
            fail('DISTRIBUTION_RESULTS_CONFLICT');
          return existing;
        }
        const previous = history.sort((a, b) => b.revision - a.revision)[0];
        if ((previous?.revision ?? 0) !== input.expectedRevision)
          fail('DISTRIBUTION_REVISION_CONFLICT');
        return this.repository.records.put(
          'RESULTS',
          `commercial:${id}:${revision}`,
          seal({
            schemaVersion: 'publication-commercial-results/2.0.0',
            ...input,
            publicationId: identity.publicationId,
            packageHash: identity.packageHash,
            observationId: id,
            revision,
            previousResultHash: previous?.contentHash ?? null,
            identity: previous?.identity ?? identity,
            inputHash: affiliateHash(input),
            recordedAt: this.now(),
          }),
        );
      },
    );
  }
  summary(target: MeasurementTarget) {
    const resolved = this.repository.resolve(target),
      history = this.repository.history(resolved.identity);
    const streams = new Map<string, any>();
    for (const r of history)
      if (
        !streams.has(r.observationId) ||
        streams.get(r.observationId).revision < r.revision
      )
        streams.set(r.observationId, r);
    const observations = [...streams.values()].sort(
      (a, b) =>
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.contentHash.localeCompare(b.contentHash),
    );
    const latest = observations.at(-1);
    const identity = latest?.identity ?? resolved.identity;
    const ledger = this.finance?.getLedgerV2ByPipelineRun(
      identity.pipelineRunId,
    );
    const totals = ledger?.totalsByCurrency ?? [];
    const knownCost: MoneyValue =
      totals.length === 1
        ? { status: 'KNOWN', ...totals[0] }
        : unknownValue(
            totals.length ? 'MULTIPLE_CURRENCIES' : 'NO_MEASURED_COST',
          );
    const unknownCosts = [
      { component: 'LOCAL_COMPUTE', ...unknownValue('NO_REAL_MEASUREMENT') },
    ];
    if (identity.operationId)
      unknownCosts.push({
        component: identity.operationId,
        ...unknownValue('PUBLICATION_COST_UNKNOWN'),
      });
    if (!ledger)
      unknownCosts.push({
        component: 'FINANCE',
        ...unknownValue('FINANCE_UNAVAILABLE'),
      });
    for (const r of ledger?.reconciliations ?? [])
      if (r.reconciliationState === 'UNKNOWN')
        unknownCosts.push({
          component: r.operationId,
          ...unknownValue('FINANCE_RECONCILIATION_REQUIRED'),
        });
    for (const id of resolved.financialOperationIds) {
      const op = this.finance?.getGlobalOperation(id);
      if (op && op.state !== 'COMPLETED')
        unknownCosts.push({
          component: id,
          ...unknownValue('FINANCE_RECONCILIATION_REQUIRED'),
        });
    }
    for (const step of resolved.unknownStageCosts)
      unknownCosts.push({
        component: step,
        ...unknownValue('WORKFLOW_COST_UNKNOWN'),
      });
    const commission: MoneyValue =
      latest?.attribution === 'DIRECT_PUBLICATION'
        ? latest.commissions
        : unknownValue(latest ? 'NOT_DIRECTLY_ATTRIBUTED' : 'NOT_REPORTED');
    const directlyAttributed = latest?.attribution === 'DIRECT_PUBLICATION';
    const unknownReason =
      latest && !directlyAttributed
        ? 'NOT_DIRECTLY_ATTRIBUTED'
        : 'NOT_REPORTED';
    const metrics =
      directlyAttributed && latest?.metrics
        ? latest.metrics
        : Object.fromEntries(
            metricNames.map((k) => [k, unknownValue(unknownReason)]),
          );
    const result = {
      identity,
      publication: {
        publishedAt: identity.publishedAt,
        remoteMediaId: identity.remoteMediaId ?? unknownValue(),
        permalink: identity.permalink ?? unknownValue(),
        executionMode: identity.executionMode,
      },
      metrics,
      clicks: directlyAttributed ? latest.clicks : unknownValue(unknownReason),
      sales: directlyAttributed ? latest.sales : unknownValue(unknownReason),
      grossRevenue: directlyAttributed
        ? latest.revenue
        : unknownValue(unknownReason),
      reportedCommission: latest?.commissions ?? unknownValue(),
      commission,
      knownCost,
      knownCostsByCurrency: totals,
      costLedger: ledger ?? unknownValue('FINANCE_UNAVAILABLE'),
      knownNetResult: subtractMoney(commission, knownCost),
      costCompleteness: unknownValue('EXCLUDES_UNMEASURED_COSTS'),
      unknownCosts,
      costScope: {
        pipelineRunId: identity.pipelineRunId,
        attribution: 'PIPELINE_RUN_NOT_ADDITIVE_ACROSS_PUBLICATIONS',
      },
      observationScope: latest
        ? {
            periodStart: latest.periodStart,
            periodEnd: latest.periodEnd,
            sourceReference: latest.sourceReference,
            attribution: latest.attribution,
            revision: latest.revision,
          }
        : null,
      knownNetResultScope: 'COMMISSION_MINUS_RECORDED_MONETARY_COSTS_ONLY',
      latestObservationId: latest?.observationId ?? null,
      observations,
      history,
    };
    const values = {
      clicks: result.clicks,
      sales: result.sales,
      grossRevenue: result.grossRevenue,
      commission,
      knownCost,
      knownNetResult: result.knownNetResult,
      'publication.remoteMediaId': result.publication.remoteMediaId,
      'publication.permalink': result.publication.permalink,
      ...Object.fromEntries(
        metricNames.map((k) => [`metrics.${k}`, metrics[k]]),
      ),
    };
    return {
      ...result,
      unknownFields: Object.entries(values)
        .filter(
          ([, value]) =>
            typeof value === 'object' &&
            value !== null &&
            value.status === 'UNKNOWN',
        )
        .map(([field]) => field),
    };
  }
}
