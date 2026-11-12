import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import type { LocalFlowService } from './local-flow.service.js';
import type { MediaService } from './media.service.js';
import { validateAlignment } from '../domain/alignment-contracts.js';
import { adaptationHash } from '../domain/media-hash.js';
import { validateCompositionPlan } from '../domain/composition-plan-contracts.js';
import { validateVideoCompositionRequest } from '../domain/video-composition-contracts.js';
import { validateVideoRender } from '../domain/video-render-contracts.js';
export interface LocalVideoPilotInput {
  schemaVersion: 'local-video-pilot/1';
  pipelineRunId: string;
  scriptId: string;
  scriptHash: string;
  scriptRevision: number;
  audio: {
    voiceTrackId: string;
    contentHash: string;
    durationMilliseconds: number;
  };
  plan: unknown;
  compositionRequest: unknown;
}
/** No journal or campaign workflow: replay is owned by the existing Media receipts. */
export class LocalVideoPilot {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly flow: LocalFlowService,
    private readonly media: MediaService,
  ) {}
  run(input: LocalVideoPilotInput): Promise<any> {
    const key = adaptationHash(input);
    const prior = this.pending.get(key);
    if (prior) return prior;
    const operation = this.execute(input).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, operation);
    return operation;
  }
  private async execute(input: LocalVideoPilotInput) {
    const fail = (code: string): never => {
      throw Object.assign(new Error(code), { code });
    };
    if (
      input.schemaVersion !== 'local-video-pilot/1' ||
      !Number.isSafeInteger(input.scriptRevision) ||
      input.scriptRevision < 1
    )
      fail('LOCAL_PILOT_CONTEXT_REQUIRED');
    const plan = validateCompositionPlan(input.plan),
      request = validateVideoCompositionRequest(input.compositionRequest);
    const stored = this.media.getCompositionPlan(plan.compositionPlanId);
    if (
      adaptationHash(stored) !== adaptationHash(plan) ||
      plan.pipelineRunId !== input.pipelineRunId ||
      plan.scriptId !== input.scriptId ||
      plan.scriptContentHash !== input.scriptHash ||
      plan.voiceTrackId !== input.audio.voiceTrackId ||
      plan.voiceTrackContentHash !== input.audio.contentHash ||
      plan.durationMilliseconds !== input.audio.durationMilliseconds ||
      request.compositionPlanId !== plan.compositionPlanId ||
      request.compositionPlanContentHash !== plan.contentHash
    )
      fail('LOCAL_PILOT_BINDING_MISMATCH');
    for (const segment of plan.segments) {
      const asset = this.media.get(segment.mediaAssetId);
      if (
        !asset ||
        asset.contentHash !== segment.mediaAssetContentHash ||
        asset.pipelineRunId !== input.pipelineRunId ||
        !asset.rights.commercialUseAllowed
      )
        return fail('LOCAL_PILOT_BINDING_MISMATCH');
      assertMediaProcessingRights(
        asset.rights.evidence,
        { mediaRef: asset.mediaReference, contentHash: asset.contentHash },
        null,
      );
    }
    const audio = this.flow.authorizedAudio(
      input.pipelineRunId,
      input.scriptId,
      input.scriptHash,
      input.audio.voiceTrackId,
    );
    if (!audio || adaptationHash(audio) !== adaptationHash(input.audio))
      return fail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
    const aligned = validateAlignment(
      await this.flow.alignAudio(audio.voiceTrackId),
    );
    if (
      aligned.input.audioAssetId !== audio.voiceTrackId ||
      aligned.input.durationMs !== audio.durationMilliseconds ||
      aligned.input.scriptId !== input.scriptId ||
      aligned.input.scriptVersion !== input.scriptRevision ||
      aligned.input.audioSha256 !== audio.contentHash
    )
      fail('ALIGNMENT_BINDING_MISMATCH');
    const subtitles = this.flow.subtitles(aligned.output.alignmentId) as {
      subtitleId: string;
      scriptContentHash: string;
      voiceTrackId: string;
    };
    if (
      subtitles.scriptContentHash !== input.scriptHash ||
      subtitles.voiceTrackId !== audio.voiceTrackId
    )
      fail('LOCAL_SUBTITLE_BINDING_INVALID');
    const source = validateVideoRender(await this.flow.compose(request));
    if (
      source.pipelineRunId !== input.pipelineRunId ||
      source.compositionPlanId !== plan.compositionPlanId ||
      source.compositionPlanContentHash !== plan.contentHash
    )
      return fail('LOCAL_PILOT_BINDING_MISMATCH');
    const render = validateVideoRender(
      await this.flow.burn(source.videoRenderId, subtitles.subtitleId),
    );
    const qc = await this.flow.ensureQcHandoffEvidence(render.videoRenderId);
    if (!qc) return fail('QC_TIMESTAMP_REQUIRED');
    const handoff = this.media.handoff(
      {
        videoRenderId: render.videoRenderId,
        pipelineRunId: input.pipelineRunId,
        scriptId: input.scriptId,
        scriptContentHash: input.scriptHash,
        renderRevision: render.revision,
        renderContentHash: render.contentHash,
        qualityControlReportId: qc.reportId,
        compositionRequestId: request.videoCompositionRequestId,
      },
      this.flow,
    );
    if (handoff.status !== 'READY_TECHNICAL')
      fail(handoff.blockers[0] ?? 'LOCAL_PILOT_NOT_READY');
    return {
      schemaVersion: 'local-video-pilot-result/1',
      executionIdentity: request.videoCompositionRequestId,
      alignmentId: aligned.output.alignmentId,
      alignmentProvider: aligned.output.provider,
      alignmentProvenance: aligned.provenance,
      subtitleId: subtitles.subtitleId,
      render,
      handoff,
      qcPolicy: 'local-qc/1',
      humanApproval: 'PENDING',
      publicationAuthorized: false,
    };
  }
}
