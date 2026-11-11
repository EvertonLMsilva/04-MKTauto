import type { CompositionRender } from '../domain/render.types.js';

export const VIDEO_COMPOSER = Symbol('VIDEO_COMPOSER');
export interface CompositionReceipt {
  requestHash: string;
  videoRender: CompositionRender;
}
export interface RenderRepository {
  getVideoRender(
    id: string,
  ): import('../domain/render.types.js').VideoRender | null;
}
export interface InitialRenderRepository extends RenderRepository {
  close(): void;
  getCompositionPlan(id: string): any;
  getVideoComposition(id: string): CompositionReceipt | null;
  listVideoRendersByCompositionPlan(id: string): any[];
  registerVideoComposition(value: {
    request: unknown;
    videoRender: unknown;
  }): any;
}
export interface VideoComposer {
  compose(
    input: {
      logicalCallId: string;
      compositionPlan: any;
      output: {
        containerFormat: string;
        widthPixels: number;
        heightPixels: number;
      };
    },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}
export interface RenderStorage {
  createStaging(): Promise<string>;
  promote(
    sourcePath: string,
    contentHash: string,
    options?: {
      validateExisting?: (path: string) => Promise<void>;
    },
  ): Promise<{
    logicalReference: string;
    physicalPath: string;
    reused: boolean;
  }>;
  cleanup(stagingPath: string): Promise<void>;
}
