import type { ContentService } from './content.service.js';
import type { AffiliateService } from '../../affiliate/application/affiliate.service.js';
import { validateProjectSnapshot } from '../../project/domain/project-contracts.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  rejectAffiliateDynamicPrice,
  validateAffiliateBriefing,
} from '../../affiliate/domain/affiliate-contracts.js';
import type { ResearchReader } from '../../research/application/research-reader.port.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import type { OperationsStore } from '../../content-operations/application/ports/operations.port.js';
import { StageRecoveryService } from '../../content-operations/application/stage-recovery.service.js';
import type { StageInput } from '../../content-operations/domain/stage-contracts.js';
import { stageIdentifier } from '../../content-operations/domain/stage-contracts.js';
import { validateAffiliateEditorialSelection } from '../domain/affiliate-editorial-contracts.js';
import {
  scriptContentHash,
  validateScript,
} from '../domain/script-contracts.js';
import type {
  AffiliateEditorialSelection,
  EditorialScript,
} from '../domain/content.types.js';
import type {
  EditorialIdea,
  EditorialProvider,
  EditorialProviderInput,
} from './editorial-provider.port.js';

export interface EditorialRequest {
  generationRequestId: string;
  pipelineRunId: string;
  briefingId: string;
  researchShortlistId: string;
  referenceInsightId: string | null;
  requestedAt: string;
  supersedesScriptId: string | null;
}
export class EditorialFlowError extends Error {
  constructor(
    readonly code: string,
    readonly field: string,
  ) {
    super(code);
  }
}
const policyVersion = 'affiliate-editorial-policy/1.0.0';

