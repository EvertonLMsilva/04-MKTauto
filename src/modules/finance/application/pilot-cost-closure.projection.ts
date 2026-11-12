import type {
  FinanceReadiness,
  RunFinanceReadiness,
} from '../domain/finance.types.js';
import type {
  PilotCostClosure,
  RecordedCostStatus,
} from '../domain/pilot-cost-closure.types.js';

export function projectPilotCostClosure(
  run: RunFinanceReadiness,
  budget: FinanceReadiness,
): PilotCostClosure {
  const recordedDataStatus: RecordedCostStatus =
    run.status === 'RECONCILED'
      ? 'RECORDED_DATA_RECONCILED'
      : run.status === 'UNKNOWN'
        ? 'UNKNOWN'
        : 'PARTIAL_EVIDENCE';
  return {
    schemaVersion: 'pilot-cost-closure/1.0.0',
    pipelineRunId: run.pipelineRunId,
    evaluatedAt: budget.evaluatedAt,
    recordedDataStatus,
    coverageStatus: 'COVERAGE_UNVERIFIED',
    closureStatus:
      recordedDataStatus === 'RECORDED_DATA_RECONCILED'
        ? 'COVERAGE_UNVERIFIED'
        : recordedDataStatus,
    financiallyClosed: false,
    totalRunCost: null,
    spendingAuthorized: false,
    run,
    budget,
    blockers: [
      ...run.pendingClosure.map((code) => ({ source: 'RUN' as const, code })),
      ...budget.reasons.map((code) => ({ source: 'GLOBAL' as const, code })),
    ],
  };
}
