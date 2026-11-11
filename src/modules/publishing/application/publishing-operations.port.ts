export interface PublicationDestination {
  network: string;
  account: string;
  label: string;
}
export interface PublicationTransition {
  stream: 'social' | 'manual';
  cursor: number;
  version: number;
}
export interface OperationalPublication {
  operationId: string;
  destination: PublicationDestination;
  confirmed: boolean;
  requiresReconciliation: boolean;
  failed: boolean;
  errorCode?: string;
  simulated: boolean;
  transition?: PublicationTransition;
  receipt?: { publicationId: string; accountId: string; permalink?: string };
}
export interface OperationalPackage {
  hash: string;
  cursor: number;
  destination: PublicationDestination;
  identity: {
    videoRenderId: string;
    videoRenderRevision: number;
    videoRenderContentHash: string;
    qualityControlReportId: string;
    qualityControlReportContentHash: string;
  };
  review: {
    hash: string;
    decision: string;
    revoked: boolean;
    currentApproval: boolean;
  } | null;
  publications: OperationalPublication[];
}
export interface PublishingOperationsPort {
  checkpoint(): { social: number; manual: number };
  packages(runId: string): OperationalPackage[];
}
export const PUBLISHING_OPERATIONS = Symbol('PUBLISHING_OPERATIONS');

// Validated persistence snapshots, internal to the Publishing application boundary.
export interface PublishingOperationsSession {
  checkpoint(): { social: number; manual: number };
  packages(
    runId: string,
  ): { cursor: number; value: any; review: any; revoked: boolean }[];
  publications(packageHash: string): { cursor: number; value: any }[];
  operations(packageHash: string): {
    value: any;
    history: { cursor: number; value: any }[];
    mode: 'fake' | 'live';
  }[];
  close(): void;
}
export interface PublishingOperationsPersistence {
  open(): PublishingOperationsSession;
}
