import type { CampaignRepository } from '../infrastructure/campaign.repository.js';
import { CampaignError } from '../domain/campaign.js';
import type { CampaignExecution, CampaignEvent } from '../domain/campaign.js';
export interface CampaignWorkflow {
  readyToResume?: (
    execution: CampaignExecution,
    history: CampaignEvent[],
  ) => Promise<boolean>;
  readonly steps: readonly string[];
  execute: (
    step: string,
    execution: CampaignExecution,
    request: Record<string, unknown>,
    completed: Record<string, unknown>,
  ) => Promise<unknown>;
  reconcile: (
    execution: CampaignExecution,
    history: CampaignEvent[],
  ) => Promise<Record<string, unknown> | null>;
}
export class CampaignOrchestrator {
  constructor(
    readonly repository: CampaignRepository,
    private readonly workflow: CampaignWorkflow,
    private readonly now = () => new Date().toISOString(),
    private readonly ttl = 60_000,
  ) {}
  async tick() {
    this.repository.recover(this.now());
    for (const e of this.repository.pendingFinalization()) {
      const history = this.repository.history(e.execution_id);
      try {
        if (e.status === 'WAITING_INPUT') {
          if (await this.workflow.readyToResume?.(e, history))
            this.repository.resume(e.execution_id, this.now(), e.version);
        } else {
          const request = executionRequest(history);
          if (
            !request.videoProduction ||
            request.mode !== 'LOCAL_VALIDATION' ||
            request.publication
          )
            continue;
          const last = history
            .filter((h) => h.event_type === 'STEP_STARTED')
            .at(-1);
          if (
            !last ||
            ![
              'MEDIA_QC',
              'AUDIO',
              'ALIGNMENT',
              'SUBTITLES',
              'COMPOSITION',
              'BURN',
              'QC',
              'PREVIEW',
            ].includes(String(last.evidence.step))
          )
            continue;
          const proof = await this.workflow.reconcile(e, history);
          if (proof?.verified === true)
            this.repository.resume(
              e.execution_id,
              this.now(),
              e.version,
              proof,
            );
        }
      } catch (error) {
        if (!(
          error instanceof CampaignError &&
          error.code === 'EXECUTION_VERSION_CONFLICT'
        ))
          throw error;
      }
    }
    for (const e of this.repository.pendingPublicationPolls(this.now())) {
      try {
        this.repository.resume(e.execution_id, this.now(), e.version);
      } catch (error) {
        if (!(
          error instanceof CampaignError &&
          error.code === 'EXECUTION_VERSION_CONFLICT'
        ))
          throw error;
      }
    }
    for (const e of this.repository.due(this.now())) {
      const claimed = this.repository.claim(
        e.execution_id,
        this.now(),
        this.ttl,
      );
      if (claimed) await this.run(claimed);
    }
  }
  async resume(id: string) {
    const e = this.repository.get(id);
    const verified =
      e.status === 'WAITING_RECONCILIATION'
        ? await this.workflow.reconcile(e, this.repository.history(id))
        : null;
    return this.repository.resume(id, this.now(), e.version, verified);
  }
  private async run(e: CampaignExecution) {
    const id = e.execution_id,
      token = e.claim_token!;
    let renewalFailure: unknown;
    const heartbeat = setInterval(() => {
      try {
        this.repository.heartbeat(id, token, this.now(), this.ttl);
      } catch (error) {
        renewalFailure = error;
      }
    }, this.ttl / 3);
    heartbeat.unref();
    try {
      const history = this.repository.history(id),
        request = executionRequest(history);
      const completed: Record<string, unknown> = {};
      for (const event of history)
        if (event.event_type === 'STEP_DONE')
          completed[String(event.evidence.step)] = event.evidence.result;
      for (const event of history)
        if (event.event_type === 'HUMAN_APPROVAL')
          completed.APPROVAL = event.evidence;
      for (const step of this.workflow.steps) {
        if (renewalFailure) throw renewalFailure;
        if (Object.hasOwn(completed, step)) continue;
        let attempts = this.repository
          .history(id)
          .filter(
            (h) =>
              h.event_type === 'STEP_FAILED' &&
              h.evidence.step === step &&
              h.evidence.retrySafe === true,
          ).length;
        for (;;) {
          if (attempts >= 3) {
            this.repository.ownedEvent(
              id,
              token,
              this.now(),
              'RETRY_EXHAUSTED',
              { step },
              'FAILED',
            );
            return;
          }
          this.repository.ownedEvent(id, token, this.now(), 'STEP_STARTED', {
            step,
          });
          try {
            const result = await this.workflow.execute(
              step,
              e,
              request,
              completed,
            );
            if (renewalFailure) throw renewalFailure;
            this.repository.ownedEvent(id, token, this.now(), 'STEP_DONE', {
              step,
              result,
            });
            completed[step] = result;
            break;
          } catch (error) {
            if (error instanceof CampaignError && error.code === 'CLAIM_LOST')
              return;
            const failure = error as {
              code?: string;
              transient?: boolean;
              retrySafe?: boolean;
            };
            const code =
              typeof failure?.code === 'string' &&
              /^[A-Z][A-Z0-9_]{2,99}$/.test(failure.code)
                ? failure.code
                : 'CAMPAIGN_STEP_FAILED';
            const uncertain =
              /UNKNOWN|UNCERTAIN|RECONCILIATION|TIMEOUT|NETWORK|CONNECTION/.test(
                code,
              );
            const waiting =
              /REQUIRED|UNAVAILABLE|NOT_FOUND|BUDGET_EXCEEDED|PRICE_UNPROVEN/.test(
                code,
              );
            const safe =
              !uncertain &&
              !waiting &&
              failure?.transient === true &&
              failure?.retrySafe === true;
            this.repository.ownedEvent(id, token, this.now(), 'STEP_FAILED', {
              step,
              code,
              retrySafe: safe,
            });
            if (safe && ++attempts < 3) continue;
            this.repository.ownedEvent(
              id,
              token,
              this.now(),
              'PAUSED',
              { step, code },
              uncertain
                ? 'WAITING_RECONCILIATION'
                : waiting
                  ? 'WAITING_INPUT'
                  : 'FAILED',
            );
            return;
          }
        }
      }
      this.repository.ownedEvent(
        id,
        token,
        this.now(),
        'COMPLETED',
        { handoff: completed.HANDOFF },
        'SUCCEEDED',
      );
    } catch (error) {
      if (!(error instanceof CampaignError && error.code === 'CLAIM_LOST'))
        throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
}
export function executionRequest(
  history: CampaignEvent[],
): Record<string, unknown> {
  const request = { ...history[0].evidence };
  for (const event of history)
    if (event.event_type === 'INPUT_SUPPLIED')
      Object.assign(request, event.evidence);
  return request;
}
