import { createHash } from 'node:crypto';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import { InstagramConnectionService } from '../publishing/application/instagram-connection.service.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { NarrationService } from '../media/application/narration.service.js';
import { operationsNextAction } from './operations-next-action.js';
import type { NarrationScope } from '../media/application/narration-plan.port.js';
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
    @Optional()
    @Inject(PublishingService)
    private readonly publishing?: PublishingService,
    @Optional()
    @Inject(InstagramPublicationService)
    private readonly instagram?: InstagramPublicationService,
    @Optional()
    @Inject(InstagramConnectionService)
    private readonly connection?: InstagramConnectionService,
    @Optional()
    @Inject(NarrationService)
    private readonly narration?: NarrationService,
  ) {}
  private ttsScope(id: string): NarrationScope {
    const c = this.campaigns.finalizationContext(id),
      script = document(document(c.completed.EDITORIAL).script);
    const reports = (c.completed.MEDIA_QC as any)?.reports;
    if (
      !Array.isArray(reports) ||
      reports.length !== 1 ||
      reports[0].result !== 'PASS' ||
      reports[0].evidence?.provenance?.parameters?.humanReview?.decision !==
        'APPROVED'
    )
      fail('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
    const asset = this.media.get(reports[0].identity.mediaAssetId);
    if (
      !asset ||
      asset.contentHash !== reports[0].identity.contentHash ||
      asset.pipelineRunId !== c.execution.run_id
    )
      fail('TTS_SCOPE_INVALID');
    return {
      pipelineRunId: c.execution.run_id,
      campaignId: c.execution.campaign_id,
      scriptId: String(script.scriptId),
      scriptContentHash: String(script.contentHash),
      mediaAssetId: asset!.mediaAssetId,
      mediaContentHash: asset!.contentHash,
      targetDurationMs: Number(asset!.technicalProperties.durationMilliseconds),
    };
  }
  ttsPreparation(id: string, provision = false) {
    if (!this.narration) fail('TTS_PREPARATION_UNAVAILABLE');
    const p = this.narration!.preparation(this.ttsScope(id), provision);
    return {
      requestHash: p.requestHash,
      model: p.request.model,
      policyVersion: p.request.financialPolicy.schemaVersion,
      voice: p.request.voice,
      text: p.request.operation.narration,
      estimatedUsd: p.request.estimatedUsd,
      reservationUsd: p.request.reservationUsd,
      guaranteedMaximum: false,
      authorization: p.authorization,
      liveEnabled: p.liveEnabled,
      state: p.operation?.state ?? 'NOT_SUBMITTED',
      audioConfirmed:
        !!p.operation?.audio &&
        !!p.operation?.providerRequestId &&
        (p.operation.state === 'COMPLETED' ||
          p.operation.state === 'SUBMITTING' ||
          (p.operation.state === 'UNKNOWN' &&
            p.operation.errorCode === 'TTS_BILLING_EVIDENCE_REQUIRED')),
      errorCode: p.operation?.errorCode ?? null,
    };
  }
  authorizeTts(id: string, value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal),
      input = document(value);
    if (
      Object.keys(input).sort().join(',') !==
        'acceptsUnboundedCost,expiresAt,requestHash' ||
      input.acceptsUnboundedCost !== true ||
      typeof input.requestHash !== 'string' ||
      typeof input.expiresAt !== 'string'
    )
      fail('TTS_EXPLICIT_RISK_ACCEPTANCE_REQUIRED');
    if (!this.narration) fail('TTS_PREPARATION_UNAVAILABLE');
    this.narration!.authorize(
      this.ttsScope(id),
      input.requestHash as string,
      actor.id,
      input.expiresAt as string,
    );
    return this.ttsPreparation(id);
  }
  private readonly ttsInFlight = new Map<string, Promise<boolean>>();
  private async continueTts(id: string, hash?: string): Promise<boolean> {
    const existing = this.ttsInFlight.get(id);
    if (existing) return existing;
    const pending = this.continueTtsOnce(id, hash);
    this.ttsInFlight.set(id, pending);
    try {
      return await pending;
    } finally {
      this.ttsInFlight.delete(id);
    }
  }
  private async continueTtsOnce(id: string, hash?: string) {
    if (!this.narration) return false;
    let c = this.campaigns.finalizationContext(id);
    if (c.execution.status === 'SCHEDULED') {
      await this.campaigns.advanceFinalization(id);
      c = this.campaigns.finalizationContext(id);
    }
    if (c.completed.AUDIO) return true;
    if (c.execution.status === 'RUNNING') return true;
    const scope = this.ttsScope(id),
      p = this.narration.preparation(scope);
    if (!hash && !p.operation?.audio) return false;
    const op = await this.narration.executeFor(scope, hash ?? p.requestHash);
    if (!op?.audio || !op.providerRequestId)
      fail('TTS_RECONCILIATION_REQUIRED');
    const voice = await this.local.ingestTts(
      {
        pipelineRunId: scope.pipelineRunId,
        scriptId: scope.scriptId,
        scriptContentHash: scope.scriptContentHash,
        createdAt: c.execution.scheduled_at,
      },
      op.request.operationId,
      scope.targetDurationMs,
    );
    await this.campaigns.resume(id, {
      voiceTrackId: voice.voiceTrackId,
      audioMode: 'AUTOMATIC',
    });
    await this.campaigns.advanceFinalization(id);
    return true;
  }
  async executeTts(id: string, value: unknown) {
    const input = document(value);
    if (
      Object.keys(input).join(',') !== 'requestHash' ||
      typeof input.requestHash !== 'string'
    )
      fail('TTS_PREPARATION_STALE');
    if (this.ttsPreparation(id).requestHash !== input.requestHash)
      fail('TTS_PREPARATION_STALE');
    await this.continueTts(id, input.requestHash as string);
    return this.detail(id);
  }
  instagramConnection() {
    if (!this.connection) fail('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
    return this.connection!.status();
  }
  checkInstagramConnection(value: unknown) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      fail('INVALID_CONNECTION_REQUEST');
    if (!this.connection) fail('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
    return this.connection!.check();
  }
  list() {
    return this.campaigns.list();
  }
  narrationBytes(id: string) {
    const c = this.campaigns.finalizationContext(id),
      script = document(document(c.completed.EDITORIAL).script),
      audio = document(c.completed.AUDIO);
    return this.local.audioBytes(
      c.execution.run_id,
      String(script.scriptId),
      String(script.contentHash),
      String(audio.voiceTrackId),
    );
  }
  async reviseComposition(id: string, value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    this.campaigns.reviseComposition(id, value, actor.id);
    const c = this.campaigns.finalizationContext(id);
    if (!c.completed.COMPOSITION) {
      if (c.execution.status === 'RUNNING') return this.detail(id);
      if (c.execution.status !== 'SCHEDULED') await this.campaigns.resume(id);
      await this.campaigns.advanceFinalization(id);
    }
    return this.detail(id);
  }
  async authorizeComposition(id: string, value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    this.campaigns.authorizeComposition(id, value, actor.id);
    const c = this.campaigns.finalizationContext(id);
    if (!c.completed.COMPOSITION) {
      if (c.execution.status === 'RUNNING') return this.detail(id);
      if (c.execution.status !== 'SCHEDULED') await this.campaigns.resume(id);
      await this.campaigns.advanceFinalization(id);
    }
    return this.detail(id);
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
    const execution = this.campaigns.get(id);
    const tts =
      context.completed.MEDIA_QC && this.narration
        ? (() => {
            try {
              return this.ttsPreparation(id);
            } catch (error) {
              return {
                code: (error as any).code ?? 'TTS_PREPARATION_UNAVAILABLE',
              };
            }
          })()
        : null;
    return {
      execution,
      nextAction: operationsNextAction(execution, tts),
      narrationAvailable: !!context.completed.AUDIO,
      framing: context.completed.COMPOSITION
        ? this.campaigns.framingContext(id)
        : null,
      compositionAuthorization:
        context.completed.SUBTITLES && !context.completed.COMPOSITION
          ? {
              ...this.campaigns.compositionPreparation(id),
              mediaEvidence: assets
                .filter((a) =>
                  (context.completed.MEDIA_QC as any)?.reports?.some(
                    (r: any) => r.identity.mediaAssetId === a.mediaAssetId,
                  ),
                )
                .map((a) => ({
                  contentHash: a.contentHash,
                  evidence: a.rights.evidence ?? [],
                })),
            }
          : null,
      scriptRevisions: this.campaigns.scriptRevisions(id),
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
                asset.scriptContentHash === script.contentHash) ||
              this.reviewedVisual(context.completed, asset)),
        )
        .map((asset) => ({
          mediaAssetId: asset.mediaAssetId,
          position: asset.visualDirectionPosition,
          revision: asset.revision,
        })),
      scheduler: 'OFFLINE_FINALIZATION',
      audioMode: context.request?.audioMode ?? 'AUTOMATIC',
      tts,
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
      !(
        (asset.scriptId === script.scriptId &&
          asset.scriptContentHash === script.contentHash) ||
        this.reviewedVisual(context.completed, asset)
      )
    )
      fail('CAMPAIGN_SCENE_MEDIA_MISMATCH');
    return context;
  }
  private reviewedVisual(
    completed: Record<string, unknown>,
    asset: { mediaAssetId: string; contentHash: string },
  ) {
    const reports = (
      completed.MEDIA_QC as
        | {
            reports?: {
              identity: { mediaAssetId: string; contentHash: string };
            }[];
          }
        | undefined
    )?.reports;
    return (
      reports?.some(
        (report) =>
          report.identity.mediaAssetId === asset.mediaAssetId &&
          report.identity.contentHash === asset.contentHash,
      ) === true
    );
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
  async audioMode(id: string, value: unknown) {
    const input = document(value),
      context = this.campaigns.finalizationContext(id);
    if (
      Object.keys(input).join(',') !== 'mode' ||
      !['AUTOMATIC', 'RECORDING'].includes(String(input.mode))
    )
      fail('INVALID_AUDIO_MODE');
    if (context.execution.status !== 'WAITING_INPUT' || context.completed.AUDIO)
      fail('AUDIO_INPUT_CONFLICT');
    await this.campaigns.resume(id, { audioMode: input.mode });
    return this.campaigns.get(id);
  }
  reviseScript(id: string, value: unknown, principal: unknown) {
    const reviewer = operationalQcIdentity.assertActive(principal);
    return this.campaigns.reviseScript(id, value, reviewer.id);
  }
  async finalDecision(id: string, value: unknown, principal: unknown) {
    const reviewer = operationalQcIdentity.assertActive(principal),
      input = document(value);
    if (
      ![
        'decision,justification',
        'decision,justification,reviewedRenderContentHash',
      ].includes(Object.keys(input).sort().join(',')) ||
      !['APPROVED', 'REJECTED'].includes(String(input.decision))
    )
      fail('HUMAN_APPROVAL_REQUEST_INVALID');
    const { render, qc } = await this.campaigns.finalReviewContext(id);
    const revised =
      !!this.campaigns.finalizationContext(id).completed.COMPOSITION_REVISION;
    if (
      (revised || input.reviewedRenderContentHash !== undefined) &&
      input.reviewedRenderContentHash !== render.contentHash
    )
      fail('HUMAN_APPROVAL_VERSION_STALE');
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
    const c = this.campaigns.finalizationContext(id);
    if (!c.completed.AUDIO && c.completed.MEDIA_QC && this.narration) {
      try {
        if (await this.continueTts(id)) return this.campaigns.get(id);
      } catch (error) {
        if (
          !['TTS_AUDIO_CONFIGURATION_REQUIRED', 'TTS_SOURCE_REQUIRED'].includes(
            (error as any).code,
          )
        )
          throw error;
      }
    }
    await this.campaigns.advanceFinalization(id);
    return this.campaigns.get(id);
  }
  async retry(id: string) {
    this.campaigns.finalizationContext(id);
    await this.campaigns.resume(id);
    return this.campaigns.get(id);
  }
  async instagramStatus(id: string) {
    this.campaigns.finalizationContext(id);
    return (
      this.instagram?.status(id) ?? {
        configuration: { mode: 'disabled' },
        schedule: null,
        operation: null,
      }
    );
  }
  prepareInstagram(id: string, value: unknown) {
    const input = document(value),
      config = this.instagram?.configuration();
    if (
      Object.keys(input).join(',') !== 'caption' ||
      config?.mode !== 'fake' ||
      !config.accountId
    )
      fail('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
    const c = this.campaigns.publicationContext(id),
      qc = document(c.completed.QC);
    return this.publishing!.prepare(
      {
        campaignId: c.execution.campaign_id,
        campaignRevision: c.execution.campaign_revision,
        videoRenderId: c.handoff.videoRenderId,
        qualityControlReportId: qc.qualityControlReportId ?? qc.reportId,
        platform: 'instagram',
        account: config!.accountId,
        caption: input.caption,
      },
      `p8_package_${createHash('sha256')
        .update(id + ':' + String(input.caption))
        .digest('hex')}`,
    );
  }
  async scheduleInstagram(id: string, value: unknown, principal: unknown) {
    const reviewer = operationalQcIdentity.assertActive(principal),
      input = document(value),
      config = this.instagram?.configuration();
    if (
      Object.keys(input).sort().join(',') !==
        'confirm,packageHash,scheduledAt' ||
      input.confirm !== true
    )
      fail('SOCIAL_EXPLICIT_AUTHORIZATION_REQUIRED');
    if (config?.mode !== 'fake' || !config.accountId)
      fail('SOCIAL_LIVE_POST_BLOCKED');
    const c = this.campaigns.publicationContext(id),
      pkg = this.publishing!.package(String(input.packageHash));
    if (
      !pkg ||
      pkg.campaignId !== c.execution.campaign_id ||
      pkg.identity.pipelineRunId !== c.execution.run_id ||
      pkg.identity.videoRenderContentHash !== c.handoff.contentHash ||
      pkg.account !== config!.accountId
    )
      fail('SOCIAL_HANDOFF_MISMATCH');
    const date = String(input.scheduledAt);
    if (
      !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(date) ||
      !Number.isFinite(Date.parse(date))
    )
      fail('SOCIAL_SCHEDULE_INVALID');
    this.publishing!.review(
      {
        packageHash: pkg.contentHash,
        decision: 'APPROVED',
        actor: reviewer.id,
        justification: null,
      },
      `p8_auth_${createHash('sha256')
        .update(id + ':' + pkg.contentHash)
        .digest('hex')}`,
    );
    return this.instagram!.schedule(
      c.execution,
      {
        packageHash: pkg.contentHash,
        accountId: config!.accountId,
        scheduledAt: new Date(date).toISOString(),
      },
      c.handoff,
      reviewer.id,
    );
  }
  async cancelInstagram(id: string) {
    this.campaigns.finalizationContext(id);
    return this.instagram!.cancel(id);
  }
  async refreshInstagram(id: string) {
    this.campaigns.finalizationContext(id);
    await this.instagram?.tick(id);
    return this.instagramStatus(id);
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
