import { affiliateIdentifier } from '../domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import type { CreateBriefingInput } from './ports/affiliate-repository.port.js';
export interface RegisterProductDto {
  idempotencyKey: string;
  product: unknown;
}
export interface RegisterCampaignDto {
  idempotencyKey: string;
  campaign: unknown;
}
export interface CreateBriefingDto extends CreateBriefingInput {
  idempotencyKey: string;
}
export function commandEnvelope(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new AffiliateRepositoryError('INVALID_AFFILIATE_INPUT', 'input');
}
export function validateBriefingInput(
  value: unknown,
): asserts value is CreateBriefingInput {
  commandEnvelope(value, ['briefingId', 'campaignId', 'campaignRevision']);
  affiliateIdentifier(value.briefingId, 'briefingId');
  affiliateIdentifier(value.campaignId, 'campaignId');
  if (
    !Number.isSafeInteger(value.campaignRevision) ||
    (value.campaignRevision as number) < 1
  )
    throw new AffiliateRepositoryError(
      'INVALID_AFFILIATE_REVISION',
      'campaignRevision',
    );
}
