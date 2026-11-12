import { Inject, Injectable } from '@nestjs/common';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { completedContext } from '../content-operations/application/campaign-orchestrator.js';
import { identifier } from '../content-operations/domain/campaign.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { OperationsPreflightService } from './operations-preflight.service.js';
import type {
  FirstCommercialPilotQuery,
  FirstCommercialPilotReport,
} from './first-commercial-pilot.contract.js';

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const integer = (v: unknown): number | null =>
  Number.isSafeInteger(v) ? (v as number) : null;
function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

@Injectable()
export class FirstCommercialPilotService {
  constructor(
    @Inject(CampaignAdministration)
    private readonly campaigns: CampaignAdministration,
    @Inject(AffiliateService) private readonly affiliate: AffiliateService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(LocalFlowService) private readonly local: LocalFlowService,
    @Inject(PublishingService) private readonly publishing: PublishingService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(OperationsPreflightService)
    private readonly preflight: OperationsPreflightService,
  ) {}

  /** Reads existing records and rechecks physical media. No tick, generation, approval or publication. */
  async inspect(
    query: FirstCommercialPilotQuery,
  ): Promise<FirstCommercialPilotReport> {
    identifier(query.executionId);
    if (
      query.packageHash !== undefined &&
      !/^[a-f0-9]{64}$/.test(query.packageHash)
    )
      fail('PILOT_INVALID_PACKAGE_HASH');
    const execution = this.campaigns.get(query.executionId);
    const history = this.campaigns.history(query.executionId);
    const done = completedContext(history);
    const campaign = await this.affiliate.getCampaign(
      execution.campaign_id,
      execution.campaign_revision,
    );
    if (!campaign) fail('PILOT_CAMPAIGN_NOT_FOUND');
    const preflight = await this.preflight.inspect(query.executionId);
    const script = object(object(done.EDITORIAL).script);
    const audio = object(done.AUDIO);
    const video = object(done.BURN);
    const context = object(done.CONTEXT);
    const blockers: string[] = [];
    let physicalMedia: FirstCommercialPilotReport['physicalMedia'] = 'PENDING';
    let qc: FirstCommercialPilotReport['qc'] = 'PENDING';
    if (text(video.videoRenderId)) {
      try {
        const render = this.media.getVideoRender(String(video.videoRenderId));
        if (
          !render ||
          render.pipelineRunId !== execution.run_id ||
          render.contentHash !== video.contentHash ||
          render.revision !== video.revision ||
          this.media.verifyMedia(render.logicalReference) !== render.contentHash
        )
          fail('PILOT_MEDIA_BINDING_MISMATCH');
        physicalMedia = 'VERIFIED';
        const evidence = this.local.qcHandoffEvidence(render.videoRenderId);
        qc =
          evidence?.report.result === 'PASS' &&
          evidence.report.approvalBlocked === false
            ? 'PASS'
            : 'INVALID';
      } catch {
        physicalMedia = 'INVALID';
        qc = 'INVALID';
        // Keep internal paths/provider payloads out of the operator diagnostic.
        blockers.push('PILOT_PHYSICAL_EVIDENCE_INVALID');
      }
    }
    let pkg: FirstCommercialPilotReport['package'] = null;
    let publication: FirstCommercialPilotReport['publication'] = [];
    if (query.packageHash) {
      const stored = this.publishing.package(query.packageHash);
      if (
        !stored ||
        stored.identity.pipelineRunId !== execution.run_id ||
        stored.campaignId !== execution.campaign_id ||
        stored.campaignRevision !== execution.campaign_revision ||
        stored.identity.videoRenderId !== video.videoRenderId ||
        stored.identity.videoRenderContentHash !== video.contentHash
      )
        fail('PILOT_PACKAGE_SCOPE_MISMATCH');
      const readiness = this.publishing.manualReadiness(query.packageHash);
      const review = this.publishing.packageReview(query.packageHash);
      pkg = {
        hash: query.packageHash,
        readiness: readiness.status,
        approval: review?.mediaDecision.decision ?? 'PENDING',
      };
      publication = this.publishing
        .publications(query.packageHash)
        .map((p: any) => ({ id: p.publicationId, state: p.state }));
      if (readiness.status !== 'READY_FOR_OPERATOR_HANDOFF')
        blockers.push(readiness.status);
    }
    let costs: unknown;
    try {
      costs = this.finance.getPilotCostClosure(execution.run_id);
    } catch {
      costs = {
        status: 'UNKNOWN',
        amount: null,
        reason: 'FINANCE_COSTS_UNAVAILABLE',
      };
      blockers.push('FINANCE_COSTS_UNAVAILABLE');
    }
    if (object(costs).financiallyClosed !== true)
      blockers.push('COST_COVERAGE_UNVERIFIED');
    const paused = [
      'WAITING_INPUT',
      'WAITING_RECONCILIATION',
      'FAILED',
    ].includes(execution.status)
      ? history.filter((h) => h.event_type === 'PAUSED').at(-1)
      : undefined;
    const pausedCode = text(paused?.evidence.code);
    if (pausedCode) blockers.push(pausedCode);
    if (preflight.finance.status !== 'READY')
      blockers.push(`FINANCE_${preflight.finance.status}`);
    if (!video.videoRenderId) blockers.push('PHYSICAL_MP4_REQUIRED');
    else if (qc !== 'PASS') blockers.push('PHYSICAL_QC_REQUIRED');
    else if (!pkg) blockers.push('MANUAL_PACKAGE_REQUIRED');
    const currentStep =
      text(paused?.evidence.step) ??
      text(
        history.filter((h) => h.event_type === 'STEP_STARTED').at(-1)?.evidence
          .step,
      );
    return {
      schemaVersion: 'first-commercial-pilot/1.0.0',
      executionId: execution.execution_id,
      pipelineRunId: execution.run_id,
      project: {
        id: text(script.projectId) ?? text(context.projectId),
        revision:
          integer(script.projectVersion) ?? integer(context.projectVersion),
      },
      campaign: {
        id: execution.campaign_id,
        revision: execution.campaign_revision,
      },
      product: { id: campaign.productId, revision: campaign.productRevision },
      state: execution.status,
      currentStep,
      nextAction:
        (physicalMedia === 'INVALID'
          ? 'PILOT_PHYSICAL_EVIDENCE_INVALID'
          : pausedCode) ??
        blockers[0] ??
        (publication.length
          ? 'VERIFY_OPERATOR_RECEIPT'
          : 'OPERATOR_MANUAL_PUBLICATION'),
      blockers: [...new Set(blockers)],
      script: { id: text(script.scriptId), sha256: text(script.contentHash) },
      audio: {
        id: text(audio.voiceTrackId),
        sha256:
          text(audio.voiceTrackContentHash) ??
          text(object(object(done.ALIGNMENT).input).audioSha256),
      },
      video: {
        id: text(video.videoRenderId),
        revision: integer(video.revision),
        sha256: text(video.contentHash),
      },
      qc,
      physicalMedia,
      package: pkg,
      publication,
      finance: {
        readiness: preflight.finance.status,
        costs,
        spendingAuthorized: false,
      },
      history: history.map((h) => ({
        sequence: h.sequence,
        event: h.event_type,
        step: text(h.evidence.step),
        at: h.occurred_at,
      })),
      commercialAcceptance: 'NOT_ASSESSED',
      publicationAuthorized: false,
    };
  }
}
