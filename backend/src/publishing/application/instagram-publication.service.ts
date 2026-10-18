import { Logger } from '@nestjs/common';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { InstagramPublicationPorts } from './ports/instagram-publication.port.js';
import type {
  InstagramPublicationStore,
  InstagramPublicationReservations,
} from './ports/instagram-publication-store.port.js';
import { SocialPublicationService } from './social-publication.service.js';
import { socialFail } from '../domain/social-publication-contracts.js';

export class InstagramPublicationService {
  constructor(
    private readonly store: InstagramPublicationStore,
    private readonly ports: InstagramPublicationPorts | null,
    private readonly now = () => new Date().toISOString(),
    private readonly schedulerEnabled = false,
    private readonly finance?: Pick<FinanceService, 'getGlobalOperation'>,
  ) {}
  private readonly logger = new Logger(InstagramPublicationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  onModuleInit() {
    if (!this.schedulerEnabled || this.ports?.publisher.mode !== 'fake') return;
    const poll = () => {
      if (!this.pending)
        this.pending = this.tick()
          .catch((error) => {
            const code = /^SOCIAL_[A-Z_]+$/.test(error?.code ?? '')
              ? error.code
              : 'SOCIAL_SCHEDULER_FAILED';
            this.logger.error(code);
            if (
              /CONFIGURATION|SCHEMA|CONTEXT|CONFIG|PROVENANCE|BOUNDARY/.test(
                code,
              ) &&
              this.timer
            )
              clearInterval(this.timer);
          })
          .finally(() => {
            this.pending = undefined;
          });
    };
    this.timer = setInterval(poll, 1000);
    this.timer.unref();
    poll();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }
  configuration() {
    return {
      mode: this.ports?.publisher.mode ?? 'disabled',
      accountId: this.ports?.publisher.accountId ?? null,
      schedulerEnabled: this.schedulerEnabled,
      liveAuthorized: false,
    };
  }
  async schedule(
    execution: { execution_id: string; run_id: string; campaign_id: string },
    input: any,
    handoff: any,
    actor: string,
  ) {
    if (this.ports?.publisher.mode !== 'fake')
      socialFail('SOCIAL_LIVE_POST_BLOCKED');
    if (!this.finance) socialFail('SOCIAL_FINANCE_CONFIGURATION_REQUIRED');
    return this.session(async (s, _service, reservations) => {
      const source = reservations.scheduleContext!(execution.execution_id);
      if (
        source.execution.run_id !== execution.run_id ||
        source.handoff.contentHash !== handoff.contentHash
      )
        socialFail('SOCIAL_HANDOFF_MISMATCH');
      for (const operationId of source.financialOperationIds)
        if (this.finance?.getGlobalOperation(operationId)?.state === 'UNKNOWN')
          socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
      const pkg = s.manual.validateForPublication(input.packageHash),
        review = s.manual.getReview(input.packageHash);
      if (
        pkg.identity.pipelineRunId !== execution.run_id ||
        pkg.campaignId !== execution.campaign_id ||
        pkg.identity.videoRenderId !== handoff.videoRenderId ||
        pkg.identity.videoRenderContentHash !== handoff.contentHash ||
        pkg.account !== input.accountId
      )
        socialFail('SOCIAL_HANDOFF_MISMATCH');
      if (!reservations.schedule) socialFail('SOCIAL_SCHEDULER_UNAVAILABLE');
      return reservations.schedule!(
        execution.execution_id,
        { ...input, actor, reviewHash: review.contentHash },
        this.now(),
      );
    });
  }
  async status(id: string) {
    if (!this.ports)
      return {
        configuration: this.configuration(),
        schedule: null,
        operation: null,
      };
    return this.session(async (s, _service, r) => {
      const reservation = r.forExecution(id);
      return {
        configuration: this.configuration(),
        schedule: r.scheduled?.(id) ?? null,
        operation: reservation
          ? (s.social as any).get(reservation.operationId)
          : null,
      };
    });
  }
  async cancel(id: string) {
    return this.session(async (_s, _service, r) =>
      r.cancelSchedule!(id, this.now()),
    );
  }
  async tick(executionId?: string) {
    if (this.ports?.publisher.mode !== 'fake') return;
    if (!this.finance) socialFail('SOCIAL_FINANCE_CONFIGURATION_REQUIRED');
    const ids = await this.session(
      async (_s, _service, r) => r.dueSchedules?.(this.now()) ?? [],
    );
    for (const id of ids) {
      if (executionId && executionId !== id) continue;
      const claim = await this.session(async (_s, _service, r) =>
        r.claimSchedule?.(id, this.now()),
      );
      if (!claim) continue;
      let status = 'FAILED',
        result: unknown = null;
      try {
        const request = JSON.parse(claim.request_json);
        const context = await this.session(async (_s, _service, r) => {
          const c = r.scheduleContext!(id);
          for (const operationId of c.financialOperationIds)
            if (
              this.finance?.getGlobalOperation(operationId)?.state === 'UNKNOWN'
            )
              socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
          return {
            ...c,
            execution: { ...c.execution, claim_token: claim.claim_token },
          };
        });
        const proof = await this.reconcile(id);
        if (proof?.step === 'PUBLICATION') {
          result = proof.result;
          status = 'COMPLETED';
        } else {
          result = await this.execute(
            context.execution,
            request,
            context.handoff,
          );
          status = 'COMPLETED';
        }
      } catch (error) {
        const raw =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(raw)
          ? raw
          : 'SOCIAL_SCHEDULER_FAILED';
        result = { code };
        status =
          code === 'SOCIAL_PROCESSING_REQUIRED'
            ? 'SCHEDULED'
            : /UNCERTAIN|RECONCILIATION/.test(code)
              ? 'WAITING_RECONCILIATION'
              : 'FAILED';
      }
      await this.session(async (_s, _service, r) =>
        r.finishSchedule!(id, claim.claim_token, status, result, this.now()),
      );
    }
  }
  private async session<T>(
    action: (
      session: ReturnType<InstagramPublicationStore['openInstagram']>,
      service: SocialPublicationService,
      reservations: InstagramPublicationReservations,
    ) => Promise<T>,
    expectedClaim?: string,
  ) {
    if (!this.ports)
      return socialFail('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
    const p = this.ports!;
    const s = this.store.openInstagram(p.publisher.mode);
    try {
      const reservations = s.reservations;
      const service = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: p.publisher,
        media: p.media,
        transferVerifier: p.verifier,
        allowLivePosts: p.allowLivePosts ?? false,
        now: this.now,
        authorize: (op: any) =>
          reservations.authorize(op, this.now(), expectedClaim),
      });
      return await action(s, service, reservations);
    } finally {
      s.close();
    }
  }
  async execute(
    execution: {
      execution_id: string;
      run_id: string;
      campaign_id: string;
      claim_token?: string | null;
    },
    raw: any,
    handoff: any,
  ) {
    return this.session(async (s, service, reservations) => {
      const pkg = s.manual.validateForPublication(raw.packageHash);
      if (
        pkg.identity.pipelineRunId !== execution.run_id ||
        pkg.campaignId !== execution.campaign_id ||
        pkg.identity.videoRenderContentHash !== handoff.contentHash ||
        pkg.identity.videoRenderId !== handoff.videoRenderId
      )
        socialFail('SOCIAL_HANDOFF_MISMATCH');
      let op = await service.prepare(
        { packageHash: raw.packageHash, accountId: raw.accountId },
        `instagram:${execution.execution_id}`,
      );
      reservations.reserve(
        execution.execution_id,
        op,
        pkg,
        s.manual.getReview(pkg.contentHash).contentHash,
        this.now(),
      );
      reservations.authorize(op, this.now());
      if (['UNCERTAIN', 'CREATING_CONTAINER', 'PUBLISHING'].includes(op.state))
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state === 'PREPARED')
        op = await service.createContainer(
          op.operationId,
          await this.ports!.transfer(op.packageHash),
        );
      if (op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state === 'PROCESSING') op = await service.process(op.operationId);
      if (op.state === 'READY') op = await service.publish(op.operationId);
      if (op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state === 'PUBLISHED' && op.mediaId)
        op = await service.receipt(op.operationId);
      if (
        op.state === 'UNCERTAIN' ||
        op.requiresReconciliation ||
        (op.state === 'PUBLISHED' && !op.mediaId)
      )
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (['FAILED', 'EXPIRED'].includes(op.state))
        socialFail('SOCIAL_PUBLICATION_FAILED');
      if (op.state !== 'PUBLISHED' || !op.remoteReceipt)
        socialFail(op.errorCode ?? 'SOCIAL_PROCESSING_REQUIRED');
      return {
        operationId: op.operationId,
        mediaId: op.mediaId,
        receipt: op.remoteReceipt,
        cost: { status: 'UNKNOWN', amount: null },
      };
    }, execution.claim_token ?? undefined);
  }
  async reconcile(executionId: string) {
    return this.session(async (s, service) => {
      const reservation = s.reservations.forExecution(executionId);
      if (!reservation) return null;
      let op = await service.reconcile(reservation.operationId);
      if (op.state === 'PUBLISHED' && op.mediaId)
        op = await service.receipt(op.operationId);
      if (
        !op.requiresReconciliation &&
        ['PREPARED', 'PROCESSING', 'READY'].includes(op.state)
      )
        return { verified: true, reason: 'SOCIAL_PERSISTED_INTENT_VERIFIED' };
      if (
        op.state !== 'PUBLISHED' ||
        !op.remoteReceipt ||
        op.requiresReconciliation
      )
        return null;
      return {
        verified: true,
        step: 'PUBLICATION',
        result: {
          operationId: op.operationId,
          mediaId: op.mediaId,
          receipt: op.remoteReceipt,
          cost: { status: 'UNKNOWN', amount: null },
        },
      };
    });
  }
  async receipt(id: string) {
    return this.session(async (_s, service) => service.receipt(id));
  }
}
