import {
  affiliateHash, affiliateIdentifier, immutable, materializeAffiliateBriefing,
  validateAffiliateBriefing, validateAffiliateCampaign, validateAffiliateProduct,
} from './domain/affiliate-contracts.js';

export class AffiliateRepositoryError extends Error {
  constructor(code, field, options) {
    super(`${code}: ${field}`, options); this.name = 'AffiliateRepositoryError'; this.code = code; this.field = field;
  }
}

// Shares the connection and migration lifecycle of the existing repository.
export class AffiliateRepository {
  constructor(repository) {
    if (!repository?.db || typeof repository.getRun !== 'function' || typeof repository.get !== 'function') throw new TypeError('repositório de pipeline obrigatório');
    this.repository = repository; this.db = repository.db;
  }

  registerProduct(value, idempotencyKey) {
    const product = validateAffiliateProduct(value);
    return this.#command('PRODUCT', product, idempotencyKey, () => {
      const prior = this.getProduct(product.productId, product.revision);
      if (prior) return sameRevision(prior, product);
      this.#nextRevision('affiliate_product_revisions', 'product_id', product.productId, product.revision);
      this.db.prepare('INSERT INTO affiliate_product_revisions VALUES (?, ?, ?, ?)')
        .run(product.productId, product.revision, affiliateHash(product), JSON.stringify(product));
      return product;
    });
  }

  getProduct(productId, revision) {
    affiliateIdentifier(productId, 'productId'); positive(revision, 'revision');
    const row = this.db.prepare('SELECT * FROM affiliate_product_revisions WHERE product_id = ? AND revision = ?').get(productId, revision);
    if (!row) return null;
    const product = this.#read(row, validateAffiliateProduct);
    if (product.productId !== productId || product.revision !== revision) throw failure('AFFILIATE_SCOPE_MISMATCH', 'productId');
    return product;
  }

  registerCampaign(value, idempotencyKey) {
    const campaign = validateAffiliateCampaign(value);
    return this.#command('CAMPAIGN', campaign, idempotencyKey, () => {
      if (!this.repository.get(campaign.projectId)) throw failure('PROJECT_NOT_FOUND', 'projectId');
      if (!this.getProduct(campaign.productId, campaign.productRevision)) throw failure('AFFILIATE_PRODUCT_NOT_FOUND', 'productRevision');
      const prior = this.getCampaign(campaign.campaignId, campaign.revision);
      if (prior) return sameRevision(prior, campaign);
      this.#nextRevision('affiliate_campaign_revisions', 'campaign_id', campaign.campaignId, campaign.revision);
      this.db.prepare('INSERT INTO affiliate_campaign_revisions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(campaign.campaignId, campaign.revision, campaign.projectId, campaign.productId, campaign.productRevision, affiliateHash(campaign), JSON.stringify(campaign));
      return campaign;
    });
  }

  getCampaign(campaignId, revision) {
    affiliateIdentifier(campaignId, 'campaignId'); positive(revision, 'revision');
    const row = this.db.prepare('SELECT * FROM affiliate_campaign_revisions WHERE campaign_id = ? AND revision = ?').get(campaignId, revision);
    if (!row) return null;
    const campaign = this.#read(row, validateAffiliateCampaign);
    if (campaign.campaignId !== campaignId || campaign.revision !== revision || campaign.projectId !== row.project_id || campaign.productId !== row.product_id || campaign.productRevision !== row.product_revision) throw failure('AFFILIATE_SCOPE_MISMATCH', 'campaignId');
    if (!this.getProduct(campaign.productId, campaign.productRevision) || !this.repository.get(campaign.projectId)) throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    return campaign;
  }

  createBriefing(value, idempotencyKey) {
    exact(value, ['briefingId', 'campaignId', 'campaignRevision']);
    affiliateIdentifier(value.briefingId, 'briefingId'); affiliateIdentifier(value.campaignId, 'campaignId'); positive(value.campaignRevision, 'campaignRevision');
    return this.#command('BRIEFING', value, idempotencyKey, () => {
      const campaign = this.getCampaign(value.campaignId, value.campaignRevision);
      if (!campaign) throw failure('AFFILIATE_CAMPAIGN_NOT_FOUND', 'campaignRevision');
      const product = this.getProduct(campaign.productId, campaign.productRevision);
      const briefing = materializeAffiliateBriefing(value.briefingId, campaign, product);
      const prior = this.getBriefing(value.briefingId);
      if (prior) return sameRevision(prior, briefing);
      this.db.prepare('INSERT INTO affiliate_briefings VALUES (?, ?, ?, ?, ?)')
        .run(briefing.briefingId, briefing.campaignId, briefing.campaignRevision, briefing.contentHash, JSON.stringify(briefing));
      return briefing;
    });
  }

  getBriefing(briefingId) {
    affiliateIdentifier(briefingId, 'briefingId');
    const row = this.db.prepare('SELECT * FROM affiliate_briefings WHERE briefing_id = ?').get(briefingId);
    if (!row) return null;
    const briefing = this.#read(row, validateAffiliateBriefing);
    if (briefing.briefingId !== briefingId || briefing.campaignId !== row.campaign_id || briefing.campaignRevision !== row.campaign_revision) throw failure('AFFILIATE_SCOPE_MISMATCH', 'briefingId');
    const campaign = this.getCampaign(briefing.campaignId, briefing.campaignRevision);
    if (!campaign) throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    const product = this.getProduct(briefing.productId, briefing.productRevision);
    if (!product) throw failure('AFFILIATE_REFERENCE_MISSING', 'productId');
    const expected = materializeAffiliateBriefing(briefingId, campaign, product);
    if (expected.contentHash !== briefing.contentHash) throw failure('AFFILIATE_HASH_MISMATCH', 'briefingId');
    return briefing;
  }

  bindRun(value, idempotencyKey) {
    exact(value, ['pipelineRunId', 'briefingId']);
    affiliateIdentifier(value.pipelineRunId, 'pipelineRunId'); affiliateIdentifier(value.briefingId, 'briefingId');
    return this.#command('BIND_RUN', value, idempotencyKey, () => {
      const run = this.repository.getRun(value.pipelineRunId);
      if (!run) throw failure('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      const briefing = this.getBriefing(value.briefingId);
      if (!briefing) throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
      const campaign = this.getCampaign(briefing.campaignId, briefing.campaignRevision);
      if (campaign.projectId !== run.projectId) throw failure('AFFILIATE_RUN_SCOPE_MISMATCH', 'projectId');
      const prior = this.getRunBinding(run.pipelineRunId);
      if (prior) {
        if (prior.briefingId !== briefing.briefingId || prior.briefingHash !== briefing.contentHash) throw failure('AFFILIATE_RUN_BINDING_CONFLICT', 'briefingId');
        this.resolveRunBriefing(run.pipelineRunId); return prior;
      }
      const alreadyStarted = this.db.prepare(`SELECT 1 FROM scripts WHERE pipeline_run_id = ?
        UNION ALL SELECT 1 FROM ai_call_telemetry WHERE pipeline_run_id = ? AND task_type = 'script_generation'
        UNION ALL SELECT 1 FROM affiliate_script_contexts WHERE pipeline_run_id = ? LIMIT 1`).get(run.pipelineRunId, run.pipelineRunId, run.pipelineRunId);
      if (run.state !== 'RUNNING' || alreadyStarted) throw failure('AFFILIATE_RUN_BINDING_TOO_LATE', 'pipelineRunId');
      this.db.prepare('INSERT INTO affiliate_run_bindings VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(run.pipelineRunId, briefing.briefingId, briefing.contentHash, briefing.campaignId, briefing.campaignRevision, briefing.productId, briefing.productRevision);
      return this.getRunBinding(run.pipelineRunId);
    });
  }

  getRunBinding(pipelineRunId) {
    affiliateIdentifier(pipelineRunId, 'pipelineRunId');
    const row = this.db.prepare('SELECT * FROM affiliate_run_bindings WHERE pipeline_run_id = ?').get(pipelineRunId);
    if (!row) return null;
    return immutable({ pipelineRunId, briefingId: row.briefing_id, briefingHash: row.briefing_hash,
      campaignId: row.campaign_id, campaignRevision: row.campaign_revision,
      productId: row.product_id, productRevision: row.product_revision });
  }

  resolveRunBriefing(pipelineRunId, expectedBriefingId) {
    if (expectedBriefingId !== undefined) affiliateIdentifier(expectedBriefingId, 'briefingId');
    const binding = this.getRunBinding(pipelineRunId);
    if (!binding) {
      if (expectedBriefingId !== undefined) throw failure('AFFILIATE_BRIEFING_NOT_BOUND', 'briefingId');
      return null;
    }
    if (expectedBriefingId !== undefined && binding.briefingId !== expectedBriefingId) throw failure('AFFILIATE_RUN_BINDING_CONFLICT', 'briefingId');
    const briefing = this.getBriefing(binding.briefingId);
    if (!briefing) throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
    if (binding.briefingHash !== briefing.contentHash) throw failure('AFFILIATE_HASH_MISMATCH', 'briefingHash');
    for (const field of ['campaignId', 'campaignRevision', 'productId', 'productRevision']) {
      if (binding[field] !== briefing[field]) throw failure('AFFILIATE_RUN_SCOPE_MISMATCH', field);
    }
    const run = this.repository.getRun(pipelineRunId);
    const campaign = this.getCampaign(briefing.campaignId, briefing.campaignRevision);
    if (!run || run.projectId !== campaign.projectId) throw failure('AFFILIATE_RUN_SCOPE_MISMATCH', 'projectId');
    return briefing;
  }

  prepareScriptGeneration(request, pipelineRunId, expectedBriefingId) {
    return this.#transaction(() => {
      const briefing = this.resolveRunBriefing(pipelineRunId, expectedBriefingId);
      const hash = briefing?.contentHash ?? null;
      const prior = this.db.prepare('SELECT * FROM affiliate_script_contexts WHERE generation_request_id = ?').get(request.generationRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash || prior.pipeline_run_id !== pipelineRunId || prior.briefing_hash !== hash) throw failure('AFFILIATE_SCRIPT_CONTEXT_CONFLICT', 'generationRequestId');
      } else {
        this.db.prepare('INSERT INTO affiliate_script_contexts VALUES (?, ?, ?, ?)')
          .run(request.generationRequestId, request.contentHash, pipelineRunId, hash);
      }
      return briefing;
    });
  }

  verifyScriptGenerationContext(request, pipelineRunId, briefing) {
    const prior = this.db.prepare('SELECT * FROM affiliate_script_contexts WHERE generation_request_id = ?').get(request.generationRequestId);
    if (prior && (prior.request_hash !== request.contentHash || prior.pipeline_run_id !== pipelineRunId || prior.briefing_hash !== (briefing?.contentHash ?? null))) throw failure('AFFILIATE_SCRIPT_CONTEXT_CONFLICT', 'generationRequestId');
  }

  #read(row, validator) {
    let value;
    try { value = validator(JSON.parse(row.content_json)); }
    catch (cause) { throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'content', { cause }); }
    if (affiliateHash(value) !== row.content_hash) throw failure('AFFILIATE_HASH_MISMATCH', 'contentHash');
    return value;
  }
  #nextRevision(table, column, id, revision) {
    const latest = this.db.prepare(`SELECT MAX(revision) AS revision FROM ${table} WHERE ${column} = ?`).get(id).revision ?? 0;
    if (revision !== latest + 1) throw failure('AFFILIATE_REVISION_CONFLICT', 'revision');
  }
  #command(type, payload, key, operation) {
    affiliateIdentifier(key, 'idempotencyKey');
    const hash = affiliateHash(payload);
    return this.#transaction(() => {
      const prior = this.db.prepare('SELECT * FROM affiliate_commands WHERE idempotency_key = ?').get(key);
      if (prior) {
        if (prior.command_type !== type || prior.payload_hash !== hash) throw failure('AFFILIATE_IDEMPOTENCY_CONFLICT', 'idempotencyKey');
        let result;
        try { result = JSON.parse(prior.result_json); } catch (cause) { throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'result', { cause }); }
        if (affiliateHash(result) !== prior.result_hash) throw failure('AFFILIATE_HASH_MISMATCH', 'result');
        return immutable(result);
      }
      const result = operation();
      this.db.prepare('INSERT INTO affiliate_commands VALUES (?, ?, ?, ?, ?)')
        .run(key, type, hash, affiliateHash(result), JSON.stringify(result));
      return result;
    });
  }
  #transaction(operation) {
    try { this.db.exec('BEGIN IMMEDIATE'); const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
}
function sameRevision(prior, value) {
  if (affiliateHash(prior) !== affiliateHash(value)) throw failure('AFFILIATE_REVISION_CONFLICT', 'revision');
  return prior;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('INVALID_AFFILIATE_INPUT', 'input');
}
function positive(value, field) { if (!Number.isSafeInteger(value) || value < 1) throw failure('INVALID_AFFILIATE_REVISION', field); }
function failure(code, field, options) { return new AffiliateRepositoryError(code, field, options); }