export class EditorialFlowService {
  constructor(
    private readonly content: ContentService,
    private readonly affiliate: AffiliateRunContext,
    private readonly research: ResearchReader,
    private readonly operations: OperationsStore,
    private readonly finance: Pick<FinanceService, 'getGlobalOperation'>,
    private readonly provider: EditorialProvider,
    private readonly catalog: Pick<AffiliateService, 'resolveBriefingSource'>,
  ) {}
  async generate(value: unknown) {
    const request = validateRequest(value);
    // Fail before any provider invocation, including an UNKNOWN paid operation.
    if (this.provider.mode !== 'LOCAL') {
      const prior = this.finance.getGlobalOperation(
        request.generationRequestId,
      );
      throw new EditorialFlowError(
        prior?.state === 'UNKNOWN'
          ? 'EDITORIAL_FINANCE_UNKNOWN'
          : 'GLOBAL_PRICE_UNPROVEN',
        'provider',
      );
    }
    const session = this.operations.open();
    try {
      const run = session.getRun(request.pipelineRunId);
      if (!run)
        throw new EditorialFlowError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      this.affiliate.bindRun(
        {
          pipelineRunId: request.pipelineRunId,
          briefingId: request.briefingId,
        },
        `editorial_${affiliateHash({ id: request.generationRequestId }).slice(0, 32)}`,
      );
      const briefing = validateAffiliateBriefing(
        this.affiliate.resolveRunBriefing(
          request.pipelineRunId,
          request.briefingId,
        ),
      );
      const shortlist = this.research.getShortlist(request.researchShortlistId);
      const campaignSource = await this.catalog.resolveBriefingSource(
        briefing.briefingId,
      );
      const references =
        request.referenceInsightId === null
          ? null
          : this.research.getInsight(request.referenceInsightId);
      if (!shortlist || (request.referenceInsightId !== null && !references))
        throw new EditorialFlowError(
          'EDITORIAL_RESEARCH_NOT_FOUND',
          'research',
        );
      for (const artifact of [shortlist, ...(references ? [references] : [])]) {
        if (
          artifact.pipelineRunId !== run.pipelineRunId ||
          artifact.projectId !== run.projectId ||
          artifact.projectVersion !== run.projectVersion
        )
          throw new EditorialFlowError(
            'EDITORIAL_RESEARCH_SCOPE_MISMATCH',
            'research',
          );
        if (artifact.state === 'FAILED')
          throw new EditorialFlowError('EDITORIAL_RESEARCH_FAILED', 'research');
      }
      if (!shortlist.orderedCandidates.length)
        throw new EditorialFlowError('EDITORIAL_RESEARCH_EMPTY', 'research');
      const providerInput: EditorialProviderInput = immutable(
        structuredClone({
          briefing,
          campaignSource,
          shortlist,
          references,
          projectSnapshot: validateProjectSnapshot(run.projectSnapshot),
        }),
      );
      const requestHash = affiliateHash({
        request,
        briefingHash: briefing.contentHash,
        ...(campaignSource
          ? { campaignSourceHash: affiliateHash(campaignSource) }
          : {}),
        shortlistHash: shortlist.contentHash,
        referenceHash: references?.contentHash ?? null,
        provider: this.provider.configurationVersion,
        policyVersion,
      });
      this.affiliate.prepareScriptGeneration(
        {
          generationRequestId: request.generationRequestId,
          contentHash: requestHash,
        },
        request.pipelineRunId,
        request.briefingId,
      );
      const existing = this.content.getScript(
        `script:${request.generationRequestId}`,
      );
      if (existing) return result(existing);
      const recovery = new StageRecoveryService(session.stages, {
        maxAutomaticAttempts: 1,
      });
      const execute = async (
        stage: string,
        inputs: StageInput[],
        operation: () => Promise<{
          artifactId: string;
          contentHash: string;
          value: unknown;
        }>,
      ) =>
        recovery.execute(
          {
            schemaVersion: 'stage-recovery/1.0.0',
            pipelineRunId: run.pipelineRunId,
            stage,
            requestHash,
            inputs,
            policyVersions: { editorial: policyVersion },
            providerConfigHash: affiliateHash({
              version: this.provider.configurationVersion,
            }),
          },
          operation,
        );
      let previous: EditorialScript | null = null;
      let selection: AffiliateEditorialSelection;
      if (request.supersedesScriptId !== null) {
        previous = this.content.getScript(request.supersedesScriptId);
        if (
          !previous ||
          previous.pipelineRunId !== run.pipelineRunId ||
          !previous.editorialSelectionId
        )
          throw new EditorialFlowError(
            'EDITORIAL_PREVIOUS_SCRIPT_MISMATCH',
            'supersedesScriptId',
          );
        selection = this.content.getAffiliateSelection(
          previous.editorialSelectionId,
        )!;
        if (selection.briefingHash !== briefing.contentHash)
          throw new EditorialFlowError(
            'EDITORIAL_PREVIOUS_SCRIPT_MISMATCH',
            'briefingId',
          );
      } else {
        const researchResult = await execute('RESEARCH', [], async () => ({
          artifactId: `editorial-research:${request.generationRequestId}`,
          contentHash: affiliateHash(providerInput),
          value: { shortlist, references, briefingHash: briefing.contentHash },
        }));
        const ideasResult = await execute(
          'IDEA_GENERATION',
          [dependency('RESEARCH', researchResult)],
          async () => {
            const ideas = await providerCall(() =>
              this.provider.ideas(providerInput),
            );
            validateIdeas(ideas, providerInput);
            return {
              artifactId: `editorial-ideas:${request.generationRequestId}`,
              contentHash: affiliateHash({ ideas }),
              value: ideas,
            };
          },
        );
        const selected = await execute(
          'IDEA_SELECTION',
          [dependency('IDEA_GENERATION', ideasResult)],
          async () => {
            const idea = (ideasResult.value as EditorialIdea[])[0];
            const body = {
              schemaVersion: 'affiliate-editorial-selection/1.0.0',
              selectionId: `editorial_${affiliateHash({ id: request.generationRequestId }).slice(0, 32)}`,
              pipelineRunId: run.pipelineRunId,
              projectId: run.projectId,
              projectVersion: run.projectVersion,
              briefingId: briefing.briefingId,
              briefingHash: briefing.contentHash,
              evidenceRefs: briefing.evidence.map((e) => e.id),
              title: idea.title,
              editorialAngle: idea.editorialAngle,
              decision: 'SELECTED',
              actor: {
                type: 'AUTOMATION',
                id: 'editorial_automation',
                policyId: 'affiliate_editorial',
                policyVersion,
                productId: briefing.productId,
                campaignId: briefing.campaignId,
                reason:
                  'Primeira proposta elegível com pesquisa e mídia autorizada',
              },
              decidedAt: request.requestedAt,
            };
            const saved = this.content.selectAffiliate(
              validateAffiliateEditorialSelection({
                ...body,
                contentHash: affiliateHash(body),
              }),
            );
            return {
              artifactId: saved.selectionId,
              contentHash: saved.contentHash,
              value: saved,
            };
          },
        );
        selection = selected.value as AffiliateEditorialSelection;
      }
      const generated = await execute(
        'SCRIPT',
        [
          {
            stage: 'IDEA_SELECTION',
            artifactId: selection.selectionId,
            contentHash: selection.contentHash,
          },
        ],
        async () => {
          const output = await providerCall(() =>
            this.provider.script(immutable({ ...providerInput, selection })),
          );
          if (
            !output ||
            typeof output !== 'object' ||
            !Array.isArray(output.narrativeBlocks) ||
            output.narrativeBlocks.some(
              (block) => !block || typeof block.narration !== 'string',
            ) ||
            !Array.isArray(output.sensitiveClaims)
          )
            throw new EditorialFlowError(
              'EDITORIAL_PROVIDER_INVALID_RESPONSE',
              'output',
            );
          rejectAffiliateDynamicPrice(JSON.stringify(output), 'output');
          const fullNarration = [
            output.hook,
            ...output.narrativeBlocks.map((b) => b.narration),
            output.cta,
          ]
            .filter((part) => part !== null)
            .join('\n\n');
          if (output.cta !== briefing.cta)
            throw new EditorialFlowError(
              'AFFILIATE_SCRIPT_CTA_MISMATCH',
              'cta',
            );
          if (!fullNarration.includes(briefing.disclosure))
            throw new EditorialFlowError(
              'AFFILIATE_SCRIPT_DISCLOSURE_MISSING',
              'disclosure',
            );
          if (!fullNarration.includes(briefing.productName))
            throw new EditorialFlowError(
              'AFFILIATE_SCRIPT_PRODUCT_MISMATCH',
              'productName',
            );
          if (output.sensitiveClaims.length)
            throw new EditorialFlowError(
              'AFFILIATE_SCRIPT_REVIEW_BLOCKED',
              'sensitiveClaims',
            );
          const channel = run.projectSnapshot.channel;
          const body = {
            ...output,
            schemaVersion: 'script/2.0.0',
            scriptId: `script:${request.generationRequestId}`,
            pipelineRunId: run.pipelineRunId,
            projectId: run.projectId,
            projectVersion: run.projectVersion,
            editorialSelectionId: selection.selectionId,
            editorialSelectionContentHash: selection.contentHash,
            language: run.projectSnapshot.project.audience.language,
            contentFormat: channel.format,
            fullNarration,
            origin: 'AUTOMATION',
            createdAt: request.requestedAt,
            revision: (previous?.revision ?? 0) + 1,
            supersedesScriptId: previous?.scriptId ?? null,
          };
          const script = validateScript({
            ...body,
            contentHash: scriptContentHash(body),
          });
          return {
            artifactId: script.scriptId,
            contentHash: script.contentHash,
            value: {
              script,
              cost: {
                amount: null,
                currency: null,
                availability: 'UNAVAILABLE',
              },
            },
          };
        },
      );
      return result(
        this.content.registerScript(
          (generated.value as { script: EditorialScript }).script,
        ),
      );
    } finally {
      session.close();
    }
  }
}
function result(script: EditorialScript) {
  return immutable({
    script,
    cost: {
      amount: null,
      currency: null,
      availability: 'UNAVAILABLE' as const,
    },
  });
}
function dependency(
  stage: string,
  produced: { artifactId?: string; contentHash?: string },
): StageInput {
  if (!produced.artifactId || !produced.contentHash)
    throw new EditorialFlowError('INVALID_STAGE_RESULT', 'result');
  return {
    stage,
    artifactId: produced.artifactId,
    contentHash: produced.contentHash,
  };
}
async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw new EditorialFlowError('EDITORIAL_PROVIDER_UNAVAILABLE', 'provider');
  }
}
function validateIdeas(ideas: EditorialIdea[], input: EditorialProviderInput) {
  if (!Array.isArray(ideas) || !ideas.length || ideas.length > 20)
    throw new EditorialFlowError(
      'EDITORIAL_PROVIDER_INVALID_RESPONSE',
      'ideas',
    );
  const candidates = new Set(
    input.shortlist.orderedCandidates.map((c) => c.candidate.id),
  );
  for (const idea of ideas) {
    if (
      !idea ||
      typeof idea.title !== 'string' ||
      !idea.title.trim() ||
      idea.title.length > 160 ||
      typeof idea.editorialAngle !== 'string' ||
      !idea.editorialAngle.trim() ||
      idea.editorialAngle.length > 400 ||
      !Array.isArray(idea.evidenceCandidateIds) ||
      !idea.evidenceCandidateIds.length ||
      idea.evidenceCandidateIds.some((id) => !candidates.has(id))
    )
      throw new EditorialFlowError(
        'EDITORIAL_PROVIDER_INVALID_RESPONSE',
        'ideas',
      );
    rejectAffiliateDynamicPrice(JSON.stringify(idea), 'ideas');
  }
}
function validateRequest(value: unknown): EditorialRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EditorialFlowError('INVALID_EDITORIAL_REQUEST', 'request');
  const fields = [
    'generationRequestId',
    'pipelineRunId',
    'briefingId',
    'researchShortlistId',
    'referenceInsightId',
    'requestedAt',
    'supersedesScriptId',
  ];
  const r = value as EditorialRequest;
  if (
    Object.keys(r).some((k) => !fields.includes(k)) ||
    fields.some((k) => !Object.hasOwn(r, k))
  )
    throw new EditorialFlowError('INVALID_EDITORIAL_REQUEST', 'request');
  for (const key of [
    'generationRequestId',
    'pipelineRunId',
    'briefingId',
  ] as const)
    affiliateIdentifier(r[key], key);
  stageIdentifier(r.researchShortlistId, 'researchShortlistId', 200);
  for (const key of ['referenceInsightId', 'supersedesScriptId'] as const)
    if (r[key] !== null) stageIdentifier(r[key], key, 200);
  if (
    typeof r.requestedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      r.requestedAt,
    ) ||
    !Number.isFinite(Date.parse(r.requestedAt))
  )
    throw new EditorialFlowError('INVALID_TIMESTAMP', 'requestedAt');
  return immutable(structuredClone(r));
}
