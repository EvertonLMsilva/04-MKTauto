import {
  validateVideoRender,
  videoRenderIdentityHash,
} from '../domain/video-render-contracts.js';
import { validateCompositionPlan } from '../domain/composition-plan-contracts.js';
import { validateQualityControlReport } from '../domain/quality-control-contracts.js';
import type { MediaService } from './media.service.js';

export interface MediaHandoffRequest {
  videoRenderId: string;
  pipelineRunId: string;
  scriptId: string;
  scriptContentHash: string;
  renderRevision: number;
  renderContentHash: string;
  qualityControlReportId: string;
  compositionRequestId?: string;
}
export interface MediaHandoff {
  schemaVersion: 'media-handoff/1.0.0';
  status: 'READY_TECHNICAL' | 'NOT_READY' | 'UNKNOWN';
  render: {
    id: string;
    revision: number;
    contentHash: string;
    reference: string;
    pipelineRunId: string;
  } | null;
  script: { id: string; contentHash: string } | null;
  composition: 'CONSISTENT' | 'MISSING' | 'UNVERIFIED';
  qc: 'PASS' | 'WARN' | 'FAIL' | 'MISSING' | 'UNVERIFIED';
  present: string[];
  absent: string[];
  blockers: string[];
  authorizationsGranted: false;
  references: {
    compositionPlan: { id: string; contentHash: string } | null;
    qc: { id: string; contentHash: string; policyVersion: string } | null;
    compositionReceipt: { requestId: string; requestHash: string } | null;
  };
}

