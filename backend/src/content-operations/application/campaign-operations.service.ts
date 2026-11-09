import type { AffiliateRepositoryFactory } from '../../affiliate/application/ports/affiliate-repository.port.js';
import type {
  CampaignOperationsPersistence,
  CampaignOperationsPort,
  CampaignOperationsSession,
} from './campaign-operations.port.js';
import { completedContext } from './campaign-orchestrator.js';

export class CampaignOperationsService implements CampaignOperationsPort {
  constructor(
    private readonly persistence: CampaignOperationsPersistence,
    private readonly catalog: AffiliateRepositoryFactory,
  ) {}
  open(): CampaignOperationsSession {
    const session = this.persistence.open(),
      repository = session.repository;
    return {
      audit: (id) => repository.operationalHistory(id),
      facts: (id) => {
        const catalog = this.catalog.open(true);
        try {
          return repository.operationalExecutions(id).map((e) => {
            const history = repository.operationalHistory(e.execution_id);
            const request = history[0]?.evidence ?? {};
            const selection = request.catalogSelection as
              { briefing?: { productName?: string } } | undefined;
            const done = completedContext(history);
            const pause = history
              .filter((h) => h.event_type === 'PAUSED')
              .at(-1);
            return {
              executionId: e.execution_id,
              campaignId: e.campaign_id,
              runId: e.run_id,
              day: e.production_date,
              status: e.status,
              productName:
                selection?.briefing?.productName ??
                (request.briefingId
                  ? catalog.getBriefing(String(request.briefingId as string))
                      ?.productName
                  : undefined) ??
                'Produto não definido',
              pause: pause
                ? {
                    cursor: pause.cursor,
                    sequence: pause.sequence,
                    code: String(pause.evidence.code),
                    step: String(pause.evidence.step),
                  }
                : undefined,
              approvalCursor: Math.max(
                0,
                ...history
                  .filter((h) => h.event_type === 'HUMAN_APPROVAL')
                  .map((h) => h.cursor),
              ),
              stage: {
                render: done.BURN as Record<string, unknown> | undefined,
                qualityControl: done.QC as Record<string, unknown> | undefined,
                previewReady:
                  (done.PREVIEW as { ready?: boolean } | undefined)?.ready ===
                  true,
                handedOff: !!done.HANDOFF,
                approval: done.APPROVAL as Record<string, unknown> | undefined,
              },
            };
          });
        } finally {
          catalog.close();
        }
      },
      checkpoint: () => repository.checkpoint(),
      notificationBaseline: (...args) =>
        repository.notificationBaseline(...args),
      hasNotificationAttempt: (key) => repository.hasNotificationAttempt(key),
      claimNotification: (...args) => repository.claimNotification(...args),
      finishNotification: (...args) => repository.finishNotification(...args),
      recoverNotifications: (...args) =>
        repository.recoverNotifications(...args),
      close: () => session.close(),
    };
  }
}
