import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  materializeAffiliateBriefing,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  validateAffiliateBriefing,
} from '../domain/affiliate-contracts.js';
import type {
  AffiliateProduct,
  AffiliateCampaign,
  AffiliateBriefing,
} from '../domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import type {
  AffiliateRepository,
  CreateBriefingInput,
} from '../application/ports/affiliate-repository.port.js';
import { validateBriefingInput } from '../application/affiliate-commands.dto.js';
import {
  validateAffiliateCampaignSource,
  type AffiliateCampaignSourceV1,
} from '../domain/affiliate-campaign-source.js';

type Row = Record<string, SQLOutputValue>;

export class SqliteAffiliateRepository implements AffiliateRepository {
  readonly db: DatabaseSync;
  constructor(path: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    // Opening read-only first guarantees an absent file is never created.
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        ![39, 40, 41, 42].includes(
          Number(preflight.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(preflight.prepare('PRAGMA user_version').get()?.user_version) >=
          41 &&
          preflight
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw failure('AFFILIATE_SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion');
    } finally {
      preflight.close();
    }
    this.db = new DatabaseSync(path, { readOnly });
    try {
      if (readOnly) this.db.exec('PRAGMA query_only=ON;');
      else
        this.db.exec(
          'PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;',
        );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  registerProduct(value: unknown, key: string) {
    const product = validateAffiliateProduct(value);
    return this.command('PRODUCT', product, key, () => {
      const prior = this.getProduct(product.productId, product.revision);
      if (prior) return sameRevision(prior, product);
      this.nextRevision(
        'affiliate_product_revisions',
        'product_id',
        product.productId,
        product.revision,
      );
      this.db
        .prepare('INSERT INTO affiliate_product_revisions VALUES (?,?,?,?)')
        .run(
          product.productId,
          product.revision,
          affiliateHash(product),
          JSON.stringify(product),
        );
      return product;
    });
  }
  getProduct(id: string, revision: number): AffiliateProduct | null {
    affiliateIdentifier(id, 'productId');
    positive(revision, 'revision');
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_product_revisions WHERE product_id=? AND revision=?',
      )
      .get(id, revision);
    if (!row) return null;
    const product = this.read(row, validateAffiliateProduct);
    if (product.productId !== id || product.revision !== revision)
      throw failure('AFFILIATE_SCOPE_MISMATCH', 'productId');
    return product;
  }
  registerCampaign(value: unknown, key: string, projectExists: boolean) {
    const campaign = validateAffiliateCampaign(value);
    return this.command('CAMPAIGN', campaign, key, () => {
      if (!projectExists) throw failure('PROJECT_NOT_FOUND', 'projectId');
      if (!this.getProduct(campaign.productId, campaign.productRevision))
        throw failure('AFFILIATE_PRODUCT_NOT_FOUND', 'productRevision');
      const prior = this.getCampaign(campaign.campaignId, campaign.revision);
      if (prior) return sameRevision(prior, campaign);
      this.nextRevision(
        'affiliate_campaign_revisions',
        'campaign_id',
        campaign.campaignId,
        campaign.revision,
      );
      this.db
        .prepare(
          'INSERT INTO affiliate_campaign_revisions VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          campaign.campaignId,
          campaign.revision,
          campaign.projectId,
          campaign.productId,
          campaign.productRevision,
          affiliateHash(campaign),
          JSON.stringify(campaign),
        );
      return campaign;
    });
  }
  getCampaign(id: string, revision: number): AffiliateCampaign | null {
    affiliateIdentifier(id, 'campaignId');
    positive(revision, 'revision');
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_campaign_revisions WHERE campaign_id=? AND revision=?',
      )
      .get(id, revision);
    if (!row) return null;
    const campaign = this.read(row, validateAffiliateCampaign);
    if (
      campaign.campaignId !== id ||
      campaign.revision !== revision ||
      campaign.projectId !== row.project_id ||
      campaign.productId !== row.product_id ||
      campaign.productRevision !== row.product_revision
    )
      throw failure('AFFILIATE_SCOPE_MISMATCH', 'campaignId');
    if (!this.getProduct(campaign.productId, campaign.productRevision))
      throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    return campaign;
  }
  createBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
  ) {
    validateBriefingInput(value);
    return this.command('BRIEFING', value, key, () =>
      this.storeBriefing(value, projectExists),
    );
  }
  private storeBriefing(value: CreateBriefingInput, projectExists: boolean) {
    const campaign = this.getCampaign(value.campaignId, value.campaignRevision);
    if (!campaign)
      throw failure('AFFILIATE_CAMPAIGN_NOT_FOUND', 'campaignRevision');
    if (!projectExists)
      throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    const product = this.getProduct(
      campaign.productId,
      campaign.productRevision,
    );
    const briefing = materializeAffiliateBriefing(
      value.briefingId,
      campaign,
      product,
    );
    const prior = this.getBriefing(value.briefingId);
    if (prior) return sameRevision(prior, briefing);
    this.db
      .prepare('INSERT INTO affiliate_briefings VALUES (?,?,?,?,?)')
      .run(
        briefing.briefingId,
        briefing.campaignId,
        briefing.campaignRevision,
        briefing.contentHash,
        JSON.stringify(briefing),
      );
    return briefing;
  }

