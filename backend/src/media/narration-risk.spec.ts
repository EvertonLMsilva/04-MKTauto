import {
  ttsRiskFixture,
  TTS_RISK_TIME as now,
} from '../../test/support/tts-risk-fixture.js';
import { NarrationService } from './application/narration.service.js';

describe('Narration TTS risk dispatch', () => {
  let f: ReturnType<typeof ttsRiskFixture>;
  beforeEach(() => {
    f = ttsRiskFixture();
  });
  afterEach(() => f?.close());
  it('does not call a transport without individual approval or when LIVE is disabled', async () => {
    const transport = {
      ready: () => true,
      synthesize: vi.fn(async () => ({ audio: f.audio })),
    };
    const media = new NarrationService(f.service(), transport);
    await expect(media.execute(f.plan, now)).rejects.toMatchObject({
      code: 'TTS_APPROVAL_REQUIRED',
    });
    f.service().approveTts(f.plan, f.approval);
    const disabled = new NarrationService(f.service(), {
      ...transport,
      ready: () => false,
    });
    await expect(disabled.execute(f.plan, now)).rejects.toMatchObject({
      code: 'TTS_LIVE_CONFIGURATION_REQUIRED',
    });
    expect(transport.synthesize).not.toHaveBeenCalled();
    expect(f.service().getTts(f.plan.operationId)).toBeNull();
  });
  it('persists audio but never treats the provider response as a billing receipt', async () => {
    const transport = {
      ready: () => true,
      synthesize: vi.fn(async () => ({
        audio: f.audio,
        providerRequestId: 'req_fixture',
      })),
    };
    const media = new NarrationService(f.service(), transport);
    media.approve({ plan: f.plan, approval: f.approval });
    const result = await media.execute(f.plan, now);
    expect(result?.state).toBe('UNKNOWN');
    expect(result?.errorCode).toBe('TTS_BILLING_EVIDENCE_REQUIRED');
    expect(result?.audio).toEqual(f.audio);
    expect(result?.billing).toBeNull();
    await expect(
      new NarrationService(f.service(), transport).execute(f.plan, now),
    ).rejects.toMatchObject({ code: 'TTS_RECONCILIATION_REQUIRED' });
    expect(transport.synthesize).toHaveBeenCalledTimes(1);
    expect(f.service().getLedgerByPipelineRun('run_001').events).toHaveLength(
      0,
    );
  });
  it('marks timeout uncertain, keeps reservation, and never retries after restart', async () => {
    const transport = {
      ready: () => true,
      synthesize: vi.fn(async () => {
        throw new Error('timeout');
      }),
    };
    const media = new NarrationService(f.service(), transport);
    media.approve({ plan: f.plan, approval: f.approval });
    await expect(media.execute(f.plan, now)).rejects.toMatchObject({
      code: 'TTS_RECONCILIATION_REQUIRED',
    });
    expect(media.get(f.plan.operationId)?.state).toBe('UNKNOWN');
    await expect(
      new NarrationService(f.service(), transport).execute(f.plan, now),
    ).rejects.toMatchObject({ code: 'TTS_RECONCILIATION_REQUIRED' });
    expect(transport.synthesize).toHaveBeenCalledTimes(1);
    expect(f.service().getGlobalUsage(now).dailyUsd).toBe('0.011');
  });
});
