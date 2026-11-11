import {
  createFakeExecutionPolicy,
  assertFakeExecutionPolicy,
} from './fake-execution-policy.js';
import { canonicalJson } from './campaign.js';

const request = () => ({
  campaignId: 'campaign_test',
  campaignRevision: 1,
  scheduledAt: '2026-11-10T12:00:00.000Z',
  runId: 'run_controlled_fake_v1_test',
  mode: 'LOCAL_VALIDATION',
  videoProduction: { mode: 'LOCAL_IMAGES' },
  localImage: { contentHash: 'a'.repeat(64) },
});

test('daily schedule is validated and hash-bound without upgrading the FAKE policy', () => {
  const r = {
    ...request(),
    schedule: { time: '09:00', timeZone: 'America/Sao_Paulo' },
  };
  const policy = createFakeExecutionPolicy(r, 'daily_command', 'operator_test');
  expect(
    assertFakeExecutionPolicy({ ...r, fakeExecutionPolicy: policy }),
  ).toEqual(policy);
  expect(() =>
    assertFakeExecutionPolicy({
      ...r,
      schedule: { ...r.schedule, time: '10:00' },
      fakeExecutionPolicy: policy,
    }),
  ).toThrow();
  expect(() =>
    createFakeExecutionPolicy(
      { ...r, schedule: { ...r.schedule, time: '99:00' } },
      'daily_command',
      'operator_test',
    ),
  ).toThrow();
  expect(policy).toMatchObject({ mode: 'FAKE', publication: 'DISABLED' });
});
test('policy is immutable, versioned and bound to the persisted request and logical execution identity', () => {
  const r = request(),
    policy = createFakeExecutionPolicy(r, 'command_test', 'operator_test');
  expect(Object.isFrozen(policy)).toBe(true);
  expect(policy.mode).toBe('FAKE');
  expect(policy.publication).toBe('DISABLED');
  expect(
    assertFakeExecutionPolicy(
      { ...r, fakeExecutionPolicy: policy },
      {
        campaign_id: r.campaignId,
        campaign_revision: 1,
        run_id: r.runId,
        scheduled_at: r.scheduledAt,
      },
    ),
  ).toEqual(policy);
  expect(canonicalJson(policy)).toBe(
    canonicalJson(
      createFakeExecutionPolicy(r, 'command_test', 'operator_test'),
    ),
  );
});
test.each(['mode', 'runId', 'campaignId', 'scheduledAt'])(
  'refuses changed request binding: %s',
  (field) => {
    const r = request(),
      policy = createFakeExecutionPolicy(r, 'command_test', 'operator_test');
    expect(() =>
      assertFakeExecutionPolicy({
        ...r,
        [field]: 'changed',
        fakeExecutionPolicy: policy,
      }),
    ).toThrow();
  },
);
test.each([
  null,
  {},
  { mode: 'LIVE' },
  { schemaVersion: 'campaign-fake-policy/2.0.0' },
])('refuses invalid policy without a legacy default', (policy) => {
  expect(() =>
    assertFakeExecutionPolicy({ ...request(), fakeExecutionPolicy: policy }),
  ).toThrow('FAKE_EXECUTION_POLICY_INVALID');
});
test('controlled namespace cannot lose its policy; unrelated legacy requests retain their behavior', () => {
  expect(() => assertFakeExecutionPolicy(request())).toThrow(
    'FAKE_EXECUTION_POLICY_REQUIRED',
  );
  expect(
    assertFakeExecutionPolicy({ ...request(), runId: 'run_legacy' }),
  ).toBeNull();
});
test('publication, paid production and input substitution cannot be smuggled into a controlled request', () => {
  const r = request(),
    policy = createFakeExecutionPolicy(r, 'command_test', 'operator_test');
  for (const patch of [
    { publication: {} },
    { videoProduction: { mode: 'OFFLINE' } },
    { voiceTrackId: 'voice_other' },
    { schedule: {} },
    { fakeExecutionPolicy: { ...policy, mode: 'LIVE' } },
  ]) {
    expect(() =>
      assertFakeExecutionPolicy({
        ...r,
        fakeExecutionPolicy: policy,
        ...patch,
      }),
    ).toThrow();
  }
});
