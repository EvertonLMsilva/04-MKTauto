import {
  type AffiliateCampaignSourceV1,
  validateAffiliateCampaignSource,
} from '../domain/affiliate-campaign-source.js';
import { Inject, Injectable } from '@nestjs/common';
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
export class AffiliateService {
  constructor(
    @Inject(AFFILIATE_REPOSITORY)
    private readonly persistence: AffiliateRepositoryFactory,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
  ) {}
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
  ) {
    if (confirmed !== true)
      throw new ContractValidationError(
        'SHOPEE_REGISTRATION_CONFIRMATION_REQUIRED',
        'confirmed',
        'confirmação explícita obrigatória',
      );
    const result = this.evaluateShopeeSelection(
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
    return this.registerProduct({
      idempotencyKey,
      product: result.validatedProduct,
    });
  }
  async associateCampaignSource(command: unknown) {
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
    const key = affiliateIdentifier(command.idempotencyKey, 'idempotencyKey');
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
    return this.withRepository(false, async (repo) => {
      const payload = {
        source,
        verifiedMediaRefs: [...refs].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      };
      const replay = repo.replay<AffiliateCampaignSourceV1>(
        'CAMPAIGN_SOURCE',
        payload,
        key,
      );
      if (replay !== null) return replay;
      const campaign = repo.getCampaign(
        source.campaignId,
        source.campaignRevision,
      );
      if (!campaign)
        throw new AffiliateRepositoryError(
          'AFFILIATE_CAMPAIGN_NOT_FOUND',
          'campaignRevision',
        );
      await this.verifyProject(campaign);
      return repo.associateCampaignSource(source, key, refs);
    });
  }
  async getCampaignSource(id: string, revision: number) {
    affiliateIdentifier(id, 'sourceId');
    this.revision(revision);
    return this.withRepository(true, (repo) =>
      repo.getCampaignSource(id, revision),
    );
  }
  async resolveBriefingSource(id: string) {
    affiliateIdentifier(id, 'briefingId');
    return this.withRepository(true, (repo) => repo.resolveBriefingSource(id));
  }
  async registerProduct(command: unknown) {
    commandEnvelope(command, ['idempotencyKey', 'product']);
    const product = validateAffiliateProduct(command.product);
    const key = affiliateIdentifier(command.idempotencyKey, 'idempotencyKey');
    return this.withRepository(false, (repo) =>
      repo.registerProduct(product, key),
    );
  }
  async getProduct(id: string, revision: number) {
    affiliateIdentifier(id, 'productId');
    this.revision(revision);
    return this.withRepository(true, (repo) => repo.getProduct(id, revision));
  }
  async registerCampaign(command: unknown) {
    commandEnvelope(command, ['idempotencyKey', 'campaign']);
    const campaign = validateAffiliateCampaign(command.campaign);
    const key = affiliateIdentifier(command.idempotencyKey, 'idempotencyKey');
    return this.withRepository(false, async (repo) => {
      const replay = repo.replay<AffiliateCampaign>('CAMPAIGN', campaign, key);
      if (replay !== null) return replay;
      // Project reads finish before BEGIN IMMEDIATE. Projects have immutable
      // identity; SQLite FK validation remains inside the atomic write/receipt.
      const exists = (await this.projects.get(campaign.projectId)) !== null;
      return repo.registerCampaign(campaign, key, exists);
    });
  }
  async getCampaign(id: string, revision: number) {
    affiliateIdentifier(id, 'campaignId');
    this.revision(revision);
    return this.withRepository(true, async (repo) => {
      const campaign = repo.getCampaign(id, revision);
      if (campaign) await this.verifyProject(campaign);
      return campaign;
    });
  }
  async createBriefing(command: unknown) {
    commandEnvelope(command, [
      'idempotencyKey',
      'briefingId',
      'campaignId',
      'campaignRevision',
    ]);
    const { idempotencyKey, ...input } = command;
    validateBriefingInput(input);
    const key = affiliateIdentifier(idempotencyKey, 'idempotencyKey');
    return this.withRepository(false, async (repo) => {
      const replay = repo.replay<AffiliateBriefing>('BRIEFING', input, key);
      if (replay !== null) return replay;
      const campaign = repo.getCampaign(
        input.campaignId,
        input.campaignRevision,
      );
      if (!campaign)
        throw new AffiliateRepositoryError(
          'AFFILIATE_CAMPAIGN_NOT_FOUND',
          'campaignRevision',
        );
      await this.verifyProject(campaign);
      return repo.createBriefing(input, key, true);
    });
  }
  async getBriefing(id: string) {
    affiliateIdentifier(id, 'briefingId');
    return this.withRepository(true, async (repo) => {
      const briefing = repo.getBriefing(id);
      if (briefing) {
        const campaign = repo.getCampaign(
          briefing.campaignId,
          briefing.campaignRevision,
        );
        if (!campaign)
          throw new AffiliateRepositoryError(
            'AFFILIATE_REFERENCE_MISSING',
            'campaignId',
          );
        await this.verifyProject(campaign);
      }
      return briefing;
    });
  }
  private async verifyProject(campaign: AffiliateCampaign) {
    if (!(await this.projects.get(campaign.projectId)))
      throw new AffiliateRepositoryError(
        'AFFILIATE_REFERENCE_MISSING',
        'campaignId',
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
    const repo = this.persistence.open(readOnly);
    try {
      return await operation(repo);
    } finally {
      repo.close();
    }
  }
}
