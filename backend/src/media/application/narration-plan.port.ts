export interface NarrationScope {
  pipelineRunId: string;
  campaignId: string;
  scriptId: string;
  scriptContentHash: string;
  mediaAssetId: string;
  mediaContentHash: string;
  targetDurationMs: number;
}
export interface NarrationPlanStore {
  prepare(scope: NarrationScope, provision?: boolean): unknown;
  authorization(operationId: string): unknown;
}
