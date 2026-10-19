import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  completedContext,
  executionRequest,
} from './application/campaign-orchestrator.js';
test.each(['CANCELLED', 'SUCCEEDED'])(
  'only an audited composition revision can reopen %s',
  (status) => {
    const db = new DatabaseSync(':memory:');
    provisionSchema(db);
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      const r = new CampaignRepository(db),
        now = '2026-10-19T12:00:00Z';
      const e = r.schedule(
        {
          campaignId: 'campaign_001',
          campaignRevision: 1,
          runId: 'run_001',
          scheduledAt: now,
        },
        {},
        now,
      );
      if (status === 'CANCELLED') r.cancel(e.execution_id, now);
      else {
        const claimed = r.claim(e.execution_id, now, 60000)!;
        r.ownedEvent(
          e.execution_id,
          claimed.claim_token!,
          now,
          'COMPLETED',
          {},
          'SUCCEEDED',
        );
      }
      const closed = r.get(e.execution_id);
      expect(() =>
        db
          .prepare(
            "UPDATE campaign_executions SET status='WAITING_INPUT',version=version+1 WHERE execution_id=?",
          )
          .run(e.execution_id),
      ).toThrow('INVALID_CAMPAIGN_TRANSITION');
      expect(() =>
        r.reviseComposition(e.execution_id, closed.version, now, {
          policyVersion: 'unknown',
        }),
      ).toThrow();
      expect(r.get(e.execution_id).status).toBe(status);
      r.reviseComposition(e.execution_id, closed.version, now, {
        policyVersion: 'product-contain/1.0.0',
        previousRenderContentHash: 'a'.repeat(64),
        actorId: 'operator_001',
        reason: 'Preserve all of the original product image.',
      });
      expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(
        r
          .history(e.execution_id)
          .filter(
            (e) =>
              e.event_type ===
              (status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED'),
          ),
      ).toHaveLength(1);
      expect(() =>
        r.reviseComposition(e.execution_id, closed.version, now, {}),
      ).toThrow('EXECUTION_VERSION_CONFLICT');
    } finally {
      db.close();
    }
  },
);
test('reframing invalidates only rendered stages and approvals, retaining rights/audio/timing and history', () => {
  const preserved = [
    'EDITORIAL',
    'MEDIA_QC',
    'AUDIO',
    'ALIGNMENT',
    'SUBTITLES',
    'COMPOSITION_AUTHORIZATION',
  ];
  const records = preserved
    .filter((k) => k !== 'COMPOSITION_AUTHORIZATION')
    .map((step) => ({
      event_type: 'STEP_DONE',
      evidence: { step, result: { identity: step } },
    }));
  const auth = { scopeHash: 'a'.repeat(64) };
  const revision = { revision: 2, previousCompositionPlanId: 'plan_old' };
  const history = [
    { event_type: 'SCHEDULED', evidence: { composition: { old: true } } },
    ...records,
    { event_type: 'COMPOSITION_AUTHORIZED', evidence: auth },
    ...['COMPOSITION', 'BURN', 'QC', 'PREVIEW', 'HANDOFF'].map((step) => ({
      event_type: 'STEP_DONE',
      evidence: { step, result: { old: true } },
    })),
    { event_type: 'HUMAN_APPROVAL', evidence: { decision: 'APPROVED' } },
    { event_type: 'COMPOSITION_REVISED', evidence: revision },
  ] as any;
  const done = completedContext(history);
  for (const key of preserved) expect(done[key]).toBeTruthy();
  for (const key of [
    'COMPOSITION',
    'BURN',
    'QC',
    'PREVIEW',
    'APPROVAL',
    'HANDOFF',
  ])
    expect(done[key]).toBeUndefined();
  expect(done.COMPOSITION_REVISION).toEqual(revision);
  expect(executionRequest(history).composition).toBeUndefined();
  expect(history.some((e: any) => e.event_type === 'HUMAN_APPROVAL')).toBe(
    true,
  );
});
