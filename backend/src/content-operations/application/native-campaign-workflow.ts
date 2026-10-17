import type { VideoProductionPreparationService } from '../../media/application/video-production-preparation.service.js';
import type { VideoGenerationService } from '../../media/application/video-generation.service.js';
import type { VideoProductionPreparationV1 } from '../../media/domain/video-production-preparation.js';
import { validateTemporalReport } from '../../media/domain/p4-qc-contracts.js';
import type { InstagramPublicationService } from '../../publishing/application/instagram-publication.service.js';
import type { AffiliateService } from '../../affiliate/application/affiliate.service.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { ResearchReader } from '../../research/application/research-reader.port.js';
import type { EditorialFlowService } from '../../content/application/editorial-flow.service.js';
import type { EditorialProvider } from '../../content/application/editorial-provider.port.js';
import type { ContentService } from '../../content/application/content.service.js';
import type { LocalFlowService } from '../../media/application/local-flow.service.js';
import type { MediaService } from '../../media/application/media.service.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { PublishingService } from '../../publishing/application/publishing.service.js';
import type { ContentOperationsService } from './content-operations.service.js';
import type { CampaignWorkflow } from './campaign-orchestrator.js';
import { executionRequest } from './campaign-orchestrator.js';
import type { CampaignEvent, CampaignExecution } from '../domain/campaign.js';
import { CampaignError, identifier, instant } from '../domain/campaign.js';
import { usdUnits } from '../../finance/domain/video-financial-contracts.js';
import { createHash } from 'node:crypto';
import { adaptationHash } from '../../media/domain/media-hash.js';

