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
} from '../domain/affiliate-contracts.js';
import type {
  AffiliateCampaign,
  AffiliateBriefing,
} from '../domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import {
  commandEnvelope,
  validateBriefingInput,
} from './affiliate-commands.dto.js';

@Injectable()
export class AffiliateService {
  constructor(
    @Inject(AFFILIATE_REPOSITORY)
    private readonly persistence: AffiliateRepositoryFactory,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
  ) {}
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
