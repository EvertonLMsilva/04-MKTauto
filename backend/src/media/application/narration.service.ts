import type { FinanceService } from '../../finance/application/finance.service.js';
import {
  isTtsRiskRequest,
  ttsFail,
} from '../../finance/domain/tts-financial-contracts.js';
import type { NarrationTransport } from './narration-transport.port.js';
import {
  prepareNarration,
  narrationEnvelope,
  narrationEvidence,
} from '../domain/narration-contracts.js';

export type NarrationFinance = Pick<
  FinanceService,
  'approveTts' | 'getTts' | 'reconcileTts'
> &
  Partial<
    Pick<
      FinanceService,
      'beginTts' | 'dispatchTts' | 'markTtsUnknown' | 'recordTtsResult'
    >
  >;

export class NarrationService {
  constructor(
    private readonly finance: NarrationFinance,
    private readonly transport?: NarrationTransport,
  ) {}

  async execute(plan: unknown, now = new Date().toISOString()) {
    const { request } = this.prepare(plan);
    if (!isTtsRiskRequest(request)) ttsFail('TTS_FINANCIAL_GUARANTEE_REQUIRED');
    if (
      !this.transport?.ready() ||
      !this.finance.beginTts ||
      !this.finance.dispatchTts ||
      !this.finance.recordTtsResult ||
      !this.finance.markTtsUnknown
    )
      ttsFail('TTS_LIVE_CONFIGURATION_REQUIRED');
    const claim = this.finance.beginTts(plan, now);
    if (!claim.created) return claim.operation;
    this.finance.dispatchTts(request.operationId, now);
    try {
      const result = await this.transport.synthesize(request);
      this.finance.recordTtsResult(request.operationId, {
        audio: result.audio,
        providerRequestId: result.providerRequestId,
      });
    } catch {
      this.finance.markTtsUnknown(
        request.operationId,
        'TTS_TRANSPORT_UNCERTAIN',
      );
      ttsFail('TTS_RECONCILIATION_REQUIRED');
    }
    // No actual charge is inferred from duration, response headers or the reservation.
    return this.finance.markTtsUnknown(
      request.operationId,
      'TTS_BILLING_EVIDENCE_REQUIRED',
    );
  }

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
