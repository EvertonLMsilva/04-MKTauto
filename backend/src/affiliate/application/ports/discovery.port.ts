import type {
  DiscoveryCandidate,
  DiscoveryPolicy,
  DiscoveryRanking,
  RankedDiscovery,
} from '../../domain/affiliate-discovery.js';
export const DISCOVERY_SOURCE = Symbol('DISCOVERY_SOURCE');
export const DISCOVERY_REPOSITORY = Symbol('DISCOVERY_REPOSITORY');
export interface CatalogMetadata {
  obtainedAt: string;
  sourceUpdatedAt: string | null;
  sha256: string;
  sizeBytes: number;
  recordCount: number;
  validationState: string;
}
export interface DiscoveryBatch {
  candidates: DiscoveryCandidate[];
  errors: { rowNumber: number; code: string; feedId?: string }[];
  source: unknown;
}
export interface DiscoverySource {
  readonly scope: string;
  enumerateCandidates(): Promise<DiscoveryBatch>;
}
export interface DiscoverySourceFactory {
  open(): Promise<DiscoverySource>;
}
export interface DiscoverySelection extends RankedDiscovery {
  actor: { type: 'AUTOMATION'; id: string };
  externalProductId: string;
  sourceId: string;
}
export interface DiscoveryDecision {
  discoveryRunId: string;
  selection: DiscoverySelection | null;
  ranking: DiscoveryRanking;
  candidates: DiscoveryCandidate[];
  source: unknown;
  errors: DiscoveryBatch['errors'];
  policy: DiscoveryPolicy;
  evaluatedAt: string;
}
export interface DiscoveryRepository {
  close(): void;
  get(id: string, requestHash?: string): DiscoveryDecision | null;
  used(candidates: readonly DiscoveryCandidate[]): Set<string>;
  reserve(
    id: string,
    hash: string,
    create: () => DiscoveryDecision,
    at: string,
  ): DiscoveryDecision;
}
export interface DiscoveryRepositoryFactory {
  open(readOnly?: boolean): DiscoveryRepository;
}
