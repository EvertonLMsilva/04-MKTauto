import { DatabaseSync } from 'node:sqlite';
import {
  NativeCampaignWorkflow,
  campaignRequest,
} from './application/native-campaign-workflow.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  executionRequest,
} from './application/campaign-orchestrator.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { createFakeExecutionPolicy } from './domain/fake-execution-policy.js';

const at = '2026-11-10T12:00:00.000Z';
function controlledRequest() {
  const r = {
    campaignId: 'camp_test',
    campaignRevision: 1,
    scheduledAt: at,
    runId: 'run_controlled_fake_v1_test',
    briefingId: 'brief_test',
    generationRequestId: 'editorial_test',
    researchShortlistId: null,
    mode: 'LOCAL_VALIDATION',
    videoProduction: { mode: 'LOCAL_IMAGES' },
    localImage: { contentHash: 'a'.repeat(64) },
  };
  return {
    ...r,
    fakeExecutionPolicy: createFakeExecutionPolicy(
      r,
      'command_test',
      'operator_test',
    ),
  };
}
function runtime(provider = new FakeEditorialProvider(), mode = 'fake') {
  const forbidden = vi.fn((): never => {
    throw new Error('EXTERNAL_OR_SOCIAL_EFFECT_FORBIDDEN');
  });
  const flow = new NativeCampaignWorkflow(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    provider,
    {} as never,
    new LocalFlowService({} as never),
    {} as never,
    {} as never,
    {} as never,
    { coordinatePackage: forbidden } as never,
    {
      configuration: vi.fn(() => ({ mode })),
      execute: forbidden,
      reconcile: forbidden,
      status: forbidden,
    } as never,
  );
  return { flow, forbidden };
}
function persisted() {
  const db = new DatabaseSync(':memory:');
  provisionSchema(db, 44);
  db.exec('PRAGMA foreign_keys=OFF');
  const repository = new CampaignRepository(db),
    r = controlledRequest();
  const e = repository.schedule(
    {
      campaignId: r.campaignId,
      campaignRevision: r.campaignRevision,
      runId: r.runId,
      scheduledAt: r.scheduledAt,
    },
    r,
    at,
  );
  return { db, repository, r, e };
}
test('the official request validator accepts and verifies the policy, and rejects changed bindings', () => {
  const r = controlledRequest();
  expect(campaignRequest(r)).toEqual(r);
  expect(() => campaignRequest({ ...r, publication: {} })).toThrow();
  expect(() =>
    campaignRequest({ ...r, fakeExecutionPolicy: undefined }),
  ).toThrow();
});
test('official immutable event persistence replays once, survives a new repository and refuses policy mutation', () => {
  const { db, repository, r, e } = persisted();
  try {
    expect(
      repository.schedule(
        {
          campaignId: r.campaignId,
          campaignRevision: 1,
          runId: r.runId,
          scheduledAt: at,
        },
        r,
        at,
      ).execution_id,
    ).toBe(e.execution_id);
    const reopened = new CampaignRepository(db);
    expect(
      executionRequest(reopened.history(e.execution_id)).fakeExecutionPolicy,
    ).toEqual(r.fakeExecutionPolicy);
    expect(() =>
      db
        .prepare(
          'UPDATE campaign_execution_events SET evidence_json=? WHERE execution_id=?',
        )
        .run('{}', e.execution_id),
    ).toThrow('IMMUTABLE_CAMPAIGN_EVENT');
    expect(() =>
      db
        .prepare('DELETE FROM campaign_execution_events WHERE execution_id=?')
        .run(e.execution_id),
    ).toThrow('IMMUTABLE_CAMPAIGN_EVENT');
    expect(
      db.prepare('SELECT count(*) n FROM campaign_executions').get()!.n,
    ).toBe(1);
  } finally {
    db.close();
  }
});
test('after persistence, fake-to-live configuration changes never invoke publication or live reconciliation', async () => {
  const { db, repository, e } = persisted();
  try {
    for (const mode of ['fake', 'live']) {
      vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', mode);
      const { flow, forbidden } = runtime(
        undefined,
        process.env.INSTAGRAM_PUBLICATION_MODE,
      );
      const r = executionRequest(repository.history(e.execution_id));
      expect(
        await flow.execute('PUBLICATION', e, r, { OPERATOR_FLOW: true }),
      ).toMatchObject({ publication: 'DISABLED_BY_FAKE_POLICY' });
      const history = [
        ...repository.history(e.execution_id),
        {
          sequence: 2,
          event_type: 'STEP_STARTED',
          previous_status: 'RUNNING',
          next_status: 'RUNNING',
          occurred_at: at,
          evidence: { step: 'PUBLICATION' },
        },
      ] as never;
      expect(await flow.reconcile(e, history)).toMatchObject({
        verified: true,
        step: 'PUBLICATION',
        result: { publication: 'DISABLED_BY_FAKE_POLICY' },
      });
      expect(forbidden).not.toHaveBeenCalled();
    }
  } finally {
    db.close();
    vi.unstubAllEnvs();
  }
});
test('paid or unknown editorial providers fail before any stage effect, including recovery', async () => {
  const { db, repository, e } = persisted();
  try {
    const provider = new FakeEditorialProvider();
    provider.mode = 'PAID';
    const { flow, forbidden } = runtime(provider);
    await expect(
      flow.execute('CONTEXT', e, controlledRequest(), {}),
    ).rejects.toThrow('FAKE_EXECUTION_PROVIDER_FORBIDDEN');
    await expect(
      flow.reconcile(e, repository.history(e.execution_id)),
    ).rejects.toThrow('FAKE_EXECUTION_PROVIDER_FORBIDDEN');
    await expect(
      flow.readyToResume(e, repository.history(e.execution_id)),
    ).rejects.toThrow('FAKE_EXECUTION_PROVIDER_FORBIDDEN');
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test('missing policy in the controlled namespace fails explicitly and is audited by the official orchestrator', async () => {
  const { db, repository, e, r } = persisted();
  try {
    const { flow, forbidden } = runtime();
    const { fakeExecutionPolicy: _policy, ...missing } = r;
    await expect(flow.execute('PUBLICATION', e, missing, {})).rejects.toThrow(
      'FAKE_EXECUTION_POLICY_REQUIRED',
    );
    const wrong = {
      ...r,
      fakeExecutionPolicy: { ...r.fakeExecutionPolicy, mode: 'LIVE' },
    };
    const broken = repository.schedule(
      {
        campaignId: 'camp_bad',
        campaignRevision: 1,
        runId: 'run_bad',
        scheduledAt: at,
      },
      { ...wrong, campaignId: 'camp_bad', runId: 'run_bad' },
      at,
    );
    await new CampaignOrchestrator(repository, flow, () => at).tick(
      broken.execution_id,
    );
    expect(repository.get(broken.execution_id).status).toBe('FAILED');
    expect(
      repository
        .history(broken.execution_id)
        .some(
          (event) => event.evidence.code === 'FAKE_EXECUTION_POLICY_INVALID',
        ),
    ).toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test('a legacy request without policy keeps its existing manual handoff behavior', async () => {
  const { flow, forbidden } = runtime();
  expect(await flow.execute('PUBLICATION', {} as never, {}, {})).toEqual({
    publication: 'MANUAL_HANDOFF',
  });
  expect(forbidden).not.toHaveBeenCalled();
});
test('LOCAL metadata cannot disguise an unknown external editorial adapter', async () => {
  const attempted = vi.fn(async (): Promise<never> => {
    throw new Error('EXTERNAL_PROVIDER_FORBIDDEN');
  });
  const spoofed = {
    mode: 'LOCAL',
    configurationVersion: 'fake-editorial/1.0.0',
    ideas: attempted,
    script: attempted,
  };
  const { flow } = runtime(spoofed as unknown as FakeEditorialProvider);
  const { db, e } = persisted();
  try {
    await expect(
      flow.execute('EDITORIAL', e, controlledRequest(), {}),
    ).rejects.toThrow('FAKE_EXECUTION_PROVIDER_FORBIDDEN');
    expect(attempted).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test('a restarted official orchestrator reconciles an interrupted publication as disabled, even with a LIVE publisher', async () => {
  const { db, repository, e } = persisted();
  try {
    const claimed = repository.claim(e.execution_id, at, 1000)!;
    const { flow, forbidden } = runtime(undefined, 'live');
    for (const step of flow.steps.filter((step) => step !== 'PUBLICATION'))
      repository.ownedEvent(
        e.execution_id,
        claimed.claim_token!,
        at,
        'STEP_DONE',
        { step, result: {} },
      );
    repository.ownedEvent(
      e.execution_id,
      claimed.claim_token!,
      at,
      'STEP_STARTED',
      { step: 'PUBLICATION' },
    );
    repository.recover('2026-11-10T12:00:02.000Z');
    const restarted = new CampaignOrchestrator(
      new CampaignRepository(db),
      flow,
      () => '2026-11-10T12:00:03.000Z',
    );
    await restarted.resume(e.execution_id);
    await restarted.tick(e.execution_id);
    expect(repository.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(
      repository
        .history(e.execution_id)
        .find(
          (event) =>
            event.event_type === 'STEP_DONE' &&
            event.evidence.step === 'PUBLICATION',
        )?.evidence.result,
    ).toMatchObject({ publication: 'DISABLED_BY_FAKE_POLICY' });
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
