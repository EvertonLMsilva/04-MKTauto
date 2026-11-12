import { Test } from '@nestjs/testing';
import { OperationsPreflightService } from './operations-preflight.service.js';
import type { CampaignEvent } from '../content-operations/domain/campaign.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import {
  localMediaReadiness,
  readinessCheck,
} from '../media/application/local-media-readiness.js';

export function mediaReady(
  status: 'READY' | 'NOT_READY' | 'UNKNOWN' = 'READY',
) {
  return localMediaReadiness(
    Object.fromEntries(
      ['piper', 'ctc', 'ffmpeg', 'ffprobe', 'storage'].map((k) => [
        k,
        readinessCheck(status),
      ]),
    ) as never,
  );
}
export const financeReady = () => ({
  schemaVersion: 'finance-readiness/1.0.0',
  status: 'READY',
  scope: 'TECHNICAL_ONLY',
  spendingAuthorized: false,
  operationalAcceptance: 'NOT_ASSESSED',
  timeZone: 'America/Sao_Paulo',
  daily: { limitUsd: '1', remainingUsd: '1' },
  monthly: { limitUsd: '20', remainingUsd: '20' },
  operations: [{ actualCostUsd: null, evidenceReference: 'PRIVATE_SECRET' }],
  reasons: [],
});
async function fixture(
  status = 'SCHEDULED',
  code: string | null = null,
  financeStatus = 'READY',
  mediaStatus: 'READY' | 'NOT_READY' | 'UNKNOWN' = 'READY',
) {
  const execution = {
    execution_id: 'exec_001',
    campaign_id: 'camp_001',
    campaign_revision: 1,
    status,
    claim_token: 'PRIVATE_SECRET',
    finalization: {
      step: 'HANDOFF',
      completedSteps: [],
      pending: code ? { code, message: 'PRIVATE_SECRET' } : null,
    },
  };
  const campaigns = {
    get: vi.fn(() => execution),
    history: vi.fn<() => CampaignEvent[]>(() => []),
  };
  const finance = {
    getGlobalReadiness: vi.fn(() => ({
      ...financeReady(),
      status: financeStatus,
    })),
  };
  const local = { readiness: vi.fn(() => mediaReady(mediaStatus)) };
  const module = await Test.createTestingModule({
    providers: [
      OperationsPreflightService,
      { provide: CampaignAdministration, useValue: campaigns },
      { provide: FinanceService, useValue: finance },
      { provide: LocalFlowService, useValue: local },
    ],
  }).compile();
  return {
    service: module.get(OperationsPreflightService),
    execution,
    campaigns,
    finance,
    local,
  };
}
test.each(['NOT_READY', 'UNKNOWN'] as const)(
  'preserves Media %s and static-only limits',
  async (status) => {
    const f = await fixture('SCHEDULED', null, 'READY', status);
    const r = await f.service.inspect('exec_001');
    expect(r.media.status).toBe(status);
    expect(r.media.scope).toBe('STATIC_ONLY');
    expect(r.status).toBe(status);
  },
);
test('Finance NOT_READY is consumed without recalculating or authorizing spend', async () => {
  const f = await fixture('SCHEDULED', null, 'NOT_READY');
  const r = await f.service.inspect('exec_001');
  expect(r.status).toBe('NOT_READY');
  expect(r.finance.spendingAuthorized).toBe(false);
  expect(r.finance.operationalAcceptance).toBe('NOT_ASSESSED');
  expect(r.finance.daily?.limitUsd).toBe('1');
  expect(f.finance.getGlobalReadiness).toHaveBeenCalledOnce();
});
test.each([
  'EXACT_HUMAN_APPROVAL_REQUIRED',
  'AUTHENTICATED_MEDIA_REVIEW_REQUIRED',
  'AUDIO_REQUIRED',
  'LOCAL_TTS_CONFIGURATION_REQUIRED',
])(
  'projects persisted gate %s without exposing private evidence',
  async (code) => {
    const f = await fixture('WAITING_INPUT', code);
    const r = await f.service.inspect('exec_001');
    expect(r.status).toBe('ACTION_REQUIRED');
    expect(r.pending).toContain(code);
    expect(JSON.stringify(r)).not.toContain('PRIVATE_SECRET');
    expect(r.cost).toEqual({ status: 'UNKNOWN', amount: null });
  },
);
test.each(['WAITING_RECONCILIATION', 'FAILED', 'CANCELLED'])(
  'preserves %s without promoting execution',
  async (status) => {
    const f = await fixture(status);
    const r = await f.service.inspect('exec_001');
    expect(r.state).toBe(status);
    expect(r.status).not.toBe('READY_TECHNICAL');
    expect(r.recoveryRequired).toBe(status === 'WAITING_RECONCILIATION');
  },
);
test('incomplete identity and unrecognized states remain UNKNOWN', async () => {
  const f = await fixture('UNRECOGNIZED');
  f.execution.campaign_id = '';
  expect((await f.service.inspect('exec_001')).status).toBe('UNKNOWN');
});
test('unavailable dependencies remain UNKNOWN without leaking errors', async () => {
  const f = await fixture();
  f.finance.getGlobalReadiness.mockImplementation(() => {
    throw new Error('PRIVATE_SECRET');
  });
  f.local.readiness.mockImplementation(() => {
    throw new Error('PRIVATE_SECRET');
  });
  const r = await f.service.inspect('exec_001');
  expect(r.finance.status).toBe('UNKNOWN');
  expect(r.media.status).toBe('UNKNOWN');
  expect(JSON.stringify(r)).not.toContain('PRIVATE_SECRET');
});
test('completed execution still exposes missing QC and approval rather than inventing evidence', async () => {
  const f = await fixture('SUCCEEDED');
  const r = await f.service.inspect('exec_001');
  expect(r.state).toBe('SUCCEEDED');
  expect(r.qc).toBe('PENDING');
  expect(r.approval).toBe('PENDING');
  expect(r.status).toBe('ACTION_REQUIRED');
});

