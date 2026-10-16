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
