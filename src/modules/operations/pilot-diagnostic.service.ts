import { assertFakeExecutionPolicy } from '../content-operations/domain/fake-execution-policy.js';
import type { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import {
  completedContext,
  executionRequest,
} from '../content-operations/application/campaign-orchestrator.js';
import { identifier } from '../content-operations/domain/campaign.js';
import type { OperationsPreflightService } from './operations-preflight.service.js';
import type { AffiliateService } from '../affiliate/application/affiliate.service.js';
import type { FinanceService } from '../finance/application/finance.service.js';
import type { MediaService } from '../media/application/media.service.js';

/** Internal read-only observation; no workflow, provider dispatch, persistence or authorization. */
export class PilotDiagnosticService {
  constructor(
    private readonly campaigns: CampaignAdministration,
    private readonly preflight: OperationsPreflightService,
    private readonly affiliate: AffiliateService,
    private readonly finance: FinanceService,
    private readonly media: MediaService,
  ) {}
  async inspect(executionIds: readonly string[]) {
    const occurrences = [];
    for (const id of new Set(executionIds)) {
      identifier(id);
      const execution = this.campaigns.get(id);
      const history = this.campaigns.history(id);
      const request = executionRequest(history),
        done = completedContext(history);
      const policy = assertFakeExecutionPolicy(request, execution);
      if (!policy)
        throw Object.assign(new Error('PILOT_CONTROLLED_FAKE_REQUIRED'), {
          code: 'PILOT_CONTROLLED_FAKE_REQUIRED',
        });
      const run = request.run as { projectId: string; projectVersion: number };
      const catalog = await this.affiliate.catalogReadiness(
        run.projectId,
        run.projectVersion,
      );
      const item = catalog.items.find(
        (i) =>
          i.campaign.campaignId === execution.campaign_id &&
          i.campaign.revision === execution.campaign_revision,
      );
      const readiness = this.finance.getRunReadiness(execution.run_id);
      const p = await this.preflight.inspect(id);
      const script = (
        done.EDITORIAL as
          { script?: { scriptId: string; contentHash: string } } | undefined
      )?.script;
      const render = (done.BURN ?? done.COMPOSITION) as
        | { videoRenderId: string; revision: number; contentHash: string }
        | undefined;
      const qc = done.QC as { reportId: string } | undefined;
      const handoff =
        script && render && qc
          ? this.media.handoff({
              videoRenderId: render.videoRenderId,
              pipelineRunId: execution.run_id,
              scriptId: script.scriptId,
              scriptContentHash: script.contentHash,
              renderRevision: render.revision,
              renderContentHash: render.contentHash,
              qualityControlReportId: qc.reportId,
            })
          : null;
      const disabled = policy.publication === 'DISABLED';
      occurrences.push({
        executionId: id,
        runId: execution.run_id,
        campaignId: execution.campaign_id,
        campaignRevision: execution.campaign_revision,
        productionDate: execution.production_date,
        state: execution.status,
        completedSteps: Object.keys(done),
        pending: p.pending,
        preflight: p,
        affiliate: {
          schemaVersion: catalog.schemaVersion,
          snapshotHash: catalog.snapshotHash,
          eligible: item?.eligibility.technicalEligibility === 'ELIGIBLE',
          blockers: item?.eligibility.technicalBlockers ?? [
            'EXACT_CAMPAIGN_REVISION_NOT_IN_CATALOG',
          ],
          operationallyAuthorized: false as const,
        },
        mediaHandoff: handoff
          ? {
              schemaVersion: handoff.schemaVersion,
              status: handoff.status,
              qc: handoff.qc,
              composition: handoff.composition,
              blockers: handoff.blockers,
              authorizationsGranted: handoff.authorizationsGranted,
            }
          : null,
        runFinance: {
          schemaVersion: readiness.schemaVersion,
          status: readiness.status,
          totalRunCost: readiness.totalRunCost,
          recordedTotalsByCurrency: readiness.recordedTotalsByCurrency,
          unknownCosts: readiness.unknownCosts,
          pendingClosure: readiness.pendingClosure,
        },
        publication: {
          status: disabled ? 'DISABLED_BY_FAKE_POLICY' : 'NOT_ASSESSED',
          evidence: null,
        },
        blockers: [
          ...p.pending,
          ...(item?.eligibility.technicalBlockers ?? [
            'EXACT_CAMPAIGN_REVISION_NOT_IN_CATALOG',
          ]),
          ...(item?.eligibility.operationalBlockers ?? []),
          ...readiness.pendingClosure,
          ...(handoff?.blockers ?? ['MEDIA_HANDOFF_NOT_AVAILABLE']),
        ],
        nextHumanAction:
          p.nextAction ??
          (readiness.status !== 'RECONCILED'
            ? {
                code: 'RUN_FINANCE_CLOSURE_REQUIRED',
                message: 'Verifique as evid�ncias financeiras da execu��o.',
              }
            : handoff?.status !== 'READY_TECHNICAL'
              ? {
                  code: 'MEDIA_HANDOFF_REQUIRED',
                  message: 'Verifique as evid�ncias t�cnicas de m�dia.',
                }
              : null),
      });
    }
    return {
      schemaVersion: 'operations-pilot-report/1.0.0' as const,
      scope: 'OFFLINE_TECHNICAL_OBSERVATION' as const,
      authorizationsGranted: false as const,
      physicalAcceptance: 'NOT_ASSESSED' as const,
      operationalD1D2Acceptance: 'NOT_ASSESSED' as const,
      remainingOperationalGates: [
        'PHYSICAL_ACCEPTANCE_REQUIRED',
        'REAL_HUMAN_APPROVAL_REQUIRED',
        'SPENDING_AUTHORIZATION_REQUIRED',
        'SOCIAL_PUBLICATION_DISABLED',
        'OPERATIONAL_D1_D2_ACCEPTANCE_REQUIRED',
      ],
      occurrences,
    };
  }
}
