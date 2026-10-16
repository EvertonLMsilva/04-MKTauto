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
export interface AffiliateRepository {
  resolveBriefingSource(id: string): AffiliateCampaignSourceV1 | null;
  close(): void;
  getCampaignSource(
    id: string,
    revision: number,
  ): AffiliateCampaignSourceV1 | null;
  associateCampaignSource(
    value: unknown,
    key: string,
    verifiedMediaRefs: readonly string[],
  ): AffiliateCampaignSourceV1;
  replay<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
  ): T | null;
  registerProduct(value: unknown, key: string): AffiliateProduct;
  getProduct(id: string, revision: number): AffiliateProduct | null;
  registerCampaign(
    value: unknown,
    key: string,
    projectExists: boolean,
  ): AffiliateCampaign;
  getCampaign(id: string, revision: number): AffiliateCampaign | null;
  createBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
  ): AffiliateBriefing;
  getBriefing(id: string): AffiliateBriefing | null;
}
export interface AffiliateRepositoryFactory {
  open(readOnly?: boolean): AffiliateRepository;
}