/** A read-time technical observation against caller-pinned identity, never a grant. */
export function projectMediaHandoff(
  media: Pick<
    MediaService,
    | 'getVideoRender'
    | 'getCompositionPlan'
    | 'listCompositionPlansByScript'
    | 'report'
    | 'verifyMedia'
    | 'compositionReceipt'
  >,
  request: MediaHandoffRequest,
  revisions: (planId: string) => unknown[] | null,
): MediaHandoff {
  const result: MediaHandoff = {
    schemaVersion: 'media-handoff/1.0.0',
    status: 'NOT_READY',
    render: null,
    script: null,
    composition: 'UNVERIFIED',
    qc: 'UNVERIFIED',
    present: [],
    absent: [],
    blockers: [],
    authorizationsGranted: false,
    references: { compositionPlan: null, qc: null, compositionReceipt: null },
  };
  const stop = (code: string, unknown = false) => {
    result.blockers.push(code);
    result.status = unknown ? 'UNKNOWN' : 'NOT_READY';
    return result;
  };
  try {
    if (
      !request ||
      ![
        'videoRenderId',
        'pipelineRunId',
        'scriptId',
        'qualityControlReportId',
      ].every(
        (key) =>
          typeof request[key as keyof MediaHandoffRequest] === 'string' &&
          /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,199}$/.test(
            String(request[key as keyof MediaHandoffRequest]),
          ),
      ) ||
      !/^[a-f0-9]{64}$/.test(request.scriptContentHash) ||
      !/^[a-f0-9]{64}$/.test(request.renderContentHash) ||
      !Number.isSafeInteger(request.renderRevision) ||
      request.renderRevision < 1
    )
      return stop('HANDOFF_CONTEXT_REQUIRED');
    const stored = media.getVideoRender(request.videoRenderId);
    if (!stored) {
      result.absent.push('RENDER');
      return stop('RENDER_NOT_FOUND');
    }
    const render = validateVideoRender(stored);
    if (
      render.videoRenderId !== request.videoRenderId ||
      render.pipelineRunId !== request.pipelineRunId ||
      render.contentHash !== request.renderContentHash ||
      render.revision !== request.renderRevision
    )
      return stop('RENDER_IDENTITY_MISMATCH');
    result.render = {
      id: render.videoRenderId,
      revision: render.revision,
      contentHash: render.contentHash,
      reference: render.logicalReference,
      pipelineRunId: render.pipelineRunId,
    };
    result.present.push('RENDER');
    if (render.schemaVersion !== 'video-render/1.0.0')
      return stop('COMPOSITION_LINEAGE_UNAVAILABLE', true);
    const rawPlan = media.getCompositionPlan(render.compositionPlanId);
    if (!rawPlan) {
      result.composition = 'MISSING';
      result.absent.push('COMPOSITION_PLAN');
      return stop('COMPOSITION_PLAN_MISSING');
    }
    const plan = validateCompositionPlan(rawPlan);
    if (
      plan.compositionPlanId !== render.compositionPlanId ||
      plan.contentHash !== render.compositionPlanContentHash ||
      plan.pipelineRunId !== render.pipelineRunId ||
      plan.projectId !== render.projectId ||
      plan.projectVersion !== render.projectVersion ||
      plan.outputAspectRatio !== render.outputAspectRatio ||
      plan.durationMilliseconds !== render.durationMilliseconds
    )
      return stop('COMPOSITION_MISMATCH');
    if (
      plan.scriptId !== request.scriptId ||
      plan.scriptContentHash !== request.scriptContentHash
    )
      return stop('SCRIPT_REVISION_MISMATCH');
    result.script = { id: plan.scriptId, contentHash: plan.scriptContentHash };
    result.references.compositionPlan = {
      id: plan.compositionPlanId,
      contentHash: plan.contentHash,
    };
    const plans = media
      .listCompositionPlansByScript(plan.scriptId)
      .map(validateCompositionPlan);
    if (plans.some((p) => p.revision > plan.revision))
      return stop('COMPOSITION_SUPERSEDED');
    const renders = revisions(plan.compositionPlanId);
    if (!renders) return stop('RENDER_FRESHNESS_UNAVAILABLE', true);
    if (
      renders.map(validateVideoRender).some((r) => r.revision > render.revision)
    )
      return stop('RENDER_SUPERSEDED');
    result.composition = 'CONSISTENT';
    result.present.push('COMPOSITION_PLAN', 'SCRIPT_BINDING');
    if (request.compositionRequestId) {
      const receipt = media.compositionReceipt(request.compositionRequestId);
      if (!receipt) {
        result.absent.push('COMPOSITION_RECEIPT');
        return stop('COMPOSITION_RECEIPT_MISSING');
      }
      if (!/^[a-f0-9]{64}$/.test(receipt.requestHash))
        return stop('COMPOSITION_RECEIPT_MISMATCH');
      let ancestor = render;
      const seen = new Set<string>();
      while (
        ancestor.videoRenderId !== receipt.videoRender.videoRenderId &&
        ancestor.supersedesVideoRenderId &&
        seen.size < 32
      ) {
        if (seen.has(ancestor.videoRenderId))
          return stop('COMPOSITION_RECEIPT_MISMATCH');
        seen.add(ancestor.videoRenderId);
        ancestor = validateVideoRender(
          media.getVideoRender(ancestor.supersedesVideoRenderId),
        );
        if (
          ancestor.pipelineRunId !== render.pipelineRunId ||
          ancestor.compositionPlanId !== render.compositionPlanId ||
          ancestor.compositionPlanContentHash !== plan.contentHash
        )
          return stop('COMPOSITION_RECEIPT_MISMATCH');
      }
      if (
        videoRenderIdentityHash(ancestor) !==
        videoRenderIdentityHash(validateVideoRender(receipt.videoRender))
      )
        return stop('COMPOSITION_RECEIPT_MISMATCH');
      result.present.push('COMPOSITION_RECEIPT');
      result.references.compositionReceipt = {
        requestId: request.compositionRequestId,
        requestHash: receipt.requestHash,
      };
    } else result.absent.push('OPTIONAL_COMPOSITION_RECEIPT');
    if (render.logicalReference !== `render:sha256_${render.contentHash}`)
      return stop('RENDER_REFERENCE_MISMATCH');
    if (media.verifyMedia(render.logicalReference) !== render.contentHash)
      return stop('RENDER_FILE_MISMATCH');
    result.present.push('PHYSICAL_HASH');
    const storedQc = media.report(request.qualityControlReportId);
    if (!storedQc) {
      result.qc = 'MISSING';
      result.absent.push('QC');
      return stop('QC_MISSING');
    }
    const qc = validateQualityControlReport(storedQc);
    if (
      qc.qualityControlReportId !== request.qualityControlReportId ||
      qc.videoRenderId !== render.videoRenderId ||
      qc.videoRenderContentHash !== render.contentHash ||
      qc.pipelineRunId !== render.pipelineRunId ||
      qc.projectId !== render.projectId ||
      qc.projectVersion !== render.projectVersion
    )
      return stop('QC_BINDING_MISMATCH');
    if (Date.parse(qc.checkedAt) < Date.parse(render.createdAt))
      return stop('QC_PREDATES_RENDER');
    const artifacts = qc.artifacts as
      Record<string, { id: string; contentHash: string }> | undefined;
    if (!artifacts) return stop('QC_LINEAGE_UNAVAILABLE', true);
    if (
      artifacts.compositionPlan?.id !== plan.compositionPlanId ||
      artifacts.compositionPlan?.contentHash !== plan.contentHash ||
      artifacts.script?.id !== plan.scriptId ||
      artifacts.script?.contentHash !== plan.scriptContentHash ||
      artifacts.voiceTrack?.id !== plan.voiceTrackId ||
      artifacts.voiceTrack?.contentHash !== plan.voiceTrackContentHash
    )
      return stop('QC_LINEAGE_MISMATCH');
    const mediaAssets = qc.artifacts?.mediaAssets;
    if (
      !Array.isArray(mediaAssets) ||
      plan.segments.some(
        (segment: { mediaAssetId: string; mediaAssetContentHash: string }) =>
          !mediaAssets.some(
            (asset: { id: string; contentHash: string }) =>
              asset.id === segment.mediaAssetId &&
              asset.contentHash === segment.mediaAssetContentHash,
          ),
      )
    )
      return stop('QC_LINEAGE_MISMATCH');
    result.qc = qc.result;
    result.references.qc = {
      id: qc.qualityControlReportId,
      contentHash: qc.contentHash,
      policyVersion: qc.policyVersion,
    };
    result.present.push('QC');
    if (qc.result !== 'PASS' || qc.approvalBlocked) return stop('QC_NOT_PASS');
    result.status = 'READY_TECHNICAL';
    return result;
  } catch {
    return stop('HANDOFF_EVIDENCE_UNVERIFIABLE');
  }
}
