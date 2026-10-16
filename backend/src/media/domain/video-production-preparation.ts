import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import type {
  AffiliateBriefing,
  AffiliateEvidence,
} from '../../affiliate/domain/affiliate-contracts.js';
import type { AffiliateCampaignSourceV1 } from '../../affiliate/domain/affiliate-campaign-source.js';
import type {
  AffiliateEditorialSelection,
  EditorialScript,
} from '../../content/domain/content.types.js';
import { stageIdentifier } from '../../content-operations/domain/stage-contracts.js';
import type { AcquisitionRequest } from './media.types.js';

export const VIDEO_PRODUCTION_PREPARATION_VERSION =
  'video-production-preparation/1.0.0';
export type SceneMediaType =
  'GENERATED_VIDEO' | 'RECORDED_VIDEO' | 'STATIC_IMAGE' | 'ANIMATED_STILL';
export type MovementRequirement = 'REAL_MOTION_REQUIRED' | 'STATIC_ALLOWED';
export interface SceneIntent {
  visualDirectionPosition: number;
  sceneMediaType: SceneMediaType;
  movementRequirement: MovementRequirement;
}
export interface VideoPreparationRequest {
  scriptId: string;
  scriptContentHash: string;
  scriptRevision: number;
  scenes: SceneIntent[];
  // Optional optimistic assertion, not a stored idempotency key.
  expectedPreparationHash?: string;
}
export interface VideoProductionPreparationV1 {
  schemaVersion: typeof VIDEO_PRODUCTION_PREPARATION_VERSION;
  preparationId: string;
  contentHash: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  script: { scriptId: string; revision: number; contentHash: string };
  editorialSelection: {
    selectionId: string;
    contentHash: string;
    evidenceRefs: string[];
  };
  commercial: {
    productId: string;
    productRevision: number;
    campaignId: string;
    campaignRevision: number;
    briefingId: string;
    briefingHash: string;
    affiliateUrl: string;
    cta: string;
    disclosure: string;
    authorizedMediaRefs: string[];
    evidence: AffiliateEvidence[];
  };
  shopeeSource: AffiliateCampaignSourceV1 | null;
  review: {
    status: 'REQUIRED';
    flags: string[];
    sensitiveClaims: EditorialScript['sensitiveClaims'];
  };
  scenes: {
    sceneId: string;
    position: number;
    visualDirection: EditorialScript['visualDirections'][number];
    sceneMediaType: SceneMediaType;
    movementRequirement: MovementRequirement;
    generationStatus: 'PENDING';
    motionValidation: 'NOT_VALIDATED';
    // A plan only. No request ID, timestamp, resource hash or transport is fabricated.
    acquisitionPlanned: Pick<
      AcquisitionRequest,
      'scriptId' | 'scriptContentHash' | 'visualDirectionPosition' | 'assetType'
    >;
    rights: {
      status: 'UNCONFIRMED';
      requiredEvidenceKinds: ['MEDIA_USAGE_RIGHT'];
      requiredPermissions: ['COMMERCIAL_USE', 'PROCESSING'];
      availability: 'NOT_CHECKED';
    };
  }[];
}
export class VideoPreparationError extends Error {
  constructor(
    readonly code: string,
    readonly field: string,
  ) {
    super(`${code}: ${field}`);
  }
}
export function preparationFail(code: string, field: string): never {
  throw new VideoPreparationError(code, field);
}

export function validateVideoPreparationRequest(
  input: unknown,
): VideoPreparationRequest {
  const r = input as VideoPreparationRequest;
  exact(
    r,
    ['scriptId', 'scriptContentHash', 'scriptRevision', 'scenes'],
    ['expectedPreparationHash'],
  );
  stageIdentifier(r.scriptId, 'scriptId', 200);
  for (const key of ['scriptContentHash', 'expectedPreparationHash'] as const)
    if (
      (key === 'scriptContentHash' || Object.hasOwn(r, key)) &&
      !/^[a-f0-9]{64}$/.test(r[key] ?? '')
    )
      preparationFail('VIDEO_PREPARATION_INVALID_HASH', key);
  if (!Number.isSafeInteger(r.scriptRevision) || r.scriptRevision < 1)
    preparationFail('VIDEO_PREPARATION_INVALID_REVISION', 'scriptRevision');
  if (!Array.isArray(r.scenes) || !r.scenes.length || r.scenes.length > 300)
    preparationFail('VIDEO_PREPARATION_INVALID_SCENES', 'scenes');
  const positions = new Set<number>();
  for (const scene of r.scenes) {
    exact(scene, [
      'visualDirectionPosition',
      'sceneMediaType',
      'movementRequirement',
    ]);
    if (
      !Number.isSafeInteger(scene.visualDirectionPosition) ||
      scene.visualDirectionPosition < 1 ||
      positions.has(scene.visualDirectionPosition)
    )
      preparationFail(
        'VIDEO_PREPARATION_INVALID_SCENES',
        'visualDirectionPosition',
      );
    positions.add(scene.visualDirectionPosition);
    if (
      ![
        'GENERATED_VIDEO',
        'RECORDED_VIDEO',
        'STATIC_IMAGE',
        'ANIMATED_STILL',
      ].includes(scene.sceneMediaType) ||
      !['REAL_MOTION_REQUIRED', 'STATIC_ALLOWED'].includes(
        scene.movementRequirement,
      )
    )
      preparationFail('VIDEO_PREPARATION_INVALID_INTENT', 'scenes');
    if (
      scene.movementRequirement === 'REAL_MOTION_REQUIRED' &&
      !['GENERATED_VIDEO', 'RECORDED_VIDEO'].includes(scene.sceneMediaType)
    )
      preparationFail('REAL_MOTION_INTENT_REQUIRED', 'sceneMediaType');
  }
  return immutable(r);
}

