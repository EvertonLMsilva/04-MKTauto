import type {
  MediaAsset,
  AcquisitionReceipt,
  SelectionReceipt,
  QualityControlReport,
} from '../domain/media.types.js';
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
  close(): void;
  getQualityControlReport(id: string): QualityControlReport | null;
  findQualityControlReport(
    policy: string,
    id: string,
    hash: string,
  ): QualityControlReport | null;
}
export interface MediaStore {
  open(readOnly?: boolean): MediaRepository;
  openQuality(): QualityRepository;
}
