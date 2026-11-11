import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import {
  notificationText,
  publicPermalink,
} from './domain/operational-notification.js';
import {
  OperationalAlertsService,
  collectOperationalNotifications,
} from './application/operational-alerts.service.js';
import { openNotificationStore } from '../../../test/support/operational-notifications.fixture.js';
import {
  FakeOperationalNotificationAdapter,
  NullOperationalNotificationAdapter,
  TelegramOperationalNotificationAdapter,
  notificationAdapter,
} from './infrastructure/operational-notification.adapter.js';

const now = '2026-11-08T13:00:00.000Z';
function fixture(adapter = new FakeOperationalNotificationAdapter()) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const campaigns = new CampaignRepository(f.base.db);
  const open = () => openNotificationStore(f.database);
  const service = () => new OperationalAlertsService(open, adapter, () => now);
  let alerts = service();
  alerts.onModuleInit();
  const execution = (day = '2026-11-08', campaignId = 'camp_001') =>
    campaigns.schedule(
      {
        campaignId,
        campaignRevision: 1,
        runId: `alert_${day.replaceAll('-', '')}_${campaignId}`,
        scheduledAt: `${day}T13:00:00.000Z`,
      },
      {
        briefingId: 'brief_001',
        campaignId,
        campaignRevision: 1,
        generationRequestId: 'alert_editorial',
      },
      now,
    );
  function pause(
    id: string,
    code = 'EXACT_HUMAN_APPROVAL_REQUIRED',
    status:
      'WAITING_INPUT' | 'FAILED' | 'WAITING_RECONCILIATION' = 'WAITING_INPUT',
  ) {
    const e = campaigns.claim(id, '2026-11-10T13:00:00.000Z', 60000)!;
    for (const [step, result] of [
      ['BURN', { videoRenderId: 'render_alert', contentHash: 'a'.repeat(64) }],
      ['QC', { reportId: 'qc_alert' }],
      ['PREVIEW', { ready: true }],
    ])
      campaigns.ownedEvent(id, e.claim_token!, now, 'STEP_DONE', {
        step,
        result,
      });
    campaigns.ownedEvent(
      id,
      e.claim_token!,
      now,
      'PAUSED',
      { step: code.startsWith('SOCIAL_') ? 'PUBLICATION' : 'HANDOFF', code },
      status,
    );
  }
  return {
    f,
    campaigns,
    adapter,
    open,
    execution,
    pause,
    get alerts() {
      return alerts;
    },
    restart() {
      alerts = service();
      alerts.onModuleInit();
    },
    async close() {
      await alerts.onModuleDestroy();
      f.cleanup();
    },
  };
}

