import { affiliateIdentifier } from '../../affiliate/domain/affiliate-contracts.js';
import {
  ttsApproval,
  ttsAudio,
  ttsFail,
  ttsHash,
  ttsRequest,
  type TtsFinancialOperation,
  type TtsResult,
} from '../domain/tts-financial-contracts.js';
import { usdAmount, usdUnits } from '../domain/video-financial-contracts.js';
import type {
  FinancialDatabase,
  TtsFinancialCommitmentsReader,
  TtsFinancialSourceReader,
  CampaignReferenceReader,
} from '../application/financial-readers.port.js';
import type { FinanceGate } from './finance-gate.repository.js';
import type { CostLedgerRepository } from './cost-ledger.repository.js';
import { CostAdjustmentsRepository } from './cost-adjustments.repository.js';

export class TtsFinanceRepository {
  private readonly db: FinancialDatabase;
  constructor(
    private readonly ledger: CostLedgerRepository,
    private readonly gate: FinanceGate,
    private readonly reader: TtsFinancialCommitmentsReader,
    private readonly sources: TtsFinancialSourceReader,
    private readonly campaigns: CampaignReferenceReader,
  ) {
    this.db = ledger.db;
  }

  private schema() {
    for (const table of [
      'tts_finance_metadata',
      'tts_financial_approvals',
      'tts_operations',
    ])
      if (
        !this.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table)
      )
        throw Object.assign(new Error('FINANCE_SCHEMA_REQUIRED'), {
          code: 'FINANCE_SCHEMA_REQUIRED',
          field: table,
        });
    if (
      this.db.prepare('SELECT version FROM tts_finance_metadata').get()
        ?.version !== 1
    )
      ttsFail('TTS_SCHEMA_INVALID');
  }
  getTts(id: string): TtsFinancialOperation | null {
    affiliateIdentifier(id, 'operationId');
    this.schema();
    return this.reader.getTts(id);
  }
  private require(id: string): TtsFinancialOperation {
    const op = this.getTts(id);
    if (!op) ttsFail('TTS_OPERATION_NOT_FOUND');
    return op;
  }
  private binding(request: any) {
    const config = this.sources.audioConfiguration(
      request.operation.audioConfigId,
    );
    const briefing = this.campaigns.resolveRunBriefing(
      request.operation.pipelineRunId,
    );
    const source = this.sources.videoSource(request.operation.sourceId);
    if (
      !config ||
      ttsHash(config) !== request.audioConfigurationHash ||
      briefing?.campaignId !== request.campaignId ||
      source?.state !== 'COMPLETED' ||
      source.requestHash !== request.source.requestHash ||
      source.request.pipelineRunId !== request.operation.pipelineRunId ||
      (request.source.sourceReference &&
        source.result?.videoReference !== request.source.sourceReference) ||
      (request.source.providerRequestId &&
        source.result?.providerRequestId !== request.source.providerRequestId)
    )
      ttsFail('TTS_SCOPE_INVALID');
  }
  approveTts(plan: unknown, value: unknown) {
    const request = ttsRequest(plan),
      approval = ttsApproval(request, value);
    return this.transaction(() => {
      this.schema();
      this.binding(request);
      this.gate.ttsCampaignUsage(request.campaignId);
      const prior = this.db
        .prepare(
          'SELECT request_hash,approval_json FROM tts_financial_approvals WHERE operation_id=?',
        )
        .get(request.operationId);
      if (
        prior &&
        (prior.request_hash !== ttsHash(request) ||
          ttsHash(JSON.parse(prior.approval_json)) !== ttsHash(approval))
      )
        ttsFail('TTS_IDENTITY_CONFLICT');
      if (!prior)
        this.db
          .prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)')
          .run(
            request.operationId,
            ttsHash(request),
            JSON.stringify(request),
            JSON.stringify(approval),
          );
      return approval;
    });
  }
  // Historical SUBMITTING reserves financial liability only. It is not a dispatch grant.
  beginTts(plan: unknown, now: string) {
    const request = ttsRequest(plan);
    return this.transaction(() => {
      this.schema();
      this.binding(request);
      const row = this.db
        .prepare(
          'SELECT request_hash,request_json,approval_json FROM tts_financial_approvals WHERE operation_id=?',
        )
        .get(request.operationId);
      if (
        !row ||
        row.request_hash !== ttsHash(request) ||
        ttsHash(JSON.parse(row.request_json)) !== row.request_hash
      )
        ttsFail('TTS_APPROVAL_REQUIRED');
      const approval = ttsApproval(request, JSON.parse(row.approval_json));
      if (
        !Number.isFinite(Date.parse(now)) ||
        Date.parse(now) < Date.parse(approval.approvedAt)
      )
        ttsFail('TTS_APPROVAL_INVALID');
      const prior = this.getTts(request.operationId);
      if (prior) {
        if (prior.requestHash !== ttsHash(request))
          ttsFail('TTS_IDENTITY_CONFLICT');
        if (['SUBMITTING', 'UNKNOWN'].includes(prior.state))
          ttsFail('TTS_RECONCILIATION_REQUIRED');
        return { created: false, operation: prior };
      }
      const { operationId, ...intent } = request;
      const intentHash = ttsHash(intent);
      if (
        this.db
          .prepare('SELECT 1 FROM tts_operations WHERE intent_hash=?')
          .get(intentHash)
      )
        ttsFail('TTS_RECONCILIATION_REQUIRED');
      const usage = this.gate.ttsCampaignUsage(request.campaignId);
      if (usage.hasUnknown || usage.hasCeilingBreach)
        ttsFail('TTS_RECONCILIATION_REQUIRED');
      if (
        usdUnits(usage.committedUsd) + usdUnits(request.reservationUsd) >
        usdUnits(usage.totalUsd)
      )
        ttsFail('TTS_BUDGET_EXCEEDED');
      this.gate.assertGlobalAvailable(request.reservationUsd, now);
      this.db
        .prepare(
          "INSERT INTO tts_operations VALUES(?,?,?,?,?,'SUBMITTING',?,NULL,NULL,NULL,NULL,NULL)",
        )
        .run(
          operationId,
          intentHash,
          ttsHash(request),
          request.campaignId,
          JSON.stringify(request),
          now,
        );
      return { created: true, operation: this.require(operationId) };
    });
  }
  dispatchTts(id: string, now: string): never {
    const op = this.require(id);
    if (!Number.isFinite(Date.parse(now))) ttsFail('TTS_APPROVAL_INVALID');
    if (op.state !== 'SUBMITTING') ttsFail('TTS_RECONCILIATION_REQUIRED');
    // Every historically valid request declares guaranteedMaximum=false.
    ttsFail('TTS_FINANCIAL_GUARANTEE_REQUIRED');
  }
  markTtsUnknown(
    id: string,
    errorCode: string | null = null,
  ): TtsFinancialOperation {
    if (errorCode !== null && !/^[A-Z0-9_]{3,100}$/.test(errorCode))
      ttsFail('TTS_INVALID_ERROR_CODE');
    return this.transaction(() => {
      const op = this.require(id);
      if (!['SUBMITTING', 'UNKNOWN'].includes(op.state))
        ttsFail('TTS_STATE_INVALID');
      if (op.state === 'UNKNOWN') {
        if (op.errorCode !== errorCode) ttsFail('TTS_IDENTITY_CONFLICT');
        return op;
      }
      this.db
        .prepare(
          "UPDATE tts_operations SET state='UNKNOWN',error_code=? WHERE operation_id=?",
        )
        .run(errorCode, id);
      for (const row of this.db
        .prepare(
          "SELECT operation_id,proof_json FROM global_paid_operations WHERE state='SUBMITTING'",
        )
        .all())
        if (JSON.parse(row.proof_json).sourceTtsId === id)
          this.gate.unknownGlobal(row.operation_id);
      return this.require(id);
    });
  }
  recordTtsResult(id: string, result: TtsResult): TtsFinancialOperation {
    const audio = ttsAudio(result?.audio);
    if (audio.provider !== 'openai' || audio.audioFormat !== 'wav')
      ttsFail('TTS_AUDIO_INVALID');
    let billing = result.billing ?? null;
    if (billing) {
      if (
        typeof billing.evidenceReference !== 'string' ||
        !billing.evidenceReference.trim()
      )
        ttsFail('TTS_BILLING_INVALID');
      billing = {
        ...billing,
        actualCostUsd: usdAmount(usdUnits(billing.actualCostUsd)),
      };
    }
    const providerId = result.providerRequestId ?? null;
    if (
      providerId !== null &&
      (typeof providerId !== 'string' ||
        !/^[a-zA-Z0-9_.:-]{3,200}$/.test(providerId))
    )
      ttsFail('TTS_PROVIDER_ID_INVALID');
    return this.transaction(() => {
      const op = this.require(id);
      if (
        (op.audio && ttsHash(op.audio) !== ttsHash(audio)) ||
        (op.billing && billing && ttsHash(op.billing) !== ttsHash(billing)) ||
        (op.providerRequestId &&
          providerId &&
          op.providerRequestId !== providerId)
      )
        ttsFail('TTS_IDENTITY_CONFLICT');
      if (!['SUBMITTING', 'UNKNOWN'].includes(op.state)) {
        if (
          !op.audio ||
          (!!billing && !op.billing) ||
          (!!providerId && !op.providerRequestId)
        )
          ttsFail('TTS_STATE_INVALID');
        return op;
      }
      this.db
        .prepare(
          'UPDATE tts_operations SET audio_json=?,billing_json=?,provider_request_id=? WHERE operation_id=?',
        )
        .run(
          JSON.stringify(audio),
          billing || op.billing ? JSON.stringify(billing ?? op.billing) : null,
          providerId ?? op.providerRequestId,
          id,
        );
      return this.require(id);
    });
  }
  reconcileTts(id: string, evidenceReference: string): TtsFinancialOperation {
    if (typeof evidenceReference !== 'string' || !evidenceReference.trim())
      ttsFail('TTS_RECONCILIATION_REQUIRED');
    return this.transaction(() => {
      const op = this.require(id);
      if (!op.audio || !op.billing) ttsFail('TTS_RECONCILIATION_REQUIRED');
      if (['COMPLETED', 'REVIEW_REQUIRED'].includes(op.state)) {
        if (op.reconciliationReference !== evidenceReference)
          ttsFail('TTS_IDENTITY_CONFLICT');
        this.account(op);
        this.settleHistoricalDispatches(id, op);
        return op;
      }
      const state =
        op.audio.durationMilliseconds >
        op.request.operation.maxDurationMilliseconds
          ? 'REVIEW_REQUIRED'
          : 'COMPLETED';
      this.db
        .prepare(
          'UPDATE tts_operations SET state=?,reconciliation_reference=?,error_code=NULL WHERE operation_id=?',
        )
        .run(state, evidenceReference, id);
      this.account(this.require(id));
      this.settleHistoricalDispatches(id, op);
      return this.require(id);
    });
  }
  private settleHistoricalDispatches(id: string, op: TtsFinancialOperation) {
    // Existing provider evidence reconciles previously dispatched operations only.
    // A RESERVED operation is never treated as dispatched or released implicitly.
    for (const row of this.db
      .prepare('SELECT * FROM global_paid_operations')
      .all()) {
      const proof = JSON.parse(row.proof_json);
      if (
        proof.kind !== 'MANUAL_TTS_RESERVATION' ||
        proof.sourceTtsId !== id ||
        row.state === 'RESERVED'
      )
        continue;
      if (
        row.actual_usd !== null &&
        (row.actual_usd !== op.billing!.actualCostUsd ||
          row.billing_reference !== op.billing!.evidenceReference)
      )
        throw Object.assign(new Error('GLOBAL_BILLING_CONFLICT'), {
          code: 'GLOBAL_BILLING_CONFLICT',
        });
      if (!['SUBMITTING', 'UNKNOWN', 'COMPLETED'].includes(row.state))
        ttsFail('TTS_STATE_INVALID');
      this.db
        .prepare(
          "UPDATE global_paid_operations SET state='COMPLETED',actual_usd=?,billing_reference=? WHERE operation_id=?",
        )
        .run(
          op.billing!.actualCostUsd,
          op.billing!.evidenceReference,
          row.operation_id,
        );
    }
  }
  accountTts(id: string) {
    return this.transaction(() => this.account(this.require(id)));
  }
  private account(op: TtsFinancialOperation) {
    if (op.state === 'SUBMITTING') ttsFail('TTS_STATE_INVALID');
    const adjustments = new CostAdjustmentsRepository(this.ledger);
    const original = this.ledger.getCostEvent(
      `tts_cost:${op.request.operationId}`,
    );
    if (adjustments.enabled() && original && op.billing) {
      adjustments.reconcileOriginal(
        original,
        op.request.operationId,
        op.billing,
      );
      return original;
    }
    if (op.billing?.actualCostUsd === '0') {
      if (this.ledger.getCostEvent(`tts_cost:${op.request.operationId}`))
        ttsFail('TTS_ACCOUNTING_RECONCILIATION_REQUIRED');
      return null;
    }
    const run = this.ledger.getRun(op.request.operation.pipelineRunId);
    if (!run) ttsFail('TTS_SCOPE_INVALID');
    return this.ledger.registerCostEvent({
      schemaVersion: 'cost-event/1.0.0',
      costEventId: `tts_cost:${op.request.operationId}`,
      category: 'voice_cost',
      pipelineRunId: run.pipelineRunId,
      projectId: run.projectId,
      projectVersion: run.projectVersion,
      contentIdentity: null,
      artifactId: null,
      amount: op.billing?.actualCostUsd ?? op.request.estimatedUsd,
      currency: 'USD',
      occurredAt: op.createdAt,
      recordedAt: op.createdAt,
      origin: 'openai',
      attributionRuleVersion: op.billing
        ? 'tts-actual/1.0.0'
        : 'tts-estimate/1.0.0',
    });
  }
  private transaction<T>(work: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
