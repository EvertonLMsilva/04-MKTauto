import { runAffiliateIo } from './affiliate-io.js';
import type { Io } from './affiliate-io.js';
import type { AffiliateCatalogCandidate } from '../domain/affiliate-catalog.js';
import {
  type AffiliateCampaignSourceV1,
  validateAffiliateCampaignSource,
} from '../domain/affiliate-campaign-source.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ShopeeCatalogCommit } from '../infrastructure/shopee-catalog-commit.js';
import type { ReviewedRegistrationPayload } from '../domain/reviewed-registration.js';
import { AFFILIATE_REPOSITORY } from './ports/affiliate-repository.port.js';
import type {
  AffiliateRepository,
  AffiliateRepositoryFactory,
} from './ports/affiliate-repository.port.js';
import { PROJECT_SNAPSHOT_READER } from '../../project/application/ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import {
  affiliateIdentifier,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  collectAffiliateProductIssues,
  immutable,
} from '../domain/affiliate-contracts.js';
import type {
  AffiliateCampaign,
  AffiliateBriefing,
  AffiliateProduct,
  AffiliateProductIssue,
} from '../domain/affiliate-contracts.js';
import type { ShopeeOfferSelection } from '../domain/shopee-offer-candidate.js';
import {
  AffiliateRepositoryError,
  ContractValidationError,
} from '../domain/affiliate.errors.js';
import {
  commandEnvelope,
  validateBriefingInput,
} from './affiliate-commands.dto.js';
export type ShopeeEligibilityResult =
  | {
      eligibility: 'BLOCKED';
      pending: readonly AffiliateProductIssue[];
      validatedProduct: null;
    }
  | {
      eligibility: 'ELIGIBLE';
      pending: readonly AffiliateProductIssue[];
      validatedProduct: AffiliateProduct;
    };
