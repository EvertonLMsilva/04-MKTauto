import { runAffiliateIo } from './affiliate-io.js';
import type { Io } from './affiliate-io.js';
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
export class AffiliateRunContextService<
  A extends boolean = false,
> implements AffiliateRunContext<A> {
  constructor(
    @Inject(AFFILIATE_RUN_CONTEXT_FACTORY)
    private readonly persistence: AffiliateRunContextFactory<A>,
  ) {}
  bindRun(input: unknown, key: string): Io<A, RunBriefingBinding> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateBindRun(input);
        affiliateIdentifier(key, 'idempotencyKey');
        return yield this.withSession(
          false,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield session.bindingCommand(input, key, () =>
                  runAffiliateIo(
                    function* (this: any): Generator<unknown, any, any> {
                      const run = yield session.executions.getRun(
                        input.pipelineRunId,
                      );
                      if (!run)
                        throw failure(
                          'PIPELINE_RUN_NOT_FOUND',
                          'pipelineRunId',
                        );
                      const briefing = yield session.catalog.getBriefing(
                        input.briefingId,
                      );
                      if (!briefing)
                        throw failure(
                          'AFFILIATE_BRIEFING_NOT_FOUND',
                          'briefingId',
                        );
                      const campaign = yield session.catalog.getCampaign(
                        briefing.campaignId,
                        briefing.campaignRevision,
                      );
                      if (!campaign)
                        throw failure(
                          'AFFILIATE_REFERENCE_MISSING',
                          'campaignId',
                        );
                      assertProjectScope(run, campaign.projectId);
                      const prior = yield session.getRunBinding(
                        run.pipelineRunId,
                      );
                      if (prior) {
                        if (
                          prior.briefingId !== briefing.briefingId ||
                          prior.briefingHash !== briefing.contentHash
                        )
                          throw failure(
                            'AFFILIATE_RUN_BINDING_CONFLICT',
                            'briefingId',
                          );
                        yield this.resolve(session, run.pipelineRunId);
                        return prior;
                      }
                      assertNewBindingAllowed(
                        run,
                        (yield session.activity.hasStarted(
                          run.pipelineRunId,
                        )) ||
                          (yield session.hasScriptContexts(run.pipelineRunId)),
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
                      yield session.insertRunBinding(binding);
                      return (yield session.getRunBinding(run.pipelineRunId))!;
                    }.call(this),
                  ),
                );
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  getRunBinding(id: string): Io<A, RunBriefingBinding | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'pipelineRunId');
        return yield this.withSession(
          true,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield session.getRunBinding(id);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  resolveRunBriefing(
    id: string,
    expectedBriefingId?: string,
  ): Io<A, AffiliateBriefing | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.withSession(
          true,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield this.resolve(session, id, expectedBriefingId);
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  inspectRun(
    id: string,
    expectedBriefingId?: string,
  ): Io<
    A,
    {
      binding: RunBriefingBinding | null;
      briefing: AffiliateBriefing | null;
    }
  > {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'pipelineRunId');
        return yield this.withSession(
          true,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                if (!(yield session.executions.getRun(id)))
                  throw failure('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
                return {
                  binding: yield session.getRunBinding(id),
                  briefing: yield this.resolve(session, id, expectedBriefingId),
                };
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  prepareScriptGeneration(
    request: GenerationIdentity,
    id: string,
    expectedBriefingId?: string,
  ): Io<A, AffiliateBriefing | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateGenerationIdentity(request);
        return yield this.withSession(
          false,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return yield session.transaction(() =>
                  runAffiliateIo(
                    function* (this: any): Generator<unknown, any, any> {
                      const briefing = yield this.resolve(
                        session,
                        id,
                        expectedBriefingId,
                      );
                      const hash = briefing?.contentHash ?? null;
                      const prior = yield session.getScriptContext(
                        request.generationRequestId,
                      );
                      assertGenerationContext(prior, request, id, hash);
                      if (!prior)
                        yield session.insertScriptContext({
                          generationRequestId: request.generationRequestId,
                          requestHash: request.contentHash,
                          pipelineRunId: id,
                          briefingHash: hash,
                        });
                      return briefing;
                    }.call(this),
                  ),
                );
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  verifyScriptGenerationContext(
    request: GenerationIdentity,
    id: string,
    briefing: AffiliateBriefing | null,
  ): Io<A, void> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        validateGenerationIdentity(request);
        yield this.withSession(
          true,
          (session: AffiliateRunContextSession<boolean>) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                return assertGenerationContext(
                  yield session.getScriptContext(request.generationRequestId),
                  request,
                  id,
                  briefing?.contentHash ?? null,
                );
              }.call(this),
            ),
        );
      }.call(this),
    );
  }
  private resolve(
    session: AffiliateRunContextSession,
    id: string,
    expectedBriefingId?: string,
  ): AffiliateBriefing | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        if (expectedBriefingId !== undefined)
          affiliateIdentifier(expectedBriefingId, 'briefingId');
        affiliateIdentifier(id, 'pipelineRunId');
        const binding = yield session.getRunBinding(id);
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
        const briefing = yield session.catalog.getBriefing(binding.briefingId);
        if (!briefing)
          throw failure('AFFILIATE_BRIEFING_NOT_FOUND', 'briefingId');
        assertBindingBriefing(binding, briefing);
        const run = yield session.executions.getRun(id);
        const campaign = yield session.catalog.getCampaign(
          briefing.campaignId,
          briefing.campaignRevision,
        );
        if (!campaign)
          throw failure('AFFILIATE_REFERENCE_MISSING', 'campaignId');
        assertProjectScope(run, campaign.projectId);
        return briefing;
      }.call(this),
    );
  }
  private withSession<T>(
    readOnly: boolean,
    operation: (session: AffiliateRunContextSession) => T,
  ): T {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.persistence.open(readOnly);
        try {
          return yield operation(session);
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
}
function failure(code: string, field: string) {
  return new AffiliateRepositoryError(code, field);
}
