import type { FinanceService } from '../../finance/application/finance.service.js';
import {
  isTtsRiskRequest,
  ttsFail,
} from '../../finance/domain/tts-financial-contracts.js';
import type { NarrationTransport } from './narration-transport.port.js';
import type {
  NarrationPlanStore,
  NarrationScope,
} from './narration-plan.port.js';
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
    private readonly plans?: NarrationPlanStore,
  ) {}
  preparation(scope: NarrationScope, provision = false) {
    if (!this.plans) ttsFail('TTS_PREPARATION_UNAVAILABLE');
    const plan = this.plans.prepare(scope, provision),
      prepared = this.prepare(plan);
    return {
      plan,
      ...prepared,
      authorization: this.plans.authorization(prepared.request.operationId),
      operation: this.get(prepared.request.operationId),
      liveEnabled: this.transport?.ready() ?? false,
    };
  }
  authorize(
    scope: NarrationScope,
    hash: string,
    actor: string,
    expiresAt: string,
  ) {
    const p = this.preparation(scope);
    if (p.requestHash !== hash) ttsFail('TTS_PREPARATION_STALE');
    return this.approve({
      plan: p.plan,
      approval: {
        requestHash: hash,
        approvedBy: actor,
        approvedAt: new Date().toISOString(),
        expiresAt,
        approvalReference: `operations/${p.request.operationId}`,
        acceptsUnboundedCost: true,
        policyVersion: 'tts-risk-reservation/2.0.0',
      },
    });
  }
  async executeFor(scope: NarrationScope, hash: string) {
    const p = this.preparation(scope);
    if (p.requestHash !== hash) ttsFail('TTS_PREPARATION_STALE');
    // Media confirmed before a crash is reusable even while its billing is unknown.
    if (p.operation?.audio && p.operation.providerRequestId) {
      if (p.operation.state === 'SUBMITTING')
        return (
          this.finance.markTtsUnknown?.(
            p.request.operationId,
            'TTS_BILLING_EVIDENCE_REQUIRED',
          ) ?? p.operation
        );
      if (!(
        p.operation.state === 'COMPLETED' ||
        (p.operation.state === 'UNKNOWN' &&
          p.operation.errorCode === 'TTS_BILLING_EVIDENCE_REQUIRED')
      ))
        ttsFail('TTS_RECONCILIATION_REQUIRED');
      return p.operation;
    }
    return this.execute(p.plan);
  }

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
