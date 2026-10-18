import type {
  GlobalUsage,
  GlobalPolicy,
  CampaignUsage,
  Reservation,
} from '../domain/finance.types.js';
import {
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  fail,
  usdAmount,
  usdUnits,
  validateVideoBudget,
  videoReservationAmount,
  AURA_ONE_VIDEO_BUDGET,
  validateVideoGenerationRequest,
  validateVideoCostAuthorization,
  videoRequestHash,
  videoQuoteHash,
} from '../domain/video-financial-contracts.js';
import type {
  VideoFinancialCommitmentsReader,
  TtsFinancialCommitmentsReader,
  CampaignReferenceReader,
  FinancialAttributionReader,
} from '../application/financial-readers.port.js';
import type { CostLedgerRepository } from './cost-ledger.repository.js';
import { CostAdjustmentsRepository } from './cost-adjustments.repository.js';
import { validateFirstFalRiskProof } from '../domain/first-fal-risk.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
const GLOBAL_DEFAULTS = Object.freeze({
  dailyUsd: '1',
  monthlyUsd: '20',
  timeZone: 'America/Sao_Paulo',
});
export class FinanceGate {
  readonly db;
  constructor(
    private readonly repository: CostLedgerRepository,
    private readonly video: VideoFinancialCommitmentsReader,
    private readonly tts: TtsFinancialCommitmentsReader,
    private readonly affiliate: CampaignReferenceReader,
    private readonly attribution: FinancialAttributionReader,
  ) {
    this.db = repository.db;
  }
  getOperation(id: string): any {
    return this.video.getOperation(id);
  }
  getTts(id: string): any {
    return this.tts.getTts(id);
  }
  // Called only by the TTS repository while its write transaction owns the session.
  ttsCampaignUsage(id: string): CampaignUsage {
    affiliateIdentifier(id, 'campaignId');
    return this.#usage(id);
  }
  getUsage(id: string): CampaignUsage {
    affiliateIdentifier(id, 'campaignId');
    return this.#transaction((): any => this.#usage(id));
  }
  configureGlobal({
    dailyUsd = GLOBAL_DEFAULTS.dailyUsd,
    monthlyUsd = GLOBAL_DEFAULTS.monthlyUsd,
    timeZone = GLOBAL_DEFAULTS.timeZone,
  }: GlobalPolicy = {}): Required<GlobalPolicy> {
    const daily = usdAmount(usdUnits(dailyUsd)),
      monthly = usdAmount(usdUnits(monthlyUsd));
    if (usdUnits(daily) <= 0n || usdUnits(monthly) <= 0n)
      fail('GLOBAL_POLICY_INVALID', 'limits');
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return this.#transaction((): any => {
      this.#initializeGlobal();
      const previous = this.db
        .prepare(
          'SELECT time_zone FROM global_finance_policy WHERE singleton=1',
        )
        .get();
      if (
        previous.time_zone !== timeZone &&
        (this.db
          .prepare('SELECT 1 FROM global_paid_operations LIMIT 1')
          .get() ||
          this.video.hasActive() ||
          this.db.prepare('SELECT 1 FROM cost_events LIMIT 1').get() ||
          this.tts.hasOperations())
      )
        fail('GLOBAL_POLICY_PERIOD_CONFLICT', 'timeZone');
      this.db
        .prepare(
          'INSERT INTO global_finance_policy VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET daily_usd=excluded.daily_usd,monthly_usd=excluded.monthly_usd,time_zone=excluded.time_zone',
        )
        .run(daily, monthly, timeZone);
      return { dailyUsd: daily, monthlyUsd: monthly, timeZone };
    });
  }
  #initializeGlobal(): any {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='global_finance_policy'",
        )
        .get()
    )
      fail('FINANCE_SCHEMA_REQUIRED', 'global_finance_policy');
    if (
      !this.db
        .prepare('SELECT 1 FROM global_finance_policy WHERE singleton=1')
        .get()
    )
      this.db
        .prepare('INSERT INTO global_finance_policy VALUES(1,?,?,?)')
        .run(
          GLOBAL_DEFAULTS.dailyUsd,
          GLOBAL_DEFAULTS.monthlyUsd,
          GLOBAL_DEFAULTS.timeZone,
        );
  }
  // All liability is aggregated in the same SQLite boundary, across campaigns.
  #globalUsage(now: string): GlobalUsage {
    this.#initializeGlobal();
    if (!Number.isFinite(Date.parse(now))) fail('GLOBAL_TIME_INVALID', 'now');
    const policy = this.db
      .prepare('SELECT * FROM global_finance_policy WHERE singleton=1')
      .get();
    const period = (value: any) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: policy.time_zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(value));
      return ['year', 'month', 'day']
        .map((type: any) => parts.find((p: any) => p.type === type)!.value)
        .join('-');
    };
    const day = period(now),
      month = day.slice(0, 7);
    let daily = 0n,
      monthly = 0n;
    const accounted = new Set();
    const add = (at: any, amount: any, unresolved: any = false): any => {
      const date = period(at);
      if (date > day) fail('GLOBAL_TIME_INVALID', 'now');
      if (unresolved || date === day) daily += amount;
      if (unresolved || date.slice(0, 7) === month) monthly += amount;
    };
    for (const row of this.db
      .prepare('SELECT * FROM global_paid_operations')
      .all()) {
      if (JSON.parse(row.proof_json).kind === 'MANUAL_TTS_RESERVATION')
        continue; // Existing TTS liability below.
      let actual = usdUnits(row.actual_usd ?? '0');
      const maximum = usdUnits(row.maximum_usd);
      for (const telemetry of this.attribution.costEvents(
        row.provider,
        JSON.parse(row.proof_json).bodyHash ?? row.request_hash,
        JSON.parse(row.proof_json).telemetryOccurredAt ?? null,
      )) {
        const cost = this.repository.getCostEvent(telemetry.cost_event_id);
        if (cost?.currency === 'USD') {
          const amount = usdUnits(cost.amount);
          if (amount > actual) actual = amount;
          accounted.add(cost.costEventId);
        }
      }
      const settled = this.settledFirstFal(row, JSON.parse(row.proof_json));
      if (settled) for (const id of settled) accounted.add(id);
      add(
        row.created_at,
        settled ? actual : actual > maximum ? actual : maximum,
        ['RESERVED', 'SUBMITTING', 'UNKNOWN'].includes(row.state),
      );
      if (actual > maximum)
        fail('GLOBAL_PRICE_CEILING_BREACHED', 'actualCostUsd');
    }
    for (const row of this.video.listActive()) {
      const op = this.getOperation(row.generation_request_id),
        actual = usdUnits(
          op.billing?.actualCostUsd ?? op.result?.actualCostUsd ?? '0',
        ),
        maximum = usdUnits(videoReservationAmount(op.ceiling));
      add(
        op.createdAt,
        actual > maximum ? actual : maximum,
        ['RESERVED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'].includes(op.state),
      );
      const cost = this.repository.getCostEvent(op.costEventId);
      if (
        cost &&
        cost.currency === 'USD' &&
        usdUnits(cost.amount) === actual &&
        cost.pipelineRunId === op.request.pipelineRunId &&
        cost.origin === op.request.provider
      )
        accounted.add(cost.costEventId);
      if (actual > maximum)
        fail('GLOBAL_PRICE_CEILING_BREACHED', 'actualCostUsd');
    }
    if (this.tts.exists())
      for (const row of this.tts.list()) {
        const adjustments = new CostAdjustmentsRepository(this.repository);
        const op = this.getTts(row.operation_id),
          actual = usdUnits(op.billing?.actualCostUsd ?? '0'),
          maximum = usdUnits(op.request.reservationUsd);
        const cost = this.repository.getCostEvent(
          `tts_cost:${row.operation_id}`,
        );
        const v2 = adjustments.enabled();
        const unresolved =
          ['SUBMITTING', 'UNKNOWN'].includes(op.state) ||
          (v2 && (!op.billing || !op.reconciliationReference));
        const net = v2 && cost ? adjustments.netUnits(cost) : actual;
        const realized = net > actual ? net : actual;
        add(
          op.createdAt,
          v2 && !unresolved
            ? realized
            : realized > maximum
              ? realized
              : maximum,
          unresolved,
        );
        if (
          cost &&
          cost.pipelineRunId === op.request.operation.pipelineRunId &&
          cost.origin === 'openai' &&
          cost.currency === 'USD' &&
          (v2 ||
            cost.amount ===
              (op.billing?.actualCostUsd ?? op.request.estimatedUsd))
        )
          accounted.add(cost.costEventId);
        if (!v2 && actual > maximum)
          fail('GLOBAL_PRICE_CEILING_BREACHED', 'actualCostUsd');
      }
    for (const cost of this.db
      .prepare(
        'SELECT cost_event_id,amount,currency,occurred_at FROM cost_events',
      )
      .all()) {
      if (accounted.has(cost.cost_event_id)) continue;
      if (cost.currency !== 'USD')
        fail('GLOBAL_COST_CURRENCY_UNSUPPORTED', 'currency');
      add(cost.occurred_at, usdUnits(cost.amount));
    }
    return {
      dailyUsd: usdAmount(daily),
      monthlyUsd: usdAmount(monthly),
      policy,
    };
  }
  getGlobalUsage(now: string = new Date().toISOString()): GlobalUsage {
    return this.#transaction((): any => this.#globalUsage(now));
  }
  private settledFirstFal(row: any, proof: any): string[] | null {
    if (
      row.provider !== 'fal_ai' ||
      proof.kind !== 'FIRST_FAL_RISK_ACCEPTED' ||
      row.state !== 'COMPLETED' ||
      row.actual_usd === null ||
      !row.billing_reference ||
      !proof.pipelineRunId ||
      !proof.risk ||
      affiliateHash(proof.risk) !== proof.riskHash
    )
      return null;
    const { campaignId: _campaignId, ...authorization } = proof;
    validateFirstFalRiskProof(authorization, proof.acceptedAt);
    const settlement = this.attribution.falSettlement?.(
      proof.pipelineRunId,
      proof.risk.requestHash,
    );
    if (
      !settlement ||
      settlement.imageHash !== proof.risk.imageHash ||
      settlement.endpoint !== proof.risk.model.endpoint ||
      usdUnits(settlement.finalAmount) !== usdUnits(row.actual_usd)
    )
      return null;
    let total = 0n;
    for (const id of settlement.costEventIds) {
      const cost = this.repository.getCostEvent(id);
      if (
        !cost ||
        cost.pipelineRunId !== proof.pipelineRunId ||
        cost.currency !== 'USD' ||
        cost.origin !== settlement.source ||
        cost.category !== 'media_cost'
      )
        return null;
      total += usdUnits(cost.amount);
    }
    return total === usdUnits(settlement.finalAmount)
      ? settlement.costEventIds
      : null;
  }
  assertGlobalAvailable(amount: unknown, now: string): GlobalUsage {
    const usage = this.#globalUsage(now),
      addition = usdUnits(amount);
    if (usdUnits(usage.dailyUsd) + addition > usdUnits(usage.policy.daily_usd))
      fail('GLOBAL_DAILY_BUDGET_EXCEEDED', 'dailyUsd');
    if (
      usdUnits(usage.monthlyUsd) + addition >
      usdUnits(usage.policy.monthly_usd)
    )
      fail('GLOBAL_MONTHLY_BUDGET_EXCEEDED', 'monthlyUsd');
    return usage;
  }
  reserveGlobal(
    proof: any,
    now: any = new Date().toISOString(),
    { authorizationMode = 'AUTOMATIC' }: { authorizationMode?: string } = {},
  ): Reservation {
    return this.#transaction((): any => {
      this.#initializeGlobal();
      if (
        !proof ||
        !/^[a-zA-Z0-9_:-]{1,200}$/.test(proof.operationId ?? '') ||
        !/^[a-f0-9]{64}$/.test(proof.requestHash ?? '') ||
        !/^[a-z0-9_]{1,50}$/.test(proof.provider ?? '')
      )
        fail('GLOBAL_IDENTITY_INVALID', 'operation');
      const prior = this.db
        .prepare('SELECT * FROM global_paid_operations WHERE operation_id=?')
        .get(proof.operationId);
      if (prior) {
        if (
          prior.request_hash !== proof.requestHash ||
          prior.provider !== proof.provider
        )
          fail('GLOBAL_IDENTITY_CONFLICT', 'operationId');
        return { created: false, operation: prior };
      }
      if (
        this.db
          .prepare(
            'SELECT 1 FROM global_paid_operations WHERE provider=? AND request_hash=?',
          )
          .get(proof.provider, proof.requestHash)
      )
        fail('GLOBAL_IDENTITY_CONFLICT', 'requestHash');
      const manualTts =
        authorizationMode === 'MANUAL' &&
        proof.kind === 'MANUAL_TTS_RESERVATION' &&
        proof.provider === 'openai' &&
        this.getTts(proof.sourceTtsId)?.state === 'SUBMITTING';
      if (proof.sourceTtsId && !manualTts)
        fail('GLOBAL_PRICE_UNPROVEN', 'sourceTtsId');
      const firstFalRisk = proof.kind === 'FIRST_FAL_RISK_ACCEPTED';
      if (firstFalRisk) {
        if (authorizationMode !== 'FIRST_FAL_RISK_ACCEPTED')
          fail('GLOBAL_PRICE_UNPROVEN', 'authorizationMode');
        validateFirstFalRiskProof(proof, now);
      }
      if (
        !manualTts &&
        !firstFalRisk &&
        (proof.kind !== 'ENFORCED_MAXIMUM' ||
          proof.includesAllCharges !== true ||
          proof.currency !== 'USD' ||
          !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(proof.evidenceReference ?? '') ||
          !Number.isFinite(Date.parse(proof.expiresAt)) ||
          Date.parse(proof.expiresAt) <= Date.parse(now))
      )
        fail('GLOBAL_PRICE_UNPROVEN', 'ceiling');
      let amount;
      try {
        amount = usdAmount(
          usdUnits(
            firstFalRisk ? proof.reservationAmount : proof.maximumAmount,
          ),
        );
      } catch {
        fail('GLOBAL_PRICE_UNPROVEN', 'maximumAmount');
      }
      if (usdUnits(amount) <= 0n)
        fail('GLOBAL_PRICE_UNPROVEN', 'maximumAmount');
      let campaignId = null;
      if (proof.pipelineRunId) {
        if (!this.repository.getRun(proof.pipelineRunId))
          fail('GLOBAL_SCOPE_INVALID', 'pipelineRunId');
        campaignId =
          this.affiliate.resolveRunBriefing(proof.pipelineRunId)?.campaignId ??
          null;
        if (campaignId) {
          const usage = this.#usage(campaignId);
          if (usage.hasUnknown || usage.hasCeilingBreach)
            fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'campaignId');
          if (
            usdUnits(usage.committedUsd) + usdUnits(amount) >
            usdUnits(usage.totalUsd)
          )
            fail('VIDEO_GENERATION_BUDGET_EXCEEDED', 'campaignId');
        }
      }
      if (
        manualTts &&
        amount !== this.getTts(proof.sourceTtsId).request.reservationUsd
      )
        fail('GLOBAL_PRICE_UNPROVEN', 'manualTts');
      this.assertGlobalAvailable(manualTts ? '0' : amount, now);
      this.db
        .prepare(
          "INSERT INTO global_paid_operations VALUES(?,?,?,?,?,?,'RESERVED',NULL,NULL,NULL)",
        )
        .run(
          proof.operationId,
          proof.requestHash,
          proof.provider,
          amount,
          JSON.stringify({ ...proof, campaignId }),
          now,
        );
      return {
        created: true,
        operation: this.db
          .prepare('SELECT * FROM global_paid_operations WHERE operation_id=?')
          .get(proof.operationId),
      };
    });
  }
  dispatchGlobal(id: any, now: any = null): any {
    return this.#transaction((): any => {
      const op = this.db
        .prepare('SELECT * FROM global_paid_operations WHERE operation_id=?')
        .get(id);
      if (op?.state !== 'RESERVED')
        fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED', 'operationId');
      const at = now ?? op.created_at;
      const proof = JSON.parse(op.proof_json);
      if (proof.kind === 'MANUAL_TTS_RESERVATION')
        fail('TTS_FINANCIAL_GUARANTEE_REQUIRED', 'ceiling');
      if (proof.campaignId) {
        const usage = this.#usage(proof.campaignId);
        if (usage.hasUnknown || usage.hasCeilingBreach)
          fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'campaignId');
        if (usdUnits(usage.committedUsd) > usdUnits(usage.totalUsd))
          fail('VIDEO_GENERATION_BUDGET_EXCEEDED', 'campaignId');
      }
      if (Date.parse(JSON.parse(op.proof_json).expiresAt) <= Date.parse(at))
        fail('GLOBAL_PRICE_UNPROVEN', 'expiresAt');
      this.assertGlobalAvailable('0', at);
      this.db
        .prepare(
          "UPDATE global_paid_operations SET state='SUBMITTING' WHERE operation_id=?",
        )
        .run(id);
    });
  }
  unknownGlobal(id: any): any {
    this.db
      .prepare(
        "UPDATE global_paid_operations SET state='UNKNOWN' WHERE operation_id=? AND state='SUBMITTING'",
      )
      .run(id);
  }
  settleGlobal(id: any, { actualCostUsd, evidenceReference }: any): any {
    const actual = usdAmount(usdUnits(actualCostUsd));
    if (typeof evidenceReference !== 'string' || !evidenceReference.trim())
      fail('GLOBAL_BILLING_INVALID', 'evidenceReference');
    return this.#transaction((): any => {
      const op = this.db
        .prepare('SELECT * FROM global_paid_operations WHERE operation_id=?')
        .get(id);
      if (!op) fail('GLOBAL_OPERATION_NOT_FOUND', 'operationId');
      if (
        op.actual_usd !== null &&
        (op.actual_usd !== actual || op.billing_reference !== evidenceReference)
      )
        fail('GLOBAL_BILLING_CONFLICT', 'actualCostUsd');
      if (!['SUBMITTING', 'UNKNOWN', 'COMPLETED'].includes(op.state))
        fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED', 'state');
      this.db
        .prepare(
          "UPDATE global_paid_operations SET state='COMPLETED',actual_usd=?,billing_reference=? WHERE operation_id=?",
        )
        .run(actual, evidenceReference, id);
    });
  }
  async executePaid(
    proof: any,
    transport: () => Promise<any>,
    now = new Date().toISOString(),
    options: { authorizationMode?: string } = {},
  ) {
    const reserved = this.reserveGlobal(proof, now, options);
    if (!reserved.created) {
      if (
        reserved.operation.state === 'COMPLETED' &&
        reserved.operation.result_json !== null
      )
        return JSON.parse(reserved.operation.result_json);
      fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED', 'operationId');
    }
    this.dispatchGlobal(proof.operationId, now);
    try {
      const result = await transport();
      this.db
        .prepare(
          "UPDATE global_paid_operations SET state='COMPLETED',result_json=? WHERE operation_id=?",
        )
        .run(JSON.stringify(result ?? null), proof.operationId);
      return result;
    } catch (error) {
      this.unknownGlobal(proof.operationId);
      throw error;
    }
  }
  configureCampaign(
    campaignId: string,
    revision: number,
    value: unknown = AURA_ONE_VIDEO_BUDGET,
  ) {
    const policy = validateVideoBudget(value);
    return this.#transaction(() => {
      const campaign = this.affiliate.getCampaign(campaignId, revision);
      if (!campaign) fail('VIDEO_GENERATION_CAMPAIGN_NOT_FOUND', 'campaignId');
      const prior = this.db
        .prepare(
          'SELECT * FROM video_generation_campaign_budgets WHERE campaign_id = ?',
        )
        .get(campaignId);
      if (prior) {
        if (
          prior.project_id !== campaign.projectId ||
          JSON.stringify(policy) !== prior.policy_json
        )
          fail('VIDEO_GENERATION_POLICY_CONFLICT', 'campaignId');
      } else {
        this.db
          .prepare(
            'INSERT INTO video_generation_campaign_budgets VALUES (?, ?, ?, ?)',
          )
          .run(
            campaignId,
            revision,
            campaign.projectId,
            JSON.stringify(policy),
          );
      }
      return policy;
    });
  }
  approveEstimate(value: any, quote: any, approval: any) {
    const request = validateVideoGenerationRequest(value);
    validateVideoCostAuthorization(quote, request, approval?.approvedAt);
    if (
      quote.kind !== 'OFFICIAL_ESTIMATE' ||
      approval?.acceptsUnboundedCost !== true ||
      Object.keys(approval).sort().join(',') !==
        'acceptsUnboundedCost,approvalReference,approvedAt,approvedBy' ||
      typeof approval.approvedBy !== 'string' ||
      !approval.approvedBy.trim() ||
      typeof approval.approvalReference !== 'string' ||
      !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(approval.approvalReference) ||
      !Number.isFinite(Date.parse(approval.approvedAt))
    )
      fail('VIDEO_GENERATION_ESTIMATE_APPROVAL_REQUIRED', 'approval');
    return this.#transaction(() => {
      const policy = this.#policy(request.campaignId);
      if (usdUnits(quote.reservationAmount) > usdUnits(policy.perGenerationUsd))
        fail('VIDEO_GENERATION_PRICE_LIMIT', 'reservation');
      const body = {
        requestHash: videoRequestHash(request),
        quoteHash: videoQuoteHash(quote),
        campaignId: request.campaignId,
        ...approval,
      };
      const prior = this.db
        .prepare(
          'SELECT approval_json FROM video_generation_estimate_approvals WHERE request_hash=?',
        )
        .get(body.requestHash);
      if (
        prior &&
        videoQuoteHash(JSON.parse(prior.approval_json)) !== videoQuoteHash(body)
      )
        fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'approval');
      if (!prior)
        this.db
          .prepare(
            'INSERT INTO video_generation_estimate_approvals VALUES (?, ?, ?, ?)',
          )
          .run(
            body.requestHash,
            body.campaignId,
            body.quoteHash,
            JSON.stringify(body),
          );
      return immutable(body);
    });
  }
  #policy(campaignId: any): any {
    const row = this.db
      .prepare(
        'SELECT * FROM video_generation_campaign_budgets WHERE campaign_id = ?',
      )
      .get(campaignId);
    if (!row) fail('VIDEO_GENERATION_POLICY_REQUIRED', 'campaignId');
    return {
      ...validateVideoBudget(JSON.parse(row.policy_json)),
      projectId: row.project_id,
    };
  }
  #usage(campaignId: string): CampaignUsage {
    const policy = this.#policy(campaignId);
    const rows = this.video.listActive(campaignId);
    let total = 0n;
    let reservedSubmissions = 0;
    let paidSubmissions = 0;
    let hasUnknown = false;
    let hasCeilingBreach = false;
    const accountedCostIds = new Set();
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='global_paid_operations'",
        )
        .get()
    )
      for (const row of this.db
        .prepare('SELECT * FROM global_paid_operations')
        .all()) {
        const proof = JSON.parse(row.proof_json);
        if (
          proof.campaignId !== campaignId ||
          proof.kind === 'MANUAL_TTS_RESERVATION'
        )
          continue;
        let actual = usdUnits(row.actual_usd ?? '0');
        const reserved = usdUnits(row.maximum_usd);
        for (const telemetry of this.attribution.costEvents(
          row.provider,
          proof.bodyHash ?? row.request_hash,
          proof.telemetryOccurredAt ?? null,
        )) {
          const cost = this.repository.getCostEvent(telemetry.cost_event_id);
          if (cost?.currency === 'USD') {
            const value = usdUnits(cost.amount);
            if (value > actual) actual = value;
            accountedCostIds.add(cost.costEventId);
          }
        }
        const settled = this.settledFirstFal(row, proof);
        if (settled) for (const id of settled) accountedCostIds.add(id);
        total += settled ? actual : actual > reserved ? actual : reserved;
        if (['SUBMITTING', 'UNKNOWN'].includes(row.state)) hasUnknown = true;
        if (actual > reserved) hasCeilingBreach = true;
      }
    if (this.tts.exists()) {
      for (const row of this.tts.list(campaignId)) {
        const adjustments = new CostAdjustmentsRepository(this.repository);
        const operation = this.getTts(row.operation_id);
        const reservation = usdUnits(operation.request.reservationUsd),
          actual = usdUnits(operation.billing?.actualCostUsd ?? '0');
        const event = this.repository.getCostEvent(
          `tts_cost:${row.operation_id}`,
        );
        const v2 = adjustments.enabled();
        const unresolved =
          ['SUBMITTING', 'UNKNOWN'].includes(operation.state) ||
          (v2 && (!operation.billing || !operation.reconciliationReference));
        const net = v2 && event ? adjustments.netUnits(event) : actual;
        const realized = net > actual ? net : actual;
        total +=
          v2 && !unresolved
            ? realized
            : realized > reservation
              ? realized
              : reservation;
        if (unresolved) hasUnknown = true;
        if (!v2 && actual > reservation) hasCeilingBreach = true;
        if (
          event &&
          event.pipelineRunId === operation.request.operation.pipelineRunId &&
          event.origin === 'openai' &&
          (v2 ||
            event.amount ===
              (operation.billing?.actualCostUsd ??
                operation.request.estimatedUsd)) &&
          event.currency === 'USD'
        )
          accountedCostIds.add(event.costEventId);
      }
    }
    for (const row of rows) {
      const operation = this.getOperation(row.generation_request_id);
      const ceiling = usdUnits(videoReservationAmount(operation.ceiling));
      const actual = usdUnits(
        operation.billing?.actualCostUsd ??
          operation.result?.actualCostUsd ??
          '0',
      );
      total += actual > ceiling ? actual : ceiling;
      if (operation.state === 'RESERVED') reservedSubmissions++;
      else paidSubmissions++;
      if (operation.state === 'UNKNOWN') hasUnknown = true;
      if (actual > ceiling) hasCeilingBreach = true;
      const event = this.repository.getCostEvent(operation.costEventId);
      if (
        event &&
        event.pipelineRunId === operation.request.pipelineRunId &&
        event.origin === operation.request.provider &&
        event.currency === 'USD' &&
        actual > 0n &&
        usdUnits(event.amount) === actual
      )
        accountedCostIds.add(event.costEventId);
    }
    const runs = this.affiliate.listRuns(campaignId);
    for (const run of runs) {
      for (const cost of this.repository.listCostEventsByPipelineRun(
        run.pipeline_run_id,
      )) {
        if (accountedCostIds.has(cost.costEventId)) continue;
        if (cost.currency !== 'USD')
          fail('VIDEO_GENERATION_COST_CURRENCY_UNSUPPORTED', 'currency');
        total += usdUnits(cost.amount);
      }
    }
    return immutable({
      campaignId,
      totalUsd: policy.totalUsd,
      committedUsd: usdAmount(total),
      reservedSubmissions,
      paidSubmissions,
      hasUnknown,
      hasCeilingBreach,
    });
  }
  #transaction<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error: any) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
