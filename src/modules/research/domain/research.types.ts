// Public historical records. Validation remains in their original contracts.
export interface ResearchShortlist extends Record<string, unknown> {
  artifactId: string;
  contentHash: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  state: string;
  policy: { shortlistLimit: number; [key: string]: unknown };
  rights: {
    usageCondition: string;
    mediaDownloaded: boolean;
    republicationAllowed: boolean;
  };
  orderedCandidates: {
    candidate: { id: string; title: string; [key: string]: unknown };
    cluster: { candidateIds: string[]; [key: string]: unknown };
    score: { value: number; confidence: number; [key: string]: unknown };
    [key: string]: unknown;
  }[];
}
export interface ReferenceInsight extends Record<string, unknown> {
  artifactId: string;
  contentHash: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  references: {
    evidence: { evidenceId: string; [key: string]: unknown }[];
    [key: string]: unknown;
  }[];
}
