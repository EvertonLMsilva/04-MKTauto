import { adaptationHash } from '../../media/domain/media-hash.js';
import { assertMediaProcessingRights } from '../../media/domain/media-processing-rights.js';
import type { LocalImageSource } from '../../media/application/local-flow.port.js';
import { CampaignError } from './campaign.js';

export interface OneShotMediaIdentity {
  executionId: string;
  pipelineRunId: string;
  campaignId: string;
  campaignRevision: number;
  productId: string;
  productRevision: number;
  briefingId: string;
  briefingHash: string;
  mediaReference: string;
  imageContentHash: string;
}
export function prepareOneShotMedia(
  identity: OneShotMediaIdentity,
  source: LocalImageSource,
) {
  if (
    identity.mediaReference !== source.mediaReference ||
    identity.imageContentHash !== source.contentHash
  )
    throw new CampaignError('ONE_SHOT_MEDIA_IDENTITY_CONFLICT');
  const scopes =
    source.rights.evidence
      ?.map((e) => e.mediaAuthorization?.operationScope)
      .filter((s): s is string => s !== undefined) ?? [];
  if (
    !scopes.length ||
    new Set(scopes).size !== 1 ||
    !source.rights.commercialUseAllowed
  )
    throw new CampaignError('ONE_SHOT_MEDIA_SCOPE_REQUIRED');
  assertMediaProcessingRights(
    source.rights.evidence,
    { mediaRef: source.mediaReference, contentHash: source.contentHash },
    null,
    scopes[0],
    { campaignId: identity.campaignId, purpose: 'HUMAN_QC_REVIEW' },
  );
  const declarationHash = adaptationHash(source);
  const scopeHash = adaptationHash({ identity, declarationHash });
  const operationScope = `one_shot_${scopeHash}`;
  const boundSource = structuredClone(source);
  for (const e of boundSource.rights.evidence ?? [])
    if (e.mediaAuthorization?.operationScope !== undefined)
      e.mediaAuthorization.operationScope = operationScope;
  return {
    identity,
    declarationHash,
    scopeHash,
    operationScope,
    boundSource,
    boundDeclarationHash: adaptationHash(boundSource),
  };
}
export type OneShotMediaPreparation = ReturnType<typeof prepareOneShotMedia>;
export interface OneShotMediaDecision {
  authorizationId: string;
  scopeHash: string;
  acceptsProcessing: true;
  sourceRef: string;
  statement: string;
}
export function assertOneShotDecision(
  value: OneShotMediaDecision,
  prepared: OneShotMediaPreparation,
) {
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'acceptsProcessing,authorizationId,scopeHash,sourceRef,statement' ||
    value.acceptsProcessing !== true ||
    value.scopeHash !== prepared.scopeHash ||
    typeof value.authorizationId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{2,199}$/.test(value.authorizationId) ||
    typeof value.sourceRef !== 'string' ||
    value.sourceRef.trim().length < 3 ||
    value.sourceRef.length > 1000 ||
    typeof value.statement !== 'string' ||
    value.statement.trim().length < 15 ||
    value.statement.length > 2000
  )
    throw new CampaignError('ONE_SHOT_MEDIA_HUMAN_AUTHORIZATION_REQUIRED');
}
