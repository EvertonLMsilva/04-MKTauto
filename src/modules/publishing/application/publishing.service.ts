import { createHash } from 'node:crypto';
import type { OperationalAlertsService } from '../../notifications/application/operational-alerts.service.js';
import { CommercialMeasurementService } from './commercial-measurement.service.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { MeasurementTarget } from '../domain/commercial-measurement.js';
import type { CampaignOperationalFacts } from '../../content-operations/application/campaign-operations.port.js';
import {
  HumanApprovalService,
  validateRequest,
} from './human-approval.service.js';
import type { PublishingStore, PublishingMedia } from './publishing.port.js';
import { distributionFail } from '../domain/manual-distribution-contracts.js';
import type { ManualReleaseHandoff } from './manual-release-handoff.js';
export class PublishingService {
  constructor(
    private readonly store: PublishingStore,
    private readonly media: PublishingMedia,
    private readonly finance?: Pick<
      FinanceService,
      'getLedgerV2ByPipelineRun' | 'getGlobalOperation'
    >,
    private readonly notifications?: Pick<OperationalAlertsService, 'scan'>,
  ) {}
  private signalNotifications() {
    try {
      void this.notifications?.scan().catch(() => {});
    } catch {
      /* Operational only. */
    }
  }
  private session<T>(
    readOnly: boolean,
    action: (session: ReturnType<PublishingStore['open']>) => T,
  ): T {
    const s = this.store.open(readOnly);
    try {
      return action(s);
    } finally {
      s.close();
    }
  }
  decide(value: unknown) {
    const identity = validateRequest(value);
    const render = this.media.getVideoRender(identity.videoRenderId);
    if (
      render &&
      this.media.verifyMedia(render.logicalReference) !== render.contentHash
    )
      distributionFail('DISTRIBUTION_MEDIA_CHANGED');
    return this.session(false, (s) =>
      new HumanApprovalService({ repository: s.approvals }).decide(value),
    );
  }
  approval(id: string) {
    return this.session(true, (s) => s.approvals.getHumanApprovalDecision(id));
  }
  approvals(runId: string) {
    return this.session(true, (s) =>
      s.approvals.listHumanApprovalDecisionsByPipelineRun(runId),
    );
  }
  prepare(value: unknown, key: string) {
    const result = this.session(false, (s) => s.manual.prepare(value, key));
    this.signalNotifications();
    return result;
  }
  coordinatePackage(
    runId: string,
    input: {
      campaignId: string;
      campaignRevision: number;
      videoRenderId: string;
      qualityControlReportId: string;
      platform: string;
      account: string;
      caption: string;
    },
  ) {
    let created = false;
    const result = this.session(false, (s) => {
      const packages = s.manual.repository
        .list('PACKAGE')
        .filter(
          (p: any) =>
            p.identity.pipelineRunId === runId && p.platform === input.platform,
        );
      if (packages.length > 1)
        distributionFail('DISTRIBUTION_PACKAGE_AMBIGUOUS');
      const p = packages[0];
      if (p) {
        if (
          p.campaignId !== input.campaignId ||
          p.campaignRevision !== input.campaignRevision ||
          p.account !== input.account ||
          p.platform !== input.platform ||
          p.identity.videoRenderId !== input.videoRenderId ||
          p.identity.qualityControlReportId !== input.qualityControlReportId ||
          p.caption !== input.caption
        )
          distributionFail('DISTRIBUTION_PACKAGE_SCOPE_MISMATCH');
        return p;
      }
      const prepared = s.manual.prepare(
        input,
        `campaign_package_${createHash('sha256')
          .update(
            input.platform === 'instagram'
              ? runId
              : JSON.stringify({
                  runId,
                  platform: input.platform,
                  account: input.account,
                }),
          )
          .digest('hex')
          .slice(0, 32)}`,
      );
      created = true;
      return prepared;
    });
    if (created) this.signalNotifications();
    return result;
  }
  validatePackage(hash: string, handoff?: CampaignOperationalFacts) {
    return this.session(true, (s) =>
      s.manual.validateForPublication(hash, handoff),
    );
  }
  package(hash: string) {
    return this.session(true, (s) => s.manual.getPackage(hash));
  }
  manualHandoff(hash: string): ManualReleaseHandoff {
    return this.session(true, (s) => s.manual.manualHandoff(hash));
  }
  review(value: unknown, key: string) {
    const result = this.session(false, (s) => s.manual.review(value, key));
    this.signalNotifications();
    return result;
  }
  revokeApproval(value: unknown) {
    return this.session(false, (s) => s.manual.revokeApproval(value));
  }
  packageReview(hash: string) {
    return this.session(true, (s) => s.manual.getReview(hash));
  }
  recordPublication(value: unknown, key: string) {
    const result = this.session(false, (s) =>
      s.manual.recordPublication(value, key),
    );
    this.signalNotifications();
    return result;
  }
  publication(id: string) {
    return this.session(true, (s) => s.manual.getPublication(id));
  }
  publications(hash: string) {
    return this.session(true, (s) => s.manual.listPublications(hash));
  }
  recordResults(value: unknown, key: string) {
    return this.session(false, (s) => s.manual.recordResults(value, key));
  }
  recordCommercialResults(
    target: MeasurementTarget,
    input: unknown,
    key: string,
  ) {
    return this.session(false, (s) =>
      new CommercialMeasurementService(
        s.manual.repository,
        this.finance,
      ).record(target, input, key),
    );
  }
  commercialSummary(target: MeasurementTarget) {
    return this.session(true, (s) =>
      new CommercialMeasurementService(
        s.manual.repository,
        this.finance,
      ).summary(target),
    );
  }
  results(id: string) {
    return this.session(true, (s) => s.manual.listResults(id));
  }
  socialOperation(id: string) {
    return this.store.social((r) => r.get(id));
  }
  socialHistory(id: string) {
    return this.store.social((r) => r.history(id));
  }
}
