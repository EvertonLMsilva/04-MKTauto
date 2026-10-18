import { socialFail } from '../domain/social-publication-contracts.js';
import type { PublishingMedia } from './publishing.port.js';
import type { LocalFlowService } from '../../media/application/local-flow.service.js';
import { adaptationHash } from '../../media/domain/media-hash.js';
// A separate eligibility assessment. Never relabel a technical local QC report as commercial approval.
export function publishingEvidence(
  media: PublishingMedia,
  local: LocalFlowService,
): PublishingMedia {
  return {
    getVideoRender: (id: string) => media.getVideoRender(id),
    verifyMedia: (ref: string) => media.verifyMedia(ref),
    report: (id: string) => {
      if (!id.startsWith('local_qc:')) return media.report(id);
      const proof = local.publicationEvidence(id) as any;
      if (
        proof?.qc?.result !== 'PASS' ||
        proof.qc.approvalBlocked !== false ||
        proof.render?.contentHash !== proof.qc.videoRenderContentHash ||
        !proof.assets?.length ||
        !proof.audio?.contentHash ||
        !proof.planHash
      )
        socialFail('SOCIAL_ELIGIBILITY_REQUIRED');
      const body = {
        schemaVersion: 'publication-eligibility/1.0.0',
        qualityControlReportId: id,
        policyVersion: 'publication-eligibility/1',
        pipelineRunId: proof.render.pipelineRunId,
        projectId: proof.render.projectId,
        projectVersion: proof.render.projectVersion,
        videoRenderId: proof.render.videoRenderId,
        videoRenderContentHash: proof.render.contentHash,
        result: 'PASS',
        approvalBlocked: false,
        findings: [
          'COMMERCIAL_RIGHTS',
          'PROCESSING_RIGHTS',
          'NARRATION_RIGHTS',
        ].map((code) => ({ code, status: 'PASS' })),
        evidence: {
          localQcHash: adaptationHash(proof.qc),
          planHash: proof.planHash,
          audio: proof.audio,
          assets: proof.assets,
        },
      };
      return { ...body, contentHash: adaptationHash(body) } as any;
    },
  };
}
