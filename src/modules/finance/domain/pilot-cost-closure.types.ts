import type { FinanceReadiness, RunFinanceReadiness } from './finance.types.js';

export type RecordedCostStatus =
  'RECORDED_DATA_RECONCILED' | 'PARTIAL_EVIDENCE' | 'UNKNOWN';

// A read-only closing statement, not an accounting entry or a spending grant.
export interface PilotCostClosure {
  schemaVersion: 'pilot-cost-closure/1.0.0';
  pipelineRunId: string;
  evaluatedAt: string;
  recordedDataStatus: RecordedCostStatus;
  coverageStatus: 'COVERAGE_UNVERIFIED';
  closureStatus: 'PARTIAL_EVIDENCE' | 'UNKNOWN' | 'COVERAGE_UNVERIFIED';
  financiallyClosed: false;
  totalRunCost: null;
  spendingAuthorized: false;
  // Existing evidence, adjustments and exact amounts are retained without reaggregation.
  run: RunFinanceReadiness;
  // Global context across all campaigns, not an additional cost of this run.
  budget: FinanceReadiness;
  blockers: { source: 'RUN' | 'GLOBAL'; code: string }[];
}
