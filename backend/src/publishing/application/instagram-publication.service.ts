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
  ) {}
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
        raw,
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
