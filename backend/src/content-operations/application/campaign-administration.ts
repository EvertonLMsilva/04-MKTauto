import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CampaignRepository } from '../infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  executionRequest,
} from './campaign-orchestrator.js';
import {
  NativeCampaignWorkflow,
  campaignRequest,
  document,
} from './native-campaign-workflow.js';
import { CampaignError } from '../domain/campaign.js';
import { HumanApprovalService } from '../../publishing/application/human-approval.service.js';
export const CAMPAIGN_DATABASE = Symbol('CAMPAIGN_DATABASE');
export class CampaignAdministration implements OnModuleInit, OnModuleDestroy {
  private db?: DatabaseSync;
  private store?: CampaignRepository;
  private runner?: CampaignOrchestrator;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private readonly logger = new Logger(CampaignAdministration.name);
  constructor(
    private readonly path: string | null,
    readonly workflow: NativeCampaignWorkflow,
    private readonly enabled = false,
  ) {}
  private open() {
    if (this.store) return this.store;
    if (!this.path || !isAbsolute(this.path))
      throw new CampaignError('CAMPAIGN_DATABASE_REQUIRED');
    const db = new DatabaseSync(this.path, { readOnly: true });
    try {
      if (
        ![41, 42].includes(
          Number(db.prepare('PRAGMA user_version').get()?.user_version),
        )
      )
        throw new CampaignError('CAMPAIGN_SCHEMA_41_REQUIRED');
    } finally {
      db.close();
    }
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA foreign_keys=ON');
    this.store = new CampaignRepository(this.db);
    this.runner = new CampaignOrchestrator(this.store, this.workflow);
    return this.store;
  }
  onModuleInit() {
    if (!this.enabled) return;
    this.open();
    const poll = () => {
      if (this.pending) return;
      this.pending = this.tick()
        .catch((error) => {
          this.logger.error(
            error instanceof Error
              ? error.message
              : 'CAMPAIGN_SCHEDULER_FAILED',
          );
        })
        .finally(() => {
          this.pending = undefined;
        });
    };
    this.timer = setInterval(poll, 1000);
    this.timer.unref();
    poll();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    this.db?.close();
  }
  async schedule(value: unknown) {
    const r = campaignRequest(value);
    await this.workflow.validate(r);
    return this.open().schedule(
      {
        campaignId: String(r.campaignId),
        campaignRevision: Number(r.campaignRevision),
        scheduledAt: String(r.scheduledAt),
        runId: String(r.runId),
      },
      r,
      new Date().toISOString(),
    );
  }
  get(id: string) {
    return this.open().get(id);
  }
  history(id: string) {
    return this.open().history(id);
  }
  cancel(id: string) {
    return this.open().cancel(id, new Date().toISOString());
  }
  async resume(id: string, value?: unknown) {
    const store = this.open();
    if (
      value !== undefined &&
      value !== null &&
      Object.keys(document(value)).length
    ) {
      const patch = document(value),
        e = store.get(id),
        history = store.history(id);
      const stages: Record<string, string> = {
        voiceTrackId: 'AUDIO',
        audio: 'AUDIO',
        alignment: 'ALIGNMENT',
        composition: 'COMPOSITION',
        publication: 'PUBLICATION',
        sceneMediaAssetIds: 'MEDIA_QC',
      };
      if (
        Object.keys(patch).some(
          (k) =>
            !stages[k] ||
            history.some(
              (h) =>
                h.event_type === 'STEP_DONE' && h.evidence.step === stages[k],
            ),
        )
      )
        throw new CampaignError('COMPLETED_INPUT_CONFLICT');
      campaignRequest({ ...executionRequest(history), ...patch });
      store.administrativeEvent(
        id,
        e.version,
        new Date().toISOString(),
        'INPUT_SUPPLIED',
        patch,
      );
    }
    return this.runner!.resume(id);
  }
  async tick() {
    this.open();
    await this.runner!.tick();
  }
  async approve(id: string, value: unknown) {
    const r = this.open(),
      e = r.get(id),
      events = r.history(id);
    const done: Record<string, unknown> = {};
    for (const event of events)
      if (event.event_type === 'STEP_DONE')
        done[String(event.evidence.step)] = event.evidence.result;
    const evidence = await this.workflow.approvalEvidence(e, done);
    // Reuse the existing deterministic approval rules with local QC's verified identity.
    const service = new HumanApprovalService({
      repository: {
        getVideoRender: () => evidence.render,
        getQualityControlReport: () => evidence.qc,
        getHumanApprovalDecision: (decisionId: string) =>
          events.find(
            (h) =>
              h.event_type === 'HUMAN_APPROVAL' &&
              h.evidence.humanApprovalDecisionId === decisionId,
          )?.evidence ?? null,
        registerHumanApprovalDecision: (decision: Record<string, unknown>) =>
          decision,
        findApprovedHumanApprovalDecision: () => null,
      },
    });
    const decision = service.decide(value) as Record<string, unknown>;
    r.administrativeEvent(
      id,
      e.version,
      new Date().toISOString(),
      'HUMAN_APPROVAL',
      decision,
    );
    return decision;
  }
}
