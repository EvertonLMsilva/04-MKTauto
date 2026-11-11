import { runAffiliateIo } from '../application/affiliate-io.js';
import type { AffiliateSession, AffiliateSql } from './affiliate-sql.js';
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
import { ContractValidationError } from '../domain/affiliate.errors.js';
import type { AffiliateCatalogCandidate } from '../domain/affiliate-catalog.js';
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
  readonly sql: AffiliateSql;
  private readonly sqlite?: DatabaseSync;
  protected readonly session?: AffiliateSession;
  get db(): DatabaseSync {
    if (!this.sqlite) throw new Error('AFFILIATE_NATIVE_SQLITE_UNAVAILABLE');
    return this.sqlite;
  }
  constructor(
    path: string | AffiliateSession,
    {
      readOnly = false,
    }: {
      readOnly?: boolean;
    } = {},
  ) {
    if (typeof path !== 'string') {
      this.session = path;
      this.sql = path.sql;
      return;
    }
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    // Opening read-only first guarantees an absent file is never created.
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        ![39, 40, 41, 42, 43, 44].includes(
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
    this.sqlite = new DatabaseSync(path, { readOnly });
    this.sql = this.sqlite;
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
    if (this.session) this.session.close();
    else this.db.close();
  }
  catalogCandidates(projectId: string): AffiliateCatalogCandidate[] {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(projectId, 'projectId');
        const rows = yield this.sql
          .prepare(
            `SELECT c.campaign_id,c.revision FROM affiliate_campaign_revisions c
      WHERE c.project_id=? AND c.revision=(SELECT MAX(n.revision) FROM affiliate_campaign_revisions n WHERE n.campaign_id=c.campaign_id)
      AND c.product_revision=(SELECT MAX(p.revision) FROM affiliate_product_revisions p WHERE p.product_id=c.product_id)
      ORDER BY c.product_id,c.product_revision,c.campaign_id`,
          )
          .all(projectId);
        const candidates = new Map<string, AffiliateCatalogCandidate>();
        for (const row of rows) {
          try {
            const campaign = (yield this.getCampaign(
              String(row.campaign_id),
              Number(row.revision),
            ))!;
            const product = (yield this.getProduct(
              campaign.productId,
              campaign.productRevision,
            ))!;
            if (!candidates.has(product.productId))
              candidates.set(product.productId, { campaign, product });
          } catch (error) {
            if (!(
              error instanceof ContractValidationError ||
              error instanceof AffiliateRepositoryError
            ))
              throw error;
          }
        }
        return [...candidates.values()];
      }.call(this),
    );
  }
  registerProduct(value: unknown, key: string) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const product = validateAffiliateProduct(value);
        return yield this.command('PRODUCT', product, key, () =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.getProduct(
                product.productId,
                product.revision,
              );
              if (prior) return sameRevision(prior, product);
              yield this.nextRevision(
                'affiliate_product_revisions',
                'product_id',
                product.productId,
                product.revision,
              );
              yield this.sql
                .prepare(
                  'INSERT INTO affiliate_product_revisions VALUES (?,?,?,?)',
                )
                .run(
                  product.productId,
                  product.revision,
                  affiliateHash(product),
                  JSON.stringify(product),
                );
              return product;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  getProduct(id: string, revision: number): AffiliateProduct | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'productId');
        positive(revision, 'revision');
        const row = yield this.sql
          .prepare(
            'SELECT * FROM affiliate_product_revisions WHERE product_id=? AND revision=?',
          )
          .get(id, revision);
        if (!row) return null;
        const product = yield this.read(row, validateAffiliateProduct);
        if (product.productId !== id || product.revision !== revision)
          throw failure('AFFILIATE_SCOPE_MISMATCH', 'productId');
        return product;
      }.call(this),
    );
  }
  registerCampaign(value: unknown, key: string, projectExists: boolean) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const campaign = validateAffiliateCampaign(value);
        return yield this.command('CAMPAIGN', campaign, key, () =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              if (!projectExists)
                throw failure('PROJECT_NOT_FOUND', 'projectId');
              if (
                !(yield this.getProduct(
                  campaign.productId,
                  campaign.productRevision,
                ))
              )
                throw failure('AFFILIATE_PRODUCT_NOT_FOUND', 'productRevision');
              const prior = yield this.getCampaign(
                campaign.campaignId,
                campaign.revision,
              );
              if (prior) return sameRevision(prior, campaign);
              yield this.nextRevision(
                'affiliate_campaign_revisions',
                'campaign_id',
                campaign.campaignId,
                campaign.revision,
              );
              yield this.sql
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
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  getCampaign(id: string, revision: number): AffiliateCampaign | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'campaignId');
        positive(revision, 'revision');
        const row = yield this.sql
          .prepare(
            'SELECT * FROM affiliate_campaign_revisions WHERE campaign_id=? AND revision=?',
          )
          .get(id, revision);
        if (!row) return null;
        const campaign = yield this.read(row, validateAffiliateCampaign);
        if (
          campaign.campaignId !== id ||
          campaign.revision !== revision ||
          campaign.projectId !== row.project_id ||
          campaign.productId !== row.product_id ||
          campaign.productRevision !== row.product_revision
        )
          throw failure('AFFILIATE_SCOPE_MISMATCH', 'campaignId');
        if (
          !(yield this.getProduct(campaign.productId, campaign.productRevision))
        )
          throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
        return campaign;
      }.call(this),
    );
  }
  createBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
  ) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateBriefingInput(value);
        return yield this.command('BRIEFING', value, key, () =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              return yield this.storeBriefing(value, projectExists);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private storeBriefing(value: CreateBriefingInput, projectExists: boolean) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const campaign = yield this.getCampaign(
          value.campaignId,
          value.campaignRevision,
        );
        if (!campaign)
          throw failure('AFFILIATE_CAMPAIGN_NOT_FOUND', 'campaignRevision');
        if (!projectExists)
          throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
        const product = yield this.getProduct(
          campaign.productId,
          campaign.productRevision,
        );
        const briefing = materializeAffiliateBriefing(
          value.briefingId,
          campaign,
          product,
        );
        const prior = yield this.getBriefing(value.briefingId);
        if (prior) return sameRevision(prior, briefing);
        yield this.sql
          .prepare('INSERT INTO affiliate_briefings VALUES (?,?,?,?,?)')
          .run(
            briefing.briefingId,
            briefing.campaignId,
            briefing.campaignRevision,
            briefing.contentHash,
            JSON.stringify(briefing),
          );
        return briefing;
      }.call(this),
    );
  }
  createCatalogBriefing(
    value: CreateBriefingInput,
    key: string,
    projectExists: boolean,
    expectedHash: string,
  ) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateBriefingInput(value);
        return yield this.command(
          'BRIEFING',
          { ...value, expectedHash },
          key,
          () =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const briefing = yield this.storeBriefing(value, projectExists);
                if (briefing.contentHash !== expectedHash)
                  throw failure('AFFILIATE_HASH_MISMATCH', 'briefingId');
                if (yield this.hasCampaignSources()) {
                  const row = yield this.sql
                    .prepare(
                      `SELECT source_id,revision,briefing_id FROM affiliate_campaign_sources_v1
          WHERE campaign_id=? AND campaign_revision=? ORDER BY revision DESC LIMIT 1`,
                    )
                    .get(value.campaignId, value.campaignRevision);
                  if (row && row.briefing_id !== briefing.briefingId) {
                    const source = (yield this.getCampaignSource(
                      String(row.source_id),
                      Number(row.revision),
                    ))!;
                    // Existing provenance may be rebound only to a new immutable briefing of
                    // the same product/offer. No discovery, verification or external effect.
                    const next = validateAffiliateCampaignSource({
                      ...source,
                      revision: source.revision + 1,
                      briefingId: briefing.briefingId,
                    });
                    yield this.sql
                      .prepare(
                        'INSERT INTO affiliate_campaign_sources_v1 VALUES(?,?,?,?,?,?,?,?,?)',
                      )
                      .run(
                        next.sourceId,
                        next.revision,
                        next.campaignId,
                        next.campaignRevision,
                        next.productId,
                        next.productRevision,
                        next.briefingId,
                        affiliateHash(next),
                        JSON.stringify(next),
                      );
                  }
                }
                return briefing;
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  getBriefing(id: string): AffiliateBriefing | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'briefingId');
        const row = yield this.sql
          .prepare('SELECT * FROM affiliate_briefings WHERE briefing_id=?')
          .get(id);
        if (!row) return null;
        const briefing = yield this.read(row, validateAffiliateBriefing);
        if (
          briefing.briefingId !== id ||
          briefing.campaignId !== row.campaign_id ||
          briefing.campaignRevision !== row.campaign_revision
        )
          throw failure('AFFILIATE_SCOPE_MISMATCH', 'briefingId');
        const campaign = yield this.getCampaign(
          briefing.campaignId,
          briefing.campaignRevision,
        );
        if (!campaign)
          throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
        const product = yield this.getProduct(
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
      }.call(this),
    );
  }
  resolveBriefingSource(id: string): AffiliateCampaignSourceV1 | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const briefing = yield this.getBriefing(id);
        if (!briefing)
          throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
        // Supported historical catalogs predate the additive Shopee extension.
        if (!(yield this.hasCampaignSources())) return null;
        const rows = yield this.sql
          .prepare(
            'SELECT source_id,revision,briefing_id FROM affiliate_campaign_sources_v1 WHERE briefing_id=? OR (campaign_id=? AND campaign_revision=?)',
          )
          .all(id, briefing.campaignId, briefing.campaignRevision);
        const linked = rows.filter((row: Row) => row.briefing_id === id);
        if (linked.length > 1)
          throw failure('AFFILIATE_SOURCE_AMBIGUOUS', 'briefingId');
        if (!linked.length) {
          if (rows.length)
            throw failure('AFFILIATE_SOURCE_BRIEFING_NOT_BOUND', 'briefingId');
          return null;
        }
        const row = linked[0];
        const source = yield this.getCampaignSource(
          String(row.source_id),
          Number(row.revision),
        );
        if (
          !source ||
          source.briefingId !== id ||
          source.campaignId !== briefing.campaignId ||
          source.campaignRevision !== briefing.campaignRevision ||
          source.productId !== briefing.productId ||
          source.productRevision !== briefing.productRevision
        )
          throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'briefingId');
        return source;
      }.call(this),
    );
  }
  getCampaignSource(
    id: string,
    revision: number,
  ): AffiliateCampaignSourceV1 | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'sourceId');
        positive(revision, 'revision');
        const row = yield this.sql
          .prepare(
            'SELECT * FROM affiliate_campaign_sources_v1 WHERE source_id=? AND revision=?',
          )
          .get(id, revision);
        if (!row) return null;
        const source = yield this.read(row, validateAffiliateCampaignSource);
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
        const campaign = yield this.getCampaign(
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
          const briefing = yield this.getBriefing(source.briefingId);
          if (
            !briefing ||
            briefing.campaignId !== source.campaignId ||
            briefing.campaignRevision !== source.campaignRevision
          )
            throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'briefingId');
        }
        return source;
      }.call(this),
    );
  }
  associateCampaignSource(
    value: unknown,
    key: string,
    verifiedMediaRefs: readonly string[],
  ) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const source = validateAffiliateCampaignSource(value);
        if (
          !Array.isArray(verifiedMediaRefs) ||
          verifiedMediaRefs.some(
            (ref) => typeof ref !== 'string' || !ref.trim(),
          ) ||
          new Set(verifiedMediaRefs).size !== verifiedMediaRefs.length
        )
          throw failure('INVALID_AFFILIATE_INPUT', 'verifiedMediaRefs');
        const payload = {
          source,
          verifiedMediaRefs: [...verifiedMediaRefs].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        };
        return yield this.command('CAMPAIGN_SOURCE', payload, key, () =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              const product = yield this.getProduct(
                source.productId,
                source.productRevision,
              );
              if (!product)
                throw failure('AFFILIATE_PRODUCT_NOT_FOUND', 'productRevision');
              if (
                product.media.some(
                  (media: { mediaRef: string }) =>
                    !verifiedMediaRefs.includes(media.mediaRef),
                )
              )
                throw failure('SHOPEE_MEDIA_NOT_VERIFIED', 'verifiedMediaRefs');
              const campaign = yield this.getCampaign(
                source.campaignId,
                source.campaignRevision,
              );
              if (!campaign)
                throw failure(
                  'AFFILIATE_CAMPAIGN_NOT_FOUND',
                  'campaignRevision',
                );
              if (
                campaign.productId !== source.productId ||
                campaign.productRevision !== source.productRevision ||
                campaign.affiliateUrl !== source.affiliateUrl
              )
                throw failure('AFFILIATE_SOURCE_SCOPE_MISMATCH', 'campaign');
              const existing = yield this.getCampaignSource(
                source.sourceId,
                source.revision,
              );
              if (existing) {
                if (affiliateHash(existing) !== affiliateHash(source))
                  throw failure('AFFILIATE_SOURCE_CONFLICT', 'source');
                return existing;
              }
              const owner = yield this.sql
                .prepare(
                  'SELECT source_id FROM affiliate_campaign_sources_v1 WHERE campaign_id=? AND campaign_revision=? LIMIT 1',
                )
                .get(source.campaignId, source.campaignRevision);
              if (owner && owner.source_id !== source.sourceId)
                throw failure('AFFILIATE_SOURCE_CONFLICT', 'sourceId');
              const latest =
                (yield this.sql
                  .prepare(
                    'SELECT MAX(revision) revision FROM affiliate_campaign_sources_v1 WHERE source_id=?',
                  )
                  .get(source.sourceId))?.revision ?? 0;
              if (source.revision !== Number(latest) + 1)
                throw failure('AFFILIATE_SOURCE_CONFLICT', 'revision');
              if (Number(latest) > 0) {
                const previous = (yield this.getCampaignSource(
                  source.sourceId,
                  Number(latest),
                ))!;
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
                if (yield this.getBriefing(source.briefingId))
                  throw failure(
                    'AFFILIATE_SOURCE_BRIEFING_EXISTS',
                    'briefingId',
                  );
                yield this.storeBriefing(
                  {
                    briefingId: source.briefingId,
                    campaignId: source.campaignId,
                    campaignRevision: source.campaignRevision,
                  },
                  true,
                );
              }
              yield this.sql
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
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  replay<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'BIND_RUN' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
  ): T | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(key, 'idempotencyKey');
        const prior = yield this.sql
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
          throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'result', {
            cause,
          });
        }
        if (affiliateHash(result) !== prior.result_hash)
          throw failure('AFFILIATE_HASH_MISMATCH', 'result');
        return immutable(result);
      }.call(this),
    );
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
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const latest =
          (yield this.sql
            .prepare(
              `SELECT MAX(revision) revision FROM ${table} WHERE ${column}=?`,
            )
            .get(id))?.revision ?? 0;
        if (revision !== Number(latest) + 1)
          throw failure('AFFILIATE_REVISION_CONFLICT', 'revision');
      }.call(this),
    );
  }
  protected command<T>(
    type: 'PRODUCT' | 'CAMPAIGN' | 'BRIEFING' | 'BIND_RUN' | 'CAMPAIGN_SOURCE',
    payload: unknown,
    key: string,
    operation: () => T,
  ): T {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(key, 'idempotencyKey');
        const hash = affiliateHash(payload);
        return yield this.transaction(() =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              const cached = yield this.replay(type, payload, key);
              const result = cached ?? (yield operation());
              if (cached === null)
                yield this.sql
                  .prepare('INSERT INTO affiliate_commands VALUES (?,?,?,?,?)')
                  .run(
                    key,
                    type,
                    hash,
                    affiliateHash(result),
                    JSON.stringify(result),
                  );
              return result;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private hasCampaignSources(): boolean {
    return this.session
      ? true
      : Number(this.db.prepare('PRAGMA user_version').get()?.user_version) >=
          42;
  }
  transaction<T>(operation: () => T): T {
    if (this.session) return this.session.transaction(operation);
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