  getBriefing(id: string): AffiliateBriefing | null {
    affiliateIdentifier(id, 'briefingId');
    const row = this.db
      .prepare('SELECT * FROM affiliate_briefings WHERE briefing_id=?')
      .get(id);
    if (!row) return null;
    const briefing = this.read(row, validateAffiliateBriefing);
    if (
      briefing.briefingId !== id ||
      briefing.campaignId !== row.campaign_id ||
      briefing.campaignRevision !== row.campaign_revision
    )
      throw failure('AFFILIATE_SCOPE_MISMATCH', 'briefingId');
    const campaign = this.getCampaign(
      briefing.campaignId,
      briefing.campaignRevision,
    );
    if (!campaign) throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    const product = this.getProduct(
      briefing.productId,
      briefing.productRevision,
    );
    if (!product) throw failure('AFFILIATE_REFERENCE_MISSING', 'productId');
    if (
      materializeAffiliateBriefing(id, campaign, product).contentHash !==
      briefing.contentHash
    )
      throw failure('AFFILIATE_HASH_MISMATCH', 'briefingId');
    return briefing;
  }
  getCampaignSource(
    id: string,
    revision: number,
  ): AffiliateCampaignSourceV1 | null {
    affiliateIdentifier(id, 'sourceId');
    positive(revision, 'revision');
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_campaign_sources_v1 WHERE source_id=? AND revision=?',
      )
      .get(id, revision);
    if (!row) return null;
    const source = this.read(row, validateAffiliateCampaignSource);
    if (
      source.sourceId !== id ||
      source.revision !== revision ||
      source.campaignId !== row.campaign_id ||
      source.campaignRevision !== row.campaign_revision ||
      source.productId !== row.product_id ||
      source.productRevision !== row.product_revision ||
      source.briefingId !== row.briefing_id
    )
      throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'source');
    const campaign = this.getCampaign(
      source.campaignId,
      source.campaignRevision,
    );
    if (
      !campaign ||
      campaign.productId !== source.productId ||
      campaign.productRevision !== source.productRevision ||
      campaign.affiliateUrl !== source.affiliateUrl
    )
      throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'campaign');
    if (source.briefingId !== null) {
      const briefing = this.getBriefing(source.briefingId);
      if (
        !briefing ||
        briefing.campaignId !== source.campaignId ||
        briefing.campaignRevision !== source.campaignRevision
      )
        throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'briefingId');
    }
    return source;
  }
  associateCampaignSource(
    value: unknown,
    key: string,
    verifiedMediaRefs: readonly string[],
  ) {
    const source = validateAffiliateCampaignSource(value);
    if (
      !Array.isArray(verifiedMediaRefs) ||
      verifiedMediaRefs.some((ref) => typeof ref !== 'string' || !ref.trim()) ||
      new Set(verifiedMediaRefs).size !== verifiedMediaRefs.length
    )
      throw failure('INVALID_AFFILIATE_INPUT', 'verifiedMediaRefs');
    const payload = {
      source,
      verifiedMediaRefs: [...verifiedMediaRefs].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    };
    return this.command('CAMPAIGN_SOURCE', payload, key, () => {
      const product = this.getProduct(source.productId, source.productRevision);
      if (!product)
        throw failure('AFFILIATE_PRODUCT_NOT_FOUND', 'productRevision');
      if (
        product.media.some(
          (media) => !verifiedMediaRefs.includes(media.mediaRef),
        )
      )
        throw failure('SHOPEE_MEDIA_NOT_VERIFIED', 'verifiedMediaRefs');
      const campaign = this.getCampaign(
        source.campaignId,
        source.campaignRevision,
      );
      if (!campaign)
        throw failure('AFFILIATE_CAMPAIGN_NOT_FOUND', 'campaignRevision');
      if (
        campaign.productId !== source.productId ||
        campaign.productRevision !== source.productRevision ||
        campaign.affiliateUrl !== source.affiliateUrl
      )
        throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'campaign');
      const existing = this.getCampaignSource(source.sourceId, source.revision);
      if (existing) {
        if (affiliateHash(existing) !== affiliateHash(source))
          throw failure('AFFILIATE_SOURCE_CONFLICT', 'source');
        return existing;
      }
      const owner = this.db
        .prepare(
          'SELECT source_id FROM affiliate_campaign_sources_v1 WHERE campaign_id=? AND campaign_revision=? LIMIT 1',
        )
        .get(source.campaignId, source.campaignRevision);
      if (owner && owner.source_id !== source.sourceId)
        throw failure('AFFILIATE_SOURCE_CONFLICT', 'sourceId');
      const latest =
        this.db
          .prepare(
            'SELECT MAX(revision) revision FROM affiliate_campaign_sources_v1 WHERE source_id=?',
          )
          .get(source.sourceId)?.revision ?? 0;
      if (source.revision !== Number(latest) + 1)
        throw failure('AFFILIATE_SOURCE_CONFLICT', 'revision');
      if (Number(latest) > 0) {
        const previous = this.getCampaignSource(
          source.sourceId,
          Number(latest),
        )!;
        // Later snapshots may only reference their explicitly created briefing.
        if (
          source.briefingId === null ||
          affiliateHash({
            ...source,
            revision: previous.revision,
            briefingId: previous.briefingId,
          }) !== affiliateHash(previous)
        )
          throw failure('AFFILIATE_SOURCE_CONFLICT', 'source');
      }
      if (source.briefingId !== null) {
        if (this.getBriefing(source.briefingId))
          throw failure('AFFILIATE_SOURCE_BRIEFING_EXISTS', 'briefingId');
        this.storeBriefing(
          {
            briefingId: source.briefingId,
            campaignId: source.campaignId,
            campaignRevision: source.campaignRevision,
          },
          true,
        );
      }
      this.db
        .prepare(
          'INSERT INTO affiliate_campaign_sources_v1 VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          source.sourceId,
          source.revision,
          source.campaignId,
          source.campaignRevision,
          source.productId,
          source.productRevision,
          source.briefingId,
          affiliateHash(source),
          JSON.stringify(source),
        );
      return source;
    });
  }
  replay<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'BIND_RUN' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
  ): T | null {
    affiliateIdentifier(key, 'idempotencyKey');
    const prior = this.db
      .prepare('SELECT * FROM affiliate_commands WHERE idempotency_key=?')
      .get(key);
    if (!prior) return null;
    if (
      prior.command_type !== type ||
      prior.payload_hash !== affiliateHash(payload)
    )
      throw failure('AFFILIATE_IDEMPOTENCY_CONFLICT', 'idempotencyKey');
    let result: T;
    try {
      result = JSON.parse(prior.result_json as string) as T;
    } catch (cause) {
      throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'result', { cause });
    }
    if (affiliateHash(result) !== prior.result_hash)
      throw failure('AFFILIATE_HASH_MISMATCH', 'result');
    return immutable(result);
  }
  private read<T>(row: Row, validator: (value: unknown) => T): T {
    let value: T;
    try {
      value = validator(JSON.parse(row.content_json as string));
    } catch (cause) {
      throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'content', { cause });
    }
    if (affiliateHash(value) !== row.content_hash)
      throw failure('AFFILIATE_HASH_MISMATCH', 'contentHash');
    return value;
  }
  private nextRevision(
    table: 'affiliate_product_revisions' | 'affiliate_campaign_revisions',
    column: 'product_id' | 'campaign_id',
    id: string,
    revision: number,
  ) {
    const latest =
      this.db
        .prepare(
          `SELECT MAX(revision) revision FROM ${table} WHERE ${column}=?`,
        )
        .get(id)?.revision ?? 0;
    if (revision !== Number(latest) + 1)
      throw failure('AFFILIATE_REVISION_CONFLICT', 'revision');
  }
  protected command<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'BIND_RUN' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
    operation: () => T,
  ): T {
    affiliateIdentifier(key, 'idempotencyKey');
    const hash = affiliateHash(payload);
    return this.transaction(() => {
      const cached = this.replay<T>(type, payload, key);
      const result = cached ?? operation();
      if (cached === null)
        this.db
          .prepare('INSERT INTO affiliate_commands VALUES (?,?,?,?,?)')
          .run(key, type, hash, affiliateHash(result), JSON.stringify(result));
      return result;
    });
  }
  transaction<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
function sameRevision<T>(prior: T, value: T) {
  if (affiliateHash(prior) !== affiliateHash(value))
    throw failure('AFFILIATE_REVISION_CONFLICT', 'revision');
  return prior;
}
function positive(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw failure('INVALID_AFFILIATE_REVISION', field);
}
function failure(code: string, field: string, options?: ErrorOptions) {
  return new AffiliateRepositoryError(code, field, options);
}
