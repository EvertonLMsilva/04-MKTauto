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
  close(): void;
  replay<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING',
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
