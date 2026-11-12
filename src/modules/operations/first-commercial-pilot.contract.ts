export interface FirstCommercialPilotQuery {
  executionId: string;
  packageHash?: string;
}

/** A read projection, never an authorization or a second workflow journal. */
export interface FirstCommercialPilotReport {
  schemaVersion: 'first-commercial-pilot/1.0.0';
  executionId: string;
  pipelineRunId: string;
  project: { id: string | null; revision: number | null };
  campaign: { id: string; revision: number };
  product: { id: string; revision: number };
  state: string;
  currentStep: string | null;
  nextAction: string;
  blockers: string[];
  script: { id: string | null; sha256: string | null };
  audio: { id: string | null; sha256: string | null };
  video: { id: string | null; revision: number | null; sha256: string | null };
  qc: 'PASS' | 'PENDING' | 'INVALID';
  physicalMedia: 'VERIFIED' | 'PENDING' | 'INVALID';
  package: { hash: string; readiness: string; approval: string } | null;
  publication: { id: string; state: string }[];
  finance: { readiness: string; costs: unknown; spendingAuthorized: false };
  history: {
    sequence: number;
    event: string;
    step: string | null;
    at: string;
  }[];
  commercialAcceptance: 'NOT_ASSESSED';
  publicationAuthorized: false;
}
