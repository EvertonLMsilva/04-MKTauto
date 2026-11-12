export interface CostEvent {
  schemaVersion: 'cost-event/1.0.0';
  costEventId: string;
  category:
    | 'production_cost'
    | 'ai_cost'
    | 'media_cost'
    | 'voice_cost'
    | 'publishing_cost';
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  contentIdentity: string | null;
  artifactId: string | null;
  amount: string;
  currency: string;
  occurredAt: string;
  origin: string;
  attributionRuleVersion: string;
  recordedAt: string;
}
export interface CostLedger {
  schemaVersion: 'cost-ledger/1.0.0';
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  events: CostEvent[];
  totalsByCurrency: { currency: string; amount: string }[];
}
export interface GlobalPolicy {
  dailyUsd?: string;
  monthlyUsd?: string;
  timeZone?: string;
}
export interface GlobalUsage {
  dailyUsd: string;
  monthlyUsd: string;
  policy: {
    singleton: number;
    daily_usd: string;
    monthly_usd: string;
    time_zone: string;
  };
}
export interface FinanceReadinessPeriod {
  period: string;
  limitUsd: string;
  committedUsd: string;
  recordedCostUsd: string;
  // Includes conservative headroom retained by the existing gate after settlement.
  reservedLiabilityUsd: string;
  remainingUsd: string;
}
export interface FinanceReadinessOperation {
  source: 'GLOBAL' | 'VIDEO' | 'TTS';
  operationId: string;
  state: string;
  createdAt: string;
  actualCostUsd: string | null;
  evidenceReference: string | null;
  reconciliationRequired: boolean;
}
export type FinanceReadinessReason =
  | 'ACTIVE_RESERVATIONS'
  | 'OPERATIONS_IN_FLIGHT'
  | 'UNKNOWN_OPERATIONS'
  | 'COST_EVIDENCE_UNAVAILABLE'
  | 'RECONCILIATION_REQUIRED'
  | 'PRICE_CEILING_BREACHED'
  | 'DAILY_BUDGET_EXHAUSTED'
  | 'MONTHLY_BUDGET_EXHAUSTED';
export interface FinanceReadiness {
  schemaVersion: 'finance-readiness/1.0.0';
  evaluatedAt: string;
  status: 'READY' | 'NOT_READY';
  scope: 'TECHNICAL_ONLY';
  operationalAcceptance: 'NOT_ASSESSED';
  spendingAuthorized: false;
  timeZone: string;
  usage: GlobalUsage;
  daily: FinanceReadinessPeriod;
  monthly: FinanceReadinessPeriod;
  operations: FinanceReadinessOperation[];
  reasons: FinanceReadinessReason[];
}
export interface CampaignUsage {
  campaignId: string;
  totalUsd: string;
  committedUsd: string;
  reservedSubmissions: number;
  paidSubmissions: number;
  hasUnknown: boolean;
  hasCeilingBreach: boolean;
}
export interface GlobalOperation {
  operation_id: string;
  request_hash: string;
  provider: string;
  maximum_usd: string;
  proof_json: string;
  created_at: string;
  state: 'RESERVED' | 'SUBMITTING' | 'UNKNOWN' | 'COMPLETED';
  actual_usd: string | null;
  billing_reference: string | null;
  result_json: string | null;
}
export interface Reservation {
  created: boolean;
  operation: GlobalOperation;
}
export interface Settlement {
  actualCostUsd: string;
  evidenceReference: string;
}
export interface AuthorizationOptions {
  authorizationMode?: string;
}
export interface RunFinancialOperation {
  source: 'TTS' | 'GLOBAL' | 'VIDEO';
  operationId: string;
  requestHash: string;
  state: string;
  currency: 'USD';
  actualCostUsd: string | null;
  evidenceReference: string | null;
  reconciled: boolean;
  costEventIds: string[];
}
export interface RunFinanceReadiness {
  schemaVersion: 'run-finance-readiness/1.0.0';
  pipelineRunId: string;
  runIdentityHash: string;
  scope: 'RECORDED_FINANCE_DATA';
  status: 'RECONCILED' | 'PENDING' | 'UNKNOWN';
  // Recorded data cannot attest that every external cost of the run was supplied.
  totalRunCost: null;
  ledger: import('./cost-adjustment-contracts.js').CostLedgerV2;
  recordedTotalsByCurrency: { currency: string; amount: string }[];
  provenEventTotalsByCurrency: { currency: string; amount: string }[];
  entries: {
    costEventId: string;
    currency: string;
    netAmount: string;
    reconciled: boolean;
  }[];
  operations: RunFinancialOperation[];
  evidence: string[];
  missingEvidence: string[];
  unknownCosts: string[];
  pendingClosure: string[];
}
