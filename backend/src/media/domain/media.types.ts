export interface MediaAsset {
  schemaVersion: string;
  mediaAssetId: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptContentHash: string;
  visualDirectionPosition: number;
  assetType: 'IMAGE' | 'VIDEO';
  technicalProperties: {
    format: string;
    widthPixels: number;
    heightPixels: number;
    durationMilliseconds: number | null;
    mimeType?: string;
    hasAudio?: boolean | null;
  };
  contentHash: string;
  mediaReference: string;
  origin:
    | 'OPERATOR_OWNED'
    | 'AUTHORIZED_THIRD_PARTY'
    | 'PROVIDER_GENERATED'
    | 'PROVIDER_LICENSED';
  provider: string | null;
  rights: {
    usageBasis: 'OWNED' | 'LICENSED' | 'EXPLICIT_PERMISSION' | 'PROVIDER_TERMS';
    commercialUseAllowed: boolean;
  };
  createdAt: string;
  revision: number;
  supersedesMediaAssetId: string | null;
  source?: {
    externalAssetId: string;
    licenseName: string;
    licenseUrl: string;
    photographerName: string;
    photographerUrl: string;
    sourceUrl: string;
  } | null;
}
export interface AcquisitionRequest {
  schemaVersion: string;
  mediaAcquisitionRequestId: string;
  scriptId: string;
  scriptContentHash: string;
  visualDirectionPosition: number;
  assetType: 'IMAGE' | 'VIDEO';
  requestedAt: string;
  contentHash: string;
}
export interface SelectionRequest {
  schemaVersion: string;
  mediaSelectionRequestId: string;
  scriptId: string;
  scriptContentHash: string;
  visualDirectionPosition: number;
  productionProfile: 'STATIC_IMAGE_V1' | 'MIXED_MEDIA_V2';
  requestedAt: string;
  contentHash: string;
}
export interface AcquisitionReceipt {
  requestHash: string;
  mediaAsset: MediaAsset;
}
export interface SelectionReceipt extends AcquisitionReceipt {
  productionProfile: string;
  requestedAssetType: string;
  selectedAssetType: string;
  fallbackCode: string | null;
}
export interface QualityControlReport {
  schemaVersion: string;
  qualityControlReportId: string;
  policyVersion: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  videoRenderId: string;
  videoRenderContentHash: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  approvalBlocked: boolean;
  findings: Record<string, unknown>[];
  checkedAt: string;
  contentHash: string;
  artifacts?: Record<string, unknown>;
  origin?: Record<string, unknown>;
}
