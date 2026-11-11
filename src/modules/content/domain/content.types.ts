export interface EditorialScope {
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
}
export type ScoreComponentName =
  | 'nicheAudienceFit'
  | 'evidenceStrength'
  | 'novelty'
  | 'editorialFeasibility'
  | 'editorialRightsRisk'
  | 'diversity';
export interface ScoreComponent {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  value: number | null;
  weight: number;
  reason: string;
  evidenceIds: string[];
  contribution: number | null;
}
export interface IdeaCandidate extends EditorialScope {
  schemaVersion: string;
  ideaCandidateId: string;
  ideaBatchId: string;
  contentIdentity: string;
  title: string;
  editorialAngle: string;
  editorialIntent: { audienceProfile: string; language: string };
  researchShortlistId: string;
  evidenceCandidateIds: string[];
  referenceInsightId: string | null;
  referenceEvidenceIds: string[];
  createdAt: string;
  origin: 'OPERATOR' | 'EXTERNAL_CONSUMER';
  contentHash: string;
}
export interface IdeaScore extends EditorialScope {
  schemaVersion: string;
  ideaScoreId: string;
  ideaCandidateId: string;
  ideaBatchId: string;
  policyVersion: string;
  calculatedAt: string;
  components: Record<ScoreComponentName, ScoreComponent>;
  total: number;
  rank: number;
  tieBreakRule: string;
  explanation: string;
  contentHash: string;
}
export interface IdeaSelection extends EditorialScope {
  schemaVersion: string;
  ideaSelectionId: string;
  ideaBatchId: string;
  ideaCandidateId: string;
  ideaScoreId: string;
  ideaContentHash: string;
  ideaScoreContentHash: string;
  decision: 'SELECTED';
  actor: { type: 'HUMAN'; id: string };
  decidedAt: string;
  editorialRationale: string | null;
  revision: number;
  supersedesIdeaSelectionId: string | null;
  contentHash: string;
}
export interface AffiliateEditorialSelection extends EditorialScope {
  schemaVersion: string;
  selectionId: string;
  briefingId: string;
  briefingHash: string;
  evidenceRefs: string[];
  title: string;
  editorialAngle: string;
  decision: 'SELECTED';
  actor:
    | { type: 'HUMAN'; id: string }
    | {
        type: 'AUTOMATION';
        id: string;
        policyId: string;
        policyVersion: string;
        productId: string;
        campaignId: string;
        reason: string;
      };
  decidedAt: string;
  contentHash: string;
}
export interface EditorialScript extends EditorialScope {
  schemaVersion: string;
  scriptId: string;
  ideaSelectionId?: string;
  ideaSelectionContentHash?: string;
  ideaCandidateId?: string;
  ideaContentHash?: string;
  editorialSelectionId?: string;
  editorialSelectionContentHash?: string;
  language: string;
  contentFormat: 'short_video' | 'long_video';
  hook: string;
  narrativeBlocks: { position: number; purpose: string; narration: string }[];
  fullNarration: string;
  visualDirections: {
    position: number;
    blockPosition: number;
    description: string;
    mediaSearchQuery?: string;
  }[];
  cta: string | null;
  estimatedDurationSeconds: number;
  sensitiveClaims: {
    position: number;
    blockPosition: number;
    summary: string;
    sourceRequired: boolean;
    humanReviewRequired: boolean;
  }[];
  reviewFlags: string[];
  origin: 'OPERATOR' | 'EXTERNAL_CONSUMER' | 'AUTOMATION';
  createdAt: string;
  revision: number;
  supersedesScriptId: string | null;
  contentHash: string;
}
export interface IdeaBatch extends EditorialScope {
  ideaBatchId: string;
  researchShortlistId: string;
  origin: 'OPERATOR' | 'EXTERNAL_CONSUMER';
  createdAt: string;
  proposals: {
    ideaCandidateId: string;
    title: string;
    editorialAngle: string;
    evidenceCandidateIds: string[];
    referenceInsightId: string | null;
    referenceEvidenceIds: string[];
  }[];
}
export interface IdeaWithScore {
  idea: IdeaCandidate;
  score: IdeaScore;
}

export interface IdeaScoringPolicy {
  version: string;
  weights: Record<ScoreComponentName, number>;
  unavailableHandling: string;
  rightsRiskContribution: string;
  tieBreakRule: string;
}
