import type { ContentService } from '../../content/application/content.service.js';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import type { MediaStore } from '../application/media.port.js';
import { MediaAssetRepository } from './media-asset.repository.js';
import { QualityControlRepository } from './quality-control.repository.js';
import { VideoRenderRepository } from './video-render.reader.js';
import { LocalRenderIntegrity } from './local-render-integrity.js';
export const MEDIA_DATABASE = Symbol('MEDIA_DATABASE');
export class MediaPersistence implements MediaStore {
  constructor(
    private readonly path: string | null,
    private readonly operations: Pick<ContentOperationsService, 'get'>,
    private readonly content: Pick<ContentService, 'getScript'>,
    private readonly renderRoot: string | null = process.env
      .PUBLISHING_RENDER_ROOT ?? null,
  ) {}
  openRender() {
    return new VideoRenderRepository(
      this.database(),
      this.operations,
      this.content,
      { readOnly: true },
    );
  }
  verifyMedia(reference: string): string {
    return new LocalRenderIntegrity(this.renderRoot).verifyMedia(reference);
  }
  private database() {
    if (!this.path)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return this.path;
  }
  open(readOnly = false) {
    return new MediaAssetRepository(
      this.database(),
      this.operations,
      this.content,
      { readOnly },
    );
  }
  openQuality() {
    return new QualityControlRepository(
      this.database(),
      this.operations,
      this.content,
      { readOnly: true },
    );
  }
}