test('READY_TECHNICAL is a projection of recorded checkpoints, never spending or physical acceptance', async () => {
  const f = await fixture('SUCCEEDED');
  f.campaigns.history.mockReturnValue([
    {
      previous_status: null,
      next_status: 'SUCCEEDED',
      occurred_at: '2026-11-11T12:00:00Z',
      sequence: 1,
      event_type: 'STEP_DONE',
      evidence: { step: 'QC', result: { result: 'PASS' } },
    },
    {
      previous_status: null,
      next_status: 'SUCCEEDED',
      occurred_at: '2026-11-11T12:00:00Z',
      sequence: 2,
      event_type: 'HUMAN_APPROVAL',
      evidence: { decision: 'APPROVED' },
    },
  ]);
  const r = await f.service.inspect('exec_001');
  expect(r.status).toBe('READY_TECHNICAL');
  expect(r.qc).toBe('PASS');
  expect(r.approval).toBe('RECORDED');
  expect(r.media.physicalValidation).toBe('NOT_PERFORMED');
  expect(r.finance.spendingAuthorized).toBe(false);
  expect(r.uncertainties).toContain('COST_UNAVAILABLE');
});
test('a persisted failing QC is NOT_READY', async () => {
  const f = await fixture();
  f.campaigns.history.mockReturnValue([
    {
      previous_status: null,
      next_status: 'SUCCEEDED',
      occurred_at: '2026-11-11T12:00:00Z',
      sequence: 1,
      event_type: 'STEP_DONE',
      evidence: { step: 'QC', result: { result: 'FAIL' } },
    },
  ]);
  expect((await f.service.inspect('exec_001')).qc).toBe('INVALID');
  expect((await f.service.inspect('exec_001')).status).toBe('NOT_READY');
});
