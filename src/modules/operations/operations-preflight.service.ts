import { Inject, Injectable } from '@nestjs/common';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { completedContext } from '../content-operations/application/campaign-orchestrator.js';
import {
  campaignStates,
  identifier,
} from '../content-operations/domain/campaign.js';
import { FinanceService } from '../finance/application/finance.service.js';
import type {
  FinanceReadiness,
  FinanceReadinessPeriod,
} from '../finance/domain/finance.types.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import {
  localMediaReadiness,
  type LocalMediaReadiness,
} from '../media/application/local-media-readiness.js';
import { operationsNextAction } from './operations-next-action.js';

export type PreflightStatus =
  'READY_TECHNICAL' | 'ACTION_REQUIRED' | 'NOT_READY' | 'UNKNOWN';
export interface OperationsPreflight {
  schemaVersion: 'operations-preflight/1.0.0';
  executionId: string;
  campaign: { id: string | null; revision: number | null };
  state: string;
  currentStep: string | null;
  status: PreflightStatus;
  pending: string[];
  nextAction: { code: string; message: string } | null;
  finance: {
    schemaVersion: 'finance-readiness/1.0.0';
    status: 'READY' | 'NOT_READY' | 'UNKNOWN';
    scope: 'TECHNICAL_ONLY';
    spendingAuthorized: false;
    operationalAcceptance: 'NOT_ASSESSED';
    timeZone: string | null;
    daily: FinanceReadinessPeriod | null;
    monthly: FinanceReadinessPeriod | null;
    reasons: string[];
  };
  media: LocalMediaReadiness;
  qc: 'PASS' | 'INVALID' | 'PENDING';
  approval: 'RECORDED' | 'REJECTED' | 'PENDING';
  recoveryRequired: boolean;
  uncertainties: string[];
  cost: { status: 'UNKNOWN'; amount: null };
}
const gates = new Set([
  'CATALOG_PRODUCT_REQUIRED',
  'REAL_VIDEO_MEDIA_REQUIRED',
  'MEDIA_SELECTION_REQUIRED',
  'AUTHENTICATED_MEDIA_REVIEW_REQUIRED',
  'COMPLETE_TEMPORAL_QC_REQUIRED',
  'MEDIA_REVIEW_REJECTED',
  'MEDIA_QC_FAILED',
  'GLOBAL_DAILY_BUDGET_EXCEEDED',
  'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
  'AUDIO_REQUIRED',
  'LOCAL_TTS_CONFIGURATION_REQUIRED',
  'LOCAL_TTS_LICENSE_REQUIRED',
  'LOCAL_TTS_EXECUTION_REQUIRED',
  'LOCAL_TTS_BUSY_REQUIRED',
  'ALIGNMENT_CONFIGURATION_REQUIRED',
  'COMPOSITION_RIGHTS_REQUIRED',
  'EXACT_HUMAN_APPROVAL_REQUIRED',
  'QC_FAILED',
  'FINANCE_UNKNOWN',
  'INTERRUPTED_EFFECT_REQUIRES_VERIFICATION',
]);
const steps = new Set([
  'CONTEXT',
  'EDITORIAL',
  'SCENES',
  'VIDEO_GENERATION',
  'MEDIA_QC',
  'AUDIO',
  'ALIGNMENT',
  'SUBTITLES',
  'COMPOSITION',
  'BURN',
  'QC',
  'PREVIEW',
  'HANDOFF',
  'PUBLICATION',
]);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const period = (p: FinanceReadinessPeriod): FinanceReadinessPeriod => ({
  period: p.period,
  limitUsd: p.limitUsd,
  committedUsd: p.committedUsd,
  recordedCostUsd: p.recordedCostUsd,
  reservedLiabilityUsd: p.reservedLiabilityUsd,
  remainingUsd: p.remainingUsd,
});
@Injectable()
export class OperationsPreflightService {
  constructor(
    @Inject(CampaignAdministration)
    private readonly campaigns: CampaignAdministration,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(LocalFlowService) private readonly local: LocalFlowService,
  ) {}
  async inspect(id: string): Promise<OperationsPreflight> {
    identifier(id);
    // Reads only. In particular, detail()/TTS preparation and workflow reconciliation are not invoked.
    const execution = await this.campaigns.get(id);
    const history = await this.campaigns.history(id);
    const done = completedContext(history);
    let finance: OperationsPreflight['finance'] = {
      schemaVersion: 'finance-readiness/1.0.0',
      status: 'UNKNOWN',
      scope: 'TECHNICAL_ONLY',
      spendingAuthorized: false,
      operationalAcceptance: 'NOT_ASSESSED',
      timeZone: null,
      daily: null,
      monthly: null,
      reasons: ['FINANCE_UNAVAILABLE'],
    };
    try {
      const r: FinanceReadiness = await this.finance.getGlobalReadiness();
      finance = {
        schemaVersion: r.schemaVersion,
        status: r.status,
        scope: r.scope,
        spendingAuthorized: r.spendingAuthorized,
        operationalAcceptance: r.operationalAcceptance,
        timeZone: r.timeZone,
        daily: period(r.daily),
        monthly: period(r.monthly),
        reasons: [...r.reasons],
      };
    } catch {
      /* Availability is unknown; never infer zero usage or available budget. */
    }
    let media = localMediaReadiness();
    try {
      const r = await this.local.readiness();
      media = {
        schemaVersion: r.schemaVersion,
        scope: r.scope,
        status: r.status,
        automaticGeneration: r.automaticGeneration,
        components: Object.fromEntries(
          (['piper', 'ctc', 'ffmpeg', 'ffprobe', 'storage'] as const).map(
            (key) => [
              key,
              {
                status: r.components[key].status,
                codes: [...r.components[key].codes],
              },
            ],
          ),
        ) as LocalMediaReadiness['components'],
        unverified: [...r.unverified],
        physicalValidation: r.physicalValidation,
      };
    } catch {
      /* Static inspection failure is explicitly UNKNOWN. */
    }
    const action = operationsNextAction(execution);
    const pending = action
      ? [gates.has(action.code) ? action.code : 'EXECUTION_ACTION_REQUIRED']
      : [];
    const qcResult = object(done.QC).result;
    const qc =
      qcResult === 'PASS' && object(done.QC).approvalBlocked !== true
        ? 'PASS'
        : qcResult !== undefined
          ? 'INVALID'
          : 'PENDING';
    const decision = object(done.APPROVAL).decision;
    const approval =
      decision === 'APPROVED'
        ? 'RECORDED'
        : decision === 'REJECTED'
          ? 'REJECTED'
          : 'PENDING';
    const recoveryRequired = execution.status === 'WAITING_RECONCILIATION';
    const validIdentity =
      /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{2,199}$/.test(execution.campaign_id) &&
      Number.isSafeInteger(execution.campaign_revision) &&
      execution.campaign_revision > 0;
    const knownState = (campaignStates as readonly string[]).includes(
      execution.status,
    );
    const uncertainties = ['COST_UNAVAILABLE', ...media.unverified];
    if (recoveryRequired) uncertainties.push('EFFECT_REQUIRES_VERIFICATION');
    if (finance.status === 'UNKNOWN') uncertainties.push('FINANCE_UNAVAILABLE');
    if (media.status === 'UNKNOWN')
      uncertainties.push('MEDIA_READINESS_UNKNOWN');
    if (!validIdentity || !knownState)
      uncertainties.push('EXECUTION_CONTEXT_UNKNOWN');
    const status: PreflightStatus =
      !validIdentity || !knownState
        ? 'UNKNOWN'
        : ['FAILED', 'CANCELLED'].includes(execution.status) ||
            finance.status === 'NOT_READY' ||
            media.status === 'NOT_READY' ||
            qc === 'INVALID' ||
            approval === 'REJECTED'
          ? 'NOT_READY'
          : recoveryRequired || pending.length
            ? 'ACTION_REQUIRED'
            : finance.status === 'UNKNOWN' || media.status === 'UNKNOWN'
              ? 'UNKNOWN'
              : qc === 'PENDING' || approval === 'PENDING'
                ? 'ACTION_REQUIRED'
                : 'READY_TECHNICAL';
    const knownPending = [...pending];
    if (finance.status !== 'READY')
      knownPending.push(
        finance.status === 'UNKNOWN'
          ? 'FINANCE_UNAVAILABLE'
          : 'FINANCE_NOT_READY',
      );
    if (media.status !== 'READY')
      knownPending.push(
        media.status === 'UNKNOWN'
          ? 'MEDIA_READINESS_UNKNOWN'
          : 'MEDIA_NOT_READY',
      );
    if (qc !== 'PASS')
      knownPending.push(qc === 'INVALID' ? 'QC_INVALID' : 'QC_REQUIRED');
    if (approval !== 'RECORDED')
      knownPending.push(
        approval === 'REJECTED'
          ? 'HUMAN_APPROVAL_REJECTED'
          : 'EXACT_HUMAN_APPROVAL_REQUIRED',
      );
    const nextCode =
      !validIdentity || !knownState
        ? 'EXECUTION_CONTEXT_UNKNOWN'
        : recoveryRequired
          ? 'RECONCILIATION_REQUIRED'
          : execution.status === 'FAILED'
            ? 'EXECUTION_FAILED'
            : execution.status === 'CANCELLED'
              ? 'EXECUTION_CANCELLED'
              : (knownPending[0] ?? null);
    return {
      schemaVersion: 'operations-preflight/1.0.0',
      executionId: id,
      campaign: {
        id: validIdentity ? execution.campaign_id : null,
        revision: validIdentity ? execution.campaign_revision : null,
      },
      state: knownState ? execution.status : 'UNKNOWN',
      currentStep: steps.has(String(execution.finalization.step))
        ? String(execution.finalization.step)
        : null,
      status,
      pending: [...new Set(knownPending)],
      nextAction: nextCode
        ? {
            code: nextCode,
            message: 'Verifique a pendência operacional antes de continuar.',
          }
        : null,
      finance,
      media,
      qc,
      approval,
      recoveryRequired,
      uncertainties,
      cost: { status: 'UNKNOWN', amount: null },
    };
  }
}