export function document(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CampaignError('INVALID_CAMPAIGN_REQUEST');
  return value as Record<string, unknown>;
}
export function campaignRequest(raw: unknown) {
  const r = document(raw);
  const allowed = [
    'campaignId',
    'campaignRevision',
    'scheduledAt',
    'runId',
    'run',
    'briefingId',
    'researchShortlistId',
    'referenceInsightId',
    'generationRequestId',
    'scriptId',
    'voiceTrackId',
    'audio',
    'alignment',
    'composition',
    'mode',
    'publication',
    'videoProduction',
    'sceneMediaAssetIds',
  ];
  if (Object.keys(r).some((k) => !allowed.includes(k)))
    throw new CampaignError('INVALID_CAMPAIGN_REQUEST');
  for (const k of [
    'campaignId',
    'runId',
    'briefingId',
    'researchShortlistId',
    'generationRequestId',
  ])
    identifier(r[k]);
  instant(r.scheduledAt);
  if (
    !Number.isSafeInteger(r.campaignRevision) ||
    Number(r.campaignRevision) < 1
  )
    throw new CampaignError('INVALID_CAMPAIGN_REVISION');
  if (!['LOCAL_VALIDATION', 'PRODUCTION'].includes(String(r.mode)))
    throw new CampaignError('CAMPAIGN_MODE_REQUIRED');
  for (const k of ['scriptId', 'voiceTrackId', 'referenceInsightId'])
    if (r[k] != null) identifier(r[k]);
  if (r.videoProduction !== undefined) {
    const video = document(r.videoProduction);
    if (
      Object.keys(video).join(',') !== 'mode' ||
      video.mode !== 'OFFLINE' ||
      r.mode !== 'LOCAL_VALIDATION' ||
      r.publication !== undefined
    )
      throw new CampaignError('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
  }
  if (r.sceneMediaAssetIds !== undefined) {
    if (
      !r.videoProduction ||
      !Array.isArray(r.sceneMediaAssetIds) ||
      r.sceneMediaAssetIds.length > 300 ||
      new Set(r.sceneMediaAssetIds).size !== r.sceneMediaAssetIds.length
    )
      throw new CampaignError('INVALID_SCENE_MEDIA');
    r.sceneMediaAssetIds.forEach(identifier);
  }
  if (r.publication !== undefined) {
    const publication = document(r.publication);
    if (
      Object.keys(publication).sort().join(',') !== 'accountId,packageHash' ||
      typeof publication.packageHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(publication.packageHash) ||
      typeof publication.accountId !== 'string' ||
      !/^[1-9]\d{4,63}$/.test(publication.accountId)
    )
      throw new CampaignError('INVALID_PUBLICATION_REQUEST');
  }
  return JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
}
export class NativeCampaignWorkflow implements CampaignWorkflow {
  readonly steps = [
    'CONTEXT',
    'EDITORIAL',
    'SCENES',
    'VIDEO_GENERATION',
    'MEDIA_QC',
    'AUDIO',
    'ALIGNMENT',
    'SUBTITLES',
    'COMPOSITION',
    'BURN',
    'QC',
    'PREVIEW',
    'HANDOFF',
    'PUBLICATION',
  ];
  constructor(
    private readonly affiliate: Pick<
      AffiliateService,
      'getCampaign' | 'getBriefing'
    >,
    private readonly binding: AffiliateRunContext,
    private readonly research: ResearchReader,
    private readonly editorial: Pick<EditorialFlowService, 'generate'>,
    private readonly provider: EditorialProvider,
    private readonly content: Pick<ContentService, 'getScript'>,
    private readonly local: LocalFlowService,
    private readonly media: Pick<
      MediaService,
      | 'getCompositionPlan'
      | 'getVideoRender'
      | 'verifyMedia'
      | 'compositionReceipt'
    >,
    private readonly finance: Pick<
      FinanceService,
      'getGlobalUsage' | 'getGlobalOperation'
    >,
    private readonly operations: Pick<
      ContentOperationsService,
      'start' | 'get'
    >,
    private readonly publishing: Pick<PublishingService, 'approvals'>,
    private readonly instagram?: Pick<
      InstagramPublicationService,
      'execute' | 'reconcile'
    >,
    private readonly production?: {
      preparations: Pick<VideoProductionPreparationService, 'prepare'>;
      generation: Pick<VideoGenerationService, 'submit' | 'poll' | 'recover'>;
      media: Pick<MediaService, 'get' | 'evaluateTemporalMedia'>;
    },
  ) {}
  async validate(r: Record<string, unknown>) {
    const campaign = await this.affiliate.getCampaign(
      String(r.campaignId),
      Number(r.campaignRevision),
    );
    const brief = await this.affiliate.getBriefing(String(r.briefingId));
    if (!campaign || !brief)
      throw new CampaignError('CAMPAIGN_CONTEXT_NOT_FOUND');
    if (
      brief.campaignId !== campaign.campaignId ||
      brief.campaignRevision !== campaign.revision
    )
      throw new CampaignError('CAMPAIGN_BRIEFING_MISMATCH');
    return campaign;
  }
  private financeGate(r: Record<string, unknown>, at: string) {
    const op = this.finance.getGlobalOperation(String(r.generationRequestId));
    if (op?.state === 'UNKNOWN') throw new CampaignError('FINANCE_UNKNOWN');
    const usage = this.finance.getGlobalUsage(at);
    if (
      usage.policy.time_zone !== 'America/Sao_Paulo' ||
      usdUnits(usage.policy.daily_usd) > usdUnits('1') ||
      usdUnits(usage.policy.monthly_usd) > usdUnits('20')
    )
      throw new CampaignError('FINANCE_POLICY_REQUIRED');
    if (usdUnits(usage.dailyUsd) >= usdUnits(usage.policy.daily_usd))
      throw new CampaignError('GLOBAL_DAILY_BUDGET_EXCEEDED');
    if (usdUnits(usage.monthlyUsd) >= usdUnits(usage.policy.monthly_usd))
      throw new CampaignError('GLOBAL_MONTHLY_BUDGET_EXCEEDED');
  }
  async execute(
    step: string,
    e: CampaignExecution,
    r: Record<string, unknown>,
    done: Record<string, unknown>,
  ): Promise<unknown> {
    if (step === 'PUBLICATION') {
      if (!r.publication) return { publication: 'MANUAL_HANDOFF' };
      if (!this.instagram)
        throw new CampaignError('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
      return this.instagram.execute(e, r.publication, done.HANDOFF);
    }
    // No paid transport is reachable from this workflow. Unknown charges stay unknown.
    if (!(
      r.videoProduction &&
      ['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC'].includes(step)
    ))
      this.financeGate(r, new Date().toISOString());
    if (step === 'CONTEXT') {
      const campaign = await this.validate(r);
      if (!this.research.getShortlist(String(r.researchShortlistId)))
        throw new CampaignError('RESEARCH_REQUIRED');
      if (r.run) {
        const run = document(r.run);
        if (
          run.pipelineRunId !== e.run_id ||
          run.projectId !== campaign.projectId
        )
          throw new CampaignError('CAMPAIGN_RUN_MISMATCH');
        await this.operations.start(run);
      }
      const run = this.operations.get(e.run_id);
      if (run.projectId !== campaign.projectId || run.state !== 'RUNNING')
        throw new CampaignError('CAMPAIGN_RUN_MISMATCH');
      this.binding.bindRun(
        { pipelineRunId: e.run_id, briefingId: r.briefingId },
        `campaign_${e.execution_id}`,
      );
      this.binding.resolveRunBriefing(e.run_id, String(r.briefingId));
      return {
        projectId: run.projectId,
        projectVersion: run.projectVersion,
        briefingId: r.briefingId,
        mode: r.mode,
        cost: { status: 'UNKNOWN', amount: null },
      };
    }
    if (step === 'EDITORIAL') {
      if (r.scriptId) {
        const script = this.content.getScript(identifier(r.scriptId));
        if (!script) throw new CampaignError('SCRIPT_REQUIRED');
        if (script.pipelineRunId !== e.run_id)
          throw new CampaignError('CAMPAIGN_SCRIPT_MISMATCH');
        // The public editorial service validates affiliate binding and research even on replay.
        if (script.scriptId !== `script:${identifier(r.generationRequestId)}`)
          throw new CampaignError('CAMPAIGN_SCRIPT_MISMATCH');
      }
      if (this.provider.mode !== 'LOCAL')
        throw new CampaignError('GLOBAL_PRICE_UNPROVEN');
      if (
        this.provider.configurationVersion.startsWith('fake-') &&
        r.mode !== 'LOCAL_VALIDATION'
      )
        throw new CampaignError('EDITORIAL_REAL_PROVIDER_REQUIRED');
      return this.editorial.generate({
        generationRequestId: r.generationRequestId,
        pipelineRunId: e.run_id,
        briefingId: r.briefingId,
        researchShortlistId: r.researchShortlistId,
        referenceInsightId: r.referenceInsightId ?? null,
        requestedAt: e.scheduled_at,
        supersedesScriptId: null,
      });
    }
    const script = document(document(done.EDITORIAL).script);
    if (['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC'].includes(step)) {
      if (!r.videoProduction) return { status: 'NOT_REQUESTED' };
      if (!this.production)
        throw new CampaignError('VIDEO_PRODUCTION_CONFIGURATION_REQUIRED');
      if (
        r.mode !== 'LOCAL_VALIDATION' ||
        document(r.videoProduction).mode !== 'OFFLINE'
      )
        throw new CampaignError('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
      if (step === 'SCENES') {
        // Re-read immutable Content/Affiliate revisions through the existing service.
        const directions = script.visualDirections as { position: number }[];
        return this.production.preparations.prepare({
          scriptId: script.scriptId,
          scriptContentHash: script.contentHash,
          scriptRevision: script.revision,
          scenes: directions.map((direction) => ({
            visualDirectionPosition: direction.position,
            sceneMediaType: 'GENERATED_VIDEO',
            movementRequirement: 'REAL_MOTION_REQUIRED',
          })),
        });
      }
      const preparation = done.SCENES as VideoProductionPreparationV1;
      if (step === 'VIDEO_GENERATION') {
        for (const scene of preparation.scenes) {
          const operationId =
            'simulation_' +
            adaptationHash({
              executionId: e.execution_id,
              preparationHash: preparation.contentHash,
              position: scene.position,
            });
          const submitted = await this.production.generation.submit({
            operationId,
            preparation,
            scenePosition: scene.position,
          });
          // A known failed simulation is recovered only after an explicit campaign resume.
          if (submitted.state === 'FAILED')
            this.production.generation.recover(operationId);
          if (
            this.production.generation.poll(operationId).state !== 'COMPLETED'
          )
            throw new CampaignError('VIDEO_SIMULATION_RECOVERY_REQUIRED');
        }
        // Persist only that the offline stage ran. Provider job state stays in memory.
        return {
          mode: 'OFFLINE',
          materialization: 'NOT_MATERIALIZED',
          compositionReady: false,
          preparationHash: preparation.contentHash,
          simulatedScenes: preparation.scenes.length,
        };
      }
      const ids = r.sceneMediaAssetIds as string[] | undefined;
      if (!ids?.length || ids.length !== preparation.scenes.length)
        throw new CampaignError('REAL_VIDEO_MEDIA_REQUIRED');
      const reports = [];
      for (let i = 0; i < ids.length; i++) {
        const asset = this.production.media.get(ids[i]);
        if (!asset) throw new CampaignError('REAL_VIDEO_MEDIA_REQUIRED');
        if (
          asset.assetType !== 'VIDEO' ||
          asset.pipelineRunId !== e.run_id ||
          asset.scriptId !== script.scriptId ||
          asset.scriptContentHash !== script.contentHash ||
          asset.visualDirectionPosition !== preparation.scenes[i].position ||
          asset.projectId !== preparation.projectId ||
          asset.projectVersion !== preparation.projectVersion
        )
          throw new CampaignError('CAMPAIGN_SCENE_MEDIA_MISMATCH');
        if (!asset.rights.commercialUseAllowed)
          throw new CampaignError('COMMERCIAL_MEDIA_RIGHTS_REQUIRED');
        const rights = asset.rights.evidence?.filter(
          (evidence) =>
            evidence.kind === 'MEDIA_USAGE_RIGHT' &&
            evidence.mediaAuthorization?.mediaRef === asset.mediaReference &&
            evidence.mediaAuthorization.contentHash === asset.contentHash,
        );
        if (
          !rights?.length ||
          rights.some(
            (evidence) =>
              evidence.mediaAuthorization?.localProcessing !== true ||
              evidence.mediaAuthorization?.processing !== 'GRANTED' ||
              evidence.mediaAuthorization.commercialUse !== 'GRANTED',
          )
        )
          throw new CampaignError('MEDIA_PROCESSING_RIGHTS_REQUIRED');
        const report = validateTemporalReport(
          await this.production.media.evaluateTemporalMedia(asset.mediaAssetId),
          {
            mediaAssetId: asset.mediaAssetId,
            mediaReference: asset.mediaReference,
            contentHash: asset.contentHash,
            scriptContentHash: asset.scriptContentHash,
            visualDirectionPosition: asset.visualDirectionPosition,
          },
        );
        reports.push(report);
      }
      if (reports.some((report) => report.result !== 'PASS'))
        throw new CampaignError('COMPLETE_TEMPORAL_QC_REQUIRED');
      return { preparationHash: preparation.contentHash, reports };
    }
    if (step === 'AUDIO') {
      if (!r.voiceTrackId) throw new CampaignError('AUDIO_REQUIRED');
      if (r.audio) {
        const audio = document(r.audio),
          voice = document(audio.voiceTrack);
        if (
          voice.voiceTrackId !== r.voiceTrackId ||
          voice.scriptId !== script.scriptId ||
          voice.pipelineRunId !== e.run_id
        )
          throw new CampaignError('CAMPAIGN_AUDIO_MISMATCH');
        await this.local.ingest(audio);
      }
      return {
        voiceTrackId: r.voiceTrackId,
        cost: { status: 'UNKNOWN', amount: null },
      };
    }
    if (step === 'ALIGNMENT') {
      const result = document(
        r.alignment
          ? await this.local.acceptAlignment(r.alignment)
          : await this.local.alignAudio(String(r.voiceTrackId)),
      );
      const input = document(result.input);
      if (
        input.scriptId !== script.scriptId ||
        input.audioAssetId !== r.voiceTrackId
      )
        throw new CampaignError('CAMPAIGN_ALIGNMENT_MISMATCH');
      return result;
    }
    if (step === 'SUBTITLES')
      return this.local.subtitles(
        String(document(document(done.ALIGNMENT).output).alignmentId),
      );
    if (step === 'COMPOSITION') {
      if (!r.composition) throw new CampaignError('COMPOSITION_REQUIRED');
      const request = document(r.composition),
        plan = this.media.getCompositionPlan(String(request.compositionPlanId));
      if (!plan) throw new CampaignError('COMPOSITION_PLAN_REQUIRED');
      if (
        document(plan).pipelineRunId !== e.run_id ||
        document(plan).scriptId !== script.scriptId ||
        document(plan).voiceTrackId !== r.voiceTrackId
      )
        throw new CampaignError('CAMPAIGN_COMPOSITION_MISMATCH');
      if (r.videoProduction) {
        const value = document(plan),
          segments = value.segments as Record<string, unknown>[];
        const reports = document(done.MEDIA_QC).reports as {
          identity: { mediaAssetId: string; contentHash: string };
        }[];
        if (
          value.schemaVersion !== 'composition-plan/2.0.0' ||
          !Array.isArray(segments) ||
          segments.some(
            (segment) =>
              segment.movementRequirement !== 'REAL_MOTION_REQUIRED' ||
              !reports.some(
                (report) =>
                  report.identity.mediaAssetId === segment.mediaAssetId &&
                  report.identity.contentHash === segment.mediaAssetContentHash,
              ),
          )
        )
          throw new CampaignError('MOTION_COMPOSITION_V2_REQUIRED');
      }
      return this.local.compose(request);
    }
    if (step === 'BURN')
      return this.local.burn(
        String(document(done.COMPOSITION).videoRenderId),
        String(document(done.SUBTITLES).subtitleId),
      );
    const video = String(document(done.BURN).videoRenderId);
    if (step === 'QC') {
      const report = document(await this.local.qc(video));
      if (report.result === 'UNKNOWN')
        throw new CampaignError('QC_INPUT_REQUIRED');
      if (report.result !== 'PASS') throw new CampaignError('QC_FAILED');
      return report;
    }
    if (step === 'PREVIEW') {
      const preview = document(await this.local.preview(video));
      if (preview.ready !== true) throw new CampaignError('PREVIEW_REQUIRED');
      return preview;
    }
    if (step === 'HANDOFF') {
      const render = this.media.getVideoRender(video),
        qc = document(done.QC);
      if (
        !render ||
        this.media.verifyMedia(render.logicalReference) !== render.contentHash
      )
        throw new CampaignError('HANDOFF_MEDIA_CHANGED');
      const approvals = [
        ...(done.APPROVAL ? [document(done.APPROVAL)] : []),
        ...this.publishing.approvals(e.run_id),
      ];
      const approval = approvals.find(
        (a: Record<string, unknown>) =>
          a.decision === 'APPROVED' &&
          a.videoRenderId === video &&
          a.videoRenderContentHash === render.contentHash &&
          a.videoRenderRevision === render.revision &&
          a.pipelineRunId === e.run_id &&
          a.qualityControlReportId === qc.reportId &&
          a.qualityControlReportContentHash ===
            createHash('sha256').update(JSON.stringify(qc)).digest('hex'),
      );
      if (!approval) throw new CampaignError('EXACT_HUMAN_APPROVAL_REQUIRED');
      return {
        videoRenderId: video,
        contentHash: render.contentHash,
        approvalId: approval.humanApprovalDecisionId,
        preview: document(done.PREVIEW).url,
        mode: r.mode,
        publication: 'MANUAL_HANDOFF',
        cost: { status: 'UNKNOWN', amount: null },
      };
    }
    throw new CampaignError('INVALID_CAMPAIGN_STAGE');
  }
  async approvalEvidence(e: CampaignExecution, done: Record<string, unknown>) {
    if (e.status !== 'WAITING_INPUT' || !done.QC || !done.PREVIEW || !done.BURN)
      throw new CampaignError('APPROVAL_PREVIEW_REQUIRED');
    const preview = document(
      await this.local.preview(String(document(done.BURN).videoRenderId)),
    );
    if (preview.ready !== true)
      throw new CampaignError('APPROVAL_PREVIEW_REQUIRED');
    const render = this.media.getVideoRender(
      String(document(done.BURN).videoRenderId),
    );
    const qc = document(done.QC);
    if (
      !render ||
      render.pipelineRunId !== e.run_id ||
      qc.result !== 'PASS' ||
      this.media.verifyMedia(render.logicalReference) !== render.contentHash
    )
      throw new CampaignError('HANDOFF_MEDIA_CHANGED');
    return {
      render,
      qc: {
        ...qc,
        qualityControlReportId: qc.reportId,
        contentHash: createHash('sha256')
          .update(JSON.stringify(qc))
          .digest('hex'),
        pipelineRunId: e.run_id,
        projectId: render.projectId,
        projectVersion: render.projectVersion,
      },
    };
  }
  async reconcile(e: CampaignExecution, history: CampaignEvent[]) {
    const publication = history
      .filter((h) => h.event_type === 'STEP_STARTED')
      .at(-1);
    if (publication?.evidence.step === 'PUBLICATION' && this.instagram)
      return this.instagram.reconcile(e.execution_id);
    const lastFailure = history
      .filter((h) => h.event_type === 'STEP_FAILED')
      .at(-1);
    const request = executionRequest(history);
    if (lastFailure?.evidence.code === 'FINANCE_UNKNOWN') {
      const operation = this.finance.getGlobalOperation(
        String(request.generationRequestId),
      );
      if (operation?.state !== 'COMPLETED') return null;
      this.financeGate(request, new Date().toISOString());
      return {
        verified: true,
        reason: 'FINANCE_RECONCILED',
        operationId: request.generationRequestId,
      };
    }
    const last = history.filter((h) => h.event_type === 'STEP_STARTED').at(-1);
    if (
      !last ||
      history.some(
        (h) => h.sequence > last.sequence && h.event_type === 'STEP_DONE',
      )
    )
      return { verified: true, reason: 'NO_IN_FLIGHT_STAGE' };
    const completed: Record<string, unknown> = {};
    for (const event of history)
      if (event.event_type === 'STEP_DONE')
        completed[String(event.evidence.step)] = event.evidence.result;
    if (
      request.videoProduction &&
      request.mode === 'LOCAL_VALIDATION' &&
      document(request.videoProduction).mode === 'OFFLINE' &&
      ['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC'].includes(
        String(last.evidence.step),
      )
    ) {
      // Preparation is read-only, simulation has no external effect, and temporal
      // QC stores immutable hash-bound evidence. Re-execution uses existing IDs.
      return { verified: true, reason: 'OFFLINE_VIDEO_STAGE_REPLAY_SAFE' };
    }
    if (last.evidence.step === 'CONTEXT') {
      const run = this.operations.get(e.run_id);
      const binding = this.binding.getRunBinding(e.run_id);
      if (binding?.briefingId !== request.briefingId) return null;
      await this.validate(request);
      return {
        verified: true,
        step: 'CONTEXT',
        result: {
          projectId: run.projectId,
          projectVersion: run.projectVersion,
          briefingId: request.briefingId,
          mode: request.mode,
          cost: { status: 'UNKNOWN', amount: null },
        },
      };
    }
    if (last.evidence.step === 'COMPOSITION' && request.composition) {
      const composition = document(request.composition);
      const receipt = this.media.compositionReceipt(
        String(composition.videoCompositionRequestId),
      );
      if (!receipt || receipt.requestHash !== composition.contentHash)
        return null;
      const render = receipt.videoRender;
      if (
        render.pipelineRunId !== e.run_id ||
        this.media.verifyMedia(render.logicalReference) !== render.contentHash
      )
        return null;
      return { verified: true, step: 'COMPOSITION', result: render };
    }
    if (
      last.evidence.step === 'BURN' &&
      completed.COMPOSITION &&
      completed.SUBTITLES
    ) {
      const videoId = document(completed.COMPOSITION).videoRenderId;
      const subtitleId = document(completed.SUBTITLES).subtitleId;
      const render = this.media.getVideoRender(
        `video_render:local:${adaptationHash({ videoId, subtitleId })}`,
      );
      if (
        !render ||
        render.pipelineRunId !== e.run_id ||
        this.media.verifyMedia(render.logicalReference) !== render.contentHash
      )
        return null;
      return { verified: true, step: 'BURN', result: render };
    }
    // Verify an editorial effect through its immutable public artifact; never call the provider again.
    if (last.evidence.step === 'EDITORIAL') {
      if (request.mode !== 'LOCAL_VALIDATION') return null;
      if (
        this.finance.getGlobalOperation(String(request.generationRequestId))
          ?.state === 'UNKNOWN'
      )
        return null;
      const script = this.content.getScript(
        `script:${identifier(request.generationRequestId)}`,
      );
      if (script?.pipelineRunId === e.run_id)
        return {
          verified: true,
          step: 'EDITORIAL',
          result: {
            script,
            cost: { availability: 'UNAVAILABLE', amount: null, currency: null },
          },
        };
    }
    return null;
  }
}
