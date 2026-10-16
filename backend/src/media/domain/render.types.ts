export interface VideoRenderIdentity {
  videoRenderId: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  contentHash: string;
  logicalReference: string;
  revision: number;
  supersedesVideoRenderId: string | null;
  createdAt: string;
  outputAspectRatio: string;
  widthPixels: number;
  heightPixels: number;
  durationMilliseconds: number;
}
export interface CompositionRender extends VideoRenderIdentity {
  schemaVersion: 'video-render/1.0.0';
  compositionPlanId: string;
  compositionPlanContentHash: string;
  containerFormat: string;
}
export interface AdaptedRender extends VideoRenderIdentity {
  schemaVersion: 'video-render/2.0.0';
  origin:
    | {
        schemaVersion: 'video-origin/1.0.0';
        kind: 'LEGACY_COMPOSITION';
        videoRenderId: string;
        videoRenderContentHash: string;
      }
    | {
        schemaVersion: 'video-origin/1.0.0';
        kind: 'AI_GENERATED';
        generationRequestId: string;
        providerRequestId: string;
        requestHash: string;
        sourceReference: string;
        sourceContentHash: string;
        rights: {
          evidenceReference: string;
          evidenceContentHash: string;
          processingAuthorized: boolean;
          commercialUseAuthorized: boolean;
          audioAuthorized: boolean;
        };
      };
  audioConfigId: string;
  audioConfigHash: string;
  narrationId: string | null;
  narrationHash: string | null;
  frameCount: number;
  frameRate: number;
  videoCodec: string;
  videoProfile: string;
  audioCodec: string;
  audioProfile: string;
  audioSampleRate: number;
  audioChannels: number;
}
export type VideoRender = CompositionRender | AdaptedRender;
