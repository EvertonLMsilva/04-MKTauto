import type { CampaignOperationsPort } from '../../content-operations/application/campaign-operations.port.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { OperationalAlertsService } from '../../notifications/application/operational-alerts.service.js';
import type {
  DestinationPublicationStore,
  FacebookPublicationPorts,
  PublicationNetwork,
} from './ports/destination-publication.port.js';
import { SocialPublicationService } from './social-publication.service.js';
import { socialFail } from '../domain/social-publication-contracts.js';

// Explicit distribution of existing, approved media. No timer and no production pipeline.
export class DestinationPublicationService {
  constructor(
    private readonly store: DestinationPublicationStore,
    private readonly campaigns: CampaignOperationsPort,
    private readonly facebook: FacebookPublicationPorts | null,
    private readonly finance: Pick<FinanceService, 'getGlobalOperation'>,
    private readonly notifications?: Pick<OperationalAlertsService, 'scan'>,
    private readonly now = () => new Date().toISOString(),
  ) {}
  status(id: string) {
    return this.store.readDestinations(id);
  }
  private context(id: string) {
    const s = this.campaigns.open();
    try {
      const e = s.facts(id)[0];
      if (!e) socialFail('SOCIAL_EXECUTION_NOT_FOUND');
      return { execution: e, request: s.audit(id)[0]?.evidence ?? {} };
    } finally {
      s.close();
    }
  }
  async execute(id: string, network: PublicationNetwork, account: string) {
    if (network !== 'FACEBOOK_REELS' || !this.facebook)
      socialFail('SOCIAL_FACEBOOK_CONFIGURATION_REQUIRED');
    const ports = this.facebook,
      canonical = 'facebook_reels:' + account;
    if (ports.publisher.accountId !== canonical)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const { execution: e, request } = this.context(id),
      s = this.store.openDestination(ports.publisher.mode);
    try {
      const prior = s.reservations.forExecution(id, network, account),
        previous = prior ? s.social.get(prior.operationId) : null;
      if (
        previous?.state === 'PUBLISHED' &&
        previous.remoteReceipt &&
        !previous.requiresReconciliation
      )
        return this.result(previous);
      const packages = s.manual.repository
        .list('PACKAGE')
        .filter(
          (p: any) =>
            p.platform === 'facebook' &&
            p.account === account &&
            p.identity.pipelineRunId === e.runId,
        );
      if (!previous && packages.length !== 1)
        socialFail(
          packages.length
            ? 'DISTRIBUTION_PACKAGE_AMBIGUOUS'
            : 'SOCIAL_PACKAGE_REQUIRED',
        );
      const pkg = s.manual.validateForPublication(
        previous?.packageHash ?? packages[0].contentHash,
      );
      const approval = e.stage.approval;
      if (
        ['CANCELLED', 'FAILED'].includes(e.status) ||
        approval?.decision !== 'APPROVED' ||
        approval.videoRenderId !== pkg.identity.videoRenderId ||
        approval.videoRenderContentHash !==
          pkg.identity.videoRenderContentHash ||
        approval.qualityControlReportId !==
          pkg.identity.qualityControlReportId ||
        approval.qualityControlReportContentHash !==
          pkg.identity.qualityControlReportContentHash ||
        e.stage.render?.videoRenderId !== pkg.identity.videoRenderId
      )
        socialFail('SOCIAL_HANDOFF_MISMATCH');
      const recovery = request.legacyRecovery as
        { financialOperationIds?: string[] } | undefined;
      const financialIds =
        recovery?.financialOperationIds ??
        [request.generationRequestId].filter(
          (v): v is string => typeof v === 'string',
        );
      for (const operationId of financialIds)
        if (this.finance.getGlobalOperation(operationId)?.state === 'UNKNOWN')
          socialFail('SOCIAL_FINANCE_RECONCILIATION_REQUIRED');
      const localBytes = await ports.localBytes(
        pkg.contentHash,
        pkg.identity.videoRenderId,
        pkg.identity.videoRenderContentHash,
      );
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: ports.publisher,
        media: ports.media,
        transferVerifier: ports.verifier,
        allowLivePosts: ports.allowLivePosts ?? false,
        now: this.now,
        authorize: (op: any) => s.reservations.authorize(op, this.now()),
      });
      let op = await engine.prepare(
        { packageHash: pkg.contentHash, accountId: canonical },
        `facebook_reels:${id}:${account}`,
        'local',
      );
      s.reservations.reserve(
        id,
        op,
        pkg,
        s.manual.getReview(pkg.contentHash).contentHash,
        this.now(),
      );
      if (
        ['CREATING_CONTAINER', 'PUBLISHING', 'UNCERTAIN'].includes(op.state) ||
        op.requiresReconciliation
      ) {
        op = await engine.reconcile(op.operationId);
        if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
          socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      }
      if (['PREPARED', 'PROCESSING', 'READY'].includes(op.state))
        await ports.verifyConnection?.();
      if (op.state === 'PREPARED')
        op = await engine.createContainer(op.operationId);
      if (op.state === 'PROCESSING' && op.uploadStage === 'UPLOADING') {
        await engine.reconcile(op.operationId);
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      }
      if (op.state === 'PROCESSING' && op.uploadStage === 'PENDING')
        op = await engine.upload(op.operationId, localBytes);
      if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state === 'PROCESSING') op = await engine.process(op.operationId);
      if (op.state === 'READY') op = await engine.publish(op.operationId);
      if (op.state === 'PUBLISHED') op = await engine.receipt(op.operationId);
      if (op.state === 'UNCERTAIN' || op.requiresReconciliation)
        socialFail('SOCIAL_RECONCILIATION_REQUIRED');
      if (op.state !== 'PUBLISHED' || !op.remoteReceipt)
        socialFail(op.errorCode ?? 'SOCIAL_PROCESSING_REQUIRED');
      return this.result(op);
    } finally {
      s.close();
      try {
        await this.notifications?.scan();
      } catch {
        /* Operational delivery cannot change publication outcome. */
      }
    }
  }
  private result(op: any) {
    return {
      operationId: op.operationId,
      network: 'FACEBOOK_REELS',
      mediaId: op.mediaId,
      receipt: op.remoteReceipt,
      cost: { status: 'UNKNOWN', amount: null },
    };
  }
}
