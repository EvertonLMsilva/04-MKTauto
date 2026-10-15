import { AffiliateRepository } from './affiliate-repository.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as tts from './tts-finance.js';
import { affiliateIdentifier, immutable } from './domain/affiliate-contracts.js';
import { AURA_ONE_VIDEO_BUDGET, fail, usdAmount, usdUnits, validateVideoBudget,
  validateVideoCostAuthorization, videoReservationAmount, videoQuoteHash, validateVideoGenerationRequest, validateVideoProviderResult, videoRequestHash } from './domain/video-generation-contracts.js';

// Reservations are liabilities, not invoices. Retain the maximum for every
// dispatched operation, including unknown/failed outcomes, independently of CostLedger.
const GLOBAL_DEFAULTS = Object.freeze({dailyUsd:'1',monthlyUsd:'20',timeZone:'America/Sao_Paulo'});
export class BudgetGate {
  // Prices originate in a configured trusted provider boundary, never API input.
  static paidFetch(fetchImpl, { gate, costCeilingSource, provider = 'openai', authorizationMode = 'AUTOMATIC', now = () => new Date().toISOString() } = {}) {
    return async (url, options, scope = {}) => {
      if (!gate || typeof costCeilingSource !== 'function') fail('GLOBAL_FINANCE_REQUIRED','transport');
      if(options.signal?.aborted)fail('GLOBAL_TRANSPORT_CANCELLED','signal');
      const requestHash=createHash('sha256').update(`${url}\n${options.body}`).digest('hex');
      const quote=await costCeilingSource({provider,requestHash,url,body:options.body});
      if(quote?.provider!==provider || quote?.requestHash!==requestHash)fail('GLOBAL_PRICE_UNPROVEN','requestHash');
      const saved=await gate.executePaid({...quote,...Object.fromEntries(Object.entries(scope).filter(([,value])=>value!==undefined)),bodyHash:createHash('sha256').update(options.body).digest('hex'),operationId:`${provider}:${requestHash}`},async()=>{
        const response=await fetchImpl(url,options);
        const body=Buffer.from(await response.arrayBuffer());
        if(body.length>64*1024*1024)fail('GLOBAL_RESPONSE_TOO_LARGE','response');
        return {body:body.toString('base64'),status:response.status,headers:['content-type','x-request-id'].flatMap(key=>response.headers.get(key)?[[key,response.headers.get(key)]]:[])};
      },now(),{authorizationMode});
      return new Response(Buffer.from(saved.body,'base64'),{status:saved.status,headers:saved.headers});
    };
  }
  // Compatibility for the existing explicitly approved, unbounded manual TTS.
  // This is not a provider ceiling and cannot authorize automatic execution.
  ttsTransportProof(id, {provider,requestHash,url,body}) {
    const operation=this.getTts(id),payload=JSON.parse(body);
    const approval=this.db.prepare('SELECT approval_json FROM tts_financial_approvals WHERE operation_id=?').get(id);
    if(provider!=='openai' || url!=='https://api.openai.com/v1/audio/speech' || operation?.state!=='SUBMITTING' || !approval
      || JSON.parse(approval.approval_json).acceptsUnboundedCost!==true || payload.input!==operation.request.operation.narration
      || payload.model!==operation.request.model || payload.voice!==operation.request.voice || payload.response_format!=='wav')fail('GLOBAL_PRICE_UNPROVEN','manualTts');
    return {provider,requestHash,kind:'MANUAL_TTS_RESERVATION',sourceTtsId:id,currency:'USD',maximumAmount:operation.request.reservationUsd};
  }
  configureGlobal({ dailyUsd = GLOBAL_DEFAULTS.dailyUsd, monthlyUsd = GLOBAL_DEFAULTS.monthlyUsd, timeZone = GLOBAL_DEFAULTS.timeZone } = {}) {
    const daily = usdAmount(usdUnits(dailyUsd)), monthly = usdAmount(usdUnits(monthlyUsd));
    if (usdUnits(daily) <= 0n || usdUnits(monthly) <= 0n) fail('GLOBAL_POLICY_INVALID', 'limits');
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return this.#transaction(() => {
      this.#initializeGlobal();
      const previous=this.db.prepare('SELECT time_zone FROM global_finance_policy WHERE singleton=1').get();
      if(previous.time_zone!==timeZone && (this.db.prepare('SELECT 1 FROM global_paid_operations LIMIT 1').get()
        || this.db.prepare("SELECT 1 FROM video_generation_operations WHERE state!='CANCELLED' LIMIT 1").get()
        || this.db.prepare('SELECT 1 FROM cost_events LIMIT 1').get()
        || this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='tts_operations'").get() && this.db.prepare('SELECT 1 FROM tts_operations LIMIT 1').get()))fail('GLOBAL_POLICY_PERIOD_CONFLICT','timeZone');
      this.db.prepare('INSERT INTO global_finance_policy VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET daily_usd=excluded.daily_usd,monthly_usd=excluded.monthly_usd,time_zone=excluded.time_zone').run(daily, monthly, timeZone);
      return { dailyUsd: daily, monthlyUsd: monthly, timeZone };
    });
  }
  #initializeGlobal() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='global_finance_policy'").get()) {
      this.db.exec(readFileSync(new URL('./db/migrations/global_finance_v1.sql', import.meta.url), 'utf8'));
      this.db.prepare('INSERT INTO global_finance_policy VALUES(1,?,?,?)').run(GLOBAL_DEFAULTS.dailyUsd, GLOBAL_DEFAULTS.monthlyUsd, GLOBAL_DEFAULTS.timeZone);
    }
  }
  // All liability is aggregated in the same SQLite boundary, across campaigns.
  #globalUsage(now) {
    this.#initializeGlobal();
    if (!Number.isFinite(Date.parse(now))) fail('GLOBAL_TIME_INVALID', 'now');
    const policy = this.db.prepare('SELECT * FROM global_finance_policy WHERE singleton=1').get();
    const period = value => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: policy.time_zone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date(value));
      return ['year','month','day'].map(type => parts.find(p => p.type === type).value).join('-');
    };
    const day = period(now), month = day.slice(0,7); let daily = 0n, monthly = 0n;
    const accounted = new Set();
    const add = (at, amount, unresolved=false) => { const date=period(at); if(date>day) fail('GLOBAL_TIME_INVALID','now'); if(unresolved || date===day) daily+=amount; if(unresolved || date.slice(0,7)===month) monthly+=amount; };
    for (const row of this.db.prepare('SELECT * FROM global_paid_operations').all()) {
      if(JSON.parse(row.proof_json).kind==='MANUAL_TTS_RESERVATION')continue; // Existing TTS liability below.
      let actual = usdUnits(row.actual_usd ?? '0'); const maximum=usdUnits(row.maximum_usd);
      for(const telemetry of this.db.prepare('SELECT cost_event_id FROM ai_call_telemetry WHERE provider=? AND input_hash=? AND occurred_at=? AND cost_event_id IS NOT NULL').all(row.provider,JSON.parse(row.proof_json).bodyHash??row.request_hash,JSON.parse(row.proof_json).telemetryOccurredAt??null)){
        const cost=this.repository.getCostEvent(telemetry.cost_event_id);
        if(cost?.currency==='USD'){const amount=usdUnits(cost.amount);if(amount>actual)actual=amount;accounted.add(cost.costEventId);}
      }
      add(row.created_at, actual>maximum?actual:maximum, ['RESERVED','SUBMITTING','UNKNOWN'].includes(row.state));
      if(actual>maximum) fail('GLOBAL_PRICE_CEILING_BREACHED','actualCostUsd');
    }
    for (const row of this.db.prepare("SELECT generation_request_id FROM video_generation_operations WHERE state!='CANCELLED'").all()) {
      const op=this.getOperation(row.generation_request_id), actual=usdUnits(op.billing?.actualCostUsd??op.result?.actualCostUsd??'0'), maximum=usdUnits(videoReservationAmount(op.ceiling));
      add(op.createdAt, actual>maximum?actual:maximum, ['RESERVED','SUBMITTING','SUBMITTED','UNKNOWN'].includes(op.state));
      const cost=this.repository.getCostEvent(op.costEventId);
      if(cost && cost.currency==='USD' && usdUnits(cost.amount)===actual && cost.pipelineRunId===op.request.pipelineRunId && cost.origin===op.request.provider) accounted.add(cost.costEventId);
      if(actual>maximum) fail('GLOBAL_PRICE_CEILING_BREACHED','actualCostUsd');
    }
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='tts_operations'").get()) for(const row of this.db.prepare('SELECT operation_id FROM tts_operations').all()) {
      const op=this.getTts(row.operation_id), actual=usdUnits(op.billing?.actualCostUsd??'0'), maximum=usdUnits(op.request.reservationUsd);
      add(op.createdAt,actual>maximum?actual:maximum,['SUBMITTING','UNKNOWN'].includes(op.state));
      const cost=this.repository.getCostEvent(`tts_cost:${row.operation_id}`);
      if(cost && cost.pipelineRunId===op.request.operation.pipelineRunId && cost.origin==='openai' && cost.currency==='USD' && cost.amount===(op.billing?.actualCostUsd??op.request.estimatedUsd))accounted.add(cost.costEventId);
      if(actual>maximum)fail('GLOBAL_PRICE_CEILING_BREACHED','actualCostUsd');
    }
    for(const cost of this.db.prepare('SELECT cost_event_id,amount,currency,occurred_at FROM cost_events').all()) {
      if(accounted.has(cost.cost_event_id))continue;
      if(cost.currency!=='USD')fail('GLOBAL_COST_CURRENCY_UNSUPPORTED','currency');
      add(cost.occurred_at,usdUnits(cost.amount));
    }
    return { dailyUsd:usdAmount(daily),monthlyUsd:usdAmount(monthly),policy };
  }
  getGlobalUsage(now = new Date().toISOString()) { return this.#transaction(() => this.#globalUsage(now)); }
  assertGlobalAvailable(amount, now) {
    const usage=this.#globalUsage(now), addition=usdUnits(amount);
    if(usdUnits(usage.dailyUsd)+addition>usdUnits(usage.policy.daily_usd))fail('GLOBAL_DAILY_BUDGET_EXCEEDED','dailyUsd');
    if(usdUnits(usage.monthlyUsd)+addition>usdUnits(usage.policy.monthly_usd))fail('GLOBAL_MONTHLY_BUDGET_EXCEEDED','monthlyUsd');
    return usage;
  }
  reserveGlobal(proof, now = new Date().toISOString(), {authorizationMode='AUTOMATIC'} = {}) {
    return this.#transaction(() => {
      this.#initializeGlobal();
      if(!proof || !/^[a-zA-Z0-9_:-]{1,200}$/.test(proof.operationId??'') || !/^[a-f0-9]{64}$/.test(proof.requestHash??'') || !/^[a-z0-9_]{1,50}$/.test(proof.provider??''))fail('GLOBAL_IDENTITY_INVALID','operation');
      const prior=this.db.prepare('SELECT * FROM global_paid_operations WHERE operation_id=?').get(proof.operationId);
      if(prior){if(prior.request_hash!==proof.requestHash || prior.provider!==proof.provider)fail('GLOBAL_IDENTITY_CONFLICT','operationId');return {created:false,operation:prior};}
      if(this.db.prepare('SELECT 1 FROM global_paid_operations WHERE provider=? AND request_hash=?').get(proof.provider,proof.requestHash))fail('GLOBAL_IDENTITY_CONFLICT','requestHash');
      const manualTts=authorizationMode==='MANUAL' && proof.kind==='MANUAL_TTS_RESERVATION' && proof.provider==='openai' && this.getTts(proof.sourceTtsId)?.state==='SUBMITTING';
      if(proof.sourceTtsId && !manualTts)fail('GLOBAL_PRICE_UNPROVEN','sourceTtsId');
      if(!manualTts && (proof.kind!=='ENFORCED_MAXIMUM' || proof.includesAllCharges!==true || proof.currency!=='USD' || !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(proof.evidenceReference??'') || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt)<=Date.parse(now)))fail('GLOBAL_PRICE_UNPROVEN','ceiling');
      let amount;try{amount=usdAmount(usdUnits(proof.maximumAmount));}catch{fail('GLOBAL_PRICE_UNPROVEN','maximumAmount');}
      if(usdUnits(amount)<=0n)fail('GLOBAL_PRICE_UNPROVEN','maximumAmount');
      let campaignId = null;
      if(proof.pipelineRunId){
        if(!this.repository.getRun(proof.pipelineRunId))fail('GLOBAL_SCOPE_INVALID','pipelineRunId');
        campaignId=this.affiliate.resolveRunBriefing(proof.pipelineRunId)?.campaignId??null;
        if(campaignId){const usage=this.#usage(campaignId);if(usage.hasUnknown||usage.hasCeilingBreach)fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED','campaignId');if(usdUnits(usage.committedUsd)+usdUnits(amount)>usdUnits(usage.totalUsd))fail('VIDEO_GENERATION_BUDGET_EXCEEDED','campaignId');}
      }
      if(manualTts && amount!==this.getTts(proof.sourceTtsId).request.reservationUsd)fail('GLOBAL_PRICE_UNPROVEN','manualTts');
      this.assertGlobalAvailable(manualTts?'0':amount,now);
      this.db.prepare("INSERT INTO global_paid_operations VALUES(?,?,?,?,?,?,'RESERVED',NULL,NULL,NULL)").run(proof.operationId,proof.requestHash,proof.provider,amount,JSON.stringify({...proof,campaignId}),now);
      return {created:true,operation:this.db.prepare('SELECT * FROM global_paid_operations WHERE operation_id=?').get(proof.operationId)};
    });
  }
  dispatchGlobal(id, now = null) {
    return this.#transaction(() => {
      const op=this.db.prepare('SELECT * FROM global_paid_operations WHERE operation_id=?').get(id);
      if(op?.state!=='RESERVED')fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED','operationId');
      const at=now??op.created_at;
      const proof=JSON.parse(op.proof_json);
      if(proof.campaignId){const usage=this.#usage(proof.campaignId);if(usage.hasUnknown||usage.hasCeilingBreach)fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED','campaignId');if(usdUnits(usage.committedUsd)>usdUnits(usage.totalUsd))fail('VIDEO_GENERATION_BUDGET_EXCEEDED','campaignId');}
      if(Date.parse(JSON.parse(op.proof_json).expiresAt)<=Date.parse(at))fail('GLOBAL_PRICE_UNPROVEN','expiresAt');
      this.assertGlobalAvailable('0',at);
      this.db.prepare("UPDATE global_paid_operations SET state='SUBMITTING' WHERE operation_id=?").run(id);
    });
  }
  unknownGlobal(id) { this.db.prepare("UPDATE global_paid_operations SET state='UNKNOWN' WHERE operation_id=? AND state='SUBMITTING'").run(id); }
  settleGlobal(id,{actualCostUsd,evidenceReference}) {
    const actual=usdAmount(usdUnits(actualCostUsd));
    if(typeof evidenceReference!=='string'||!evidenceReference.trim())fail('GLOBAL_BILLING_INVALID','evidenceReference');
    return this.#transaction(()=>{
      const op=this.db.prepare('SELECT * FROM global_paid_operations WHERE operation_id=?').get(id);
      if(!op)fail('GLOBAL_OPERATION_NOT_FOUND','operationId');
      if(op.actual_usd!==null && (op.actual_usd!==actual || op.billing_reference!==evidenceReference))fail('GLOBAL_BILLING_CONFLICT','actualCostUsd');
      if(!['SUBMITTING','UNKNOWN','COMPLETED'].includes(op.state))fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED','state');
      this.db.prepare("UPDATE global_paid_operations SET state='COMPLETED',actual_usd=?,billing_reference=? WHERE operation_id=?").run(actual,evidenceReference,id);
    });
  }
  async executePaid(proof, transport, now = new Date().toISOString(), options = {}) {
    const reserved=this.reserveGlobal(proof,now,options);
    if(!reserved.created){if(reserved.operation.state==='COMPLETED' && reserved.operation.result_json!==null)return JSON.parse(reserved.operation.result_json);fail('GLOBAL_OPERATION_RECONCILIATION_REQUIRED','operationId');}
    this.dispatchGlobal(proof.operationId,now);
    try { const result=await transport(); this.db.prepare("UPDATE global_paid_operations SET state='COMPLETED',result_json=? WHERE operation_id=?").run(JSON.stringify(result??null),proof.operationId); return result; }
    catch(error){this.unknownGlobal(proof.operationId);throw error;}
  }
  initializeTts() { return tts.initializeTts(this); }
  approveTts(plan, approval) { return tts.approveTts(this, plan, approval); }
  beginTts(plan, now) { return tts.beginTts(this, plan, now); }
  getTts(id) { return tts.getTts(this, id); }
  saveTtsAudio(id, audio, billing=null) { return tts.saveTtsAudio(this,id,audio,billing); }
  setTtsProviderId(id, requestId) { return tts.setTtsProviderId(this,id,requestId); }
  finishTts(id,state,reference=null,errorCode=null) { return tts.finishTts(this,id,state,reference,errorCode); }
  accountTts(id) { return tts.accountTts(this,id); }
  ttsCampaignUsage(id) { return this.#usage(id); }
  constructor(repository) {
    if (!repository?.db || typeof repository.registerCostEvent !== 'function') throw new TypeError('CostLedgerRepository obrigatório');
    this.repository = repository; this.db = repository.db; this.affiliate = new AffiliateRepository(repository);
  }
  configureCampaign(campaignId, revision, value = AURA_ONE_VIDEO_BUDGET) {
    const policy = validateVideoBudget(value);
    return this.#transaction(() => {
      const campaign = this.affiliate.getCampaign(campaignId, revision);
      if (!campaign) fail('VIDEO_GENERATION_CAMPAIGN_NOT_FOUND', 'campaignId');
      const prior = this.db.prepare('SELECT * FROM video_generation_campaign_budgets WHERE campaign_id = ?').get(campaignId);
      if (prior) {
        if (prior.project_id !== campaign.projectId || JSON.stringify(policy) !== prior.policy_json) fail('VIDEO_GENERATION_POLICY_CONFLICT', 'campaignId');
      } else {
        this.db.prepare('INSERT INTO video_generation_campaign_budgets VALUES (?, ?, ?, ?)')
          .run(campaignId, revision, campaign.projectId, JSON.stringify(policy));
      }
      return policy;
    });
  }
  getOperation(id) {
    affiliateIdentifier(id, 'generationRequestId');
    const row = this.db.prepare('SELECT * FROM video_generation_operations WHERE generation_request_id = ?').get(id);
    if (!row) return null;
    const request = validateVideoGenerationRequest(JSON.parse(row.request_json));
    if (videoRequestHash(request) !== row.request_hash || request.generationRequestId !== id
      || request.campaignId !== row.campaign_id || request.pipelineRunId !== row.pipeline_run_id || request.originalSlot !== row.original_slot) fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'persistedRequest');
    const operation = { request, requestHash: row.request_hash, ceiling: JSON.parse(row.ceiling_json), state: row.state,
      ownerToken: row.owner_token, createdAt: row.created_at, costEventId: row.cost_event_id,
      providerRequestId: null, result: null, billing: null };
    this.validateAuthorization(operation.ceiling, request, operation.createdAt);
    if (row.result_json) {
      operation.result = validateVideoProviderResult(JSON.parse(row.result_json), operation);
      operation.providerRequestId = operation.result.providerRequestId;
    }
    const billing = this.db.prepare('SELECT * FROM video_generation_billing WHERE generation_request_id = ?').get(id);
    if (billing) operation.billing = { providerRequestId: billing.provider_request_id,
      actualCostUsd: billing.actual_cost_usd, evidenceReference: billing.evidence_reference };
    return immutable(operation);
  }
  getUsage(campaignId) { affiliateIdentifier(campaignId, 'campaignId'); return this.#transaction(() => this.#usage(campaignId)); }
  approveEstimate(value, quote, approval) {
    const request = validateVideoGenerationRequest(value);
    validateVideoCostAuthorization(quote, request, approval?.approvedAt);
    if (quote.kind !== 'OFFICIAL_ESTIMATE' || approval?.acceptsUnboundedCost !== true
      || Object.keys(approval).sort().join(',') !== 'acceptsUnboundedCost,approvalReference,approvedAt,approvedBy'
      || typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim()
      || typeof approval.approvalReference !== 'string' || !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(approval.approvalReference)
      || !Number.isFinite(Date.parse(approval.approvedAt))) fail('VIDEO_GENERATION_ESTIMATE_APPROVAL_REQUIRED', 'approval');
    return this.#transaction(() => {
      const policy = this.#policy(request.campaignId);
      if (usdUnits(quote.reservationAmount) > usdUnits(policy.perGenerationUsd)) fail('VIDEO_GENERATION_PRICE_LIMIT', 'reservation');
      const body = { requestHash: videoRequestHash(request), quoteHash: videoQuoteHash(quote), campaignId: request.campaignId, ...approval };
      const prior = this.db.prepare('SELECT approval_json FROM video_generation_estimate_approvals WHERE request_hash=?').get(body.requestHash);
      if (prior && videoQuoteHash(JSON.parse(prior.approval_json)) !== videoQuoteHash(body)) fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'approval');
      if (!prior) this.db.prepare('INSERT INTO video_generation_estimate_approvals VALUES (?, ?, ?, ?)').run(body.requestHash, body.campaignId, body.quoteHash, JSON.stringify(body));
      return immutable(body);
    });
  }
  validateAuthorization(quote, request, now, {authorizationMode='MANUAL'} = {}) {
    if(!['MANUAL','AUTOMATIC'].includes(authorizationMode))fail('GLOBAL_AUTHORIZATION_MODE_INVALID','authorizationMode');
    if(authorizationMode==='AUTOMATIC' && quote?.kind!=='ENFORCED_MAXIMUM')fail('GLOBAL_PRICE_UNPROVEN','ceiling');
    const result = validateVideoCostAuthorization(quote, request, now);
    if (quote.kind === 'OFFICIAL_ESTIMATE') {
      const approval = this.db.prepare('SELECT quote_hash,approval_json FROM video_generation_estimate_approvals WHERE request_hash=? AND campaign_id=?')
        .get(videoRequestHash(request), request.campaignId);
      if (!approval || approval.quote_hash !== videoQuoteHash(quote) || JSON.parse(approval.approval_json).acceptsUnboundedCost !== true)
        fail('VIDEO_GENERATION_ESTIMATE_APPROVAL_REQUIRED', 'approval');
    }
    return result;
  }
  preflight(value, quote, now) {
    const request = validateVideoGenerationRequest(value); const proof = this.validateAuthorization(quote, request, now);
    const prior = this.getOperation(request.generationRequestId);
    if (prior && prior.requestHash !== videoRequestHash(request)) fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'request');
    if (prior && prior.state !== 'CANCELLED') return { operation: prior, usage: this.getUsage(request.campaignId), newSubmission: false };
    const policy = this.#policy(request.campaignId), usage = this.getUsage(request.campaignId);
    const briefing = this.affiliate.resolveRunBriefing(request.pipelineRunId), run = this.repository.getRun(request.pipelineRunId);
    if (!briefing || briefing.campaignId !== request.campaignId || run?.projectId !== policy.projectId || run.state !== 'RUNNING') fail('VIDEO_GENERATION_CAMPAIGN_SCOPE_MISMATCH', 'pipelineRunId');
    if (!briefing.mediaRefs.includes(request.image.mediaRef)) fail('VIDEO_GENERATION_IMAGE_NOT_AUTHORIZED', 'image');
    if (usdUnits(videoReservationAmount(proof)) > usdUnits(policy.perGenerationUsd)) fail('VIDEO_GENERATION_PRICE_LIMIT', 'reservation');
    if (usage.hasUnknown) fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'campaign');
    if (usage.hasCeilingBreach) fail('VIDEO_GENERATION_PRICE_CEILING_BREACHED', 'campaign');
    if (usage.reservedSubmissions + usage.paidSubmissions >= policy.maxPaidSubmissions) fail('VIDEO_GENERATION_SUBMISSION_LIMIT', 'campaign');
    if (usdUnits(usage.committedUsd) + usdUnits(videoReservationAmount(proof)) > usdUnits(policy.totalUsd)) fail('VIDEO_GENERATION_BUDGET_EXCEEDED', 'campaign');
    if (request.originalSlot > policy.plannedOriginals) fail('VIDEO_GENERATION_ORIGINAL_LIMIT', 'slot');
    if (this.db.prepare("SELECT 1 FROM video_generation_operations WHERE campaign_id=? AND original_slot=? AND state!='CANCELLED'").get(request.campaignId, request.originalSlot)) fail('VIDEO_GENERATION_SLOT_USED', 'slot');
    return { usage, newSubmission: true };
  }
  reserve(value, ceiling, ownerToken, now) {
    const request = validateVideoGenerationRequest(value); const hash = videoRequestHash(request);
    const proof = this.validateAuthorization(ceiling, request, now);
    return this.#transaction(() => {
      const prior = this.getOperation(request.generationRequestId);
      if (prior && prior.requestHash !== hash) fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'generationRequestId');
      if (prior && prior.state !== 'CANCELLED') return { created: false, operation: prior };
      const policy = this.#policy(request.campaignId);
      const briefing = this.affiliate.resolveRunBriefing(request.pipelineRunId);
      const run = this.repository.getRun(request.pipelineRunId);
      if (!briefing || briefing.campaignId !== request.campaignId || run?.projectId !== policy.projectId || run.state !== 'RUNNING') fail('VIDEO_GENERATION_CAMPAIGN_SCOPE_MISMATCH', 'pipelineRunId');
      if (!['video-generation-request/2.0.0','video-generation-request/3.0.0'].includes(request.schemaVersion)) fail('VIDEO_GENERATION_IDENTITY_INCOMPLETE', 'schemaVersion');
      if (!briefing.mediaRefs.includes(request.image.mediaRef)) fail('VIDEO_GENERATION_IMAGE_NOT_AUTHORIZED', 'image.mediaRef');
      if (usdUnits(videoReservationAmount(proof)) > usdUnits(policy.perGenerationUsd)) fail('VIDEO_GENERATION_PRICE_LIMIT', 'maximumAmount');
      const usage = this.#usage(request.campaignId);
      if (usage.reservedSubmissions + usage.paidSubmissions >= policy.maxPaidSubmissions) fail('VIDEO_GENERATION_SUBMISSION_LIMIT', 'campaignId');
      if (usage.hasUnknown) fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'campaignId');
      if (usage.hasCeilingBreach) fail('VIDEO_GENERATION_PRICE_CEILING_BREACHED', 'campaignId');
      if (usdUnits(usage.committedUsd) + usdUnits(videoReservationAmount(proof)) > usdUnits(policy.totalUsd)) fail('VIDEO_GENERATION_BUDGET_EXCEEDED', 'campaignId');
      if (request.originalSlot > policy.plannedOriginals) fail('VIDEO_GENERATION_ORIGINAL_LIMIT', 'originalSlot');
      if (this.db.prepare("SELECT 1 FROM video_generation_operations WHERE campaign_id = ? AND original_slot = ? AND state != 'CANCELLED'").get(request.campaignId, request.originalSlot)) fail('VIDEO_GENERATION_SLOT_USED', 'originalSlot');
      const costEventId = `video_cost:${request.generationRequestId}`;
      if (this.repository.getCostEvent(costEventId)) fail('VIDEO_GENERATION_IDENTITY_CONFLICT', 'costEventId');
      this.assertGlobalAvailable(videoReservationAmount(proof), now);
      if (prior) {
        this.db.prepare("UPDATE video_generation_operations SET state = 'RESERVED', ceiling_json = ?, owner_token = ?, created_at = ?, result_json = NULL WHERE generation_request_id = ?")
          .run(JSON.stringify(proof), ownerToken, now, request.generationRequestId);
      } else {
        this.db.prepare("INSERT INTO video_generation_operations VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, NULL, ?)")
          .run(request.generationRequestId, request.campaignId, request.pipelineRunId, request.originalSlot, hash, JSON.stringify(request), JSON.stringify(proof), ownerToken, now, costEventId);
      }
      return { created: true, operation: this.getOperation(request.generationRequestId) };
    });
  }
  dispatch(id, ownerToken, now) {
    return this.#transaction(() => {
      const operation = this.getOperation(id);
      if (operation?.state !== 'RESERVED' || operation.ownerToken !== ownerToken) fail('VIDEO_GENERATION_DISPATCH_FORBIDDEN', 'state');
      this.validateAuthorization(operation.ceiling, operation.request, now);
      const policy = this.#policy(operation.request.campaignId); const usage = this.#usage(operation.request.campaignId);
      if (usage.hasUnknown) fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'campaignId');
      if (usage.hasCeilingBreach) fail('VIDEO_GENERATION_PRICE_CEILING_BREACHED', 'campaignId');
      if (usdUnits(usage.committedUsd) > usdUnits(policy.totalUsd)) fail('VIDEO_GENERATION_BUDGET_EXCEEDED', 'campaignId');
      this.assertGlobalAvailable('0', now);
      this.db.prepare("UPDATE video_generation_operations SET state = 'SUBMITTING' WHERE generation_request_id = ?").run(id);
      return this.getOperation(id);
    });
  }
  cancelReserved(id, ownerToken) {
    return this.#transaction(() => {
      this.db.prepare("UPDATE video_generation_operations SET state = 'CANCELLED' WHERE generation_request_id = ? AND state = 'RESERVED' AND owner_token = ?").run(id, ownerToken);
      return this.getOperation(id);
    });
  }
  observe(id, value) {
    return this.#transaction(() => {
      const operation = this.getOperation(id);
      if (!operation) fail('VIDEO_GENERATION_NOT_FOUND', 'generationRequestId');
      const result = validateVideoProviderResult(value, operation);
      if (['COMPLETED', 'FAILED'].includes(operation.state)) {
        if (JSON.stringify(result) !== JSON.stringify(operation.result)) fail('VIDEO_GENERATION_RESULT_CONFLICT', 'result');
        return operation;
      }
      if (!['SUBMITTING', 'SUBMITTED', 'UNKNOWN'].includes(operation.state)) fail('VIDEO_GENERATION_RECOVERY_FORBIDDEN', 'state');
      if (operation.providerRequestId && result.providerRequestId !== operation.providerRequestId) fail('VIDEO_GENERATION_RESULT_CONFLICT', 'providerRequestId');
      if (operation.result?.actualCostUsd !== null && operation.result?.actualCostUsd !== undefined
        && operation.result.actualCostUsd !== result.actualCostUsd) fail('VIDEO_GENERATION_RESULT_CONFLICT', 'actualCostUsd');
      if (operation.billing && result.actualCostUsd !== null && result.actualCostUsd !== operation.billing.actualCostUsd)
        fail('VIDEO_GENERATION_RESULT_CONFLICT', 'actualCostUsd');
      this.db.prepare('UPDATE video_generation_operations SET state = ?, result_json = ? WHERE generation_request_id = ?')
        .run(result.state, JSON.stringify(result), id);
      return this.getOperation(id);
    });
  }
  markUnknown(id) {
    const operation = this.getOperation(id);
    if (!operation || ['COMPLETED', 'FAILED'].includes(operation.state)) return operation;
    return this.observe(id, { generationRequestId: id, requestHash: operation.requestHash, provider: operation.request.provider,
      state: 'UNKNOWN', providerRequestId: operation.providerRequestId, videoReference: null, actualCostUsd: operation.result?.actualCostUsd ?? null });
  }
  reconcileCost(id, value) {
    return this.#transaction(() => {
      const operation = this.getOperation(id);
      if (!operation) fail('VIDEO_GENERATION_NOT_FOUND', 'generationRequestId');
      if (!operation.providerRequestId) fail('VIDEO_GENERATION_RECONCILIATION_REQUIRED', 'providerRequestId');
      if (!value || Object.keys(value).sort().join(',') !== 'actualCostUsd,evidenceReference,providerRequestId'
        || typeof value.evidenceReference !== 'string' || !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(value.evidenceReference))
        fail('VIDEO_GENERATION_INVALID_CONTRACT', 'billing');
      const receipt = { providerRequestId: value.providerRequestId, actualCostUsd: usdAmount(usdUnits(value.actualCostUsd)),
        evidenceReference: value.evidenceReference };
      if (receipt.providerRequestId !== operation.providerRequestId
        || (operation.result?.actualCostUsd != null && receipt.actualCostUsd !== operation.result.actualCostUsd)
        || (operation.billing && JSON.stringify(operation.billing) !== JSON.stringify(receipt)))
        fail('VIDEO_GENERATION_RESULT_CONFLICT', 'billing');
      if (!operation.billing) this.db.prepare('INSERT INTO video_generation_billing VALUES (?, ?, ?, ?)')
        .run(id, receipt.providerRequestId, receipt.actualCostUsd, receipt.evidenceReference);
      return this.getOperation(id);
    });
  }
  #policy(campaignId) {
    const row = this.db.prepare('SELECT * FROM video_generation_campaign_budgets WHERE campaign_id = ?').get(campaignId);
    if (!row) fail('VIDEO_GENERATION_POLICY_REQUIRED', 'campaignId');
    return { ...validateVideoBudget(JSON.parse(row.policy_json)), projectId: row.project_id };
  }
  #usage(campaignId) {
    const policy = this.#policy(campaignId);
    const rows = this.db.prepare("SELECT generation_request_id FROM video_generation_operations WHERE campaign_id = ? AND state != 'CANCELLED'").all(campaignId);
    let total = 0n; let reservedSubmissions = 0; let paidSubmissions = 0; let hasUnknown = false; let hasCeilingBreach = false;
    const accountedCostIds = new Set();
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='global_paid_operations'").get())for(const row of this.db.prepare('SELECT * FROM global_paid_operations').all()){
      const proof=JSON.parse(row.proof_json);if(proof.campaignId!==campaignId || proof.kind==='MANUAL_TTS_RESERVATION')continue;
      let actual=usdUnits(row.actual_usd??'0');const reserved=usdUnits(row.maximum_usd);
      for(const telemetry of this.db.prepare('SELECT cost_event_id FROM ai_call_telemetry WHERE provider=? AND input_hash=? AND occurred_at=? AND cost_event_id IS NOT NULL').all(row.provider,proof.bodyHash??row.request_hash,proof.telemetryOccurredAt??null)){
        const cost=this.repository.getCostEvent(telemetry.cost_event_id);if(cost?.currency==='USD'){const value=usdUnits(cost.amount);if(value>actual)actual=value;accountedCostIds.add(cost.costEventId);}
      }
      total+=actual>reserved?actual:reserved;if(['SUBMITTING','UNKNOWN'].includes(row.state))hasUnknown=true;if(actual>reserved)hasCeilingBreach=true;
    }
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='tts_operations'").get()) {
      for (const row of this.db.prepare('SELECT operation_id FROM tts_operations WHERE campaign_id=?').all(campaignId)) {
        const operation=this.getTts(row.operation_id);
        const reservation=usdUnits(operation.request.reservationUsd), actual=usdUnits(operation.billing?.actualCostUsd??'0');
        total+=actual>reservation?actual:reservation;
        if(['SUBMITTING','UNKNOWN'].includes(operation.state))hasUnknown=true;
        if(actual>reservation)hasCeilingBreach=true;
        const event=this.repository.getCostEvent(`tts_cost:${row.operation_id}`);
        if(event && event.pipelineRunId===operation.request.operation.pipelineRunId && event.origin==='openai'
          && event.amount===(operation.billing?.actualCostUsd??operation.request.estimatedUsd) && event.currency==='USD')accountedCostIds.add(event.costEventId);
      }
    }
    for (const row of rows) {
      const operation = this.getOperation(row.generation_request_id);
      const ceiling = usdUnits(videoReservationAmount(operation.ceiling)); const actual = usdUnits(operation.billing?.actualCostUsd ?? operation.result?.actualCostUsd ?? '0');
      total += actual > ceiling ? actual : ceiling;
      if (operation.state === 'RESERVED') reservedSubmissions++; else paidSubmissions++;
      if (operation.state === 'UNKNOWN') hasUnknown = true;
      if (actual > ceiling) hasCeilingBreach = true;
      const event = this.repository.getCostEvent(operation.costEventId);
      if (event && event.pipelineRunId === operation.request.pipelineRunId && event.origin === operation.request.provider
        && event.currency === 'USD' && actual > 0n && usdUnits(event.amount) === actual) accountedCostIds.add(event.costEventId);
    }
    const runs = this.db.prepare('SELECT pipeline_run_id FROM affiliate_run_bindings WHERE campaign_id = ?').all(campaignId);
    for (const run of runs) {
      for (const cost of this.repository.listCostEventsByPipelineRun(run.pipeline_run_id)) {
        if (accountedCostIds.has(cost.costEventId)) continue;
        if (cost.currency !== 'USD') fail('VIDEO_GENERATION_COST_CURRENCY_UNSUPPORTED', 'currency');
        total += usdUnits(cost.amount);
      }
    }
    return immutable({ campaignId, totalUsd: policy.totalUsd, committedUsd: usdAmount(total), reservedSubmissions, paidSubmissions, hasUnknown, hasCeilingBreach });
  }
  #transaction(operation) {
    try { this.db.exec('BEGIN IMMEDIATE'); const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
}
