import type {
  MediaAsset,
  AcquisitionReceipt,
  SelectionReceipt,
  QualityControlReport,
} from '../domain/media.types.js';
import type { VideoRender } from '../domain/render.types.js';
import type { InitialRenderRepository } from './video-composition.port.js';
export interface MediaRepository {
  close(): void;
  registerMediaAsset(value: unknown): MediaAsset;
  getMediaAsset(id: string): MediaAsset | null;
  listMediaAssetsByPipelineRun(id: string): MediaAsset[];
  listMediaAssetsByScript(id: string): MediaAsset[];
  listMediaAssetsByVisualDirection(id: string, position: number): MediaAsset[];
  registerAcquiredMediaAsset(value: unknown): MediaAsset;
  getMediaAcquisition(id: string): AcquisitionReceipt | null;
  registerMediaSelection(value: unknown): MediaAsset;
  getMediaSelection(id: string): SelectionReceipt | null;
}
export interface QualityRepository {
  reviewTemporalMedia?(
    id: string,
    input: unknown,
    principal: unknown,
  ): Promise<unknown>;
  evaluateTemporalMedia?(id: string): Promise<unknown>;
  close(): void;
  getQualityControlReport(id: string): QualityControlReport | null;
  findQualityControlReport(
    policy: string,
    id: string,
    hash: string,
  ): QualityControlReport | null;
}
export interface MediaStore {
  openInitialRender?(readOnly?: boolean): InitialRenderRepository;
  openComposition(readOnly?: boolean): CompositionRepository;
  open(readOnly?: boolean): MediaRepository;
  openQuality(readOnly?: boolean): QualityRepository;
  openRender(): {
    getVideoRender(id: string): VideoRender | null;
    close(): void;
  };
  verifyMedia(reference: string): string;
}
export interface CompositionRepository {
  close(): void;
  registerCompositionPlan(value: unknown): unknown;
  getCompositionPlan(id: string): unknown;
  listCompositionPlansByPipelineRun(id: string): unknown[];
  listCompositionPlansByScript(id: string): unknown[];
}
