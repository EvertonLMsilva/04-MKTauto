import type { RunFinancialOperation } from './finance.types.js';

export interface CoverageDocument {
  evidenceId: string;
  reference: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  stageId: string | null;
  kind: 'PERIMETER' | 'BILLING' | 'NOT_APPLICABLE';
  currency: string | null;
}
export interface CostPerimeterStage {
  stageId: string;
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE';
  justification?: string;
  costEventIds: string[];
  operations: Pick<
    RunFinancialOperation,
    'source' | 'operationId' | 'requestHash'
  >[];
  evidenceIds: string[];
}
export interface RunCostPerimeter {
  schemaVersion: 'run-cost-perimeter/1.0.0';
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  runIdentityHash: string;
  // Explicit attestation of the declared scope; references are not fetched or authenticated.
  complete: boolean;
  perimeterEvidenceIds: string[];
  evidence: CoverageDocument[];
  stages: CostPerimeterStage[];
}
export type StageCostStatus =
  | 'RECORDED'
  | 'RECONCILED'
  | 'PARTIAL_EVIDENCE'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE_DOCUMENTED'
  | 'NOT_OBSERVED';
export interface RunCostCoverage {
  schemaVersion: 'run-cost-coverage/1.0.0';
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  runIdentityHash: string;
  scope: 'DECLARED_PERIMETER';
  coverageStatus:
    | 'DOCUMENTED_PERIMETER_COVERED'
    | 'PARTIAL_COVERAGE'
    | 'COVERAGE_UNVERIFIED'
    | 'UNKNOWN';
  perimeterEvidenceIds: string[];
  evidence: CoverageDocument[];
  stages: {
    stageId: string;
    status: StageCostStatus;
    justification: string | null;
    costEventIds: string[];
    operationKeys: string[];
    evidenceIds: string[];
    missingEvidence: string[];
    blockers: string[];
  }[];
  coveredStages: string[];
  notCoveredStages: string[];
  unassignedCostEventIds: string[];
  unassignedOperations: string[];
  missingEvidence: string[];
  blockers: string[];
  // References to canonical net ledger totals, never a sum of stage/operation costs.
  knownFinancialTotals: { currency: string; amount: string }[];
  totalRunCost: { currency: string; amount: string }[] | null;
  financiallyClosed: false;
  spendingAuthorized: false;
}
