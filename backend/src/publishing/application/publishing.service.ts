import { createHash } from 'node:crypto';
import {
  HumanApprovalService,
  validateRequest,
} from './human-approval.service.js';
import type { PublishingStore, PublishingMedia } from './publishing.port.js';
import { distributionFail } from '../domain/manual-distribution-contracts.js';
export class PublishingService {
  constructor(
    private readonly store: PublishingStore,
    private readonly media: PublishingMedia,
  ) {}
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
    return this.session(false, (s) => s.manual.prepare(value, key));
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
    return this.session(false, (s) => {
      const packages = s.manual.repository
        .list('PACKAGE')
        .filter((p: any) => p.identity.pipelineRunId === runId);
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
      return s.manual.prepare(
        input,
        `campaign_package_${createHash('sha256').update(runId).digest('hex').slice(0, 32)}`,
      );
    });
  }
  validatePackage(hash: string) {
    return this.session(true, (s) => s.manual.validateForPublication(hash));
  }
  package(hash: string) {
    return this.session(true, (s) => s.manual.getPackage(hash));
  }
  review(value: unknown, key: string) {
    return this.session(false, (s) => s.manual.review(value, key));
  }
  revokeApproval(value: unknown) {
    return this.session(false, (s) => s.manual.revokeApproval(value));
  }
  packageReview(hash: string) {
    return this.session(true, (s) => s.manual.getReview(hash));
  }
  recordPublication(value: unknown, key: string) {
    return this.session(false, (s) => s.manual.recordPublication(value, key));
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
