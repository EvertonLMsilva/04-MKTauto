import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { OperationalAlertsService } from './application/operational-alerts.service.js';
import { openNotificationStore } from '../../test/support/operational-notifications.fixture.js';
import {
  FakeOperationalNotificationAdapter,
  notificationAdapter,
} from './infrastructure/operational-notification.adapter.js';
import {
  DiscordOperationalNotificationAdapter,
  discordNotificationAdapter,
} from './infrastructure/discord-operational-notification.adapter.js';
import { OperationalNotificationsModule } from './operational-notifications.module.js';
import {
  OPERATIONAL_NOTIFICATION_PORT,
  DISCORD_OPERATIONAL_NOTIFICATION_PORT,
} from './application/operational-notification.port.js';

const now = '2026-11-08T13:00:00.000Z';
const webhook = `https://discord.com/api/webhooks/123456789012345678/${'fixture_'.repeat(8)}`;
function fixture(ports: any) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const campaigns = new CampaignRepository(f.base.db);
  const open = () => openNotificationStore(f.database);
  let alerts = new OperationalAlertsService(open, ports, () => now);
  alerts.onModuleInit();
  function waiting(
    day = '2026-11-08',
    code = 'EXACT_HUMAN_APPROVAL_REQUIRED',
    campaign = 'camp_001',
  ) {
    const e = campaigns.schedule(
      {
        campaignId: campaign,
        campaignRevision: 1,
        scheduledAt: `${day}T13:00:00.000Z`,
        runId: `channel_${day.replaceAll('-', '')}_${campaign}`,
      },
      { briefingId: 'brief_001', campaignId: campaign, campaignRevision: 1 },
      now,
    );
    const claim = campaigns.claim(
      e.execution_id,
      '2026-11-10T13:00:00.000Z',
      60000,
    )!;
    for (const [step, result] of [
      ['BURN', { videoRenderId: 'channel_render' }],
      ['QC', { reportId: 'channel_qc' }],
      ['PREVIEW', { ready: true }],
    ])
      campaigns.ownedEvent(
        e.execution_id,
        claim.claim_token!,
        now,
        'STEP_DONE',
        { step, result },
      );
    campaigns.ownedEvent(
      e.execution_id,
      claim.claim_token!,
      now,
      'PAUSED',
      { step: code.startsWith('SOCIAL_') ? 'PUBLICATION' : 'HANDOFF', code },
      code === 'SOCIAL_REMOTE_UNCERTAIN'
        ? 'WAITING_RECONCILIATION'
        : 'WAITING_INPUT',
    );
    return e;
  }
  return {
    f,
    campaigns,
    waiting,
    get alerts() {
      return alerts;
    },
    async restart() {
      await alerts.onModuleDestroy();
      alerts = new OperationalAlertsService(open, ports, () => now);
      alerts.onModuleInit();
    },
    async close() {
      await alerts.onModuleDestroy();
      f.cleanup();
    },
  };
}

test.each(['both', 'telegram-fails', 'discord-fails'] as const)(
  '%s keeps delivery and idempotency independent by destination',
  async (mode) => {
    const telegram = new FakeOperationalNotificationAdapter('telegram:fixture'),
      discord = new FakeOperationalNotificationAdapter('discord:fixture');
    if (mode === 'telegram-fails')
      telegram.result = { status: 'FAILED', errorCode: 'TELEGRAM_HTTP_ERROR' };
    if (mode === 'discord-fails')
      discord.result = { status: 'FAILED', errorCode: 'DISCORD_HTTP_ERROR' };
    const f = fixture([telegram, discord]);
    try {
      const e = f.waiting();
      const before = f.campaigns.get(e.execution_id);
      await f.alerts.scan();
      await f.alerts.scan();
      await f.restart();
      await f.alerts.scan();
      expect(telegram.messages).toHaveLength(1);
      expect(discord.messages).toEqual(telegram.messages);
      expect(f.campaigns.get(e.execution_id)).toEqual(before);
      const receipts = f.campaigns
        .history(e.execution_id)
        .filter((h) =>
          [
            'OPERATIONAL_NOTIFICATION_DELIVERED',
            'OPERATIONAL_NOTIFICATION_FAILED',
          ].includes(h.event_type),
        );
      expect(receipts).toHaveLength(2);
      expect(new Set(receipts.map((h) => h.evidence.destinationId)).size).toBe(
        2,
      );
      expect(
        receipts.filter(
          (h) => h.event_type === 'OPERATIONAL_NOTIFICATION_DELIVERED',
        ),
      ).toHaveLength(mode === 'both' ? 2 : 1);
    } finally {
      await f.close();
    }
  },
);

