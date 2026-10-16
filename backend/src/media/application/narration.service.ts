import type { FinanceService } from '../../finance/application/finance.service.js';
import {
  prepareNarration,
  narrationEnvelope,
  narrationEvidence,
} from '../domain/narration-contracts.js';

export type NarrationFinance = Pick<
  FinanceService,
  'approveTts' | 'getTts' | 'reconcileTts'
>;

export class NarrationService {
  constructor(private readonly finance: NarrationFinance) {}

  prepare(plan: unknown) {
    return prepareNarration(plan);
  }

  approve(value: unknown) {
    const { plan, approval } = narrationEnvelope(value, ['plan', 'approval']);
    return this.finance.approveTts(plan, approval);
  }

  get(id: string) {
    // Finance owns persisted identities, states, audio metadata and receipts.
    return this.finance.getTts(id);
  }

  reconcile(id: string, value: unknown) {
    // Finance validates existing audio/billing and accounts atomically.
    // A separate accountTts call would split this transaction unnecessarily.
    return this.finance.reconcileTts(id, narrationEvidence(value));
  }
}
