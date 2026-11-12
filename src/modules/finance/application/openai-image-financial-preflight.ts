import type {
  FinanceReadiness,
  CampaignUsage,
} from '../domain/finance.types.js';
import type {
  ImageFinancialScope,
  OpenAIImageFinancialPreflightResult,
} from '../domain/openai-image-financial-contracts.js';
import {
  validateImageFinancialRequest,
  imageFinancialTime,
} from '../domain/openai-image-financial-contracts.js';
import { usdUnits, usdAmount } from '../domain/video-financial-contracts.js';
export interface ImageFinancialObservation {
  operationId: string;
  requestHash: string;
  scope: ImageFinancialScope;
  state:
    | 'NOT_SENT'
    | 'RESERVED'
    | 'SUBMITTING'
    | 'UNKNOWN'
    | 'COMPLETED'
    | 'REJECTED';
  actualCostUsd: string | null;
  billingEvidence: string | null;
}
export interface ImageFinancialSnapshot {
  // The adapter must verify project/campaign/run relationships, not echo the requested scope.
  scope: ImageFinancialScope;
  global: FinanceReadiness | null;
  campaign: CampaignUsage | null;
  operation: ImageFinancialObservation | null;
}
export interface ImageFinancialReadPort {
  // One consistent read of existing Finance data. No reserve, approval, transport or write capability.
  read(query: {
    scope: ImageFinancialScope;
    operationId: string;
    at: string;
  }): ImageFinancialSnapshot;
}
const SCALE = 10n ** 24n,
  MILLION = 1000000n;
