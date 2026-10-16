import { historicalResidualPersistence } from './historical-residual-persistence.js';
import { historicalResidualContracts } from './historical-residual-contracts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { CostLedgerRepository } = historicalResidualPersistence(
  'cost-ledger-repository',
);
const { BudgetGate } = historicalResidualPersistence('budget-gate');
const { AffiliateRepository } = historicalResidualPersistence(
  'affiliate-repository',
);
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const { adaptationHash } = historicalResidualContracts(
  'video-adaptation-contracts',
);
const { videoRequestHash } = historicalResidualContracts(
  'video-generation-contracts',
);
export const time = '2026-10-13T12:00:00Z';
export const proof = (id = 'a', amount = '0.6') => ({
  operationId: id,
  requestHash: id.repeat(64).slice(0, 64),
  provider: 'openai',
  kind: 'ENFORCED_MAXIMUM',
  includesAllCharges: true,
  currency: 'USD',
  maximumAmount: amount,
  evidenceReference: 'mock:enforced',
  expiresAt: '2027-12-31T00:00:00Z',
});
export function financeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'finance-ts-'));
  const path = join(dir, 'test.sqlite');
  const legacy = new CostLedgerRepository(path);
  const gate = new BudgetGate(legacy);
  gate.configureGlobal();
  return {
    path,
    legacy,
    gate,
    close() {
      legacy.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function campaignFinanceFixture(configureBudgets = true) {
  const f = financeFixture();
  const { legacy: r, gate: g } = f;
  r.create(fixtures.project());
  const affiliate = new AffiliateRepository(r);
  affiliate.registerProduct(fixtures.product(), 'prod_create');
  for (let i = 1; i <= 2; i++) {
    affiliate.registerCampaign(
      fixtures.campaign({ campaignId: 'camp_00' + i }),
      'camp_create_' + i,
    );
    affiliate.createBriefing(
      {
        briefingId: 'brief_00' + i,
        campaignId: 'camp_00' + i,
        campaignRevision: 1,
      },
      'brief_create_' + i,
    );
    fixtures.startRun(r, 'run_00' + i);
    affiliate.bindRun(
      { pipelineRunId: 'run_00' + i, briefingId: 'brief_00' + i },
      'bind_run_' + i,
    );
    if (configureBudgets) g.configureCampaign('camp_00' + i, 1);
  }
  g.initializeTts();
  return { ...f, affiliate };
}
export function cost(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'cost-event/1.0.0',
    costEventId: 'cost_001',
    category: 'ai_cost',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    contentIdentity: null,
    artifactId: null,
    amount: '0.04',
    currency: 'USD',
    occurredAt: time,
    origin: 'manual_invoice',
    attributionRuleVersion: 'direct-run/1.0.0',
    recordedAt: time,
    ...overrides,
  };
}
export function video(
  f: ReturnType<typeof campaignFinanceFixture>,
  i: number,
  state = 'COMPLETED',
  actual: string | null = '0.12',
  kind = 'ENFORCED_MAXIMUM',
) {
  const request = {
    schemaVersion: 'video-generation-request/2.0.0',
    generationRequestId: 'video_00' + i,
    campaignId: 'camp_00' + i,
    pipelineRunId: 'run_00' + i,
    originalSlot: 1,
    provider: 'fake_video',
    purpose: 'ORIGINAL',
    outputAspectRatio: '9:16',
    prompt: 'Local fixture',
    image: { mediaRef: 'authorized-image-001', contentHash: 'a'.repeat(64) },
    endpoint: 'fake/video',
    configuration: {
      resolution: { width: 720, height: 1280 },
      frames: 121,
      fps: 24,
      audio: false,
      multiscale: false,
      parameters: {},
    },
  };
  const hash = videoRequestHash(request);
  const ceiling =
    kind === 'ENFORCED_MAXIMUM'
      ? {
          kind,
          currency: 'USD',
          provider: 'fake_video',
          requestHash: hash,
          maximumAmount: i === 1 ? '0.15' : '0.2',
          includesAllCharges: true,
          evidenceReference: 'fixture/local',
          expiresAt: '2099-01-01T00:00:00Z',
        }
      : {
          kind,
          currency: 'USD',
          provider: 'fake_video',
          requestHash: hash,
          estimatedAmount: '0.1',
          reservationAmount: '0.15',
          evidenceReference: 'https://fal.ai/models/fixture',
          expiresAt: '2099-01-01T00:00:00Z',
        };
  if (kind === 'OFFICIAL_ESTIMATE')
    f.gate.approveEstimate(request, ceiling, {
      approvedAt: time,
      approvedBy: 'human',
      approvalReference: 'fixture:approval',
      acceptsUnboundedCost: true,
    });
  f.gate.reserve(request, ceiling, 'fixture', time);
  if (state === 'CANCELLED')
    f.gate.cancelReserved(request.generationRequestId, 'fixture');
  else if (state !== 'RESERVED') {
    f.gate.dispatch(request.generationRequestId, 'fixture', time);
    f.gate.observe(request.generationRequestId, {
      generationRequestId: request.generationRequestId,
      requestHash: hash,
      provider: 'fake_video',
      state,
      providerRequestId: 'provider_00' + i,
      videoReference: state === 'COMPLETED' ? 'object:fixture/video' : null,
      actualCostUsd: actual,
    });
  }
  return request;
}
export function tts(
  f: ReturnType<typeof campaignFinanceFixture>,
  i: number,
  state = 'COMPLETED',
  actual: string | null = null,
) {
  const id = 'tts_00' + i,
    request = {
      schemaVersion: 'tts-operation/1.0.0',
      operationId: id,
      campaignId: 'camp_00' + i,
      operation: { pipelineRunId: 'run_00' + i },
      reservationUsd: i === 1 ? '0.01' : '0.02',
      estimatedUsd: '0.00306',
    };
  const hash = adaptationHash(request);
  f.legacy.db
    .prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)')
    .run(id, hash, JSON.stringify(request), '{}');
  f.legacy.db
    .prepare('INSERT INTO tts_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      hash,
      hash,
      request.campaignId,
      JSON.stringify(request),
      state,
      time,
      null,
      actual === null
        ? null
        : JSON.stringify({
            actualCostUsd: actual,
            evidenceReference: 'fixture:bill',
          }),
      null,
      null,
      null,
    );
  return request;
}
export function telemetry(
  f: ReturnType<typeof financeFixture>,
  id: string,
  inputHash: string,
  amount: string,
  occurredAt = time,
) {
  f.legacy.db
    .prepare(
      "INSERT INTO ai_call_telemetry (ai_call_id,logical_call_id,schema_version,identity_hash,request_hash,pipeline_run_id,project_id,project_version,cost_event_id,provider,model,task_type,prompt_version,cost_amount,currency,cost_origin,occurred_at,input_hash,outcome,failure_code,recorded_at) VALUES(?,?,'ai-call-telemetry/1.0.0',?,?,'run_001','project_001',1,?,'openai','fake','script_generation','fixture/1.0.0',?,'USD','PROVIDER',?,?,'FAILURE','FIXTURE',?)",
    )
    .run(
      'call_' + id,
      'logical_' + id,
      'a'.repeat(64),
      'a'.repeat(64),
      id,
      amount,
      occurredAt,
      inputHash,
      time,
    );
}