@Injectable()
export class AffiliateService<A extends boolean = false> {
  constructor(
    @Inject(AFFILIATE_REPOSITORY)
    private readonly persistence: AffiliateRepositoryFactory<A>,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
    @Optional()
    @Inject(ShopeeCatalogCommit)
    private readonly shopeeCommit?: ShopeeCatalogCommit<boolean>,
  ) {}
  async replayReviewedRegistration(
    payload: ReviewedRegistrationPayload,
    key: string,
  ) {
    if (!this.shopeeCommit)
      throw new Error('AFFILIATE_REVIEW_COMMIT_UNAVAILABLE');
    return this.shopeeCommit.replayReviewed(payload, key);
  }
  async registerReviewedRegistration(
    payload: ReviewedRegistrationPayload,
    key: string,
  ) {
    validateAffiliateProduct(payload.product);
    validateAffiliateCampaign(payload.campaign);
    if (!this.shopeeCommit)
      throw new Error('AFFILIATE_REVIEW_COMMIT_UNAVAILABLE');
    await this.verifyProject(payload.campaign);
    return this.shopeeCommit.commitReviewed(payload, key);
  }
  async prepareShopeeCatalog(
    productValue: unknown,
    campaignValue: unknown,
    sourceValue: unknown,
    verifiedMediaRefs: readonly string[],
    receipt: string,
  ): Promise<AffiliateCampaignSourceV1> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const product = validateAffiliateProduct(productValue);
        const campaign = validateAffiliateCampaign(campaignValue);
        const source = validateAffiliateCampaignSource(sourceValue);
        affiliateIdentifier(`sp_${receipt}`, 'idempotencyKey');
        if (!this.shopeeCommit)
          throw new Error('SHOPEE_CATALOG_COMMIT_REQUIRED');
        yield yield this.verifyProject(campaign);
        return yield this.shopeeCommit.commit(
          product,
          campaign,
          source,
          verifiedMediaRefs,
          receipt,
        );
      }.call(this),
    );
  }
  catalogCandidates(projectId: string): Io<A, AffiliateCatalogCandidate[]> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(projectId, 'projectId');
        const repo = yield this.persistence.open(true);
        try {
          return yield repo.catalogCandidates(projectId);
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
  async createCatalogBriefing(
    value: {
      briefingId: string;
      campaignId: string;
      campaignRevision: number;
    },
    expectedHash: string,
  ): Promise<AffiliateBriefing> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateBriefingInput(value);
        if (!/^[a-f0-9]{64}$/.test(expectedHash))
          throw new AffiliateRepositoryError(
            'INVALID_AFFILIATE_INPUT',
            'expectedHash',
          );
        return yield this.withRepository(
          false,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const campaign = yield repo.getCampaign(
                  value.campaignId,
                  value.campaignRevision,
                );
                if (!campaign)
                  throw new AffiliateRepositoryError(
                    'AFFILIATE_CAMPAIGN_NOT_FOUND',
                    'campaignId',
                  );
                yield yield this.verifyProject(campaign);
                return yield repo.createCatalogBriefing(
                  value,
                  `catalog_${value.briefingId}`,
                  true,
                  expectedHash,
                );
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  // No repository, source adapter, or project reads. Candidate metadata is never evidence.
  evaluateShopeeSelection(
    selection: ShopeeOfferSelection,
    product: unknown,
    verifiedMediaRefs: readonly string[] = [],
  ): ShopeeEligibilityResult {
    if (
      selection?.state !== 'SELECTED' ||
      selection.candidate?.source !== 'SHOPEE_AFFILIATE_API'
    )
      return immutable({
        eligibility: 'BLOCKED',
        pending: [{ code: 'SHOPEE_SELECTION_REQUIRED', field: 'selection' }],
        validatedProduct: null,
      });
    const pending = collectAffiliateProductIssues(product);
    if (
      product &&
      typeof product === 'object' &&
      'media' in product &&
      Array.isArray(product.media)
    ) {
      product.media.forEach((media: unknown, index: number) => {
        if (
          !media ||
          typeof media !== 'object' ||
          !('mediaRef' in media) ||
          !Array.isArray(verifiedMediaRefs) ||
          !verifiedMediaRefs.includes(media.mediaRef as string)
        )
          pending.push({
            code: 'SHOPEE_MEDIA_NOT_VERIFIED',
            field: `media.${index}.mediaRef`,
          });
      });
    }
    if (pending.length)
      return immutable({
        eligibility: 'BLOCKED',
        pending,
        validatedProduct: null,
      });
    return immutable({
      eligibility: 'ELIGIBLE',
      pending: [],
      validatedProduct: validateAffiliateProduct(product),
    });
  }
  async registerShopeeSelection(
    selection: ShopeeOfferSelection,
    product: unknown,
    verifiedMediaRefs: readonly string[],
    idempotencyKey: string,
    confirmed: true,
  ): Promise<AffiliateProduct> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        if (confirmed !== true)
          throw new ContractValidationError(
            'SHOPEE_REGISTRATION_CONFIRMATION_REQUIRED',
            'confirmed',
            'confirmação explícita obrigatória',
          );
        const result = yield this.evaluateShopeeSelection(
          selection,
          product,
          verifiedMediaRefs,
        );
        if (result.eligibility !== 'ELIGIBLE')
          throw new ContractValidationError(
            'SHOPEE_SELECTION_BLOCKED',
            'product',
            'produto inelegível',
          );
        return yield this.registerProduct({
          idempotencyKey,
          product: result.validatedProduct,
        });
      }.call(this),
    );
  }
  async associateCampaignSource(
    command: unknown,
  ): Promise<AffiliateCampaignSourceV1> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        commandEnvelope(command, [
          'idempotencyKey',
          'source',
          'confirmed',
          'verifiedMediaRefs',
        ]);
        if (command.confirmed !== true)
          throw new ContractValidationError(
            'AFFILIATE_SOURCE_CONFIRMATION_REQUIRED',
            'confirmed',
            'confirma��o expl�cita obrigat�ria',
          );
        const source = validateAffiliateCampaignSource(command.source);
        const key = affiliateIdentifier(
          command.idempotencyKey,
          'idempotencyKey',
        );
        const refs = command.verifiedMediaRefs;
        if (
          !Array.isArray(refs) ||
          refs.some((ref) => typeof ref !== 'string' || !ref.trim()) ||
          new Set(refs).size !== refs.length
        )
          throw new AffiliateRepositoryError(
            'INVALID_AFFILIATE_INPUT',
            'verifiedMediaRefs',
          );
        return yield this.withRepository(
          false,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const payload = {
                  source,
                  verifiedMediaRefs: [...refs].sort((a, b) =>
                    a < b ? -1 : a > b ? 1 : 0,
                  ),
                };
                const replay = yield repo.replay<AffiliateCampaignSourceV1>(
                  'CAMPAIGN_SOURCE',
                  payload,
                  key,
                );
                if (replay !== null) return replay;
                const campaign = yield repo.getCampaign(
                  source.campaignId,
                  source.campaignRevision,
                );
                if (!campaign)
                  throw new AffiliateRepositoryError(
                    'AFFILIATE_CAMPAIGN_NOT_FOUND',
                    'campaignRevision',
                  );
                yield yield this.verifyProject(campaign);
                return yield repo.associateCampaignSource(source, key, refs);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async getCampaignSource(
    id: string,
    revision: number,
  ): Promise<AffiliateCampaignSourceV1 | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'sourceId');
        yield this.revision(revision);
        return yield this.withRepository(
          true,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield repo.getCampaignSource(id, revision);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async resolveBriefingSource(
    id: string,
  ): Promise<AffiliateCampaignSourceV1 | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'briefingId');
        return yield this.withRepository(
          true,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield repo.resolveBriefingSource(id);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async registerProduct(command: unknown): Promise<AffiliateProduct> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        commandEnvelope(command, ['idempotencyKey', 'product']);
        const product = validateAffiliateProduct(command.product);
        const key = affiliateIdentifier(
          command.idempotencyKey,
          'idempotencyKey',
        );
        return yield this.withRepository(
          false,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield repo.registerProduct(product, key);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async getProduct(
    id: string,
    revision: number,
  ): Promise<AffiliateProduct | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'productId');
        yield this.revision(revision);
        return yield this.withRepository(
          true,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield repo.getProduct(id, revision);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async registerCampaign(command: unknown): Promise<AffiliateCampaign> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        commandEnvelope(command, ['idempotencyKey', 'campaign']);
        const campaign = validateAffiliateCampaign(command.campaign);
        const key = affiliateIdentifier(
          command.idempotencyKey,
          'idempotencyKey',
        );
        return yield this.withRepository(
          false,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const replay = yield repo.replay<AffiliateCampaign>(
                  'CAMPAIGN',
                  campaign,
                  key,
                );
                if (replay !== null) return replay;
                // Project reads finish before BEGIN IMMEDIATE. Projects have immutable
                // identity; SQLite FK validation remains inside the atomic write/receipt.
                const exists =
                  (yield yield this.projects.get(campaign.projectId)) !== null;
                return yield repo.registerCampaign(campaign, key, exists);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async getCampaign(
    id: string,
    revision: number,
  ): Promise<AffiliateCampaign | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'campaignId');
        yield this.revision(revision);
        return yield this.withRepository(
          true,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const campaign = yield repo.getCampaign(id, revision);
                if (campaign) yield yield this.verifyProject(campaign);
                return campaign;
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async createBriefing(command: unknown): Promise<AffiliateBriefing> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        commandEnvelope(command, [
          'idempotencyKey',
          'briefingId',
          'campaignId',
          'campaignRevision',
        ]);
        const { idempotencyKey, ...input } = command;
        validateBriefingInput(input);
        const key = affiliateIdentifier(idempotencyKey, 'idempotencyKey');
        return yield this.withRepository(
          false,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const replay = yield repo.replay<AffiliateBriefing>(
                  'BRIEFING',
                  input,
                  key,
                );
                if (replay !== null) return replay;
                const campaign = yield repo.getCampaign(
                  input.campaignId,
                  input.campaignRevision,
                );
                if (!campaign)
                  throw new AffiliateRepositoryError(
                    'AFFILIATE_CAMPAIGN_NOT_FOUND',
                    'campaignRevision',
                  );
                yield yield this.verifyProject(campaign);
                return yield repo.createBriefing(input, key, true);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  async getBriefing(id: string): Promise<AffiliateBriefing | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'briefingId');
        return yield this.withRepository(
          true,
          (repo: AffiliateRepository<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const briefing = yield repo.getBriefing(id);
                if (briefing) {
                  const campaign = yield repo.getCampaign(
                    briefing.campaignId,
                    briefing.campaignRevision,
                  );
                  if (!campaign)
                    throw new AffiliateRepositoryError(
                      'AFFILIATE_REFERENCE_MISSING',
                      'campaignId',
                    );
                  yield yield this.verifyProject(campaign);
                }
                return briefing;
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  private async verifyProject(campaign: AffiliateCampaign): Promise<void> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        if (!(yield yield this.projects.get(campaign.projectId)))
          throw new AffiliateRepositoryError(
            'AFFILIATE_REFERENCE_MISSING',
            'campaignId',
          );
      }.call(this),
    );
  }
  private revision(value: number) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new AffiliateRepositoryError(
        'INVALID_AFFILIATE_REVISION',
        'revision',
      );
  }
  private async withRepository<T>(
    readOnly: boolean,
    operation: (repo: AffiliateRepository) => T | Promise<T>,
  ): Promise<T> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const repo = yield this.persistence.open(readOnly);
        try {
          return yield yield operation(repo);
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
}