test('render wait delivers once; polling, replay and restart preserve campaign state and never duplicate', async () => {
  const f = fixture();
  try {
    const e = f.execution();
    f.pause(e.execution_id);
    const before = f.campaigns.get(e.execution_id);
    await f.alerts.scan();
    await f.alerts.scan();
    f.restart();
    await f.alerts.scan();
    expect(f.adapter.messages).toHaveLength(1);
    expect(f.adapter.messages[0].kind).toBe('RENDER_READY_FOR_REVIEW');
    expect(f.adapter.messages[0].text).toContain('Fone de exemplo');
    expect(f.adapter.messages[0].text).toContain('2026-11-08');
    expect(f.campaigns.get(e.execution_id)).toEqual(before);
    expect(
      f.campaigns
        .history(e.execution_id)
        .filter((h) => h.event_type === 'OPERATIONAL_NOTIFICATION_DELIVERED'),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test.each([
  ['CATALOG_PRODUCT_REQUIRED', 'WAITING_INPUT', 'NO_ELIGIBLE_PRODUCT'],
  ['SOCIAL_AUTH_REQUIRED', 'WAITING_INPUT', 'AUTH_CONFIGURATION_REQUIRED'],
  [
    'SOCIAL_REMOTE_UNCERTAIN',
    'WAITING_RECONCILIATION',
    'PUBLICATION_UNCERTAIN',
  ],
  ['PRIVATE_STACK_TOKEN_SECRET', 'FAILED', 'OPERATION_FAILED'],
] as const)(
  '%s emits a classified operational message',
  async (code, status, kind) => {
    const f = fixture();
    try {
      const e = f.execution();
      f.pause(e.execution_id, code, status);
      await f.alerts.scan();
      expect(f.adapter.messages).toHaveLength(1);
      expect(f.adapter.messages[0].kind).toBe(kind);
      const text = f.adapter.messages[0].text;
      expect(text).not.toContain('PRIVATE_STACK_TOKEN_SECRET');
      if (kind === 'PUBLICATION_UNCERTAIN')
        expect(text).toContain(
          'Não reenviar manualmente; reconciliação necessária.',
        );
    } finally {
      await f.close();
    }
  },
);

test('different campaigns and dates are independent; irrelevant success/ticks create no spam', async () => {
  const f = fixture();
  try {
    const a = f.execution();
    await f.alerts.scan();
    expect(f.adapter.messages).toEqual([]);
    f.pause(a.execution_id);
    const b = f.execution('2026-11-09');
    f.pause(b.execution_id);
    const catalog = new SqliteAffiliateRepository(f.f.database);
    try {
      catalog.registerCampaign(
        { ...catalog.getCampaign('camp_001', 1)!, campaignId: 'camp_other' },
        'other_alert_campaign',
        true,
      );
    } finally {
      catalog.close();
    }
    const c = f.execution('2026-11-08', 'camp_other');
    f.pause(c.execution_id);
    await f.alerts.scan();
    expect(f.adapter.messages).toHaveLength(3);
    await f.alerts.scan();
    expect(f.adapter.messages).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test('failed or ambiguous delivery is persisted once and never retried after restart', async () => {
  const adapter = new FakeOperationalNotificationAdapter();
  adapter.result = { status: 'UNCERTAIN', errorCode: 'TELEGRAM_TIMEOUT' };
  const f = fixture(adapter);
  try {
    const e = f.execution();
    f.pause(e.execution_id);
    const before = f.campaigns.get(e.execution_id);
    await f.alerts.scan();
    f.restart();
    await f.alerts.scan();
    expect(adapter.messages).toHaveLength(1);
    expect(f.campaigns.get(e.execution_id)).toEqual(before);
    expect(
      f.campaigns
        .history(e.execution_id)
        .some((h) => h.event_type === 'OPERATIONAL_NOTIFICATION_UNCERTAIN'),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test.each(['http500', 'timeout'] as const)(
  'real Telegram adapter %s does not change campaign state or retry',
  async (mode) => {
    const fetch = vi.fn(async () => {
      if (mode === 'timeout')
        throw Object.assign(new Error('private URL omitted'), {
          name: 'TimeoutError',
        });
      return new Response('{}', { status: 500 });
    });
    const telegram = new TelegramOperationalNotificationAdapter(
      '123456789:' + 'fixture_'.repeat(6),
      '-100000000001',
      fetch as any,
      20,
    );
    const adapter = new FakeOperationalNotificationAdapter();
    vi.spyOn(adapter, 'send').mockImplementation(async (message) => {
      adapter.messages.push(message);
      return telegram.send(message);
    });
    const f = fixture(adapter);
    try {
      const e = f.execution();
      f.pause(e.execution_id);
      const before = f.campaigns.get(e.execution_id);
      await f.alerts.scan();
      f.restart();
      await f.alerts.scan();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(f.campaigns.get(e.execution_id)).toEqual(before);
    } finally {
      await f.close();
    }
  },
);

test('two dispatchers claim one transition atomically', async () => {
  const f = fixture();
  const other = new OperationalAlertsService(f.open, f.adapter, () => now);
  other.onModuleInit();
  try {
    const e = f.execution();
    f.pause(e.execution_id);
    await Promise.all([f.alerts.scan(), other.scan()]);
    expect(f.adapter.messages).toHaveLength(1);
  } finally {
    await other.onModuleDestroy();
    await f.close();
  }
});

test('first activation ignores old states; later transitions remain eligible after restart', async () => {
  const f = fixture();
  const adapter = new FakeOperationalNotificationAdapter('fake:new-recipient');
  let other: OperationalAlertsService | undefined;
  try {
    const old = f.execution();
    f.pause(old.execution_id);
    other = new OperationalAlertsService(f.open, adapter, () => now);
    other.onModuleInit();
    await other.scan();
    expect(adapter.messages).toHaveLength(0);
    const next = f.execution('2026-11-09');
    f.pause(next.execution_id);
    await other.scan();
    expect(adapter.messages).toHaveLength(1);
    await other.onModuleDestroy();
    other = new OperationalAlertsService(f.open, adapter, () => now);
    other.onModuleInit();
    await other.scan();
    expect(adapter.messages).toHaveLength(1);
  } finally {
    await other?.onModuleDestroy();
    await f.close();
  }
});

test('crash after durable intent is UNKNOWN, never a second Telegram POST', async () => {
  const f = fixture();
  let restarted: OperationalAlertsService | undefined;
  try {
    const e = f.execution();
    f.pause(e.execution_id);
    const repo = f.open();
    try {
      const baseline = repo.baseline(
        f.adapter.destinationId,
        { campaign: 0, social: 0, manual: 0 },
        now,
      );
      const intent = collectOperationalNotifications(
        repo,
        f.adapter.destinationId,
        baseline,
      )[0];
      expect(
        repo.claim(
          intent,
          () =>
            collectOperationalNotifications(
              repo,
              f.adapter.destinationId,
              baseline,
            ).some((c) => c.key === intent.key),
          now,
        ),
      ).toBe(true);
    } finally {
      repo.close();
    }
    restarted = new OperationalAlertsService(
      f.open,
      f.adapter,
      () => '2026-11-08T13:01:00.000Z',
    );
    restarted.onModuleInit();
    await restarted.scan();
    expect(f.adapter.messages).toHaveLength(0);
    expect(
      f.campaigns
        .history(e.execution_id)
        .some(
          (h) =>
            h.event_type === 'OPERATIONAL_NOTIFICATION_UNCERTAIN' &&
            h.evidence.errorCode === 'NOTIFICATION_PROCESS_INTERRUPTED',
        ),
    ).toBe(true);
  } finally {
    await restarted?.onModuleDestroy();
    await f.close();
  }
});

test('Null and missing Telegram configuration never call transports or expose credentials', async () => {
  const fetch = vi.fn();
  const disabled = notificationAdapter({}, fetch);
  expect(disabled).toBeInstanceOf(NullOperationalNotificationAdapter);
  const incomplete = notificationAdapter(
    {
      OPERATIONAL_NOTIFICATIONS_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'private_not_a_token',
    },
    fetch,
  );
  expect(incomplete.enabled).toBe(false);
  expect(JSON.stringify(incomplete)).not.toContain('private_not_a_token');
  await disabled.send({ kind: 'OPERATION_FAILED', text: 'fixture' });
  expect(fetch).not.toHaveBeenCalled();
});

test('public message redacts untrusted labels/errors and removes query credentials from permalinks', () => {
  for (const url of [
    'http://video.example/clip/1',
    'https://secret@video.example/clip/1',
    'https://video.example:444/clip/1',
    'https://localhost/clip/1',
    'https://private.invalid/clip/1',
    'https://127.0.0.1/clip/1',
    'https://video.example/clip/token%3Dsecret',
  ])
    expect(publicPermalink(url)).toBeNull();
  const token = '123456789:' + 'fixture_'.repeat(6);
  const text = notificationText('OPERATION_FAILED', {
    campaign: 'https://private.invalid/?token=fixture',
    product: `Produto\n${token}`,
    day: '2026-11-08',
    step: 'RAW_STACK_SECRET',
    code: 'RAW_TOKEN_SECRET',
  });
  expect(text).not.toContain(token);
  expect(text).not.toContain('private.invalid');
  expect(text).not.toContain('RAW_STACK_SECRET');
  expect(text).not.toContain('RAW_TOKEN_SECRET');
  expect(text).toContain('OPERATION_FAILED');
  const published = notificationText('PUBLICATION_SUCCEEDED', {
    campaign: 'camp_001',
    product: 'Produto',
    day: '2026-11-08',
    permalink:
      'https://www.instagram.com/reel/example/?access_token=fixture#secret',
  });
  expect(published).toContain('https://www.instagram.com/reel/example/');
  expect(published).not.toContain('access_token');
  expect(published).not.toContain('#secret');
});

test.each(['success', 'http500', 'timeout'] as const)(
  'Telegram %s uses bounded official HTTPS POST with redacted errors',
  async (mode) => {
    const token = '123456789:' + 'fixture_'.repeat(6),
      chat = '-100000000001';
    const fetch = vi.fn(async (_url: any, init: any) => {
      if (mode === 'timeout')
        throw Object.assign(
          new Error(`https://api.telegram.org/bot${token}/sendMessage`),
          { name: 'TimeoutError' },
        );
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(JSON.parse(init.body)).sort()).toEqual([
        'chat_id',
        'text',
      ]);
      return new Response(
        JSON.stringify(
          mode === 'success'
            ? { ok: true, result: { message_id: 1 } }
            : { ok: false, description: token },
        ),
        { status: mode === 'http500' ? 500 : 200 },
      );
    });
    const adapter = new TelegramOperationalNotificationAdapter(
      token,
      chat,
      fetch as any,
      20,
    );
    const result = await adapter.send({
      kind: 'OPERATION_FAILED',
      text: 'Mensagem de teste',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${token}/sendMessage`,
    );
    expect(result.status).toBe(
      mode === 'success'
        ? 'DELIVERED'
        : mode === 'timeout'
          ? 'UNCERTAIN'
          : 'FAILED',
    );
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(adapter)).not.toContain(chat);
  },
);
