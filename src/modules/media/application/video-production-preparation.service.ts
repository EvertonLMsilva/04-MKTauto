import type { ContentService } from '../../content/application/content.service.js';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import type { AffiliateService } from '../../affiliate/application/affiliate.service.js';
import { validateScript } from '../../content/domain/script-contracts.js';
import { validateAffiliateEditorialSelection } from '../../content/domain/affiliate-editorial-contracts.js';
import { validateAffiliateBriefing } from '../../affiliate/domain/affiliate-contracts.js';
import { validateAffiliateCampaignSource } from '../../affiliate/domain/affiliate-campaign-source.js';
import {
  buildVideoProductionPreparation,
  preparationFail,
  validateVideoPreparationRequest,
  requireGeneratedVideoScene,
} from '../domain/video-production-preparation.js';
import {
  validateMediaAcquisitionRequest,
  mediaAcquisitionRequestHash,
} from '../domain/media-acquisition-contracts.js';
import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';

// Read-only preparation. No acquisition, generation, composition or recovery writer.
export class VideoProductionPreparationService {
  constructor(
    private readonly content: Pick<
      ContentService,
      'getScript' | 'getAffiliateSelection'
    >,
    private readonly operations: Pick<
      ContentOperationsService,
      'get' | 'resolveAffiliateBriefing'
    >,
    private readonly affiliate: Pick<AffiliateService, 'resolveBriefingSource'>,
  ) {}
  // Read-only request construction. Consent and financial dispatch remain separate.
  async prepareFalRequest(
    input: unknown,
    options: {
      scenePosition: number;
      mediaAcquisitionRequestId: string;
      requestedAt: string;
      mediaRef: string;
      imageHash: string;
    },
  ) {
    const preparation = await this.prepare(input);
    const scene = requireGeneratedVideoScene(
      preparation,
      options.scenePosition,
    );
    const briefing = this.operations.resolveAffiliateBriefing(
      preparation.pipelineRunId,
      preparation.commercial.briefingId,
    );
    if (!briefing || !briefing.mediaRefs.includes(options.mediaRef))
      preparationFail('PROVIDER_IMAGE_NOT_AUTHORIZED', 'mediaRef');
    assertMediaProcessingRights(
      briefing.evidence,
      { mediaRef: options.mediaRef, contentHash: options.imageHash },
      'fal_ai',
      options.mediaAcquisitionRequestId,
    );
    const body = {
      schemaVersion: 'media-acquisition-request/1.0.0',
      mediaAcquisitionRequestId: options.mediaAcquisitionRequestId,
      scriptId: preparation.script.scriptId,
      scriptContentHash: preparation.script.contentHash,
      visualDirectionPosition: scene.position,
      assetType: 'VIDEO',
      requestedAt: options.requestedAt,
    };
    const request = validateMediaAcquisitionRequest({
      ...body,
      contentHash: mediaAcquisitionRequestHash(body),
    });
    return { preparation, scenePosition: scene.position, request };
  }
  async prepare(input: unknown) {
    const request = validateVideoPreparationRequest(input);
    const stored = this.content.getScript(request.scriptId);
    if (!stored)
      preparationFail('VIDEO_PREPARATION_SCRIPT_NOT_FOUND', 'scriptId');
    const script = validateScript(stored);
    if (
      script.scriptId !== request.scriptId ||
      script.contentHash !== request.scriptContentHash ||
      script.revision !== request.scriptRevision
    )
      preparationFail('VIDEO_PREPARATION_SCRIPT_CONFLICT', 'script');
    if (!script.editorialSelectionId)
      preparationFail(
        'VIDEO_PREPARATION_COMMERCIAL_SELECTION_REQUIRED',
        'editorialSelectionId',
      );
    const selected = this.content.getAffiliateSelection(
      script.editorialSelectionId,
    );
    if (!selected)
      preparationFail(
        'VIDEO_PREPARATION_SELECTION_NOT_FOUND',
        'editorialSelectionId',
      );
    const selection = validateAffiliateEditorialSelection(selected);
    const run = this.operations.get(script.pipelineRunId);
    if (
      run.pipelineRunId !== script.pipelineRunId ||
      run.projectId !== script.projectId ||
      run.projectVersion !== script.projectVersion ||
      selection.pipelineRunId !== script.pipelineRunId ||
      selection.projectId !== script.projectId ||
      selection.projectVersion !== script.projectVersion ||
      selection.selectionId !== script.editorialSelectionId ||
      selection.contentHash !== script.editorialSelectionContentHash
    )
      preparationFail('VIDEO_PREPARATION_SCOPE_MISMATCH', 'script');
    const resolved = this.operations.resolveAffiliateBriefing(
      script.pipelineRunId,
      selection.briefingId,
    );
    if (!resolved)
      preparationFail('VIDEO_PREPARATION_BRIEFING_MISMATCH', 'briefingId');
    const briefing = validateAffiliateBriefing(resolved);
    if (
      briefing.briefingId !== selection.briefingId ||
      briefing.contentHash !== selection.briefingHash ||
      script.cta !== briefing.cta ||
      selection.evidenceRefs.some(
        (ref) => !briefing.evidence.some((e) => e.id === ref),
      )
    )
      preparationFail('VIDEO_PREPARATION_BRIEFING_MISMATCH', 'briefingId');
    const resolvedSource = await this.affiliate.resolveBriefingSource(
      briefing.briefingId,
    );
    const source =
      resolvedSource === null
        ? null
        : validateAffiliateCampaignSource(resolvedSource);
    if (
      source &&
      (source.briefingId !== briefing.briefingId ||
        source.campaignId !== briefing.campaignId ||
        source.campaignRevision !== briefing.campaignRevision ||
        source.productId !== briefing.productId ||
        source.productRevision !== briefing.productRevision ||
        source.affiliateUrl !== briefing.affiliateUrl)
    )
      preparationFail('VIDEO_PREPARATION_SOURCE_MISMATCH', 'shopeeSource');
    return buildVideoProductionPreparation(
      request,
      script,
      selection,
      briefing,
      source,
    );
  }
}
