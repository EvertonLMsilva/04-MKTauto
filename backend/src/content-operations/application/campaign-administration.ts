import { DatabaseSync } from 'node:sqlite';
import { PRODUCT_FRAMING_POLICY } from '../../media/domain/product-framing.js';
import {
  compositionScope,
  compositionGrant,
} from '../domain/composition-authorization.js';
import { isAbsolute } from 'node:path';
import { Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CampaignRepository } from '../infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  executionRequest,
  completedContext,
} from './campaign-orchestrator.js';
import {
  NativeCampaignWorkflow,
  campaignRequest,
  document,
  localRecurrence,
  localRequestInput,
} from './native-campaign-workflow.js';
import {
  CampaignError,
  identifier,
  instant,
  canonicalJson,
} from '../domain/campaign.js';
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
    private readonly now = () => new Date().toISOString(),
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
    this.runner = new CampaignOrchestrator(this.store, this.workflow, this.now);
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
    if (document(value).legacyRecovery)
      throw new CampaignError('LEGACY_RECOVERY_ENDPOINT_REQUIRED');
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
  async startLocal(value: unknown) {
    const input = localRequestInput(value),
      enabled = localRecurrence(input);
    if (enabled === false) {
      const existing = this.open()
        .recurrences(true)
        .find((e) => e.config.request.campaignId === input.campaignId);
      if (existing) {
        const seed = existing.config.request;
        // Stopping production must remain possible after catalog eligibility is lost.
        if (
          seed.campaignRevision !== input.campaignRevision ||
          seed.scheduledAt !== instant(input.requestedAt) ||
          document(seed.run).projectVersion !== input.projectVersion ||
          canonicalJson(seed.localImage) !== canonicalJson(input.localImage)
        )
          throw new CampaignError('CAMPAIGN_RECURRENCE_CONFLICT');
        return this.open().configureRecurrence(
          seed,
          false,
          String(input.requestId),
          this.now(),
        );
      }
    }
    const request = await this.workflow.localRequest(value);
    if (enabled === undefined) return this.schedule(request);
    await this.workflow.validate(request);
    return this.open().configureRecurrence(
      request,
      enabled,
      String(input.requestId),
      this.now(),
    );
  }
  async operatorReview(id: string, actor: string) {
    const store = this.open(),
      e = store.get(id);
    const snapshot = await this.workflow.operatorReview(
      e,
      completedContext(store.history(id)),
    );
    const reviewId = store.presentOperatorReview(
      id,
      e.version,
      actor,
      snapshot,
      this.now(),
    );
    return { executionId: id, reviewId, ...snapshot };
  }
  async operatorDecision(
    id: string,
    kind: 'render' | 'package',
    input: unknown,
  ) {
    const v = document(input);
    if (
      Object.keys(v).sort().join(',') !==
        'actor,decision,justification,reviewId' ||
      !['APPROVED', 'REJECTED'].includes(String(v.decision))
    )
      throw new CampaignError('INVALID_REVIEW_DECISION');
    const store = this.open(),
      e = store.get(id),
      history = store.history(id);
    const view = history.find(
      (h) =>
        h.event_type === 'OPERATOR_REVIEW_PRESENTED' &&
        h.evidence.reviewId === v.reviewId,
    )?.evidence;
    if (!view || view.actor !== v.actor)
      throw new CampaignError('REVIEW_OWNERSHIP_CONFLICT');
    const receipt = history.find(
      (h) =>
        h.event_type === 'OPERATOR_REVIEW_DECIDED' &&
        h.evidence.reviewId === v.reviewId &&
        h.evidence.kind === kind,
    )?.evidence;
    if (receipt) {
      if (
        receipt.decision !== v.decision ||
        receipt.justification !== v.justification
      )
        throw new CampaignError('REVIEW_DECISION_CONFLICT');
      return receipt.result;
    }
    const current = await this.workflow.operatorReview(
      e,
      completedContext(history),
    );
    const shown = document(view.snapshot);
    if (
      store.get(id).version !== e.version ||
      e.version !== view.version ||
      canonicalJson(current.identity) !== canonicalJson(shown.identity) ||
      current.destination !== shown.destination ||
      canonicalJson(current.package) !== canonicalJson(shown.package)
    )
      throw new CampaignError('STALE_REVIEW_CONFLICT');
    const result =
      kind === 'render'
        ? await this.approve(id, {
            ...current.identity,
            actor: v.actor,
            decision: v.decision,
            justification: v.justification,
          })
        : current.package
          ? this.workflow.reviewOperatorPackage(
              current.package.contentHash,
              String(v.decision),
              String(v.actor),
              v.justification,
              `operator_review_${String(v.reviewId)}`,
            )
          : (() => {
              throw new CampaignError('PACKAGE_REVIEW_REQUIRED');
            })();
    store.administrativeEvent(
      id,
      store.get(id).version,
      this.now(),
      'OPERATOR_REVIEW_DECIDED',
      {
        reviewId: v.reviewId,
        kind,
        decision: v.decision,
        justification: v.justification,
        result,
      },
    );
    return result;
  }
  result(id: string) {
    const store = this.open(),
      history = store.history(id);
    return this.workflow.result(
      store.get(id),
      executionRequest(history),
      completedContext(history),
    );
  }
  async recoverLegacy(value: unknown) {
    const request = await this.workflow.recoverLegacy(value);
    return this.open().schedule(
      {
        campaignId: String(request.campaignId),
        campaignRevision: Number(request.campaignRevision),
        runId: String(request.runId),
        scheduledAt: String(request.scheduledAt),
      },
      request,
      new Date().toISOString(),
    );
  }
  get(id: string) {
    const store = this.open(),
      execution = store.get(id),
      history = store.history(id);
    const last = history
      .filter((event) =>
        ['PAUSED', 'STEP_STARTED', 'STEP_DONE', 'COMPLETED'].includes(
          event.event_type,
        ),
      )
      .at(-1);
    const done = completedContext(history);
    const code =
      execution.status === 'WAITING_INPUT' ||
      execution.status === 'FAILED' ||
      execution.status === 'WAITING_RECONCILIATION'
        ? String(history.at(-1)?.evidence.code ?? last?.evidence.code ?? '')
        : null;
    const messages: Record<string, string> = {
      REAL_VIDEO_MEDIA_REQUIRED: 'Associe um vídeo autorizado para cada cena.',
      MEDIA_SELECTION_REQUIRED:
        'Selecione a versão do vídeo que deve ser utilizada.',
      AUTHENTICATED_MEDIA_REVIEW_REQUIRED:
        'Revise o vídeo e a imagem de referência com uma identidade QC_REVIEWER.',
      COMPLETE_TEMPORAL_QC_REQUIRED:
        'Conclua a revisão autenticada das mídias.',
      MEDIA_REVIEW_REJECTED:
        'A revisão humana rejeitou esta mídia. A composição foi interrompida.',
      MEDIA_QC_FAILED:
        'O vídeo falhou na verificação técnica. Forneça uma mídia válida antes de retomar.',
      GLOBAL_DAILY_BUDGET_EXCEEDED:
        'O limite diário do Finance foi atingido. Aguarde a renovação da janela diária (America/Sao_Paulo) e clique em Retomar. A revisão aprovada permanece registrada.',
      GLOBAL_MONTHLY_BUDGET_EXCEEDED:
        'O limite mensal do Finance foi atingido. Aguarde a renovação da janela mensal (America/Sao_Paulo) e clique em Retomar. A revisão aprovada permanece registrada.',
      AUDIO_REQUIRED:
        'Disponibilize uma gravação autorizada vinculada ao roteiro.',
      LOCAL_TTS_CONFIGURATION_REQUIRED:
        'Configure um modelo TTS local com manifesto de licença e hashes aprovados, ou escolha gravação própria.',
      LOCAL_TTS_LICENSE_REQUIRED:
        'A licença ou identidade do TTS local não está comprovada. Revise o manifesto autorizado ou escolha gravação própria.',
      LOCAL_TTS_EXECUTION_REQUIRED:
        'A síntese local falhou. Verifique os recursos locais ou escolha gravação própria.',
      LOCAL_TTS_BUSY_REQUIRED:
        'Outra execução está produzindo esta narração. Aguarde a conclusão; uma trava abandonada exige verificação operacional.',
      NARRATION_DURATION_REQUIRED:
        'O conteúdo aprovado não cabe no vídeo em fala natural. A remoção de repetições não foi suficiente; revise o roteiro ou forneça gravação válida. Nenhuma palavra foi cortada.',
      LOCAL_AUDIO_SELECTION_REQUIRED:
        'Selecione uma das gravações autorizadas para este roteiro.',
      ALIGNMENT_CONFIGURATION_REQUIRED:
        'O alinhamento local exige um modelo e ambiente já instalados e configurados.',
      COMPOSITION_RIGHTS_REQUIRED:
        'Os direitos atuais permitem somente a revisão. A composição exige autorização própria.',
      COMPOSITION_MEDIA_PROFILE_REQUIRED:
        'A mídia precisa de metadados V2 verificados para composição. Solicite uma revisão de cadastro compatível, preservando os direitos e a origem.',
      PRODUCTION_PROFILE_MISMATCH:
        'A execução foi criada com outro perfil de produção. A composição V2 exige uma execução com perfil de mídia mista.',
      COMPOSER_UNAVAILABLE:
        'Os binários locais FFmpeg/FFprobe e os diretórios de mídia precisam estar configurados no ambiente.',
      AUDIO_VIDEO_DURATION_REQUIRED:
        'A duração do áudio não cabe nos vídeos disponíveis. Forneça uma gravação ou mídia compatível.',
      EXACT_HUMAN_APPROVAL_REQUIRED:
        'Revise e aprove a versão final exata para liberar o handoff manual.',
      INTERRUPTED_EFFECT_REQUIRES_VERIFICATION:
        'O processamento foi interrompido. Os artefatos persistidos precisam ser verificados antes da retomada.',
    };
    return {
      ...execution,
      provenance:
        history[0].event_type === 'LEGACY_RECOVERY'
          ? history[0].evidence.legacyRecovery
          : null,
      finalization: {
        step: last?.evidence.step ?? null,
        completedSteps: Object.keys(done),
        pending: code
          ? {
              code,
              message:
                messages[code] ??
                'Há uma pendência técnica ou de autorização. Consulte o histórico da execução.',
            }
          : null,
        preview: done.PREVIEW ?? null,
        availableActions:
          execution.status === 'WAITING_INPUT'
            ? [
                'GLOBAL_DAILY_BUDGET_EXCEEDED',
                'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
              ].includes(code ?? '')
              ? ['WAIT_BUDGET_WINDOW', 'RESUME', 'CANCEL']
              : code === 'EXACT_HUMAN_APPROVAL_REQUIRED'
                ? ['REVIEW_FINAL', 'RESUME', 'CANCEL']
                : code === 'AUTHENTICATED_MEDIA_REVIEW_REQUIRED' ||
                    code === 'COMPLETE_TEMPORAL_QC_REQUIRED'
                  ? ['REVIEW_MEDIA', 'CANCEL']
                  : ['SUPPLY_INPUT', 'RESUME', 'CANCEL']
            : execution.status === 'WAITING_RECONCILIATION'
              ? ['RECONCILE', 'CANCEL']
              : [],
      },
    };
  }
  list() {
    return this.open()
      .listRecent()
      .map((execution) => this.get(execution.execution_id));
  }
  finalizationContext(id: string) {
    const store = this.open(),
      execution = store.get(id),
      history = store.history(id),
      request = executionRequest(history);
    if (
      !request.videoProduction ||
      request.mode !== 'LOCAL_VALIDATION' ||
      request.publication
    )
      throw new CampaignError('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
    const completed = completedContext(history);
    return { execution, history, request, completed };
  }
  publicationContext(id: string) {
    const c = this.finalizationContext(id),
      handoff = c.completed.HANDOFF ? document(c.completed.HANDOFF) : null;
    if (
      c.execution.status !== 'SUCCEEDED' ||
      !handoff ||
      !handoff.approvalId ||
      !c.completed.BURN ||
      !c.completed.QC ||
      document(c.completed.QC).result !== 'PASS' ||
      handoff.videoRenderId !== document(c.completed.BURN).videoRenderId ||
      handoff.contentHash !== document(c.completed.BURN).contentHash
    )
      throw new CampaignError('SOCIAL_HANDOFF_REQUIRED');
    return { ...c, handoff };
  }
  async finalReviewContext(id: string) {
    const { execution, completed } = this.finalizationContext(id);
    return this.workflow.approvalEvidence(execution, completed);
  }
  private readonly advancing = new Map<string, Promise<void>>();
  async advanceFinalization(id: string) {
    const active = this.advancing.get(id);
    if (active) return active;
    this.finalizationContext(id);
    const pending = this.runner!.tick(id);
    this.advancing.set(id, pending);
    try {
      await pending;
    } finally {
      this.advancing.delete(id);
    }
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
      (!value || Object.keys(document(value)).length === 0) &&
      ['SCHEDULED', 'RUNNING', 'SUCCEEDED'].includes(store.get(id).status) &&
      store
        .history(id)
        .some((event) => event.event_type === 'OPERATOR_REVIEW_PRESENTED')
    )
      return this.get(id);
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
        audioMode: 'AUDIO',
        audio: 'AUDIO',
        alignment: 'ALIGNMENT',
        composition: 'COMPOSITION',
        publication: 'PUBLICATION',
        sceneMediaAssetIds: 'MEDIA_QC',
      };
      if (
        Object.keys(patch).some(
          (k) =>
            !stages[k] || Object.hasOwn(completedContext(history), stages[k]),
        )
      )
        throw new CampaignError('COMPLETED_INPUT_CONFLICT');
      const request = executionRequest(history);
      if (request.legacyRecovery && patch.sceneMediaAssetIds !== undefined)
        throw new CampaignError('LEGACY_MEDIA_IDENTITY_CONFLICT');
      campaignRequest({ ...request, ...patch });
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
  scriptRevisions(id: string) {
    const { execution, completed } = this.finalizationContext(id);
    if (!completed.EDITORIAL) return [];
    return this.workflow.scriptRevisions(
      execution,
      document(document(completed.EDITORIAL).script),
    );
  }
  framingContext(id: string) {
    const { completed } = this.finalizationContext(id);
    if (!completed.COMPOSITION) return null;
    return document(
      this.workflow.compositionPlan(
        String(document(completed.COMPOSITION).compositionPlanId),
      ),
    );
  }
  reviseComposition(id: string, value: unknown, actorId: string) {
    const input = document(value),
      c = this.finalizationContext(id),
      store = this.open();
    if (
      Object.keys(input).sort().join(',') !==
        'previousRenderContentHash,reason' ||
      typeof input.previousRenderContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.previousRenderContentHash) ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 15 ||
      input.reason.length > 1000 ||
      !/^[a-z][a-z0-9_:-]{2,99}$/.test(actorId)
    )
      throw new CampaignError('INVALID_COMPOSITION_REVISION');
    const previous = c.history
      .filter((e) => e.event_type === 'COMPOSITION_REVISED')
      .at(-1)?.evidence;
    if (
      previous?.previousRenderContentHash === input.previousRenderContentHash &&
      previous?.actorId === actorId &&
      previous?.reason === input.reason.trim()
    )
      return this.get(id);
    const render = document(c.completed.BURN);
    if (
      !['WAITING_INPUT', 'CANCELLED', 'SUCCEEDED'].includes(
        c.execution.status,
      ) ||
      render.contentHash !== input.previousRenderContentHash ||
      c.request.publication ||
      c.history.some(
        (e) =>
          e.event_type === 'STEP_STARTED' && e.evidence.step === 'PUBLICATION',
      )
    )
      throw new CampaignError('COMPOSITION_REVISION_STATE_CONFLICT');
    // Active/persisted social work must be handled before a render can be superseded.
    if (
      store.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='instagram_publication_schedules'",
        )
        .get() &&
      store.db
        .prepare(
          'SELECT 1 FROM instagram_publication_schedules WHERE execution_id=? LIMIT 1',
        )
        .get(id)
    )
      throw new CampaignError('COMPOSITION_REVISION_PUBLICATION_CONFLICT');
    const plan = this.framingContext(id);
    if (!plan) throw new CampaignError('COMPOSITION_REVISION_STATE_CONFLICT');
    const now = new Date().toISOString();
    return store.reviseComposition(id, c.execution.version, now, {
      policyVersion: PRODUCT_FRAMING_POLICY,
      previousRenderContentHash: render.contentHash,
      previousCompositionPlanId: plan.compositionPlanId,
      revision: Number(plan.revision) + 1,
      requestedAt: now,
      actorId,
      reason: input.reason.trim(),
    });
  }
  compositionPreparation(id: string) {
    const { execution, completed } = this.finalizationContext(id);
    if (completed.COMPOSITION || completed.HANDOFF)
      throw new CampaignError('COMPOSITION_AUTHORIZATION_NOT_READY');
    return compositionScope(execution, completed);
  }
  authorizeComposition(id: string, value: unknown, actorId: string) {
    const { execution, completed, history } = this.finalizationContext(id);
    const grant = compositionGrant(
      execution,
      completed,
      value,
      actorId,
      new Date().toISOString(),
    );
    const previous = history
      .filter((e) => e.event_type === 'COMPOSITION_AUTHORIZED')
      .at(-1)?.evidence;
    if (
      previous &&
      previous.scopeHash === grant.scopeHash &&
      previous.actorId === actorId &&
      previous.sourceRef === grant.sourceRef &&
      previous.statement === grant.statement
    )
      return this.get(id);
    if (
      execution.status !== 'WAITING_INPUT' ||
      completed.COMPOSITION ||
      completed.HANDOFF
    )
      throw new CampaignError('COMPOSITION_AUTHORIZATION_NOT_READY');
    this.open().administrativeEvent(
      id,
      execution.version,
      grant.approvedAt,
      'COMPOSITION_AUTHORIZED',
      grant,
    );
    return this.get(id);
  }
  reviseScript(id: string, value: unknown, actorId: string) {
    const input = document(value),
      store = this.open(),
      execution = store.get(id),
      history = store.history(id);
    if (
      Object.keys(input).sort().join(',') !==
        'previousScriptContentHash,reason,scriptId' ||
      typeof input.scriptId !== 'string' ||
      typeof input.previousScriptContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.previousScriptContentHash) ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 15 ||
      input.reason.length > 1000 ||
      !/^[a-z][a-z0-9_:-]{2,99}$/.test(actorId)
    )
      throw new CampaignError('INVALID_SCRIPT_REVISION');
    try {
      identifier(input.scriptId);
    } catch (error) {
      if (error instanceof CampaignError && error.code === 'INVALID_IDENTIFIER')
        throw new CampaignError('INVALID_SCRIPT_REVISION_IDENTIFIER');
      throw error;
    }
    const lastRevision = history
      .filter((event) => event.event_type === 'SCRIPT_REVISED')
      .at(-1);
    if (
      lastRevision &&
      document(lastRevision.evidence.script).scriptId === input.scriptId &&
      lastRevision.evidence.previousScriptContentHash ===
        input.previousScriptContentHash &&
      lastRevision.evidence.actorId === actorId &&
      lastRevision.evidence.reason === input.reason.trim()
    )
      return this.get(id);
    const { completed, request } = this.finalizationContext(id);
    if (
      execution.status !== 'WAITING_INPUT' ||
      !completed.MEDIA_QC ||
      request.publication ||
      completed.HANDOFF ||
      history.some(
        (event) =>
          event.evidence.step === 'PUBLICATION' &&
          event.event_type === 'STEP_STARTED',
      )
    )
      throw new CampaignError('SCRIPT_REVISION_STATE_CONFLICT');
    const previous = document(document(completed.EDITORIAL).script);
    if (previous.contentHash !== input.previousScriptContentHash)
      throw new CampaignError('SCRIPT_REVISION_STALE');
    const script = this.workflow.revisedScript(
      execution,
      previous,
      input.scriptId,
    );
    store.administrativeEvent(
      id,
      execution.version,
      new Date().toISOString(),
      'SCRIPT_REVISED',
      {
        actorId,
        reason: input.reason.trim(),
        previousScriptId: previous.scriptId,
        previousScriptContentHash: previous.contentHash,
        script,
      },
    );
    return this.get(id);
  }
  async tick() {
    const store = this.open();
    for (const { config } of store.recurrences()) {
      try {
        const request = await this.workflow.recurringRequest(
          config.request,
          this.now(),
        );
        if (request) store.scheduleRecurring(config, request, this.now());
      } catch (error) {
        // Report a failed configuration without starving other scheduled campaigns.
        this.logger.error(
          error instanceof CampaignError
            ? error.code
            : 'CAMPAIGN_RECURRENCE_FAILED',
        );
      }
    }
    await this.runner!.tick();
  }
  async approve(id: string, value: unknown) {
    const r = this.open(),
      e = r.get(id),
      events = r.history(id);
    const done = completedContext(events);
    const evidence = await this.workflow.approvalEvidence(e, done);
    // Reuse the existing deterministic approval rules with local QC's verified identity.
    const service = new HumanApprovalService({
      repository: {
        getVideoRender: () => evidence.render,
        getQualityControlReport: () => evidence.qc,
        getHumanApprovalDecision: (decisionId: string) =>
          events
            .filter(
              (event) =>
                event.sequence >
                (events
                  .filter((h) =>
                    ['SCRIPT_REVISED', 'COMPOSITION_REVISED'].includes(
                      h.event_type,
                    ),
                  )
                  .at(-1)?.sequence ?? 0),
            )
            .find(
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
    if (
      events.some(
        (event) =>
          event.event_type === 'HUMAN_APPROVAL' &&
          event.evidence.contentHash === decision.contentHash,
      )
    )
      return decision;
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
