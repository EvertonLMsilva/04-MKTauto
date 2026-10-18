import { Inject, Injectable } from '@nestjs/common';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import {
  serverApprovalRequest,
  operationalQcIdentity,
} from '../publishing/application/local-qc-identity.js';
import { document } from '../content-operations/application/native-campaign-workflow.js';

const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};
@Injectable()
export class OperationsService {
  constructor(
    @Inject(CampaignAdministration)
    private readonly campaigns: CampaignAdministration,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(LocalFlowService) private readonly local: LocalFlowService,
  ) {}
  list() {
    return this.campaigns.list();
  }
  detail(id: string) {
    const context = this.campaigns.finalizationContext(id);
    const script = context.completed.EDITORIAL
      ? document(document(context.completed.EDITORIAL).script)
      : null;
    const assets = this.media.listRun(context.execution.run_id);
    const superseded = new Set(
      assets.map((asset) => asset.supersedesMediaAssetId),
    );
    return {
      execution: this.campaigns.get(id),
      script: context.completed.EDITORIAL
        ? document(context.completed.EDITORIAL).script
        : null,
      media: assets
        .filter(
          (asset) =>
            asset.assetType === 'VIDEO' &&
            !superseded.has(asset.mediaAssetId) &&
            (!script ||
              (asset.scriptId === script.scriptId &&
                asset.scriptContentHash === script.contentHash)),
        )
        .map((asset) => ({
          mediaAssetId: asset.mediaAssetId,
          position: asset.visualDirectionPosition,
          revision: asset.revision,
        })),
      scheduler: 'OFFLINE_FINALIZATION',
      cost: { status: 'UNKNOWN', amount: null },
    };
  }
  private asset(id: string, mediaId: string) {
    const context = this.campaigns.finalizationContext(id),
      asset = this.media.get(mediaId);
    const script = context.completed.EDITORIAL
      ? document(document(context.completed.EDITORIAL).script)
      : null;
    if (
      !asset ||
      !script ||
      asset.pipelineRunId !== context.execution.run_id ||
      asset.scriptId !== script.scriptId ||
      asset.scriptContentHash !== script.contentHash
    )
      fail('CAMPAIGN_SCENE_MEDIA_MISMATCH');
    return context;
  }
  reviewContext(id: string, mediaId: string, referenceId?: string) {
    this.asset(id, mediaId);
    return this.media.prepareTemporalReview(mediaId, referenceId);
  }
  reviewBytes(
    id: string,
    mediaId: string,
    referenceId: string,
    kind: 'video' | 'reference',
  ) {
    this.asset(id, mediaId);
    return this.media.reviewMediaBytes(mediaId, referenceId, kind);
  }
  async recording(
    id: string,
    input: {
      audioBase64: string;
      usageBasis: string;
      commercialUseAllowed: boolean;
      statement: string;
    },
    principal: unknown,
  ) {
    const reviewer = operationalQcIdentity.assertActive(principal);
    const { execution, completed } = this.campaigns.finalizationContext(id);
    if (
      execution.status !== 'WAITING_INPUT' ||
      completed.AUDIO ||
      !completed.EDITORIAL
    )
      fail('AUDIO_INPUT_CONFLICT');
    const script = document(document(completed.EDITORIAL).script);
    const voice = document(
      await this.local.ingestRecording(
        {
          pipelineRunId: execution.run_id,
          scriptId: String(script.scriptId),
          scriptContentHash: String(script.contentHash),
          createdAt: execution.scheduled_at,
        },
        input,
        reviewer.id,
      ),
    );
    await this.campaigns.resume(id, {
      voiceTrackId: voice.voiceTrackId,
      audio: null,
    });
    return this.campaigns.get(id);
  }
  async finalDecision(id: string, value: unknown, principal: unknown) {
    const reviewer = operationalQcIdentity.assertActive(principal),
      input = document(value);
    if (
      Object.keys(input).sort().join(',') !== 'decision,justification' ||
      !['APPROVED', 'REJECTED'].includes(String(input.decision))
    )
      fail('HUMAN_APPROVAL_REQUEST_INVALID');
    const { render, qc } = await this.campaigns.finalReviewContext(id);
    const request = serverApprovalRequest(
      {
        projectId: render.projectId,
        projectVersion: render.projectVersion,
        pipelineRunId: render.pipelineRunId,
        videoRenderId: render.videoRenderId,
        videoRenderRevision: render.revision,
        videoRenderContentHash: render.contentHash,
        qualityControlReportId: qc.qualityControlReportId,
        qualityControlReportContentHash: qc.contentHash,
        decision: input.decision,
        justification: input.justification,
      },
      reviewer,
    );
    const decision = await this.campaigns.approve(id, request);
    if (input.decision === 'REJECTED') this.campaigns.cancel(id);
    else await this.campaigns.resume(id);
    return decision;
  }
  async advance(id: string) {
    await this.campaigns.advanceFinalization(id);
    return this.campaigns.get(id);
  }
  async retry(id: string) {
    this.campaigns.finalizationContext(id);
    await this.campaigns.resume(id);
    return this.campaigns.get(id);
  }
  async finalBytes(id: string) {
    const { completed } = this.campaigns.finalizationContext(id);
    if (
      !completed.BURN ||
      !completed.QC ||
      document(completed.QC).result !== 'PASS'
    )
      fail('LOCAL_PREVIEW_BLOCKED');
    return this.local.previewBytes(
      String(document(completed.BURN).videoRenderId),
    );
  }
}
