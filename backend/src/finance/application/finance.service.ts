import type { FinanceStore, FinanceRepository } from './finance.port.js';
export class FinanceService {
  constructor(private readonly store: FinanceStore) {}
  private session<T>(action: (session: FinanceRepository) => T): T {
    const session = this.store.open();
    try {
      return action(session);
    } finally {
      session.close();
    }
  }
  register(value: unknown) {
    return this.session((r) => r.register(value));
  }
  get(id: string) {
    return this.session((r) => r.get(id));
  }
  listByPipelineRun(id: string) {
    return this.session((r) => r.listByPipelineRun(id));
  }
  getLedgerByPipelineRun(id: string) {
    return this.session((r) => r.getLedgerByPipelineRun(id));
  }
  getGlobalUsage(now?: string) {
    return this.session((r) => r.getGlobalUsage(now));
  }
  getUsage(id: string) {
    return this.session((r) => r.getUsage(id));
  }
  configureCampaign(id: string, revision: number, value?: unknown) {
    return this.session((r) => r.configureCampaign(id, revision, value));
  }
  approveEstimate(request: unknown, quote: unknown, approval: unknown) {
    return this.session((r) => r.approveEstimate(request, quote, approval));
  }
  getGlobalOperation(id: string) {
    return this.session((r) => r.getGlobalOperation(id));
  }
  configureGlobal(value: {
    dailyUsd?: string;
    monthlyUsd?: string;
    timeZone?: string;
  }) {
    return this.session((r) => r.configureGlobal(value));
  }
  // Trusted internal callers supply provider evidence. No HTTP endpoint accepts
  // price attestations or dispatches paid transports.
  reserveGlobal(
    proof: unknown,
    now?: string,
    options?: { authorizationMode?: string },
  ) {
    return this.session((r) => r.reserveGlobal(proof, now, options));
  }
  dispatchGlobal(id: string, now?: string) {
    return this.session((r) => r.dispatchGlobal(id, now));
  }
  unknownGlobal(id: string) {
    return this.session((r) => r.unknownGlobal(id));
  }
  settleGlobal(
    id: string,
    value: { actualCostUsd: string; evidenceReference: string },
  ) {
    return this.session((r) => r.settleGlobal(id, value));
  }
  async executePaid(
    proof: unknown,
    transport: () => Promise<unknown>,
    now?: string,
    options?: { authorizationMode?: string },
  ) {
    const session = this.store.open();
    try {
      return await session.executePaid(proof, transport, now, options);
    } finally {
      session.close();
    }
  }
}
