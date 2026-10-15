import { readFileSync } from 'node:fs';
import { adaptationHash } from './domain/video-adaptation-contracts.js';
import { ttsRequest, ttsApproval, ttsFail } from './domain/tts-finance-contracts.js';
import { getP4 } from './p4-video-repository.js';
import { usdUnits, usdAmount } from './domain/video-generation-contracts.js';
import { validateVoiceProviderOutput } from './domain/voice-generation-contracts.js';
export function initializeTts(gate) {
  return transaction(gate,()=>{
    if (!gate.db.prepare("SELECT 1 FROM sqlite_master WHERE name='tts_finance_metadata'").get())
      gate.db.exec(readFileSync(new URL('./db/migrations/tts_finance_v1.sql',import.meta.url),'utf8'));
    if (gate.db.prepare('SELECT version FROM tts_finance_metadata').get()?.version!==1) ttsFail('TTS_SCHEMA_INVALID');
  });
}
function binding(gate,request) {
  const config=getP4(gate.repository,'audio_config',request.operation.audioConfigId);
  const briefing=gate.affiliate.resolveRunBriefing(request.operation.pipelineRunId);
  const source=gate.db.prepare('SELECT state,request_hash,request_json,result_json FROM video_generation_operations WHERE generation_request_id=?').get(request.operation.sourceId);
  if (!config || adaptationHash(config)!==request.audioConfigurationHash || briefing?.campaignId!==request.campaignId
    || source?.state!=='COMPLETED' || source.request_hash!==request.source.requestHash
    || JSON.parse(source.request_json).pipelineRunId!==request.operation.pipelineRunId
    || (request.source.sourceReference && JSON.parse(source.result_json).videoReference!==request.source.sourceReference)
    || (request.source.providerRequestId && JSON.parse(source.result_json).providerRequestId!==request.source.providerRequestId)) ttsFail('TTS_SCOPE_INVALID');
}
export function approveTts(gate,plan,value) {
  const request=ttsRequest(plan),approval=ttsApproval(request,value);
  return transaction(gate,()=>{
    binding(gate,request); gate.ttsCampaignUsage(request.campaignId);
    const prior=gate.db.prepare('SELECT request_hash,approval_json FROM tts_financial_approvals WHERE operation_id=?').get(request.operationId);
    if(prior && (prior.request_hash!==adaptationHash(request)||adaptationHash(JSON.parse(prior.approval_json))!==adaptationHash(approval))) ttsFail('TTS_IDENTITY_CONFLICT');
    if(!prior) gate.db.prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)').run(request.operationId,adaptationHash(request),JSON.stringify(request),JSON.stringify(approval));
    return approval;
  });
}
export function getTts(gate,id) {
  const row=gate.db.prepare('SELECT * FROM tts_operations WHERE operation_id=?').get(id);if(!row)return null;
  const request=JSON.parse(row.request_json);
  if(adaptationHash(request)!==row.request_hash || request.operationId!==id || request.campaignId!==row.campaign_id) ttsFail('TTS_IDENTITY_CONFLICT');
  return {request,requestHash:row.request_hash,state:row.state,createdAt:row.created_at,
    audio:row.audio_json?JSON.parse(row.audio_json):null,billing:row.billing_json?JSON.parse(row.billing_json):null,
    reconciliationReference:row.reconciliation_reference,providerRequestId:row.provider_request_id,errorCode:row.error_code};
}
export function beginTts(gate,plan,now) {
  const request=ttsRequest(plan);
  return transaction(gate,()=>{
    binding(gate,request);
    const row=gate.db.prepare('SELECT request_hash,request_json,approval_json FROM tts_financial_approvals WHERE operation_id=?').get(request.operationId);
    if(!row || row.request_hash!==adaptationHash(request) || adaptationHash(JSON.parse(row.request_json))!==row.request_hash) ttsFail('TTS_APPROVAL_REQUIRED');
    const approval=ttsApproval(request,JSON.parse(row.approval_json));
    if(!Number.isFinite(Date.parse(now)) || Date.parse(now)<Date.parse(approval.approvedAt)) ttsFail('TTS_APPROVAL_INVALID');
    const prior=getTts(gate,request.operationId);
    if(prior){if(prior.requestHash!==adaptationHash(request))ttsFail('TTS_IDENTITY_CONFLICT');
      if(['SUBMITTING','UNKNOWN'].includes(prior.state))ttsFail('TTS_RECONCILIATION_REQUIRED');return {created:false,operation:prior};}
    const {operationId,...intent}=request, intentHash=adaptationHash(intent);
    if(gate.db.prepare('SELECT 1 FROM tts_operations WHERE intent_hash=?').get(intentHash))ttsFail('TTS_RECONCILIATION_REQUIRED');
    const usage=gate.ttsCampaignUsage(request.campaignId);
    if(usage.hasUnknown || usage.hasCeilingBreach)ttsFail('TTS_RECONCILIATION_REQUIRED');
    if(usdUnits(usage.committedUsd)+usdUnits(request.reservationUsd)>usdUnits(usage.totalUsd))ttsFail('TTS_BUDGET_EXCEEDED');
    gate.assertGlobalAvailable(request.reservationUsd,now);
    gate.db.prepare("INSERT INTO tts_operations VALUES(?,?,?,?,?,'SUBMITTING',?,NULL,NULL,NULL,NULL,NULL)").run(operationId,intentHash,adaptationHash(request),request.campaignId,JSON.stringify(request),now);
    return {created:true,operation:getTts(gate,operationId)};
  });
}
export function saveTtsAudio(gate,id,audio,billing) {
  validateVoiceProviderOutput(audio);
  if(audio.provider!=='openai' || audio.audioFormat!=='wav')ttsFail('TTS_AUDIO_INVALID');
  if(billing && (typeof billing.evidenceReference!=='string' || !billing.evidenceReference.trim()))ttsFail('TTS_BILLING_INVALID');
  if(billing)billing={...billing,actualCostUsd:usdAmount(usdUnits(billing.actualCostUsd))};
  return transaction(gate,()=>{
    const op=getTts(gate,id);if(!op || !['SUBMITTING','UNKNOWN'].includes(op.state))ttsFail('TTS_STATE_INVALID');
    gate.db.prepare('UPDATE tts_operations SET audio_json=?,billing_json=? WHERE operation_id=?').run(JSON.stringify(audio),billing?JSON.stringify(billing):null,id);
    return getTts(gate,id);
  });
}
export function setTtsProviderId(gate,id,requestId) {
  if(requestId===null)return;
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_.:-]{3,200}$/.test(requestId))ttsFail('TTS_PROVIDER_ID_INVALID');
  return transaction(gate,()=>{
    const op=getTts(gate,id);if(op?.state!=='SUBMITTING')ttsFail('TTS_STATE_INVALID');
    gate.db.prepare('UPDATE tts_operations SET provider_request_id=? WHERE operation_id=?').run(requestId,id);
  });
}
export function finishTts(gate,id,state,reference=null,errorCode=null) {
  return transaction(gate,()=>{
    const op=getTts(gate,id);
    if(!op || !['SUBMITTING','UNKNOWN'].includes(op.state) || !['COMPLETED','REVIEW_REQUIRED','UNKNOWN'].includes(state)
      || (state!=='UNKNOWN' && !op.audio) || (op.state==='UNKNOWN' && state!=='UNKNOWN' && !reference))ttsFail('TTS_STATE_INVALID');
    if(errorCode!==null && !/^[A-Z0-9_]{3,100}$/.test(errorCode))ttsFail('TTS_INVALID_ERROR_CODE');
    gate.db.prepare('UPDATE tts_operations SET state=?,reconciliation_reference=?,error_code=? WHERE operation_id=?').run(state,reference,errorCode,id);return getTts(gate,id);
  });
}
export function accountTts(gate,id) {
  const op=getTts(gate,id);if(!op || op.state==='SUBMITTING')ttsFail('TTS_STATE_INVALID');
  if(op.billing?.actualCostUsd==='0')return null;
  const run=gate.repository.getRun(op.request.operation.pipelineRunId);
  return gate.repository.registerCostEvent({schemaVersion:'cost-event/1.0.0',costEventId:`tts_cost:${id}`,category:'voice_cost',
    pipelineRunId:run.pipelineRunId,projectId:run.projectId,projectVersion:run.projectVersion,contentIdentity:null,artifactId:null,
    amount:op.billing?.actualCostUsd??op.request.estimatedUsd,currency:'USD',occurredAt:op.createdAt,recordedAt:op.createdAt,
    origin:'openai',attributionRuleVersion:op.billing?'tts-actual/1.0.0':'tts-estimate/1.0.0'});
}
function transaction(gate,fn){try{gate.db.exec('BEGIN IMMEDIATE');const result=fn();gate.db.exec('COMMIT');return result;}catch(error){if(gate.db.isTransaction)gate.db.exec('ROLLBACK');throw error;}}
