import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { FinanceService } from './application/finance.service.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { singleSubmissionQueue } from '../media/infrastructure/controlled-fal.js';
import {
  validateFirstFalRisk,
  firstFalRiskProof,
} from './domain/first-fal-risk.js';

export const riskFixture = () => ({
  schemaVersion: 'fal-first-live-risk/1.0.0',
  operationId: 'p77_first_live_i2v',
  model: {
    endpoint: 'minimax/h3-max-turbo/image-to-video',
    duration: 5,
    resolution: '768P',
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
  },
  mediaRef: 'D:\\04-Projetos\\23-MKTauto\\assets\\references\\test_00\\00.webp',
  imageHash: '131f508980e02439741f65415247ccbe6231a12b1116bb8f2d487c561a5d0719',
  requestHash: 'a'.repeat(64),
  preparationHash: 'b'.repeat(64),
  authorizedIdentity: 'individual',
  referenceBudgetUsd: '0.50',
  nominalUsd: '0.13',
  maximumCostGuaranteed: false,
  residualOverrunAccepted: true,
  maxSubmissions: 1,
  retries: 0,
  paidFallback: false,
  publicationAllowed: false,
  expiresAt: '2027-01-01T00:00:00Z',
});

describe('first fal exceptional financial authorization', () => {
  it('binds explicit risk to one identity, image, model and request without claiming a maximum', () => {
    const risk = riskFixture();
    expect(validateFirstFalRisk(risk, '2026-10-17T00:00:00Z')).toEqual(risk);
    for (const change of [
      { operationId: 'other' },
      { imageHash: 'c'.repeat(64) },
      { model: { ...risk.model, duration: 6 } },
      { referenceBudgetUsd: '1' },
      { residualOverrunAccepted: false },
      { maximumCostGuaranteed: true },
      { maxSubmissions: 2 },
      { retries: 1 },
      { paidFallback: true },
      { publicationAllowed: true },
      { authorizedIdentity: '' },
      { requestHash: null },
      { expiresAt: '2026-10-16T00:00:00Z' },
    ])
      expect(() =>
        validateFirstFalRisk({ ...risk, ...change }, '2026-10-17T00:00:00Z'),
      ).toThrow();
    expect(() =>
      firstFalRiskProof(
        risk,
        'spoofed',
        'c'.repeat(64),
        'Explicit acceptance',
        '2026-10-17T00:00:00Z',
      ),
    ).toThrow();
  });

  it.each(['success', 'timeout'] as const)(
    'persists risk and prevents repeat dispatch after %s, without changing policy',
    async (outcome) => {
      const dir = mkdtempSync(join(tmpdir(), 'first-fal-risk-'));
      const file = join(dir, 'test.sqlite');
      const db = new DatabaseSync(file);
      provisionSchema(db);
      db.close();
      const service = () =>
        new FinanceService({ open: () => new FinanceSession(file) });
      const now = '2026-10-17T00:00:00Z';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      const proof = firstFalRiskProof(
        riskFixture(),
        'individual',
        'c'.repeat(64),
        'Explicit financial risk acceptance',
        now,
      );
      const submit = vi.fn(async () => {
        if (outcome === 'timeout') throw new Error('uncertain');
        return { requestId: 'mock-only' };
      });
      try {
        service().configureGlobal({ dailyUsd: '0.50', monthlyUsd: '0.50' });
        expect(() => service().reserveGlobal(proof, now)).toThrow();
        const options = { authorizationMode: 'FIRST_FAL_RISK_ACCEPTED' };
        for (const change of [
          { actor: 'other' },
          { reservationAmount: '0.13' },
          { maximumCostGuaranteed: true },
          { maximumAmount: '0.50' },
          { riskHash: 'd'.repeat(64) },
        ])
          expect(() =>
            service().reserveGlobal({ ...proof, ...change }, now, options),
          ).toThrow();
        const queue = () =>
          singleSubmissionQueue(
            { submit, status: vi.fn(), result: vi.fn(), download: vi.fn() },
            service(),
            proof,
          );
        await Promise.allSettled([queue().submit({}), queue().submit({})]);
        expect(submit).toHaveBeenCalledTimes(1);
        await expect(queue().submit({})).rejects.toThrow();
        const stored = service().getGlobalOperation('p77_first_live_i2v')!;
        expect(JSON.parse(stored.proof_json)).toMatchObject({
          kind: 'FIRST_FAL_RISK_ACCEPTED',
          maximumCostGuaranteed: false,
          actor: 'individual',
          riskHash: affiliateHash(riskFixture()),
          reservationAmount: '0.50',
        });
        expect(stored.actual_usd).toBeNull();
        expect(service().getGlobalUsage(now).dailyUsd).toBe('0.5');
        expect(() =>
          service().reserveGlobal(
            { ...proof, operationId: 'other' },
            now,
            options,
          ),
        ).toThrow();
        if (outcome === 'success') {
          service().settleGlobal('p77_first_live_i2v', {
            actualCostUsd: '0.60',
            evidenceReference: 'mock:billing',
          });
          expect(
            service().getGlobalOperation('p77_first_live_i2v')?.actual_usd,
          ).toBe('0.6');
          expect(() => service().getGlobalUsage(now)).toThrow(
            'GLOBAL_PRICE_CEILING_BREACHED',
          );
        }
      } finally {
        vi.useRealTimers();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
