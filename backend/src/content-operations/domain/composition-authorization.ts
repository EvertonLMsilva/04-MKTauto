import { adaptationHash } from '../../media/domain/media-hash.js';
import { CampaignError } from './campaign.js';
export function compositionScope(execution: any, done: Record<string, any>) {
  const script = done.EDITORIAL?.script;
  const reports = done.MEDIA_QC?.reports;
  if (
    !script ||
    !done.AUDIO ||
    !done.ALIGNMENT ||
    !done.SUBTITLES ||
    !Array.isArray(reports) ||
    !reports.length ||
    reports.some(
      (r: any) =>
        r.result !== 'PASS' ||
        r.evidence?.provenance?.parameters?.humanReview?.decision !==
          'APPROVED',
    )
  )
    throw new CampaignError('COMPOSITION_AUTHORIZATION_NOT_READY');
  const scope = {
    schemaVersion: 'composition-authorization-scope/1.0.0',
    purpose: 'LOCAL_COMPOSITION_ONLY',
    executionId: execution.execution_id,
    campaignId: execution.campaign_id,
    pipelineRunId: execution.run_id,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    audio: done.AUDIO,
    alignmentHash: adaptationHash(done.ALIGNMENT),
    subtitleHash: adaptationHash(done.SUBTITLES),
    media: reports.map((r: any) => r.identity),
  };
  return { scope, scopeHash: adaptationHash(scope) };
}
export function compositionGrant(
  execution: any,
  done: Record<string, any>,
  input: any,
  actorId: string,
  approvedAt: string,
) {
  const prepared = compositionScope(execution, done);
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'acceptsCompositionRights,audioIntelligible,scopeHash,sourceRef,statement' ||
    input.acceptsCompositionRights !== true ||
    input.audioIntelligible !== true ||
    input.scopeHash !== prepared.scopeHash ||
    typeof input.sourceRef !== 'string' ||
    input.sourceRef.trim().length < 3 ||
    input.sourceRef.length > 1000 ||
    typeof input.statement !== 'string' ||
    input.statement.trim().length < 15 ||
    input.statement.length > 2000 ||
    !/^[a-z][a-z0-9_:-]{2,99}$/.test(actorId) ||
    !Number.isFinite(Date.parse(approvedAt))
  )
    throw new CampaignError('COMPOSITION_AUTHORIZATION_INVALID');
  return {
    ...prepared,
    sourceRef: input.sourceRef.trim(),
    statement: input.statement.trim(),
    acceptsCompositionRights: true,
    audioIntelligible: true,
    actorId,
    approvedAt,
  };
}
export function assertCompositionGrant(
  execution: any,
  done: Record<string, any>,
) {
  const grant = done.COMPOSITION_AUTHORIZATION;
  if (!grant) throw new CampaignError('COMPOSITION_RIGHTS_REQUIRED');
  const current = compositionScope(execution, done);
  if (
    grant.scopeHash !== current.scopeHash ||
    adaptationHash(grant.scope) !== current.scopeHash ||
    grant.acceptsCompositionRights !== true ||
    grant.audioIntelligible !== true ||
    typeof grant.actorId !== 'string' ||
    !/^[a-z][a-z0-9_:-]{2,99}$/.test(grant.actorId) ||
    !Number.isFinite(Date.parse(grant.approvedAt)) ||
    typeof grant.sourceRef !== 'string' ||
    grant.sourceRef.trim().length < 3 ||
    typeof grant.statement !== 'string' ||
    grant.statement.trim().length < 15
  )
    throw new CampaignError('COMPOSITION_RIGHTS_REQUIRED');
}
