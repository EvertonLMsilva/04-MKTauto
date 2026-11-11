import type { Io } from '../affiliate-io.js';
import type { AffiliateCampaignSourceV1 } from '../../domain/affiliate-campaign-source.js';
import type {
  AffiliateProduct,
  AffiliateCampaign,
  AffiliateBriefing,
} from '../../domain/affiliate-contracts.js';
export const AFFILIATE_REPOSITORY = Symbol('AFFILIATE_REPOSITORY');
export interface CreateBriefingInput {
  briefingId: string;
  campaignId: string;
  campaignRevision: number;
}
export interface AffiliateRepository<A extends boolean = false> {
  catalogCandidates(
    projectId: string,
  ): Io<
    A,
    import('../../domain/affiliate-catalog.js').AffiliateCatalogCandidate[]
  >;
  resolveBriefingSource(id: string): Io<A, AffiliateCampaignSourceV1 | null>;
  close(): Io<A, void>;
  getCampaignSource(
    id: string,
    revision: number,
  ): Io<A, AffiliateCampaignSourceV1 | null>;
  associateCampaignSource(
    value: unknown,
    key: string,
    verifiedMediaRefs: readonly string[],
  ): Io<A, AffiliateCampaignSourceV1>;
  replay<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
  ): Io<A, T | null>;
  registerProduct(value: unknown, key: string): Io<A, AffiliateProduct>;
  getProduct(id: string, revision: number): Io<A, AffiliateProduct | null>;
  registerCampaign(
    value: unknown,
    key: string,
    projectExists: boolean,
  ): Io<A, AffiliateCampaign>;
  getCampaign(id: string, revision: number): Io<A, AffiliateCampaign | null>;
  createBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
  ): Io<A, AffiliateBriefing>;
  createCatalogBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
    expectedHash: string,
  ): Io<A, AffiliateBriefing>;
  getBriefing(id: string): Io<A, AffiliateBriefing | null>;
}
export interface AffiliateRepositoryFactory<A extends boolean = false> {
  open(readOnly?: boolean): Io<A, AffiliateRepository<A>>;
}
