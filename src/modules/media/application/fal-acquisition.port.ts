import type { MediaAsset, AcquisitionRequest } from '../domain/media.types.js';
import type { FalFinanceService } from '../../finance/application/fal-finance.service.js';
import type { VideoProductionPreparationService } from './video-production-preparation.service.js';
import type { VideoProductionPreparationV1 } from '../domain/video-production-preparation.js';
export interface PreparedFalRequest {
  preparation: VideoProductionPreparationV1;
  scenePosition: number;
  request: AcquisitionRequest;
  authorization: {
    authorized: boolean;
    actorId: string;
    statement: string;
    preparationHash: string;
    requestHash: string;
    modelHash: string;
    budgetHash: string;
  };
}

export interface FalTransport {
  submit(parameters: unknown, options?: { signal?: AbortSignal }): Promise<any>;
  status(
    id: string,
    options?: { signal?: AbortSignal; url?: string | null },
  ): Promise<any>;
  result(
    id: string,
    options?: { signal?: AbortSignal; url?: string | null },
  ): Promise<any>;
  download(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<Uint8Array>;
}
export interface FalStorage {
  store(bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<any>;
  verify(output: unknown, options?: { signal?: AbortSignal }): Promise<boolean>;
}
export interface FalMediaSession {
  getRun(id: string): any;
  getScript(id: string): any;
  getMediaAcquisition(
    id: string,
  ): { requestHash: string; mediaAsset: MediaAsset } | null;
  listMediaAssetsByVisualDirection(id: string, position: number): MediaAsset[];
  registerAcquiredMediaAsset(input: {
    request: AcquisitionRequest;
    mediaAsset: MediaAsset;
  }): MediaAsset;
  close(): void;
}
export interface FalAcquisitionDependencies {
  control?: FalControl;
  preparations?: Pick<VideoProductionPreparationService, 'prepare'>;
  store: { open(): FalMediaSession };
  finance: FalFinanceService;
  briefings: { resolveRunBriefing(id: string): any };
  queue: FalTransport;
  storage: FalStorage;
  resolveImage(
    ref: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    url: string;
    contentHash: string;
    provenance?: { evidenceRef: string; sourceRef: string };
  }>;
}
export interface FalExecutionOptions {
  signal?: AbortSignal;
  principal?: unknown;
  confirmation?: unknown;
}
export interface FalControl {
  readiness(): unknown;
  authorize(
    input: PreparedFalRequest,
    options: FalExecutionOptions,
  ): Promise<{
    input: PreparedFalRequest;
    configuration: unknown;
    queue: FalTransport;
    resolveImage: FalAcquisitionDependencies['resolveImage'];
  }>;
}
