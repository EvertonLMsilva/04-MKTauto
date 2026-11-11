import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CostLedgerRepository } from './infrastructure/cost-ledger.repository.js';
import { FalGenerationRepository } from './infrastructure/fal-generation.repository.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { firstFalRiskProof } from './domain/first-fal-risk.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
const riskFixture = () => ({
  schemaVersion: 'fal-first-live-risk/1.0.0',
  operationId: 'p77_first_live_i2v',
  model: {
    endpoint: 'minimax/h3-max-turbo/image-to-video',
    duration: 5,
    resolution: '768P',
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
  },
  mediaRef: 'fixture:authorized-image',
  imageHash: '131f508980e02439741f65415247ccbe6231a12b1116bb8f2d487c561a5d0719',
  requestHash: 'b'.repeat(64),
  preparationHash: 'c'.repeat(64),
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

test.each([
  'settled',
  'partial',
  'unknown',
  'wrong-request',
  'wrong-image',
  'wrong-amount',
])(
  'first fal global commitment uses final billing only with exact evidence: %s',
  (scenario) => {
    const f = p2EditorialFixture();
    const at = '2026-10-17T00:00:00Z';
    const db = new DatabaseSync(f.database);
    provisionSchema(db);
    db.close();
    new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    ).bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_001' },
      'bind_settlement_test',
    );
    const ledger = new CostLedgerRepository(f.database);
    const jobs = new FalGenerationRepository(ledger);
    const finance = new FinanceSession(f.database);
    try {
      const risk = riskFixture();
      const proof = {
        ...firstFalRiskProof(
          risk,
          'individual',
          'c'.repeat(64),
          'Explicit financial risk acceptance',
          at,
        ),
        pipelineRunId: 'run_001',
      };
      finance.configureGlobal({ dailyUsd: '0.5', monthlyUsd: '0.5' });
      finance.configureCampaign('camp_001', 1);
      finance.reserveGlobal(proof, at, {
        authorizationMode: 'FIRST_FAL_RISK_ACCEPTED',
      });
      finance.dispatchGlobal(proof.operationId, at);
      const job = jobs.reserve({
        basis: {
          pipelineRunId: 'run_001',
          imageHash:
            scenario === 'wrong-image' ? 'd'.repeat(64) : risk.imageHash,
          endpoint: risk.model.endpoint,
        },
        request: {
          mediaAcquisitionRequestId: 'acq_001',
          contentHash:
            scenario === 'wrong-request' ? 'd'.repeat(64) : risk.requestHash,
        },
        budget: { amount: '1', currency: 'USD' },
        estimate: { amount: '0.13', currency: 'USD', source: 'fixture/1.0.0' },
      });
      jobs.submitted(job.key, 'request_fixture');
      jobs.state(job.key, 'COMPLETED');
      const observation = {
        amount: '0.13',
        currency: 'USD',
        source: 'fal_ai',
        occurredAt: at,
      };
      jobs.recordObservedCost(job.key, observation);
      if (scenario !== 'unknown')
        finance.settleGlobal(proof.operationId, {
          actualCostUsd: scenario === 'wrong-amount' ? '0.14' : '0.13',
          evidenceReference: 'fixture:billing',
        });
      expect(finance.getGlobalUsage(at).dailyUsd).toBe('0.63');
      if (scenario !== 'partial')
        jobs.recordObservedCost(job.key, { ...observation, final: true });
      const before = ledger.db
        .prepare('SELECT * FROM global_paid_operations')
        .all();
      const costs = ledger.listCostEventsByPipelineRun('run_001');
      for (let i = 0; i < 2; i++) {
        const usage = finance.getGlobalUsage(at);
        expect(usage.dailyUsd).toBe(scenario === 'settled' ? '0.13' : '0.63');
        expect(usage.monthlyUsd).toBe(scenario === 'settled' ? '0.13' : '0.63');
        expect(usage.policy.daily_usd).toBe('0.5');
        expect(finance.getUsage('camp_001').committedUsd).toBe(
          scenario === 'settled' ? '0.13' : '0.63',
        );
      }
      expect(
        ledger.db.prepare('SELECT * FROM global_paid_operations').all(),
      ).toEqual(before);
      expect(ledger.listCostEventsByPipelineRun('run_001')).toEqual(costs);
      expect(jobs.get(job.key)?.financiallySettled).toBe(
        scenario !== 'partial',
      );
    } finally {
      finance.close();
      ledger.close();
      f.cleanup();
    }
  },
);