function amount(value: bigint): string {
  const whole = value / SCALE,
    fraction = (value % SCALE).toString().padStart(24, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
function units(value: unknown): bigint | null {
  try {
    return usdUnits(value);
  } catch {
    return null;
  }
}
function scopeMatches(a: ImageFinancialScope, b: ImageFinancialScope): boolean {
  return (
    !!a &&
    a.projectId === b.projectId &&
    a.projectVersion === b.projectVersion &&
    a.pipelineRunId === b.pipelineRunId &&
    (a.campaign === null
      ? b.campaign === null
      : !!b.campaign &&
        a.campaign.campaignId === b.campaign.campaignId &&
        a.campaign.revision === b.campaign.revision)
  );
}
function available(
  global: FinanceReadiness,
  at: string,
): { daily: bigint; monthly: bigint } | null {
  if (
    global.schemaVersion !== 'finance-readiness/1.0.0' ||
    Date.parse(global.evaluatedAt) !== Date.parse(at) ||
    global.timeZone !== global.usage.policy.time_zone
  )
    return null;
  let day: string;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: global.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(at));
    day = ['year', 'month', 'day']
      .map((k) => parts.find((p) => p.type === k)!.value)
      .join('-');
  } catch {
    return null;
  }
  const result: { daily: bigint; monthly: bigint } = { daily: 0n, monthly: 0n };
  for (const key of ['daily', 'monthly'] as const) {
    const p = global[key],
      limit = units(p.limitUsd),
      committed = units(p.committedUsd),
      recorded = units(p.recordedCostUsd),
      reserved = units(p.reservedLiabilityUsd),
      remaining = units(p.remainingUsd);
    if (
      limit === null ||
      limit <= 0n ||
      committed === null ||
      recorded === null ||
      reserved === null ||
      remaining === null ||
      recorded + reserved !== committed ||
      p.period !== (key === 'daily' ? day : day.slice(0, 7))
    )
      return null;
    const canonicalLimit = units(
        key === 'daily'
          ? global.usage.policy.daily_usd
          : global.usage.policy.monthly_usd,
      ),
      canonicalUsage = units(
        key === 'daily' ? global.usage.dailyUsd : global.usage.monthlyUsd,
      );
    if (
      canonicalLimit !== limit ||
      canonicalUsage !== committed ||
      remaining !== (limit > committed ? limit - committed : 0n)
    )
      return null;
    result[key] = remaining;
  }
  return result;
}
export class OpenAIImageFinancialPreflight {
  constructor(private readonly reader: ImageFinancialReadPort) {}
  evaluate(
    value: unknown,
    at: string = new Date().toISOString(),
  ): OpenAIImageFinancialPreflightResult {
    const now = imageFinancialTime(at),
      request = validateImageFinancialRequest(value);
    const scope: ImageFinancialScope = Object.freeze({
      projectId: request.projectId,
      projectVersion: request.projectVersion,
      campaign: request.campaign,
      pipelineRunId: request.pipelineRunId,
    });
    const blockers = new Set<string>([
        'AUTHORIZATION_REQUIRED',
        'RESERVATION_REQUIRED',
      ]),
      missing = new Set<string>();
    const t = request.tariff;
    const matches =
      !!t &&
      t.model === request.model &&
      t.modelVersion === request.modelVersion &&
      t.quality === request.quality &&
      t.resolution.width === request.resolution.width &&
      t.resolution.height === request.resolution.height &&
      t.operationType === request.operationType &&
      t.billingMode === request.billingMode;
    const applicable =
      matches &&
      now >= imageFinancialTime(t!.tariffDate) &&
      now < imageFinancialTime(t!.validUntil) &&
      request.quality !== 'auto';
    if (!applicable) {
      missing.add('applicable-current-tariff');
      blockers.add('TARIFF_UNAVAILABLE_OR_INAPPLICABLE');
    }
    const cost = (
      quantity: string | null,
      rate: string | null | undefined,
      name: string,
    ): bigint | null => {
      if (quantity === null) {
        missing.add(`tokens:${name}`);
        return null;
      }
      if (!applicable) return null;
      if (quantity === '0') return 0n;
      if (rate === null || rate === undefined) {
        missing.add(`rate:${name}`);
        return null;
      }
      // rate is scaled to 18 decimal USD per million; product is exact USD at scale 24.
      return usdUnits(rate) * BigInt(quantity) * BigInt(request.imageCount);
    };
    const text = cost(
      request.tokensPerImage.textInput,
      t?.textInputUsdPerMillion,
      'text-input',
    );
    const image = cost(
      request.tokensPerImage.imageInput,
      t?.imageInputUsdPerMillion,
      'image-input',
    );
    const output = cost(
      request.tokensPerImage.imageOutput,
      t?.imageOutputUsdPerMillion,
      'image-output',
    );
    const total =
      text !== null && image !== null && output !== null
        ? text + image + output
        : null;
    const estimateStatus =
      total !== null
        ? 'ESTIMATE_DOCUMENTED'
        : [text, image, output].some((v) => v !== null)
          ? 'ESTIMATE_PARTIAL'
          : 'COST_UNKNOWN';
    if (total === null) blockers.add('COST_UNKNOWN');
    const proposed = usdUnits(request.proposedMaximumUsd) * MILLION,
      required = total !== null && total > proposed ? total : proposed;
    if (total !== null && total > proposed)
      blockers.add('PROPOSED_CEILING_BELOW_ESTIMATE');
    const snapshot = this.reader.read({
      scope,
      operationId: request.operationId,
      at,
    });
    let budgetStatus: OpenAIImageFinancialPreflightResult['budgetStatus'] =
        'UNVERIFIED',
      availableBudget: OpenAIImageFinancialPreflightResult['availableBudget'] =
        null;
    const remaining = snapshot.global ? available(snapshot.global, at) : null;
    let campaignAvailable: bigint | null = null,
      campaignValid =
        scope.campaign === null ? snapshot.campaign === null : false;
    if (
      scope.campaign &&
      snapshot.campaign &&
      snapshot.campaign.campaignId === scope.campaign.campaignId
    ) {
      const c = snapshot.campaign,
        limit = units(c.totalUsd),
        committed = units(c.committedUsd);
      campaignValid =
        limit !== null &&
        limit > 0n &&
        committed !== null &&
        typeof c.hasUnknown === 'boolean' &&
        typeof c.hasCeilingBreach === 'boolean' &&
        Number.isSafeInteger(c.reservedSubmissions) &&
        c.reservedSubmissions >= 0 &&
        Number.isSafeInteger(c.paidSubmissions) &&
        c.paidSubmissions >= 0;
      if (campaignValid) {
        campaignAvailable = limit! > committed! ? limit! - committed! : 0n;
        if (c.hasUnknown || c.hasCeilingBreach)
          blockers.add('RECONCILIATION_REQUIRED');
      }
    }
    if (!scopeMatches(snapshot.scope, scope) || !remaining || !campaignValid) {
      blockers.add('BUDGET_UNVERIFIED');
      missing.add('consistent-scoped-budget-snapshot');
    } else {
      availableBudget = {
        dailyUsd: usdAmount(remaining.daily),
        monthlyUsd: usdAmount(remaining.monthly),
        campaignUsd:
          campaignAvailable === null ? null : usdAmount(campaignAvailable),
      };
      const sufficient =
        remaining.daily * MILLION >= required &&
        remaining.monthly * MILLION >= required &&
        (campaignAvailable === null || campaignAvailable * MILLION >= required);
      budgetStatus = sufficient
        ? 'AVAILABLE_FOR_PROPOSED_MAXIMUM'
        : 'INSUFFICIENT';
      if (!sufficient) blockers.add('BUDGET_INSUFFICIENT');
      snapshot.global!.reasons.forEach((reason) =>
        blockers.add(`GLOBAL_${reason}`),
      );
    }
    let recoveryStatus: OpenAIImageFinancialPreflightResult['recoveryStatus'] =
        'NEW',
      observedCostUsd: string | null = null;
    const op = snapshot.operation;
    if (op) {
      blockers.add('OPERATION_ALREADY_EXISTS');
      if (
        op.operationId !== request.operationId ||
        op.requestHash !== request.requestHash ||
        !scopeMatches(op.scope, scope)
      ) {
        recoveryStatus = 'IDENTITY_CONFLICT';
        blockers.add('OPERATION_IDENTITY_CONFLICT');
      } else {
        const observed =
          op.actualCostUsd === null ? null : units(op.actualCostUsd);
        const evidenced =
          observed !== null &&
          typeof op.billingEvidence === 'string' &&
          !!op.billingEvidence.trim();
        observedCostUsd = evidenced ? usdAmount(observed!) : null;
        if (op.state === 'NOT_SENT' || op.state === 'RESERVED')
          recoveryStatus = op.state;
        else if (['COMPLETED', 'REJECTED'].includes(op.state) && evidenced)
          recoveryStatus = 'RECONCILED';
        else {
          recoveryStatus = 'UNCERTAIN';
          blockers.add('RECONCILIATION_REQUIRED');
          blockers.add('COST_UNKNOWN');
          missing.add(`billing:${op.operationId}`);
        }
        if (op.actualCostUsd !== null && !evidenced) {
          blockers.add('RECONCILIATION_REQUIRED');
          blockers.add('COST_UNKNOWN');
          missing.add(`billing:${op.operationId}`);
        }
        if (
          ['NOT_SENT', 'RESERVED'].includes(op.state) &&
          (op.actualCostUsd !== null || op.billingEvidence !== null)
        ) {
          recoveryStatus = 'UNCERTAIN';
          blockers.add('RECONCILIATION_REQUIRED');
          blockers.add('OPERATION_STATE_CONFLICT');
        }
        if (evidenced && total !== null && observed! * MILLION !== total)
          blockers.add('OBSERVED_COST_DIFFERS');
        if (evidenced && observed! * MILLION > proposed)
          blockers.add('OBSERVED_CEILING_BREACH');
      }
    }
    return {
      schemaVersion: 'openai-image-financial-preflight/1.0.0',
      operationId: request.operationId,
      requestHash: request.requestHash,
      evaluatedAt: at,
      estimationBasis: 'PROVIDED_PER_IMAGE_TOKEN_ESTIMATES',
      imageCount: request.imageCount,
      estimateStatus,
      statuses: [
        ...new Set([
          estimateStatus,
          ...[
            'COST_UNKNOWN',
            'BUDGET_INSUFFICIENT',
            'AUTHORIZATION_REQUIRED',
            'RESERVATION_REQUIRED',
          ].filter((s) => blockers.has(s)),
        ]),
      ],
      textInputCostUsd: text === null ? null : amount(text),
      imageInputCostUsd: image === null ? null : amount(image),
      outputImageCostUsd: output === null ? null : amount(output),
      totalEstimatedUsd: total === null ? null : amount(total),
      proposedMaximumUsd: request.proposedMaximumUsd,
      authorizedCeilingUsd: null,
      requiredBudgetUsd: amount(required),
      budgetStatus,
      availableBudget,
      budgetEvidence:
        availableBudget && snapshot.global
          ? { global: snapshot.global, campaign: snapshot.campaign }
          : null,
      recoveryStatus,
      observedCostUsd,
      missingEvidence: [...missing].sort(),
      blockers: [...blockers].sort(),
      executionAllowed: false,
      reservationPerformed: false,
    };
  }
}
