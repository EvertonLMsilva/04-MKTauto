import { createHash } from 'node:crypto';
import {
  affiliateIdentifier,
  immutable,
  affiliateHash,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  validateAffiliateBriefing,
  materializeAffiliateBriefing,
} from '../../affiliate/domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../../affiliate/domain/affiliate.errors.js';
import {
  fail,
  videoRequestHash,
  videoQuoteHash,
  validateVideoGenerationRequest,
  validateVideoCostAuthorization,
  validateVideoProviderResult,
} from '../domain/video-financial-contracts.js';
import type {
  VideoFinancialCommitmentsReader,
  TtsFinancialCommitmentsReader,
  CampaignReferenceReader,
  FinancialDatabase,
  FinancialAttributionReader,
} from '../application/financial-readers.port.js';
import type { FinanceDatabase } from './finance.database.js';
export class SqliteVideoFinancialCommitmentsReader implements VideoFinancialCommitmentsReader {
  constructor(private readonly db: FinancialDatabase) {}
  hasActive() {
    return !!this.db
      .prepare(
        "SELECT 1 FROM video_generation_operations WHERE state!='CANCELLED' LIMIT 1",
      )
      .get();
  }
  listActive(campaignId?: string): any {
    return campaignId === undefined
      ? this.db
          .prepare(
            "SELECT generation_request_id FROM video_generation_operations WHERE state!='CANCELLED'",
          )
          .all()
      : this.db
          .prepare(
            "SELECT generation_request_id FROM video_generation_operations WHERE campaign_id=? AND state!='CANCELLED'",
          )
          .all(campaignId);
  }
  getOperation(id: any): any {
    affiliateIdentifier(id, 'generationRequestId');
    const row = this.db
      .prepare(
        'SELECT * FROM video_generation_operations WHERE generation_request_id = ?',
      )
      .get(id);
    if (!row) return null;
    const request = validateVideoGenerationRequest(
      JSON.parse(row.request_json),
    );
    if (
      videoRequestHash(request) !== row.request_hash ||
      request.generationRequestId !== id ||
      request.campaignId !== row.campaign_id ||
      request.pipelineRunId !== row.pipeline_run_id ||
      request.originalSlot !== row.original_slot
    )
      fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'persistedRequest');
    const operation: any = {
      request,
      requestHash: row.request_hash,
      ceiling: JSON.parse(row.ceiling_json),
      state: row.state,
      ownerToken: row.owner_token,
      createdAt: row.created_at,
      costEventId: row.cost_event_id,
      providerRequestId: null,
      result: null,
      billing: null,
    };
    this.validateAuthorization(operation.ceiling, request, operation.createdAt);
    if (row.result_json) {
      operation.result = validateVideoProviderResult(
        JSON.parse(row.result_json),
        operation,
      );
      operation.providerRequestId = operation.result.providerRequestId;
    }
    const billing = this.db
      .prepare(
        'SELECT * FROM video_generation_billing WHERE generation_request_id = ?',
      )
      .get(id);
    if (billing)
      operation.billing = {
        providerRequestId: billing.provider_request_id,
        actualCostUsd: billing.actual_cost_usd,
        evidenceReference: billing.evidence_reference,
      };
    return immutable(operation);
  }
  validateAuthorization(
    quote: any,
    request: any,
    now: any,
    { authorizationMode = 'MANUAL' }: any = {},
  ): any {
    if (!['MANUAL', 'AUTOMATIC'].includes(authorizationMode))
      fail('GLOBAL_AUTHORIZATION_MODE_INVALID', 'authorizationMode');
    if (authorizationMode === 'AUTOMATIC' && quote?.kind !== 'ENFORCED_MAXIMUM')
      fail('GLOBAL_PRICE_UNPROVEN', 'ceiling');
    const result = validateVideoCostAuthorization(quote, request, now);
    if (quote.kind === 'OFFICIAL_ESTIMATE') {
      const approval = this.db
        .prepare(
          'SELECT quote_hash,approval_json FROM video_generation_estimate_approvals WHERE request_hash=? AND campaign_id=?',
        )
        .get(videoRequestHash(request), request.campaignId);
      if (
        !approval ||
        approval.quote_hash !== videoQuoteHash(quote) ||
        JSON.parse(approval.approval_json).acceptsUnboundedCost !== true
      )
        fail('VIDEO_GENERATION_ESTIMATE_APPROVAL_REQUIRED', 'approval');
    }
    return result;
  }
}
export class SqliteTtsFinancialSourcesReader {
  constructor(private readonly db: FinancialDatabase) {}
  audioConfiguration(id: string): unknown {
    const row = this.db
      .prepare(
        "SELECT identity_hash,payload_json FROM p4_artifacts WHERE kind='audio_config' AND artifact_id=?",
      )
      .get(id);
    if (!row) return null;
    const value = JSON.parse(row.payload_json);
    if (adaptationHash(value) !== row.identity_hash)
      ttsFail('P4_PERSISTED_INTEGRITY_INVALID');
    return value;
  }
  videoSource(id: string) {
    const row = this.db
      .prepare(
        'SELECT state,request_hash,request_json,result_json FROM video_generation_operations WHERE generation_request_id=?',
      )
      .get(id);
    return row
      ? {
          state: row.state,
          requestHash: row.request_hash,
          request: JSON.parse(row.request_json),
          result: row.result_json ? JSON.parse(row.result_json) : null,
        }
      : null;
  }
}
export class SqliteTtsFinancialCommitmentsReader implements TtsFinancialCommitmentsReader {
  constructor(private readonly db: FinancialDatabase) {}
  exists() {
    return !!this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='tts_operations'")
      .get();
  }
  hasOperations() {
    return (
      this.exists() &&
      !!this.db.prepare('SELECT 1 FROM tts_operations LIMIT 1').get()
    );
  }
  list(campaignId?: string): any {
    return campaignId === undefined
      ? this.db.prepare('SELECT operation_id FROM tts_operations').all()
      : this.db
          .prepare(
            'SELECT operation_id FROM tts_operations WHERE campaign_id=?',
          )
          .all(campaignId);
  }
  getTts(id: any): any {
    const row = this.db
      .prepare('SELECT * FROM tts_operations WHERE operation_id=?')
      .get(id);
    if (!row) return null;
    const request = JSON.parse(row.request_json);
    if (
      adaptationHash(request) !== row.request_hash ||
      request.operationId !== id ||
      request.campaignId !== row.campaign_id
    )
      ttsFail('TTS_IDENTITY_CONFLICT');
    return {
      request,
      requestHash: row.request_hash,
      state: row.state,
      createdAt: row.created_at,
      audio: row.audio_json ? JSON.parse(row.audio_json) : null,
      billing: row.billing_json ? JSON.parse(row.billing_json) : null,
      reconciliationReference: row.reconciliation_reference,
      providerRequestId: row.provider_request_id,
      errorCode: row.error_code,
    };
  }
}
function ttsFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
function adaptationHash(value: any): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}
function stable(value: any): string {
  return JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((item: any) => JSON.parse(stable(item)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key: string) => [key, JSON.parse(stable(value[key]))]),
          )
      : value,
  );
}
export class SqliteCampaignReferenceReader implements CampaignReferenceReader {
  private readonly db: FinancialDatabase;
  constructor(private readonly repository: FinanceDatabase) {
    this.db = repository.db;
  }
  listRuns(id: string): any {
    return this.db
      .prepare(
        'SELECT pipeline_run_id FROM affiliate_run_bindings WHERE campaign_id=?',
      )
      .all(id);
  }
  getProduct(productId: any, revision: any): any {
    affiliateIdentifier(productId, 'productId');
    positive(revision, 'revision');
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_product_revisions WHERE product_id = ? AND revision = ?',
      )
      .get(productId, revision);
    if (!row) return null;
    const product = this.read(row, validateAffiliateProduct);
    if (product.productId !== productId || product.revision !== revision)
      throw failure('AFFILIATE_SCOPE_MISMATCH', 'productId');
    return product;
  }
  getCampaign(campaignId: any, revision: any): any {
    affiliateIdentifier(campaignId, 'campaignId');
    positive(revision, 'revision');
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_campaign_revisions WHERE campaign_id = ? AND revision = ?',
      )
      .get(campaignId, revision);
    if (!row) return null;
    const campaign = this.read(row, validateAffiliateCampaign);
    if (
      campaign.campaignId !== campaignId ||
      campaign.revision !== revision ||
      campaign.projectId !== row.project_id ||
      campaign.productId !== row.product_id ||
      campaign.productRevision !== row.product_revision
    )
      throw failure('AFFILIATE_SCOPE_MISMATCH', 'campaignId');
    if (
      !this.getProduct(campaign.productId, campaign.productRevision) ||
      !this.repository.get(campaign.projectId)
    )
      throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    return campaign;
  }
  getBriefing(briefingId: any): any {
    affiliateIdentifier(briefingId, 'briefingId');
    const row = this.db
      .prepare('SELECT * FROM affiliate_briefings WHERE briefing_id = ?')
      .get(briefingId);
    if (!row) return null;
    const briefing = this.read(row, validateAffiliateBriefing);
    if (
      briefing.briefingId !== briefingId ||
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
    const expected = materializeAffiliateBriefing(
      briefingId,
      campaign,
      product,
    );
    if (expected.contentHash !== briefing.contentHash)
      throw failure('AFFILIATE_HASH_MISMATCH', 'briefingId');
    return briefing;
  }
  getRunBinding(pipelineRunId: any): any {
    affiliateIdentifier(pipelineRunId, 'pipelineRunId');
    const row = this.db
      .prepare('SELECT * FROM affiliate_run_bindings WHERE pipeline_run_id = ?')
      .get(pipelineRunId);
    if (!row) return null;
    return immutable({
      pipelineRunId,
      briefingId: row.briefing_id,
      briefingHash: row.briefing_hash,
      campaignId: row.campaign_id,
      campaignRevision: row.campaign_revision,
      productId: row.product_id,
      productRevision: row.product_revision,
    });
  }
  resolveRunBriefing(pipelineRunId: any, expectedBriefingId?: string): any {
    if (expectedBriefingId !== undefined)
      affiliateIdentifier(expectedBriefingId, 'briefingId');
    const binding = this.getRunBinding(pipelineRunId);
    if (!binding) {
      if (expectedBriefingId !== undefined)
        throw failure('AFFILIATE_BRIEFING_NOT_BOUND', 'briefingId');
      return null;
    }
    if (
      expectedBriefingId !== undefined &&
      binding.briefingId !== expectedBriefingId
    )
      throw failure('AFFILIATE_RUN_BINDING_CONFLICT', 'briefingId');
    const briefing = this.getBriefing(binding.briefingId);
    if (!briefing) throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
    if (binding.briefingHash !== briefing.contentHash)
      throw failure('AFFILIATE_HASH_MISMATCH', 'briefingHash');
    for (const field of [
      'campaignId',
      'campaignRevision',
      'productId',
      'productRevision',
    ]) {
      if (binding[field] !== briefing[field])
        throw failure('AFFILIATE_RUN_SCOPE_MISMATCH', field);
    }
    const run = this.repository.getRun(pipelineRunId);
    const campaign = this.getCampaign(
      briefing.campaignId,
      briefing.campaignRevision,
    );
    if (!run || run.projectId !== campaign.projectId)
      throw failure('AFFILIATE_RUN_SCOPE_MISMATCH', 'projectId');
    return briefing;
  }
  read(row: any, validator: any): any {
    let value;
    try {
      value = validator(JSON.parse(row.content_json));
    } catch (cause: any) {
      throw failure('INVALID_PERSISTED_AFFILIATE_DATA', 'content', { cause });
    }
    if (affiliateHash(value) !== row.content_hash)
      throw failure('AFFILIATE_HASH_MISMATCH', 'contentHash');
    return value;
  }
}
export class SqliteFinancialAttributionReader implements FinancialAttributionReader {
  constructor(private readonly db: FinancialDatabase) {}
  costEvents(provider: string, inputHash: string, occurredAt: string | null) {
    return this.db
      .prepare(
        'SELECT cost_event_id FROM ai_call_telemetry WHERE provider=? AND input_hash=? AND occurred_at=? AND cost_event_id IS NOT NULL',
      )
      .all(provider, inputHash, occurredAt);
  }
}
function positive(value: any, field: string): any {
  if (!Number.isSafeInteger(value) || value < 1)
    throw failure('INVALID_AFFILIATE_REVISION', field);
}
function failure(code: string, field: string, options?: ErrorOptions): any {
  return new AffiliateRepositoryError(code, field, options);
}
