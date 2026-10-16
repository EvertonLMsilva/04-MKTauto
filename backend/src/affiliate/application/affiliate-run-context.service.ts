import { Inject, Injectable } from '@nestjs/common';
import { affiliateIdentifier } from '../domain/affiliate-contracts.js';
import type { AffiliateBriefing } from '../domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import {
  validateBindRun,
  validateGenerationIdentity,
  assertProjectScope,
  assertNewBindingAllowed,
  assertBindingBriefing,
  assertGenerationContext,
} from '../domain/affiliate-run-context.js';
import type {
  GenerationIdentity,
  RunBriefingBinding,
} from '../domain/affiliate-run-context.js';
import { AFFILIATE_RUN_CONTEXT_FACTORY } from './ports/affiliate-run-context.port.js';
import type {
  AffiliateRunContext,
  AffiliateRunContextFactory,
  AffiliateRunContextSession,
} from './ports/affiliate-run-context.port.js';

@Injectable()
export class AffiliateRunContextService implements AffiliateRunContext {
  constructor(
    @Inject(AFFILIATE_RUN_CONTEXT_FACTORY)
    private readonly persistence: AffiliateRunContextFactory,
  ) {}
  bindRun(input: unknown, key: string): RunBriefingBinding {
    validateBindRun(input);
    affiliateIdentifier(key, 'idempotencyKey');
    return this.withSession(false, (session) =>
      session.bindingCommand(input, key, () => {
        const run = session.executions.getRun(input.pipelineRunId);
        if (!run) throw failure('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
        const briefing = session.catalog.getBriefing(input.briefingId);
        if (!briefing)
          throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
        const campaign = session.catalog.getCampaign(
          briefing.campaignId,
          briefing.campaignRevision,
        );
        if (!campaign)
          throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
        assertProjectScope(run, campaign.projectId);
        const prior = session.getRunBinding(run.pipelineRunId);
        if (prior) {
          if (
            prior.briefingId !== briefing.briefingId ||
            prior.briefingHash !== briefing.contentHash
          )
            throw failure('AFFILIATE_RUN_BINDING_CONFLICT', 'briefingId');
          this.resolve(session, run.pipelineRunId);
          return prior;
        }
        assertNewBindingAllowed(
          run,
          session.activity.hasStarted(run.pipelineRunId) ||
            session.hasScriptContexts(run.pipelineRunId),
        );
        const binding = {
          pipelineRunId: run.pipelineRunId,
          briefingId: briefing.briefingId,
          briefingHash: briefing.contentHash,
          campaignId: briefing.campaignId,
          campaignRevision: briefing.campaignRevision,
          productId: briefing.productId,
          productRevision: briefing.productRevision,
        };
        session.insertRunBinding(binding);
        return session.getRunBinding(run.pipelineRunId)!;
      }),
    );
  }
  getRunBinding(id: string) {
    affiliateIdentifier(id, 'pipelineRunId');
    return this.withSession(true, (session) => session.getRunBinding(id));
  }
  resolveRunBriefing(id: string, expectedBriefingId?: string) {
    return this.withSession(true, (session) =>
      this.resolve(session, id, expectedBriefingId),
    );
  }
  inspectRun(id: string, expectedBriefingId?: string) {
    affiliateIdentifier(id, 'pipelineRunId');
    return this.withSession(true, (session) => {
      if (!session.executions.getRun(id))
        throw failure('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      return {
        binding: session.getRunBinding(id),
        briefing: this.resolve(session, id, expectedBriefingId),
      };
    });
  }
  prepareScriptGeneration(
    request: GenerationIdentity,
    id: string,
    expectedBriefingId?: string,
  ) {
    validateGenerationIdentity(request);
    return this.withSession(false, (session) =>
      session.transaction(() => {
        const briefing = this.resolve(session, id, expectedBriefingId);
        const hash = briefing?.contentHash ?? null;
        const prior = session.getScriptContext(request.generationRequestId);
        assertGenerationContext(prior, request, id, hash);
        if (!prior)
          session.insertScriptContext({
            generationRequestId: request.generationRequestId,
            requestHash: request.contentHash,
            pipelineRunId: id,
            briefingHash: hash,
          });
        return briefing;
      }),
    );
  }
  verifyScriptGenerationContext(
    request: GenerationIdentity,
    id: string,
    briefing: AffiliateBriefing | null,
  ) {
    validateGenerationIdentity(request);
    this.withSession(true, (session) =>
      assertGenerationContext(
        session.getScriptContext(request.generationRequestId),
        request,
        id,
        briefing?.contentHash ?? null,
      ),
    );
  }
  private resolve(
    session: AffiliateRunContextSession,
    id: string,
    expectedBriefingId?: string,
  ): AffiliateBriefing | null {
    if (expectedBriefingId !== undefined)
      affiliateIdentifier(expectedBriefingId, 'briefingId');
    affiliateIdentifier(id, 'pipelineRunId');
    const binding = session.getRunBinding(id);
    if (!binding) {
      if (expectedBriefingId !== undefined)
        throw failure('AFFILIATE_BRIEFING_NOT_BOUND', 'briefingId');
      return null;
    }
    if (
      expectedBriefingId !== undefined &&
      binding.briefingId !== expectedBriefingId
    )
      throw failure('AFFILIATE_RUN_BINDING_CONFLICT', 'briefingId');
    const briefing = session.catalog.getBriefing(binding.briefingId);
    if (!briefing) throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
    assertBindingBriefing(binding, briefing);
    const run = session.executions.getRun(id);
    const campaign = session.catalog.getCampaign(
      briefing.campaignId,
      briefing.campaignRevision,
    );
    if (!campaign) throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
    assertProjectScope(run, campaign.projectId);
    return briefing;
  }
  private withSession<T>(
    readOnly: boolean,
    operation: (session: AffiliateRunContextSession) => T,
  ): T {
    const session = this.persistence.open(readOnly);
    try {
      return operation(session);
    } finally {
      session.close();
    }
  }
}
function failure(code: string, field: string) {
  return new AffiliateRepositoryError(code, field);
}
