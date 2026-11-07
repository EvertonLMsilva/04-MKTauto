import { assertCompositionGrant } from '../domain/composition-authorization.js';
import type { InstagramEditorialService } from '../../publishing/application/instagram-editorial.service.js';
import { PRODUCT_FRAMING_STRATEGY } from '../../media/domain/product-framing.js';
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
import { executionRequest, completedContext } from './campaign-orchestrator.js';
import type { CampaignEvent, CampaignExecution } from '../domain/campaign.js';
import { CampaignError, identifier, instant } from '../domain/campaign.js';
import { usdUnits } from '../../finance/domain/video-financial-contracts.js';
import { createHash } from 'node:crypto';
import { adaptationHash } from '../../media/domain/media-hash.js';
import { compositionPlanContentHash } from '../../media/domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from '../../media/domain/video-composition-contracts.js';
import { visualScriptMatches } from '../../content/domain/script-visual-lineage.js';
import type { LocalImageSource } from '../../media/application/local-flow.port.js';

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
    'audioMode',
    'audio',
    'alignment',
    'composition',
    'mode',
    'publication',
    'videoProduction',
    'sceneMediaAssetIds',
    'legacyRecovery',
    'localImage',
  ];
  if (Object.keys(r).some((k) => !allowed.includes(k)))
    throw new CampaignError('INVALID_CAMPAIGN_REQUEST');
  for (const k of [
    'campaignId',
    'runId',
    'briefingId',
    ...(r.legacyRecovery
      ? []
      : [
          'generationRequestId',
          ...(r.researchShortlistId === null ? [] : ['researchShortlistId']),
        ]),
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
  if (
    r.audioMode !== undefined &&
    (typeof r.audioMode !== 'string' ||
      !['AUTOMATIC', 'RECORDING'].includes(r.audioMode))
  )
    throw new CampaignError('INVALID_AUDIO_MODE');
  for (const k of ['scriptId', 'voiceTrackId', 'referenceInsightId'])
    if (r[k] != null) identifier(r[k]);
  if (r.videoProduction !== undefined) {
    const video = document(r.videoProduction);
    if (
      Object.keys(video).join(',') !== 'mode' ||
      !['OFFLINE', 'ASSISTED_LOCAL', 'LOCAL_IMAGES'].includes(
        String(video.mode),
      ) ||
      r.mode !== 'LOCAL_VALIDATION' ||
      (r.publication !== undefined && video.mode !== 'LOCAL_IMAGES')
    )
      throw new CampaignError('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
  }
  if (
    r.localImage !== undefined ||
    (r.videoProduction && document(r.videoProduction).mode === 'LOCAL_IMAGES')
  ) {
    if (
      !r.localImage ||
      !r.videoProduction ||
      document(r.videoProduction).mode !== 'LOCAL_IMAGES' ||
      [
        'sceneMediaAssetIds',
        'voiceTrackId',
        'audio',
        'alignment',
        'composition',
        'scriptId',
        'legacyRecovery',
      ].some((key) => r[key] !== undefined)
    )
      throw new CampaignError('LOCAL_IMAGE_REQUEST_REQUIRED');
    document(r.localImage);
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
    > &
      Partial<Pick<AffiliateService, 'createBriefing'>>,
    private readonly binding: AffiliateRunContext,
    private readonly research: ResearchReader,
    private readonly editorial: Pick<EditorialFlowService, 'generate'>,
    private readonly provider: EditorialProvider,
    private readonly content: Pick<ContentService, 'getScript' | 'listScripts'>,
    private readonly local: LocalFlowService,
    private readonly media: Pick<
      MediaService,
      | 'getCompositionPlan'
      | 'getVideoRender'
      | 'verifyMedia'
      | 'compositionReceipt'
    > &
      Partial<Pick<MediaService, 'registerCompositionPlan'>>,
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
    > &
      Partial<Pick<InstagramPublicationService, 'configuration' | 'status'>>,
    private readonly production?: {
      preparations: Pick<VideoProductionPreparationService, 'prepare'>;
      generation: Pick<VideoGenerationService, 'submit' | 'poll' | 'recover'>;
      media: Pick<MediaService, 'get' | 'evaluateTemporalMedia'> &
        Partial<
          Pick<
            MediaService,
            'listScript' | 'acquisition' | 'temporalReview' | 'reviewMediaBytes'
          >
        >;
    },
    private readonly captioning?: InstagramEditorialService,
  ) {}
  async captionContext(
    e: CampaignExecution,
    r: Record<string, unknown>,
    done: Record<string, unknown>,
  ) {
    const briefing = await this.affiliate.getBriefing(String(r.briefingId));
    if (
      !briefing ||
      briefing.campaignId !== e.campaign_id ||
      briefing.campaignRevision !== e.campaign_revision
    )
      throw new CampaignError('SOCIAL_CAPTION_CONTEXT_REQUIRED');
    const script = document(document(done.EDITORIAL).script);
    const render = this.media.getVideoRender(
      String(document(done.BURN).videoRenderId),
    );
    const research =
      typeof r.researchShortlistId === 'string'
        ? this.research.getShortlist(r.researchShortlistId)
        : null;
    return {
      briefing,
      script,
      render,
      qc: done.QC,
      research: research
        ? { id: research.shortlistId ?? r.researchShortlistId }
        : null,
      audience: document(done.CONTEXT ?? {}).audienceProfile ?? null,
    };
  }
  scriptRevisions(e: CampaignExecution, previous: Record<string, unknown>) {
    return this.content.listScripts(e.run_id).filter((script) => {
      try {
        this.revisedScript(e, previous, script.scriptId);
        return true;
      } catch (error) {
        if (
          error instanceof CampaignError &&
          error.code === 'SCRIPT_REVISION_SCOPE_MISMATCH'
        )
          return false;
        throw error;
      }
    });
  }
  revisedScript(
    e: CampaignExecution,
    previous: Record<string, unknown>,
    scriptId: string,
  ) {
    const script = this.content.getScript(identifier(scriptId));
    if (
      !script ||
      script.pipelineRunId !== e.run_id ||
      script.supersedesScriptId !== previous.scriptId ||
      script.revision !== Number(previous.revision) + 1 ||
      !visualScriptMatches(
        script,
        String(previous.scriptId),
        String(previous.contentHash),
        (id) => this.content.getScript(id),
      )
    )
      throw new CampaignError('SCRIPT_REVISION_SCOPE_MISMATCH');
    return script;
  }
  /** Imports persisted context only; it never replays editorial or generation. */
  async recoverLegacy(value: unknown): Promise<Record<string, unknown>> {
    const input = document(value);
    if (
      Object.keys(input).sort().join(',') !== 'campaignId,media,runId' ||
      !Array.isArray(input.media) ||
      !input.media.length ||
      input.media.length > 300
    )
      throw new CampaignError('INVALID_LEGACY_RECOVERY');
    const campaignId = identifier(input.campaignId),
      runId = identifier(input.runId);
    const run = this.operations.get(runId);
    const brief = this.binding.resolveRunBriefing(runId);
    if (!brief) throw new CampaignError('LEGACY_BRIEFING_REQUIRED');
    const campaign = await this.affiliate.getCampaign(
      campaignId,
      brief.campaignRevision,
    );
    if (
      !campaign ||
      brief.campaignId !== campaignId ||
      run.pipelineRunId !== runId ||
      campaign.projectId !== run.projectId ||
      run.state !== 'RUNNING'
    )
      throw new CampaignError('LEGACY_CAMPAIGN_RUN_MISMATCH');
    const first = document(input.media[0]);
    const original = this.production?.media.get(identifier(first.mediaAssetId));
    const script = original && this.content.getScript(original.scriptId);
    if (
      !script ||
      script.pipelineRunId !== runId ||
      script.projectId !== run.projectId ||
      script.projectVersion !== run.projectVersion ||
      script.contentHash !== original!.scriptContentHash ||
      script.visualDirections.length !== input.media.length
    )
      throw new CampaignError('LEGACY_SCRIPT_MISMATCH');
    const ids: string[] = [];
    const evidence = [];
    const financialOperationIds = new Set<string>();
    for (let i = 0; i < input.media.length; i++) {
      const item = document(input.media[i]);
      if (
        Object.keys(item).sort().join(',') !==
          'contentHash,mediaAssetId,referenceId' ||
        typeof item.contentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.contentHash)
      )
        throw new CampaignError('INVALID_LEGACY_RECOVERY');
      const id = identifier(item.mediaAssetId),
        referenceId = identifier(item.referenceId);
      const asset = this.requireSceneMedia(
        id,
        script as unknown as Record<string, unknown>,
        runId,
        script.visualDirections[i].position,
        campaignId,
      );
      if (asset.contentHash !== item.contentHash || ids.includes(id))
        throw new CampaignError('LEGACY_MEDIA_HASH_MISMATCH');
      if (
        !asset.rights.evidence?.some(
          (e) => e.mediaAuthorization?.operationScope,
        )
      )
        throw new CampaignError('LEGACY_ACQUISITION_REQUIRED');
      if (!this.production!.media.reviewMediaBytes)
        throw new CampaignError('LEGACY_INTEGRITY_VERIFIER_REQUIRED');
      for (const right of asset.rights.evidence ?? []) {
        const operation = right.mediaAuthorization?.operationScope;
        if (operation) {
          if (this.finance.getGlobalOperation(operation)?.state !== 'COMPLETED')
            throw new CampaignError('LEGACY_FINANCE_COMPLETION_REQUIRED');
          financialOperationIds.add(operation);
        }
      }
      const bytes = await this.production!.media.reviewMediaBytes!(
        id,
        referenceId,
        'video',
      );
      await this.production!.media.reviewMediaBytes!(
        id,
        referenceId,
        'reference',
      );
      if (createHash('sha256').update(bytes).digest('hex') !== item.contentHash)
        throw new CampaignError('LEGACY_MEDIA_HASH_MISMATCH');
      ids.push(id);
      evidence.push({
        mediaAssetId: id,
        contentHash: asset.contentHash,
        referenceId,
      });
    }
    return {
      campaignId,
      campaignRevision: campaign.revision,
      runId,
      scheduledAt: instant(run.startedAt),
      mode: 'LOCAL_VALIDATION',
      briefingId: brief.briefingId,
      scriptId: script.scriptId,
      videoProduction: { mode: 'ASSISTED_LOCAL' },
      sceneMediaAssetIds: ids,
      legacyRecovery: {
        provenance: 'LEGACY_RECOVERY',
        media: evidence,
        script,
        financialOperationIds: [...financialOperationIds].sort(),
        notExecutedByCurrentOrchestrator: [
          'CONTEXT',
          'EDITORIAL',
          'SCENES',
          'VIDEO_GENERATION',
        ],
      },
    };
  }
  private requireSceneMedia(
    id: string,
    script: Record<string, unknown>,
    runId: string,
    position: number,
    campaignId?: string,
  ) {
    const asset = this.production?.media.get(id);
    if (!asset) throw new CampaignError('REAL_VIDEO_MEDIA_REQUIRED');
    if (
      asset.assetType !== 'VIDEO' ||
      asset.pipelineRunId !== runId ||
      !visualScriptMatches(
        script,
        asset.scriptId,
        asset.scriptContentHash,
        (id) => this.content.getScript(id),
      ) ||
      asset.visualDirectionPosition !== position ||
      asset.projectId !== script.projectId ||
      asset.projectVersion !== script.projectVersion
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
    for (const evidence of rights!) {
      const scope = evidence.mediaAuthorization!;
      if (
        scope.campaignId !== undefined &&
        (scope.campaignId !== campaignId || scope.purpose !== 'HUMAN_QC_REVIEW')
      )
        throw new CampaignError('CAMPAIGN_MEDIA_RIGHTS_MISMATCH');
      if (scope.operationScope !== undefined) {
        const acquired = this.production?.media.acquisition?.(
          scope.operationScope,
        )?.mediaAsset;
        if (
          !scope.campaignId ||
          !acquired ||
          (
            [
              'pipelineRunId',
              'projectId',
              'projectVersion',
              'scriptId',
              'scriptContentHash',
              'visualDirectionPosition',
              'contentHash',
            ] as const
          ).some((key) => acquired[key] !== asset[key])
        )
          throw new CampaignError('MEDIA_PROCESSING_RIGHTS_REQUIRED');
        let ancestor = asset;
        const seen = new Set<string>();
        while (ancestor.mediaAssetId !== acquired.mediaAssetId) {
          if (
            !ancestor.supersedesMediaAssetId ||
            seen.has(ancestor.mediaAssetId)
          )
            throw new CampaignError('CAMPAIGN_MEDIA_RIGHTS_MISMATCH');
          seen.add(ancestor.mediaAssetId);
          const prior = this.production?.media.get(
            ancestor.supersedesMediaAssetId,
          );
          if (!prior) throw new CampaignError('CAMPAIGN_MEDIA_RIGHTS_MISMATCH');
          ancestor = prior;
        }
      }
    }
    return asset;
  }
  private sceneIds(
    r: Record<string, unknown>,
    script: Record<string, unknown>,
    runId: string,
  ): string[] {
    if (r.sceneMediaAssetIds) return r.sceneMediaAssetIds as string[];
    const assets = [] as NonNullable<
      ReturnType<
        NonNullable<NonNullable<typeof this.production>['media']['listScript']>
      >
    >;
    let version: Record<string, any> | null = script;
    const seen = new Set<string>();
    while (version && !seen.has(version.scriptId) && seen.size < 100) {
      seen.add(version.scriptId);
      assets.push(
        ...(this.production?.media.listScript?.(version.scriptId) ?? []),
      );
      version = version.supersedesScriptId
        ? this.content.getScript(version.supersedesScriptId)
        : null;
    }
    const superseded = new Set(
      assets.map((asset) => asset.supersedesMediaAssetId),
    );
    return (script.visualDirections as { position: number }[]).map(
      ({ position }) => {
        const candidates = assets.filter(
          (asset) =>
            asset.assetType === 'VIDEO' &&
            asset.pipelineRunId === runId &&
            visualScriptMatches(
              script,
              asset.scriptId,
              asset.scriptContentHash,
              (id) => this.content.getScript(id),
            ) &&
            asset.projectId === script.projectId &&
            asset.projectVersion === script.projectVersion &&
            asset.visualDirectionPosition === position &&
            !superseded.has(asset.mediaAssetId),
        );
        if (candidates.length !== 1)
          throw new CampaignError(
            candidates.length
              ? 'MEDIA_SELECTION_REQUIRED'
              : 'REAL_VIDEO_MEDIA_REQUIRED',
          );
        return candidates[0].mediaAssetId;
      },
    );
  }
  private automaticComposition(
    e: CampaignExecution,
    r: Record<string, unknown>,
    done: Record<string, unknown>,
    script: Record<string, unknown>,
  ) {
    if (!r.videoProduction || !this.media.registerCompositionPlan)
      throw new CampaignError('COMPOSITION_REQUIRED');
    const audio = document(done.AUDIO);
    const voice = this.local.authorizedAudio(
      e.run_id,
      String(script.scriptId),
      String(script.contentHash),
      String(audio.voiceTrackId),
    );
    if (!voice) throw new CampaignError('AUDIO_REQUIRED');
    if (
      audio.voiceTrackContentHash &&
      audio.voiceTrackContentHash !== voice.contentHash
    )
      throw new CampaignError('CAMPAIGN_AUDIO_MISMATCH');
    const reports = document(done.MEDIA_QC).reports as {
      identity: { mediaAssetId: string; contentHash: string };
    }[];
    const images = document(r.videoProduction).mode === 'LOCAL_IMAGES';
    const assets = reports.map(({ identity }) => {
      if (images) {
        const asset = this.prepareImage(e, r, script);
        if (
          asset.mediaAssetId !== identity.mediaAssetId ||
          asset.contentHash !== identity.contentHash
        )
          throw new CampaignError('CAMPAIGN_SCENE_MEDIA_MISMATCH');
        return asset;
      }
      this.compositionRights(
        this.production?.media.get(identity.mediaAssetId) ?? null,
        e,
        done,
      );
      const asset = this.requireSceneMedia(
        identity.mediaAssetId,
        script,
        e.run_id,
        Number(
          this.production?.media.get(identity.mediaAssetId)
            ?.visualDirectionPosition,
        ),
        e.campaign_id,
      );
      if (asset.contentHash !== identity.contentHash)
        throw new CampaignError('CAMPAIGN_SCENE_MEDIA_MISMATCH');
      this.compositionRights(asset, e, done);
      if (
        asset.schemaVersion !== 'media-asset/2.0.0' ||
        asset.technicalProperties.mimeType !== 'video/mp4'
      )
        throw new CampaignError('COMPOSITION_MEDIA_PROFILE_REQUIRED');
      return asset;
    });
    const durations = assets.map((a) =>
      images
        ? voice.durationMilliseconds
        : Number(a.technicalProperties.durationMilliseconds),
    );
    const total = durations.reduce((sum, value) => sum + value, 0);
    if (
      !assets.length ||
      durations.some((d) => !Number.isSafeInteger(d) || d < 1) ||
      voice.durationMilliseconds > total ||
      voice.durationMilliseconds < assets.length
    )
      throw new CampaignError('AUDIO_VIDEO_DURATION_REQUIRED');
    let cursor = 0,
      sourceCursor = 0;
    const segments = assets.map((asset, index) => {
      sourceCursor += durations[index];
      const end =
        index === assets.length - 1
          ? voice.durationMilliseconds
          : Math.floor((voice.durationMilliseconds * sourceCursor) / total);
      if (end <= cursor || end - cursor > durations[index])
        throw new CampaignError('AUDIO_VIDEO_DURATION_REQUIRED');
      const segment = {
        position: index + 1,
        visualDirectionPosition: asset.visualDirectionPosition,
        mediaAssetId: asset.mediaAssetId,
        mediaAssetContentHash: asset.contentHash,
        startMilliseconds: cursor,
        endMilliseconds: end,
        mediaType: images ? 'IMAGE' : 'VIDEO',
        sourceStartMilliseconds: 0,
        playbackMode: 'TRIM',
        originalAudioMuted: true,
        framingStrategy: PRODUCT_FRAMING_STRATEGY,
        movementRequirement: images ? 'STATIC_ALLOWED' : 'REAL_MOTION_REQUIRED',
        transition: {
          policyVersion: 'composition-transition/1.0.0',
          type: 'CUT',
          durationMilliseconds: 0,
        },
      };
      cursor = end;
      return segment;
    });
    const revision = done.COMPOSITION_REVISION
      ? document(done.COMPOSITION_REVISION)
      : null;
    const key = adaptationHash({
      executionId: e.execution_id,
      scriptHash: script.contentHash,
      voice,
      segments,
      revision: revision?.revision ?? 1,
    });
    const plan = {
      schemaVersion: 'composition-plan/2.0.0',
      compositionPlanId: `plan_auto:${key}`,
      pipelineRunId: e.run_id,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      voiceTrackId: voice.voiceTrackId,
      voiceTrackContentHash: voice.contentHash,
      outputAspectRatio: '9:16',
      timelineUnit: 'MILLISECOND',
      continuityMode: 'CONTIGUOUS',
      durationMilliseconds: voice.durationMilliseconds,
      segments,
      createdAt: revision?.requestedAt ?? e.scheduled_at,
      revision: revision?.revision ?? 1,
      supersedesCompositionPlanId: revision?.previousCompositionPlanId ?? null,
      productionProfile: 'MIXED_MEDIA_V2',
      compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
      contentHash: '',
    };
    plan.contentHash = compositionPlanContentHash(plan);
    this.media.registerCompositionPlan(plan);
    const request = {
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: `compose_auto:${key}`,
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
      containerFormat: 'mp4',
      widthPixels: 1080,
      heightPixels: 1920,
      requestedAt: revision?.requestedAt ?? e.scheduled_at,
      contentHash: '',
    };
    request.contentHash = videoCompositionRequestHash(request);
    return { request, plan };
  }
  compositionPlan(id: string) {
    return this.media.getCompositionPlan(id);
  }
  private prepareImage(
    e: CampaignExecution,
    r: Record<string, unknown>,
    script: Record<string, unknown>,
  ) {
    const brief = this.binding.resolveRunBriefing(
      e.run_id,
      String(r.briefingId),
    );
    const source = r.localImage as LocalImageSource;
    if (
      !brief ||
      brief.campaignId !== e.campaign_id ||
      !brief.mediaRefs.includes(source.mediaReference)
    )
      throw new CampaignError('CAMPAIGN_SCENE_MEDIA_MISMATCH');
    return this.local.prepareImage(
      {
        pipelineRunId: e.run_id,
        scriptId: String(script.scriptId),
        scriptContentHash: String(script.contentHash),
        createdAt: e.scheduled_at,
      },
      source,
    );
  }
  private compositionRights(
    asset: ReturnType<MediaService['get']>,
    e: CampaignExecution,
    done: Record<string, unknown>,
  ) {
    if (
      asset?.rights.evidence?.some(
        (evidence) =>
          evidence.mediaAuthorization?.campaignId !== undefined ||
          evidence.mediaAuthorization?.operationScope !== undefined,
      )
    )
      assertCompositionGrant(e, done);
  }
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
  async localRequest(value: unknown) {
    const input = document(value);
    if (
      Object.keys(input).sort().join(',') !==
        'campaignId,campaignRevision,localImage,projectVersion,requestId,requestedAt' ||
      !Number.isSafeInteger(input.projectVersion) ||
      Number(input.projectVersion) < 1
    )
      throw new CampaignError('INVALID_CAMPAIGN_REQUEST');
    const requestId = identifier(input.requestId),
      at = instant(input.requestedAt);
    const campaign = await this.affiliate.getCampaign(
      identifier(input.campaignId),
      Number(input.campaignRevision),
    );
    if (!campaign || !this.affiliate.createBriefing)
      throw new CampaignError('CAMPAIGN_CONTEXT_NOT_FOUND');
    const key = adaptationHash({
      campaignId: campaign.campaignId,
      requestId,
    }).slice(0, 32);
    const briefingId = `brief_${key}`,
      runId = `run_${key}`;
    await this.affiliate.createBriefing({
      idempotencyKey: `brief_${key}`,
      briefingId,
      campaignId: campaign.campaignId,
      campaignRevision: campaign.revision,
    });
    return campaignRequest({
      campaignId: campaign.campaignId,
      campaignRevision: campaign.revision,
      scheduledAt: at,
      runId,
      briefingId,
      generationRequestId: `editorial_${key}`,
      researchShortlistId: null,
      mode: 'LOCAL_VALIDATION',
      videoProduction: { mode: 'LOCAL_IMAGES' },
      localImage: input.localImage,
      run: {
        schemaVersion: 'pipeline-handoff/1.0.0',
        pipelineRunId: runId,
        projectId: campaign.projectId,
        projectVersion: input.projectVersion,
        startedAt: at,
      },
    });
  }
  async result(
    e: CampaignExecution,
    r: Record<string, unknown>,
    done: Record<string, unknown>,
  ) {
    const briefing = await this.affiliate.getBriefing(String(r.briefingId));
    const script = done.EDITORIAL
      ? document(document(done.EDITORIAL).script)
      : null;
    const localPackage =
      r.videoProduction && document(r.videoProduction).mode === 'LOCAL_IMAGES';
    return {
      executionId: e.execution_id,
      status: e.status,
      preview: done.PREVIEW ?? null,
      script: done.EDITORIAL ? document(done.EDITORIAL).script : null,
      subtitles: done.SUBTITLES ?? null,
      qc: done.QC ?? null,
      caption:
        localPackage && script
          ? {
              text: script.fullNarration,
              source: 'VALIDATED_EDITORIAL_SCRIPT',
              scriptContentHash: script.contentHash,
              humanReview: 'REQUIRED',
            }
          : (this.captioning?.history(e.execution_id).at(-1) ?? null),
      cta: briefing?.cta ?? null,
      affiliateUrl: briefing?.affiliateUrl ?? null,
      format: r.localImage ? 'AUTHORIZED_STATIC_IMAGE' : 'VIDEO',
      publication:
        done.PUBLICATION ?? (r.publication ? 'REQUESTED' : 'NOT_REQUESTED'),
      cost: { status: 'UNKNOWN', amount: null },
    };
  }
  private financeGate(r: Record<string, unknown>, at: string) {
    const operationIds = r.legacyRecovery
      ? (document(r.legacyRecovery).financialOperationIds as string[])
      : [String(r.generationRequestId)];
    for (const id of operationIds) {
      const op = this.finance.getGlobalOperation(id);
      if (op?.state === 'UNKNOWN') throw new CampaignError('FINANCE_UNKNOWN');
      if (r.legacyRecovery && op?.state !== 'COMPLETED')
        throw new CampaignError('LEGACY_FINANCE_COMPLETION_REQUIRED');
    }
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
      if (!r.publication) {
        if (
          r.videoProduction &&
          document(r.videoProduction).mode === 'LOCAL_IMAGES' &&
          this.instagram?.configuration?.().mode === 'live'
        )
          throw new CampaignError('SOCIAL_PUBLICATION_REQUEST_REQUIRED');
        return { publication: 'MANUAL_HANDOFF' };
      }
      if (!this.instagram)
        throw new CampaignError('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
      const previous = await this.instagram.status?.(e.execution_id);
      const operation = previous?.operation;
      if (
        operation &&
        ([
          'UNCERTAIN',
          'CREATING_CONTAINER',
          'PUBLISHING',
          'PUBLISHED',
        ].includes(operation.state) ||
          operation.requiresReconciliation)
      ) {
        const proof = await this.instagram.reconcile(e.execution_id);
        if (proof?.verified && proof.step === 'PUBLICATION')
          return proof.result;
        const current = await this.instagram.status?.(e.execution_id);
        if (
          !proof?.verified ||
          !current?.operation ||
          !['PREPARED', 'PROCESSING', 'READY'].includes(
            current.operation.state,
          ) ||
          current.operation.requiresReconciliation
        )
          throw new CampaignError('SOCIAL_RECONCILIATION_REQUIRED');
      }
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
      if (
        r.researchShortlistId !== null &&
        (typeof r.researchShortlistId !== 'string' ||
          !this.research.getShortlist(r.researchShortlistId))
      )
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
    if (
      r.videoProduction &&
      document(r.videoProduction).mode === 'LOCAL_IMAGES' &&
      ['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC', 'AUDIO'].includes(step)
    ) {
      const asset = this.prepareImage(e, r, script);
      if (step === 'SCENES')
        return {
          mode: 'LOCAL_IMAGES',
          mediaAssetId: asset.mediaAssetId,
          contentHash: asset.contentHash,
        };
      if (step === 'VIDEO_GENERATION')
        return {
          mode: 'LOCAL_IMAGES',
          generation: 'NOT_REQUESTED',
          materialization: 'AUTHORIZED_IMAGE',
        };
      if (step === 'MEDIA_QC')
        return {
          mode: 'LOCAL_IMAGES',
          reports: [
            {
              identity: {
                mediaAssetId: asset.mediaAssetId,
                contentHash: asset.contentHash,
              },
              result: 'PASS',
              checks: [
                'PHYSICAL_SHA256',
                'PNG_DECODE',
                'PROCESSING_RIGHTS',
                'SCRIPT_BINDING',
              ],
              motion: 'NOT_APPLICABLE',
              humanReview: 'PENDING_FINAL_PREVIEW',
            },
          ],
        };
      if (!done.MEDIA_QC) throw new CampaignError('MEDIA_QC_REQUIRED');
      const run = this.operations.get(e.run_id);
      const durationMs = run.projectSnapshot.channel.minDurationSeconds * 1000;
      const voice = await this.local.automaticAudio(
        {
          pipelineRunId: e.run_id,
          scriptId: String(script.scriptId),
          scriptContentHash: String(script.contentHash),
          createdAt: e.scheduled_at,
        },
        durationMs,
      );
      return {
        voiceTrackId: voice.voiceTrackId,
        voiceTrackContentHash: voice.contentHash,
        durationMilliseconds: voice.durationMilliseconds,
        cost: { status: 'UNKNOWN', amount: null },
      };
    }
    if (r.legacyRecovery && step === 'MEDIA_QC') {
      const verified = await this.recoverLegacy({
        campaignId: e.campaign_id,
        runId: e.run_id,
        media: document(r.legacyRecovery).media,
      });
      if (
        document(document(verified.legacyRecovery).script).contentHash !==
        script.contentHash
      )
        throw new CampaignError('LEGACY_SCRIPT_MISMATCH');
    }
    if (['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC'].includes(step)) {
      if (!r.videoProduction) return { status: 'NOT_REQUESTED' };
      if (!this.production)
        throw new CampaignError('VIDEO_PRODUCTION_CONFIGURATION_REQUIRED');
      if (
        r.mode !== 'LOCAL_VALIDATION' ||
        !['OFFLINE', 'ASSISTED_LOCAL'].includes(
          String(document(r.videoProduction).mode),
        )
      )
        throw new CampaignError('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
      if (step === 'SCENES') {
        // Re-read immutable Content/Affiliate revisions through the existing service.
        const directions = script.visualDirections as { position: number }[];
        const assisted = document(r.videoProduction).mode === 'ASSISTED_LOCAL';
        const ids = assisted
          ? this.sceneIds(r, script, e.run_id)
          : (r.sceneMediaAssetIds as string[] | undefined);
        if (assisted && (!ids?.length || ids.length !== directions.length))
          throw new CampaignError('REAL_VIDEO_MEDIA_REQUIRED');
        const selected = assisted
          ? directions.map((direction, index) =>
              this.requireSceneMedia(
                ids![index],
                script,
                e.run_id,
                direction.position,
                e.campaign_id,
              ),
            )
          : [];
        return this.production.preparations.prepare({
          scriptId: script.scriptId,
          scriptContentHash: script.contentHash,
          scriptRevision: script.revision,
          scenes: directions.map((direction, index) => ({
            visualDirectionPosition: direction.position,
            sceneMediaType:
              assisted && selected[index].origin !== 'PROVIDER_GENERATED'
                ? 'RECORDED_VIDEO'
                : 'GENERATED_VIDEO',
            movementRequirement: 'REAL_MOTION_REQUIRED',
          })),
        });
      }
      const preparation = done.SCENES as VideoProductionPreparationV1;
      if (step === 'VIDEO_GENERATION') {
        if (document(r.videoProduction).mode === 'ASSISTED_LOCAL')
          return {
            mode: 'ASSISTED_LOCAL',
            generation: 'NOT_REQUESTED',
            materialization: 'EXISTING_AUTHORIZED_MEDIA',
            compositionReady: false,
            preparationHash: preparation.contentHash,
          };

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
      // Recovered scene metadata is context, not a fabricated preparation artifact.
      const qcScenes = r.legacyRecovery
        ? (script.visualDirections as { position: number }[]).map(
            (direction, i) => ({
              position: direction.position,
              sceneMediaType:
                this.production!.media.get(
                  (r.sceneMediaAssetIds as string[])[i],
                )!.origin === 'PROVIDER_GENERATED'
                  ? 'GENERATED_VIDEO'
                  : 'RECORDED_VIDEO',
            }),
          )
        : preparation.scenes;
      const ids = this.sceneIds(r, script, e.run_id);
      if (!ids?.length || ids.length !== qcScenes.length)
        throw new CampaignError('REAL_VIDEO_MEDIA_REQUIRED');
      const reports = [];
      for (let i = 0; i < ids.length; i++) {
        const asset = this.requireSceneMedia(
          ids[i],
          script,
          e.run_id,
          qcScenes[i].position,
          e.campaign_id,
        );
        if (
          document(r.videoProduction).mode === 'ASSISTED_LOCAL' &&
          qcScenes[i].sceneMediaType !==
            (asset.origin === 'PROVIDER_GENERATED'
              ? 'GENERATED_VIDEO'
              : 'RECORDED_VIDEO')
        )
          throw new CampaignError('CAMPAIGN_SCENE_MEDIA_MISMATCH');
        let observed: unknown;
        try {
          observed = await this.production.media.evaluateTemporalMedia(
            asset.mediaAssetId,
          );
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : '';
          if (
            /^(HUMAN_APPROVAL_REVIEW_(INVALID|STALE)|AUTHENTICATED_HUMAN_REVIEW_REQUIRED)$/.test(
              code,
            )
          )
            throw new CampaignError('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
          throw error;
        }
        const report = validateTemporalReport(observed, {
          mediaAssetId: asset.mediaAssetId,
          mediaReference: asset.mediaReference,
          contentHash: asset.contentHash,
          scriptContentHash: asset.scriptContentHash,
          visualDirectionPosition: asset.visualDirectionPosition,
        });
        reports.push(report);
      }
      if (
        reports.some(
          (report) =>
            report.evidence.provenance?.parameters.humanReview?.decision ===
            'REJECTED',
        )
      )
        throw new CampaignError('MEDIA_REVIEW_REJECTED');
      if (reports.some((report) => report.result === 'FAIL'))
        throw new CampaignError('MEDIA_QC_FAILED');
      if (reports.some((report) => report.result !== 'PASS'))
        throw new CampaignError('COMPLETE_TEMPORAL_QC_REQUIRED');
      return { preparationHash: preparation?.contentHash ?? null, reports };
    }
    if (step === 'AUDIO') {
      if (!r.voiceTrackId) {
        if (!r.videoProduction) throw new CampaignError('AUDIO_REQUIRED');
        let voice = this.local.authorizedAudio(
          e.run_id,
          String(script.scriptId),
          String(script.contentHash),
          undefined,
          r.audioMode === 'RECORDING' ? 'RECORDING' : undefined,
        );
        if (!voice && r.audioMode !== 'RECORDING') {
          if (!done.MEDIA_QC)
            throw new CampaignError('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
          const ids = this.sceneIds(r, script, e.run_id);
          const durations = ids.map((id, index) => {
            const asset = this.requireSceneMedia(
              id,
              script,
              e.run_id,
              (script.visualDirections as { position: number }[])[index]
                .position,
              e.campaign_id,
            );
            const review = this.production?.media.temporalReview?.(id) as {
              result?: string;
              evidence?: {
                provenance?: {
                  parameters?: { humanReview?: { decision?: string } };
                };
              };
            } | null;
            if (
              review?.result !== 'PASS' ||
              review.evidence?.provenance?.parameters?.humanReview?.decision !==
                'APPROVED'
            )
              throw new CampaignError('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
            return Number(asset.technicalProperties.durationMilliseconds);
          });
          if (
            !durations.length ||
            durations.some((d) => !Number.isSafeInteger(d) || d < 1)
          )
            throw new CampaignError('AUDIO_VIDEO_DURATION_REQUIRED');
          voice = await this.local.automaticAudio(
            {
              pipelineRunId: e.run_id,
              scriptId: String(script.scriptId),
              scriptContentHash: String(script.contentHash),
              createdAt: e.scheduled_at,
            },
            durations.reduce((a, b) => a + b, 0),
          );
        }
        if (!voice) throw new CampaignError('AUDIO_REQUIRED');
        return {
          voiceTrackId: voice.voiceTrackId,
          voiceTrackContentHash: voice.contentHash,
          durationMilliseconds: voice.durationMilliseconds,
          cost: { status: 'UNKNOWN', amount: null },
        };
      }
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
      if (r.videoProduction) {
        const voice = this.local.authorizedAudio(
          e.run_id,
          String(script.scriptId),
          String(script.contentHash),
          String(r.voiceTrackId),
          r.audioMode === 'RECORDING' ? 'RECORDING' : undefined,
        );
        if (!voice) throw new CampaignError('AUDIO_REQUIRED');
        return {
          voiceTrackId: voice.voiceTrackId,
          voiceTrackContentHash: voice.contentHash,
          durationMilliseconds: voice.durationMilliseconds,
          cost: { status: 'UNKNOWN', amount: null },
        };
      }
      return {
        voiceTrackId: r.voiceTrackId,
        cost: { status: 'UNKNOWN', amount: null },
      };
    }
    if (step === 'ALIGNMENT') {
      const voiceTrackId = done.AUDIO
        ? document(done.AUDIO).voiceTrackId
        : r.voiceTrackId;
      const result = document(
        r.alignment
          ? await this.local.acceptAlignment(r.alignment)
          : await this.local.alignAudio(String(voiceTrackId)),
      );
      const input = document(result.input);
      if (
        input.scriptId !== script.scriptId ||
        input.audioAssetId !== voiceTrackId
      )
        throw new CampaignError('CAMPAIGN_ALIGNMENT_MISMATCH');
      return result;
    }
    if (step === 'SUBTITLES')
      return this.local.subtitles(
        String(document(document(done.ALIGNMENT).output).alignmentId),
      );
    if (step === 'COMPOSITION') {
      const automatic = !r.composition
        ? this.automaticComposition(e, r, done, script)
        : null;
      const request = automatic?.request ?? document(r.composition),
        plan =
          automatic?.plan ??
          this.media.getCompositionPlan(String(request.compositionPlanId));
      if (!plan) throw new CampaignError('COMPOSITION_PLAN_REQUIRED');
      if (
        document(plan).pipelineRunId !== e.run_id ||
        document(plan).scriptId !== script.scriptId ||
        document(plan).voiceTrackId !==
          (done.AUDIO ? document(done.AUDIO).voiceTrackId : r.voiceTrackId)
      )
        throw new CampaignError('CAMPAIGN_COMPOSITION_MISMATCH');
      if (r.videoProduction) {
        const images = document(r.videoProduction).mode === 'LOCAL_IMAGES';
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
              (images
                ? segment.mediaType !== 'IMAGE' ||
                  segment.movementRequirement !== 'STATIC_ALLOWED'
                : segment.movementRequirement !== 'REAL_MOTION_REQUIRED') ||
              !reports.some(
                (report) =>
                  report.identity.mediaAssetId === segment.mediaAssetId &&
                  report.identity.contentHash === segment.mediaAssetContentHash,
              ),
          )
        )
          throw new CampaignError('MOTION_COMPOSITION_V2_REQUIRED');
        for (const segment of segments)
          this.compositionRights(
            this.production?.media.get(String(segment.mediaAssetId)) ?? null,
            e,
            done,
          );
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
      // A local video package has no Instagram publication operation. Its caption
      // is the already validated editorial text; publication retains its own gates.
      if (
        this.captioning &&
        !(
          r.videoProduction &&
          document(r.videoProduction).mode === 'LOCAL_IMAGES'
        )
      )
        await this.captioning.ensure(
          e.execution_id,
          await this.captionContext(e, r, { ...done, QC: report }),
        );
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
  async readyToResume(e: CampaignExecution, history: CampaignEvent[]) {
    const paused = history.filter((h) => h.event_type === 'PAUSED').at(-1);
    const r = executionRequest(history);
    if (!r.videoProduction || r.mode !== 'LOCAL_VALIDATION' || r.publication)
      return false;
    const done = completedContext(history);
    if (!done.EDITORIAL) return false;
    const script = document(document(done.EDITORIAL).script);
    try {
      const revision = history
        .filter((h) => h.event_type === 'SCRIPT_REVISED')
        .at(-1);
      if (
        (revision && (!paused || revision.sequence > paused.sequence)) ||
        (paused?.evidence.step === 'AUDIO' &&
          [
            'AUDIO_REQUIRED',
            'LOCAL_TTS_CONFIGURATION_REQUIRED',
            'LOCAL_TTS_LICENSE_REQUIRED',
            'ALIGNMENT_CONFIGURATION_REQUIRED',
          ].includes(String(paused.evidence.code)))
      )
        return (
          this.local.authorizedAudio(
            e.run_id,
            String(script.scriptId),
            String(script.contentHash),
            r.voiceTrackId ? String(r.voiceTrackId) : undefined,
            r.audioMode === 'RECORDING' ? 'RECORDING' : undefined,
          ) !== null ||
          (r.audioMode !== 'RECORDING' && this.local.automaticAudioReady())
        );
      if (
        ['MEDIA_QC', 'SCENES'].includes(String(paused?.evidence.step)) &&
        [
          'REAL_VIDEO_MEDIA_REQUIRED',
          'AUTHENTICATED_MEDIA_REVIEW_REQUIRED',
          'COMPLETE_TEMPORAL_QC_REQUIRED',
        ].includes(String(paused?.evidence.code))
      ) {
        const ids = this.sceneIds(r, script, e.run_id);
        for (let i = 0; i < ids.length; i++)
          this.requireSceneMedia(
            ids[i],
            script,
            e.run_id,
            (script.visualDirections as { position: number }[])[i].position,
            e.campaign_id,
          );
        if (paused?.evidence.code === 'REAL_VIDEO_MEDIA_REQUIRED') return true;
        const reports = ids.map(
          (id) =>
            this.production?.media.temporalReview?.(id) as {
              result?: string;
            } | null,
        );
        return (
          reports.some((report) => report?.result === 'FAIL') ||
          reports.every((report) => report?.result === 'PASS')
        );
      }
      return false;
    } catch (error) {
      // A changed/revoked artifact must not release a wait. The stored pause remains authoritative.
      if (error && typeof error === 'object' && 'code' in error) return false;
      throw error;
    }
  }
  async reconcile(e: CampaignExecution, history: CampaignEvent[]) {
    const publication = history
      .filter((h) => h.event_type === 'STEP_STARTED')
      .at(-1);
    if (publication?.evidence.step === 'PUBLICATION' && this.instagram) {
      const proof = await this.instagram.reconcile(e.execution_id);
      if (proof?.verified) return proof;
      const status = await this.instagram.status?.(e.execution_id);
      const op = status?.operation;
      const request = executionRequest(history);
      const handoff = completedContext(history).HANDOFF as
        Record<string, unknown> | undefined;
      if (
        e.status === 'WAITING_RECONCILIATION' &&
        this.instagram.configuration?.().mode === 'live' &&
        op?.state === 'UNCERTAIN' &&
        op.executionMode === 'live' &&
        op.publicationFlowVersion === 2 &&
        op.uncertainStage === 'UPLOAD' &&
        op.providerStatus === 'FINISHED' &&
        op.uploadStage === 'UPLOADING' &&
        op.containerId &&
        !op.mediaId &&
        request.publication &&
        op.packageHash === document(request.publication).packageHash &&
        op.accountId === document(request.publication).accountId &&
        op.mediaHash === handoff?.contentHash
      )
        return {
          verified: true,
          reason: 'META_CONTAINER_FINISHED',
          operationId: op.operationId,
          containerId: op.containerId,
          providerStatus: 'FINISHED',
        };
      return null;
    }
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
    const completed = completedContext(history);
    if (
      ['AUDIO', 'ALIGNMENT', 'SUBTITLES', 'QC', 'PREVIEW'].includes(
        String(last.evidence.step),
      )
    ) {
      // These local operations persist immutable evidence and use stable artifact identities.
      // Re-enter through the ordinary gates; never treat an absent requirement as success.
      try {
        const result = await this.execute(
          String(last.evidence.step),
          e,
          request,
          completed,
        );
        return { verified: true, step: last.evidence.step, result };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return null;
        throw error;
      }
    }
    if (
      request.videoProduction &&
      request.mode === 'LOCAL_VALIDATION' &&
      ['OFFLINE', 'ASSISTED_LOCAL', 'LOCAL_IMAGES'].includes(
        String(document(request.videoProduction).mode),
      ) &&
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
    if (last.evidence.step === 'COMPOSITION') {
      let composition: Record<string, unknown>;
      try {
        composition = request.composition
          ? document(request.composition)
          : this.automaticComposition(
              e,
              request,
              completed,
              document(document(completed.EDITORIAL).script),
            ).request;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return null;
        throw error;
      }
      const receipt = this.media.compositionReceipt(
        String(composition.videoCompositionRequestId),
      );
      if (!receipt && !request.composition)
        return { verified: true, reason: 'LOCAL_COMPOSITION_REPLAY_SAFE' };
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
      if (!render && request.videoProduction)
        return { verified: true, reason: 'LOCAL_BURN_REPLAY_SAFE' };
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
