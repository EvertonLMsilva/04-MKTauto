import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { openNotificationStore } from '../../test/support/operational-notifications.fixture.js';
import { PublishingModule } from './publishing.module.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { FACEBOOK_PUBLICATION_PORTS } from './application/ports/destination-publication.port.js';
import { INSTAGRAM_PUBLICATION_PORTS } from './application/ports/instagram-publication.port.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { CAMPAIGN_OPERATIONS } from '../content-operations/application/campaign-operations.port.js';
import {
  OPERATIONAL_NOTIFICATION_PORT,
  DISCORD_OPERATIONAL_NOTIFICATION_PORT,
} from '../notifications/application/operational-notification.port.js';
import { FakeOperationalNotificationAdapter } from '../notifications/infrastructure/operational-notification.adapter.js';

test('Nest HTTP E2E: existing MP4, independent approvals, two receipts, notifications and restart with zero duplicate submissions', async () => {
  const f = await facebookPublicationFixture();
  const PUBLISHING_EVIDENCE = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    PublishingModule,
  ).find(
    (p: any) =>
      typeof p.provide === 'symbol' &&
      p.provide.description === 'PUBLISHING_EVIDENCE',
  ).provide;
  const telegram = new FakeOperationalNotificationAdapter('telegram:multi-e2e'),
    discord = new FakeOperationalNotificationAdapter('discord:multi-e2e');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_EXTERNAL_NETWORK'));
  vi.stubEnv('PROJECT_API_DATABASE', f.f.database);
  vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
  vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
  const baseline = openNotificationStore(f.f.database);
  try {
    for (const port of [telegram, discord])
      baseline.baseline(
        port.destinationId,
        { campaign: 0, social: 0, manual: 0 },
        f.at,
      );
  } finally {
    baseline.close();
  }
  const create = async () => {
    const module = await Test.createTestingModule({
      imports: [PublishingModule],
    })
      .overrideProvider(PublishingPersistence)
      .useValue(f.store)
      .overrideProvider(PUBLISHING_EVIDENCE)
      .useValue(f.media)
      .overrideProvider(MediaService)
      .useValue(f.media)
      .overrideProvider(LocalFlowService)
      .useValue({})
      .overrideProvider(FinanceService)
      .useValue(f.finance)
      .overrideProvider(CAMPAIGN_OPERATIONS)
      .useValue(f.campaignPort)
      .overrideProvider(FACEBOOK_PUBLICATION_PORTS)
      .useValue(f.ports)
      .overrideProvider(INSTAGRAM_PUBLICATION_PORTS)
      .useValue(null)
      .overrideProvider(OPERATIONAL_NOTIFICATION_PORT)
      .useValue(telegram)
      .overrideProvider(DISCORD_OPERATIONAL_NOTIFICATION_PORT)
      .useValue(discord)
      .overrideGuard(LocalQcGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    await app.init();
    return app;
  };
  let app: Awaited<ReturnType<typeof create>> | undefined;
  try {
    app = await create();
    const url = `/publishing/executions/${f.execution.execution_id}/facebook-reels`;
    await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(409);
    expect(f.posts).toEqual([]);
    f.approve(f.facebookPackage);
    const response = await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(201);
    expect(response.body.receipt.mediaId).toBe('987654321');
    expect(response.body.receipt.mediaId).not.toBe(f.ig.mediaId);
    const query = await request(app.getHttpServer())
      .get(`/publishing/executions/${f.execution.execution_id}/destinations`)
      .expect(200);
    expect(query.body).toHaveLength(2);
    expect(
      telegram.messages.filter((m) => m.kind === 'PUBLICATION_SUCCEEDED'),
    ).toHaveLength(2);
    expect(discord.messages).toEqual(telegram.messages);
    await app.close();
    app = await create();
    await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(201);
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    expect(telegram.messages).toHaveLength(2);
    expect(discord.messages).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await app?.close();
    vi.unstubAllEnvs();
    fetch.mockRestore();
    f.cleanup();
  }
}, 20000);