export function buildVideoProductionPreparation(
  request: VideoPreparationRequest,
  script: EditorialScript,
  selection: AffiliateEditorialSelection,
  briefing: AffiliateBriefing,
  source: AffiliateCampaignSourceV1 | null,
): VideoProductionPreparationV1 {
  const byPosition = new Map(
    request.scenes.map((s) => [s.visualDirectionPosition, s]),
  );
  if (
    script.visualDirections.length !== byPosition.size ||
    script.visualDirections.some((d) => !byPosition.has(d.position))
  )
    preparationFail('VIDEO_PREPARATION_SCENE_MISMATCH', 'scenes');
  const scenes: VideoProductionPreparationV1['scenes'] =
    script.visualDirections.map((direction) => {
      const intent = byPosition.get(direction.position)!;
      return {
        sceneId: `scene:${affiliateHash({ scriptId: script.scriptId, scriptHash: script.contentHash, revision: script.revision, position: direction.position })}`,
        position: direction.position,
        visualDirection: direction,
        sceneMediaType: intent.sceneMediaType,
        movementRequirement: intent.movementRequirement,
        generationStatus: 'PENDING',
        motionValidation: 'NOT_VALIDATED',
        acquisitionPlanned: {
          scriptId: script.scriptId,
          scriptContentHash: script.contentHash,
          visualDirectionPosition: direction.position,
          assetType: ['GENERATED_VIDEO', 'RECORDED_VIDEO'].includes(
            intent.sceneMediaType,
          )
            ? 'VIDEO'
            : 'IMAGE',
        },
        rights: {
          status: 'UNCONFIRMED',
          requiredEvidenceKinds: ['MEDIA_USAGE_RIGHT'],
          requiredPermissions: ['COMMERCIAL_USE', 'PROCESSING'],
          availability: 'NOT_CHECKED',
        },
      };
    });
  const body: Omit<
    VideoProductionPreparationV1,
    'preparationId' | 'contentHash'
  > = {
    schemaVersion: VIDEO_PRODUCTION_PREPARATION_VERSION,
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    script: {
      scriptId: script.scriptId,
      revision: script.revision,
      contentHash: script.contentHash,
    },
    editorialSelection: {
      selectionId: selection.selectionId,
      contentHash: selection.contentHash,
      evidenceRefs: selection.evidenceRefs,
    },
    commercial: {
      productId: briefing.productId,
      productRevision: briefing.productRevision,
      campaignId: briefing.campaignId,
      campaignRevision: briefing.campaignRevision,
      briefingId: briefing.briefingId,
      briefingHash: briefing.contentHash,
      affiliateUrl: briefing.affiliateUrl,
      cta: briefing.cta,
      disclosure: briefing.disclosure,
      authorizedMediaRefs: briefing.mediaRefs,
      evidence: briefing.evidence,
    },
    shopeeSource: source,
    review: {
      status: 'REQUIRED' as const,
      flags: script.reviewFlags,
      sensitiveClaims: script.sensitiveClaims,
    },
    scenes,
  };
  const contentHash = affiliateHash(body);
  if (
    request.expectedPreparationHash !== undefined &&
    request.expectedPreparationHash !== contentHash
  )
    preparationFail('VIDEO_PREPARATION_CONFLICT', 'expectedPreparationHash');
  return immutable({
    ...body,
    preparationId: `video_preparation:${contentHash}`,
    contentHash,
  });
}
function exact(value: unknown, required: string[], optional: string[] = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some(
      (k) => !required.includes(k) && !optional.includes(k),
    )
  )
    preparationFail('VIDEO_PREPARATION_INVALID_REQUEST', 'request');
}