test.each(['telegram', 'discord', 'neither'] as const)(
  '%s configuration starts normally and calls only enabled channels',
  async (mode) => {
    const fetch = vi.fn();
    const telegram =
      mode === 'telegram'
        ? new FakeOperationalNotificationAdapter('telegram:fixture')
        : notificationAdapter({}, fetch);
    const discord =
      mode === 'discord'
        ? new FakeOperationalNotificationAdapter('discord:fixture')
        : discordNotificationAdapter({}, fetch);
    const f = fixture([telegram, discord]);
    try {
      f.waiting();
      await f.alerts.scan();
      expect(fetch).not.toHaveBeenCalled();
      if (telegram instanceof FakeOperationalNotificationAdapter)
        expect(telegram.messages).toHaveLength(1);
      if (discord instanceof FakeOperationalNotificationAdapter)
        expect(discord.messages).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

test('missing/invalid Discord configuration cannot disable Telegram or leak the URL', async () => {
  const secret = 'https://private.invalid/not-a-webhook';
  const discord = discordNotificationAdapter({
    DISCORD_NOTIFICATIONS_ENABLED: 'true',
    DISCORD_WEBHOOK_URL: secret,
  });
  expect(discord.enabled).toBe(false);
  expect(JSON.stringify(discord)).not.toContain(secret);
  const telegram = new FakeOperationalNotificationAdapter('telegram:fixture');
  const f = fixture([telegram, discord]);
  try {
    f.waiting();
    await f.alerts.scan();
    expect(telegram.messages).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])(
  'private flags independently configure Telegram=%s Discord=%s',
  (telegram, discord) => {
    const env = {
      OPERATIONAL_NOTIFICATIONS_ENABLED: String(telegram),
      TELEGRAM_BOT_TOKEN: '123456789:' + 'fixture_'.repeat(6),
      TELEGRAM_CHAT_ID: '-100000000001',
      DISCORD_NOTIFICATIONS_ENABLED: String(discord),
      ...(discord ? { DISCORD_WEBHOOK_URL: webhook } : {}),
    };
    expect(notificationAdapter(env).enabled).toBe(telegram);
    expect(discordNotificationAdapter(env).enabled).toBe(discord);
  },
);

test('Nest uses the existing port and event store for both injected channel adapters', async () => {
  const f = fixture([]),
    telegram = new FakeOperationalNotificationAdapter('telegram:module'),
    discord = new FakeOperationalNotificationAdapter('discord:module');
  vi.stubEnv('PROJECT_API_DATABASE', f.f.database);
  const module = await Test.createTestingModule({
    imports: [OperationalNotificationsModule],
  })
    .overrideProvider(OPERATIONAL_NOTIFICATION_PORT)
    .useValue(telegram)
    .overrideProvider(DISCORD_OPERATIONAL_NOTIFICATION_PORT)
    .useValue(discord)
    .compile();
  try {
    await module.init();
    f.waiting();
    await module.get(OperationalAlertsService).scan();
    expect(telegram.messages).toHaveLength(1);
    expect(discord.messages).toEqual(telegram.messages);
  } finally {
    await module.close();
    vi.unstubAllEnvs();
    await f.close();
  }
});

test('Discord uses official webhook, wait=true receipt and empty allowed_mentions', async () => {
  const fetch = vi.fn(async (url: any, init: any) => {
    expect(new URL(url).hostname).toBe('discord.com');
    expect(new URL(url).searchParams.get('wait')).toBe('true');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(init.body);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toContain('@everyone');
    expect(payload.content).toContain(
      'https://www.instagram.com/reel/fixture/',
    );
    expect(payload).not.toHaveProperty('embeds');
    return new Response(JSON.stringify({ id: '123456789012345678' }));
  });
  const adapter = new DiscordOperationalNotificationAdapter(
    webhook,
    fetch as any,
  );
  expect(
    await adapter.send({
      kind: 'PUBLICATION_SUCCEEDED',
      text: '@everyone <@&12345> https://www.instagram.com/reel/fixture/',
    }),
  ).toEqual({ status: 'DELIVERED', messageId: '123456789012345678' });
  expect(JSON.stringify(adapter)).not.toContain(webhook);
  expect(JSON.stringify(adapter)).not.toContain('fixture_');
});

test.each(['http500', 'timeout', 'malformed'] as const)(
  'Discord %s is redacted and does not leak a secret to logs',
  async (mode) => {
    const log = vi.spyOn(Logger.prototype, 'warn');
    const fetch = vi.fn(async () => {
      if (mode === 'timeout')
        throw Object.assign(new Error(webhook), { name: 'TimeoutError' });
      return new Response(
        mode === 'malformed' ? 'not-json' : JSON.stringify({ error: webhook }),
        { status: mode === 'http500' ? 500 : 200 },
      );
    });
    try {
      const adapter = new DiscordOperationalNotificationAdapter(
        webhook,
        fetch as any,
        20,
      );
      const result = await adapter.send({
        kind: 'OPERATION_FAILED',
        text: 'Falha pública',
      });
      expect(result.status).not.toBe('DELIVERED');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(webhook);
      expect(JSON.stringify(log.mock.calls)).not.toContain(webhook);
    } finally {
      log.mockRestore();
    }
  },
);

test('same webhook identity survives token rotation; unsafe endpoints never become a live adapter', () => {
  const a = new DiscordOperationalNotificationAdapter(webhook),
    b = new DiscordOperationalNotificationAdapter(
      webhook.replace('fixture_'.repeat(8), 'other_fixture_'.repeat(6)),
    );
  expect(a.destinationId).toBe(b.destinationId);
  for (const url of [
    'http://discord.com/api/webhooks/123456/token',
    'https://discord.com.private.invalid/api/webhooks/123456/token',
    'https://localhost/api/webhooks/123456/token',
  ])
    expect(
      discordNotificationAdapter({
        DISCORD_NOTIFICATIONS_ENABLED: 'true',
        DISCORD_WEBHOOK_URL: url,
      }).enabled,
    ).toBe(false);
});

test('uncertain message, campaigns and production dates stay independent on both channels', async () => {
  const telegram = new FakeOperationalNotificationAdapter('telegram:fixture'),
    discord = new FakeOperationalNotificationAdapter('discord:fixture');
  const f = fixture([telegram, discord]);
  try {
    f.waiting('2026-11-08', 'SOCIAL_REMOTE_UNCERTAIN');
    f.waiting('2026-11-09');
    const catalog = new SqliteAffiliateRepository(f.f.database);
    try {
      catalog.registerCampaign(
        { ...catalog.getCampaign('camp_001', 1)!, campaignId: 'camp_other' },
        'discord_other_campaign',
        true,
      );
    } finally {
      catalog.close();
    }
    f.waiting('2026-11-08', 'EXACT_HUMAN_APPROVAL_REQUIRED', 'camp_other');
    await f.alerts.scan();
    expect(telegram.messages).toHaveLength(3);
    expect(discord.messages).toEqual(telegram.messages);
    expect(
      discord.messages.some((m) =>
        m.text.includes('Não reenviar manualmente; reconciliação necessária.'),
      ),
    ).toBe(true);
    await f.restart();
    await f.alerts.scan();
    expect(discord.messages).toHaveLength(3);
  } finally {
    await f.close();
  }
});
