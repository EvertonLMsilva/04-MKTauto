import {
  VIDEO_PRODUCTION_PREPARATION_VERSION,
  validateVideoPreparationRequest,
} from '../domain/video-production-preparation.js';
import type { VideoProductionPreparationV1 } from '../domain/video-production-preparation.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { stageIdentifier } from '../../content-operations/domain/stage-contracts.js';
import { FAL_VIDEO_ENDPOINT } from '../domain/fal-model.js';
import type { FakeVideoGenerationPort } from './fake-video-generation.port.js';

export interface VideoGenerationRequest {
  operationId: string;
  preparation: VideoProductionPreparationV1;
  scenePosition: number;
}
/** Accept an existing preparation produced by VideoProductionPreparationService.
 * All simulation state stays in the injected in-memory provider, never SQLite.
 * A fake completion authorizes neither generation, acquisition nor composition.
 */
export class VideoGenerationService {
  constructor(private readonly provider: FakeVideoGenerationPort) {}
  async submit(input: VideoGenerationRequest) {
    stageIdentifier(input.operationId, 'operationId', 200);
    const preparation = input.preparation;
    const { preparationId, contentHash, ...body } = preparation;
    if (
      preparation.schemaVersion !== VIDEO_PRODUCTION_PREPARATION_VERSION ||
      affiliateHash(body) !== contentHash ||
      preparationId !== `video_preparation:${contentHash}`
    )
      throw new Error('VIDEO_GENERATION_PREPARATION_CONFLICT');
    validateVideoPreparationRequest({
      scriptId: preparation.script.scriptId,
      scriptContentHash: preparation.script.contentHash,
      scriptRevision: preparation.script.revision,
      scenes: preparation.scenes.map((s) => ({
        visualDirectionPosition: s.position,
        sceneMediaType: s.sceneMediaType,
        movementRequirement: s.movementRequirement,
      })),
    });
    const scene = preparation.scenes.find(
      (s) => s.position === input.scenePosition,
    );
    if (!scene) throw new Error('VIDEO_GENERATION_SCENE_NOT_FOUND');
    if (scene.sceneMediaType === 'RECORDED_VIDEO')
      throw new Error('RECORDED_VIDEO_ACQUISITION_REQUIRED');
    if (scene.sceneMediaType !== 'GENERATED_VIDEO')
      throw new Error('REAL_MOTION_INTENT_REQUIRED');
    return this.provider.submit({
      operationId: input.operationId,
      preparation,
      sceneId: scene.sceneId,
      prompt: scene.visualDirection.description,
      endpoint: FAL_VIDEO_ENDPOINT,
      duration: 5,
      resolution: '768P',
      prompt_expansion_mode: 'disabled',
      enable_safety_checker: true,
    });
  }
  poll(operationId: string) {
    return this.provider.poll(operationId);
  }
  recover(operationId: string) {
    return this.provider.recover(operationId);
  }
}
