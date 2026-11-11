import {
  controlledFakeInput,
  controlledFakeRecurrenceInput,
  registerFakeCampaignInput,
} from './fake-campaign-command.contract.js';
import { campaign } from '../../test/support/affiliate-fixture.js';

test('recurrence requires a separate confirmed command with explicit time and zone', () => {
  const base = localImageCommand();
  const value = {
    ...base,
    request: {
      ...base.request,
      recurrence: {
        enabled: true,
        time: '09:00',
        timeZone: 'America/Sao_Paulo',
      },
    },
  };
  expect(controlledFakeRecurrenceInput(value)).toEqual(value.request);
  expect(() => controlledFakeInput(value)).toThrow();
  for (const patch of [
    { confirmation: false },
    { mode: 'LIVE' },
    { request: { ...value.request, recurrence: { enabled: true } } },
    {
      request: {
        ...value.request,
        recurrence: { ...value.request.recurrence, extra: true },
      },
    },
  ])
    expect(() =>
      controlledFakeRecurrenceInput({ ...value, ...patch }),
    ).toThrow();
});

export function localImageCommand() {
  const mediaReference = 'authorized-image-001',
    contentHash = 'a'.repeat(64);
  return {
    mode: 'FAKE',
    confirmation: true,
    request: {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'controlled_command_001',
      requestedAt: '2026-11-10T12:00:00.000Z',
      localImage: {
        mediaReference,
        contentHash,
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [
            {
              id: 'ev_controlled',
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'fixture:owned-local-image',
              recordedAt: '2026-11-10T12:00:00Z',
              mediaAuthorization: {
                mediaRef: mediaReference,
                contentHash,
                commercialUse: 'GRANTED',
                processing: 'GRANTED',
                localProcessing: true,
                externalProviders: [],
              },
            },
          ],
        },
      },
    },
  };
}
test('reuses official campaign validation and returns only its idempotency envelope', () => {
  const document = campaign();
  expect(
    registerFakeCampaignInput({
      mode: 'FAKE',
      confirmation: true,
      idempotencyKey: 'register_test',
      campaign: document,
    }),
  ).toEqual({ idempotencyKey: 'register_test', campaign: document });
});
test.each([
  null,
  {},
  { mode: 'LIVE', confirmation: true },
  { mode: 'FAKE', confirmation: false },
  { ...localImageCommand(), unexpected: true },
])('rejects invalid command envelope or confirmation: %j', (value) => {
  expect(() => controlledFakeInput(value)).toThrow();
});
test('accepts only explicit authorized local images without a browser-supplied policy or account', () => {
  const command = localImageCommand();
  expect(controlledFakeInput(command)).toEqual(command.request);
  for (const extra of [
    { fakeExecutionPolicy: {} },
    { publication: {} },
    { accountId: 'real_account' },
    { recurrence: { enabled: true } },
    { mode: 'PRODUCTION' },
    { requestId: '../invalid' },
    { campaignRevision: 0 },
  ])
    expect(() =>
      controlledFakeInput({
        ...command,
        request: { ...command.request, ...extra },
      }),
    ).toThrow();
});
test.each([
  { provider: 'openai' },
  { origin: 'PROVIDER_GENERATED' },
  { origin: 'USER_PROVIDED' },
  { contentHash: '../invalid' },
  { rights: { commercialUseAllowed: true, evidence: [] } },
  { rights: { commercialUseAllowed: false } },
  {
    rights: { usageBasis: 'UNKNOWN', commercialUseAllowed: true, evidence: [] },
  },
])('rejects unproven or external media: %j', (patch) => {
  const command = localImageCommand();
  expect(() =>
    controlledFakeInput({
      ...command,
      request: {
        ...command.request,
        localImage: { ...command.request.localImage, ...patch },
      },
    }),
  ).toThrow();
});
