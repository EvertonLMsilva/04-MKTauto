import type {
  CostEvent,
  CostLedger,
  GlobalPolicy,
  GlobalUsage,
  FinanceReadiness,
  RunFinanceReadiness,
  CampaignUsage,
  GlobalOperation,
  Reservation,
  Settlement,
  AuthorizationOptions,
} from '../domain/finance.types.js';
import type {
  TtsApproval,
  TtsFinancialOperation,
  TtsResult,
} from '../domain/tts-financial-contracts.js';
export interface FinanceRepository {
  close(): void;
  registerTtsAdjustment(
    value: unknown,
  ): import('../domain/cost-adjustment-contracts.js').CostAdjustmentV2;
  getTtsStatementV2(
    id: string,
  ): import('../domain/cost-adjustment-contracts.js').TtsFinancialStatementV2;
  getLedgerV2ByPipelineRun(
    id: string,
  ): import('../domain/cost-adjustment-contracts.js').CostLedgerV2;
  approveTts(plan: unknown, approval: unknown): TtsApproval;
  beginTts(
    plan: unknown,
    now?: string,
  ): { created: boolean; operation: TtsFinancialOperation };
  getTts(id: string): TtsFinancialOperation | null;
  dispatchTts(id: string, now?: string): void;
  markTtsUnknown(id: string, errorCode?: string | null): TtsFinancialOperation;
  recordTtsResult(id: string, result: TtsResult): TtsFinancialOperation;
  reconcileTts(id: string, evidenceReference: string): TtsFinancialOperation;
  accountTts(id: string): CostEvent | null;
  register(value: unknown): CostEvent;
  get(id: string): CostEvent | null;
  listByPipelineRun(id: string): CostEvent[];
  getLedgerByPipelineRun(id: string): CostLedger;
  getGlobalUsage(now?: string): GlobalUsage;
  getGlobalReadiness(now?: string): FinanceReadiness;
  getRunReadiness(id: string): RunFinanceReadiness;
  getUsage(id: string): CampaignUsage;
  configureCampaign(id: string, revision: number, value?: unknown): unknown;
  approveEstimate(request: unknown, quote: unknown, approval: unknown): unknown;
  getGlobalOperation(id: string): GlobalOperation | null;
  configureGlobal(value: GlobalPolicy): Required<GlobalPolicy>;
  reserveGlobal(
    proof: unknown,
    now?: string,
    options?: AuthorizationOptions,
  ): Reservation;
  dispatchGlobal(id: string, now?: string): void;
  unknownGlobal(id: string): void;
  settleGlobal(id: string, value: Settlement): void;
  executePaid(
    proof: unknown,
    transport: () => Promise<unknown>,
    now?: string,
    options?: AuthorizationOptions,
  ): Promise<unknown>;
}
export interface FinanceStore {
  open(): FinanceRepository;
}
