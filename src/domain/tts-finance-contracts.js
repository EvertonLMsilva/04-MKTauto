import { adaptationHash } from './video-adaptation-contracts.js';
import { validateAudioConfig } from './p4-video-contracts.js';
import { affiliateIdentifier, immutable } from './affiliate-contracts.js';
export function ttsFail(code) { throw Object.assign(new Error(code), { code }); }
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function ttsRequest(plan) {
  const op=plan?.operation, config=validateAudioConfig(plan?.audioConfiguration?.config), provider=plan?.providerConfiguration;
  if (!op || adaptationHash(op)!==plan.operationHash || !op.narration?.trim() || op.narration.length>4096
    || op.maxDurationMilliseconds!==10000 || op.audioConfigId!==plan.audioConfiguration.id
    || plan.audioConfiguration.contentHash!==adaptationHash(config) || op.audioConfigId!==`audio_config:${adaptationHash(config)}`
    || config.provider!=='openai' || config.language!=='pt-BR' || config.voice!=='marin' || config.style!=='informative' || config.mode==='PRESERVE'
    || provider?.model!=='gpt-4o-mini-tts' || provider.voice!=='marin' || provider.audioFormat!=='wav'
    || provider.policyVersion!=='openai-voice-policy/2.0.0' || adaptationHash({provider:'openai',...provider})!==plan.providerConfigurationHash
    || plan.estimatedCost?.currency!=='USD' || String(plan.estimatedCost.amount)!=='0.00306'
    || String(plan.estimatedCost.proposedInternalAllowanceUsd)!=='0.01' || plan.estimatedCost.guaranteedMaximum!==false
    || plan.source?.generationRequestId!==op.sourceId || !hash(plan.source.requestHash) || !hash(plan.source.sourceContentHash)) ttsFail('TTS_INVALID_PLAN');
  for(const key of ['sourceId','pipelineRunId']) affiliateIdentifier(op[key],key);
  affiliateIdentifier(plan.operationId,'operationId');
  return immutable({schemaVersion:'tts-operation/1.0.0',operationId:plan.operationId,campaignId:config.campaignId,
    operation:op,source:plan.source,providerConfigurationHash:plan.providerConfigurationHash,
    model:provider.model,language:config.language,voice:config.voice,style:config.style,
    narrationHash:adaptationHash(op.narration),audioConfigurationHash:adaptationHash(config),
    estimatedUsd:'0.00306',reservationUsd:'0.01',costBasis:'PLANNING_ESTIMATE',guaranteedMaximum:false});
}
export function ttsApproval(request, value) {
  if (!value || Object.keys(value).sort().join(',')!=='acceptsUnboundedCost,approvalReference,approvedAt,approvedBy,requestHash'
    || value.requestHash!==adaptationHash(request) || value.acceptsUnboundedCost!==true
    || typeof value.approvedBy!=='string' || !value.approvedBy.trim()
    || typeof value.approvalReference!=='string' || !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(value.approvalReference)
    || typeof value.approvedAt!=='string' || !Number.isFinite(Date.parse(value.approvedAt))) ttsFail('TTS_APPROVAL_INVALID');
  return immutable(value);
}
