import type { FalTransport } from './fal-acquisition.port.js';
import type { VideoProductionPreparationV1 } from '../domain/video-production-preparation.js';

export interface FakeVideoGenerationRequest {
  operationId: string;
  preparation: VideoProductionPreparationV1;
  sceneId: string;
  prompt: string;
  endpoint: string;
  duration: 5;
  resolution: '768P';
  prompt_expansion_mode: 'disabled';
  enable_safety_checker: true;
}
export interface FakeVideoGenerationJob {
  mode: 'fake';
  fakeJobId: string;
  state: 'SUBMITTED' | 'COMPLETED' | 'FAILED';
  attempt: number;
  request: FakeVideoGenerationRequest;
  materialization: 'NOT_MATERIALIZED';
  mediaAsset: null;
  motionValidation: 'NOT_VALIDATED';
  rightsValidation: 'NOT_CONFIRMED';
  compositionReady: false;
  executionAuthorized: false;
  qcRequired: readonly string[];
}
// Uses only the queue submission/status shape. No result/download/storage or Finance port.
export interface FakeVideoGenerationPort extends Pick<
  FalTransport,
  'submit' | 'status'
> {
  submit(request: FakeVideoGenerationRequest): Promise<FakeVideoGenerationJob>;
  status(operationId: string): Promise<FakeVideoGenerationJob>;
  recover(operationId: string): FakeVideoGenerationJob;
  poll(operationId: string): FakeVideoGenerationJob;
}
