import { affiliateIdentifier } from './affiliate-contracts.js';
import type { AffiliateBriefing } from './affiliate-contracts.js';
import {
  AffiliateRepositoryError,
  ContractValidationError,
} from './affiliate.errors.js';

export interface BindRunInput {
  pipelineRunId: string;
  briefingId: string;
}
export interface RunBriefingBinding extends BindRunInput {
  briefingHash: string;
  campaignId: string;
  campaignRevision: number;
  productId: string;
  productRevision: number;
}
export interface ExecutionContext {
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
}
// Content owns the full generation request; Affiliate needs only its identity.
export interface GenerationIdentity {
  generationRequestId: string;
  contentHash: string;
}
export interface ScriptGenerationContext {
  generationRequestId: string;
  requestHash: string;
  pipelineRunId: string;
  briefingHash: string | null;
}
export function validateBindRun(value: unknown): asserts value is BindRunInput {
  const keys = ['pipelineRunId', 'briefingId'];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail('INVALID_AFFILIATE_INPUT', 'input');
  const input = value as BindRunInput;
  affiliateIdentifier(input.pipelineRunId, 'pipelineRunId');
  affiliateIdentifier(input.briefingId, 'briefingId');
}
export function validateGenerationIdentity(request: GenerationIdentity) {
  if (
    typeof request?.generationRequestId !== 'string' ||
    request.generationRequestId.length > 180 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(request.generationRequestId)
  )
    throw new ContractValidationError(
      'INVALID_IDENTIFIER',
      'generationRequestId',
      'valor inválido',
    );
  if (
    typeof request.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.contentHash)
  )
    throw new ContractValidationError(
      'INVALID_HASH',
      'contentHash',
      'valor inválido',
    );
}
export function validateExecutionProjection(
  run: ExecutionContext,
  snapshot: unknown,
): ExecutionContext {
  affiliateIdentifier(run.pipelineRunId, 'pipelineRunId');
  affiliateIdentifier(run.projectId, 'projectId');
  const project = (
    snapshot as { project?: { id?: unknown; version?: unknown } } | null
  )?.project;
  if (
    !Number.isSafeInteger(run.projectVersion) ||
    run.projectVersion < 1 ||
    project?.id !== run.projectId ||
    project?.version !== run.projectVersion ||
    !['RUNNING', 'SUCCEEDED', 'FAILED'].includes(run.state)
  )
    fail('INVALID_PERSISTED_PIPELINE_RUN', 'pipelineRunId');
  return run;
}
export function assertProjectScope(
  run: ExecutionContext | null,
  projectId: string,
) {
  if (!run || run.projectId !== projectId)
    fail('AFFILIATE_RUN_SCOPE_MISMATCH', 'projectId');
}
export function assertNewBindingAllowed(
  run: ExecutionContext,
  started: boolean,
) {
  if (run.state !== 'RUNNING' || started)
    fail('AFFILIATE_RUN_BINDING_TOO_LATE', 'pipelineRunId');
}
export function assertBindingBriefing(
  binding: RunBriefingBinding,
  briefing: AffiliateBriefing,
) {
  if (binding.briefingHash !== briefing.contentHash)
    fail('AFFILIATE_HASH_MISMATCH', 'briefingHash');
  for (const field of [
    'campaignId',
    'campaignRevision',
    'productId',
    'productRevision',
  ] as const)
    if (binding[field] !== briefing[field])
      fail('AFFILIATE_RUN_SCOPE_MISMATCH', field);
}
export function assertGenerationContext(
  prior: ScriptGenerationContext | null,
  request: GenerationIdentity,
  runId: string,
  hash: string | null,
) {
  if (
    prior &&
    (prior.requestHash !== request.contentHash ||
      prior.pipelineRunId !== runId ||
      prior.briefingHash !== hash)
  )
    fail('AFFILIATE_SCRIPT_CONTEXT_CONFLICT', 'generationRequestId');
}
function fail(code: string, field: string): never {
  throw new AffiliateRepositoryError(code, field);
}
