import { OperationalNotificationRepository } from './infrastructure/operational-notification.repository.js';
import { OperationalAlertsService } from './application/operational-alerts.service.js';
import { CONTROLLED_FAKE_RUN_PREFIX } from '../content-operations/domain/fake-execution-policy.js';

test('controlled runs never become Telegram/Discord candidates; legacy facts remain available', async () => {
  const controlled = {
    executionId: 'controlled_test',
    runId: `${CONTROLLED_FAKE_RUN_PREFIX}test`,
  };
  const legacy = { executionId: 'legacy_test', runId: 'run_legacy_test' };
  const packages = vi.fn(() => []);
  const repository = new OperationalNotificationRepository(
    { facts: () => [controlled, legacy] } as never,
    { packages } as never,
  );
  expect(repository.facts()).toEqual([{ execution: legacy, packages: [] }]);
  expect(packages).toHaveBeenCalledExactlyOnceWith(legacy.runId);
});
test('the real alert dispatcher cannot send for a controlled run, including after a worker restart', async () => {
  const send = vi.fn(async (): Promise<never> => {
    throw new Error('EXTERNAL_NOTIFICATION_FORBIDDEN');
  });
  const controlled = {
    executionId: 'controlled_test',
    runId: `${CONTROLLED_FAKE_RUN_PREFIX}test`,
    campaignId: 'controlled_test',
    day: '2026-11-10',
    productName: 'Synthetic test',
    status: 'FAILED',
    pause: { cursor: 1, sequence: 1, code: 'TEST_FAILURE', step: 'CONTEXT' },
    approvalCursor: 0,
    stage: { previewReady: false, handedOff: false },
  };
  const campaigns = {
    facts: () => [controlled],
    checkpoint: () => 0,
    notificationBaseline: (_: unknown, init: () => unknown) => init(),
    recoverNotifications: vi.fn(),
    hasNotificationAttempt: () => false,
    claimNotification: () => true,
    finishNotification: vi.fn(),
    close: vi.fn(),
  };
  const publishing = {
    packages: vi.fn(() => []),
    checkpoint: () => ({ social: 0, manual: 0 }),
  };
  const open = () =>
    new OperationalNotificationRepository(
      campaigns as never,
      publishing as never,
    );
  for (let restart = 0; restart < 2; restart++) {
    const service = new OperationalAlertsService(open, [
      { enabled: true, destinationId: 'telegram:fixture', send },
      { enabled: true, destinationId: 'discord:fixture', send },
    ]);
    service.onModuleInit();
    await service.scan();
    await service.onModuleDestroy();
  }
  expect(send).not.toHaveBeenCalled();
  expect(publishing.packages).not.toHaveBeenCalled();
  // The same dispatcher still delivers a legacy failure. This rules out a
  // broken test port or blanket notification shutdown as the explanation.
  const legacySend = vi.fn(async () => ({
    status: 'DELIVERED' as const,
    messageId: 'fixture_receipt',
  }));
  const legacyOpen = () =>
    new OperationalNotificationRepository(
      {
        ...campaigns,
        facts: () => [
          {
            ...controlled,
            executionId: 'legacy_test',
            runId: 'run_legacy_test',
          },
        ],
      } as never,
      publishing as never,
    );
  const legacy = new OperationalAlertsService(legacyOpen, {
    enabled: true,
    destinationId: 'telegram:fixture',
    send: legacySend,
  });
  legacy.onModuleInit();
  await legacy.scan();
  await legacy.onModuleDestroy();
  expect(legacySend).toHaveBeenCalledTimes(1);
});
