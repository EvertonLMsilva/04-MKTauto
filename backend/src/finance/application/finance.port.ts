import type {
  CostEvent,
  CostLedger,
  GlobalPolicy,
  GlobalUsage,
  CampaignUsage,
  GlobalOperation,
  Reservation,
  Settlement,
  AuthorizationOptions,
} from '../domain/finance.types.js';
export interface FinanceRepository {
  close(): void;
  register(value: unknown): CostEvent;
  get(id: string): CostEvent | null;
  listByPipelineRun(id: string): CostEvent[];
  getLedgerByPipelineRun(id: string): CostLedger;
  getGlobalUsage(now?: string): GlobalUsage;
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
