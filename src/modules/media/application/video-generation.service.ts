import { requireGeneratedVideoScene } from '../domain/video-production-preparation.js';
import type { VideoProductionPreparationV1 } from '../domain/video-production-preparation.js';
import { stageIdentifier } from '../../content-operations/domain/stage-contracts.js';
import { FAL_VIDEO_MODEL } from '../domain/fal-model.js';
import type { FakeVideoGenerationPort } from './fake-video-generation.port.js';
import type { FalAcquisitionService } from './fal-acquisition.service.js';
import type { PreparedFalRequest } from './fal-acquisition.port.js';

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
  constructor(
    private readonly provider: FakeVideoGenerationPort,
    private readonly acquisition?: Pick<
      FalAcquisitionService,
      'acquirePrepared'
    >,
  ) {}
  async generatePrepared(
    input: PreparedFalRequest,
    config: unknown,
    options: { signal?: AbortSignal } = {},
  ) {
    if (!this.acquisition) throw new Error('FAL_LIVE_DISABLED');
    return this.acquisition.acquirePrepared(input, config, options);
  }
  async submit(input: VideoGenerationRequest) {
    stageIdentifier(input.operationId, 'operationId', 200);
    const preparation = input.preparation;
    const scene = requireGeneratedVideoScene(preparation, input.scenePosition);
    return this.provider.submit({
      operationId: input.operationId,
      preparation,
      sceneId: scene.sceneId,
      prompt: scene.visualDirection.description,
      ...FAL_VIDEO_MODEL,
    });
  }
  poll(operationId: string) {
    return this.provider.poll(operationId);
  }
  recover(operationId: string) {
    return this.provider.recover(operationId);
  }
}
