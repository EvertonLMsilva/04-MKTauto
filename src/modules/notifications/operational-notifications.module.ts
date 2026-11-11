import { Module } from '@nestjs/common';
import { CampaignOperationsModule } from '../content-operations/campaign-operations.module.js';
import {
  CAMPAIGN_OPERATIONS,
  type CampaignOperationsPort,
} from '../content-operations/application/campaign-operations.port.js';
import { PublishingOperationsModule } from '../publishing/publishing-operations.module.js';
import {
  PUBLISHING_OPERATIONS,
  type PublishingOperationsPort,
} from '../publishing/application/publishing-operations.port.js';
import { OperationalAlertsService } from './application/operational-alerts.service.js';
import {
  OPERATIONAL_NOTIFICATION_PORT,
  DISCORD_OPERATIONAL_NOTIFICATION_PORT,
  type OperationalNotificationPort,
  OPERATIONAL_NOTIFICATION_STORE,
  type OperationalNotificationStoreFactory,
} from './application/operational-notification.port.js';
import { OperationalNotificationRepository } from './infrastructure/operational-notification.repository.js';
import { notificationAdapter } from './infrastructure/operational-notification.adapter.js';
import { discordNotificationAdapter } from './infrastructure/discord-operational-notification.adapter.js';
@Module({
  imports: [CampaignOperationsModule, PublishingOperationsModule],
  providers: [
    {
      provide: OPERATIONAL_NOTIFICATION_STORE,
      inject: [CAMPAIGN_OPERATIONS, PUBLISHING_OPERATIONS],
      useFactory:
        (
          campaigns: CampaignOperationsPort,
          publishing: PublishingOperationsPort,
        ): OperationalNotificationStoreFactory =>
        () =>
          new OperationalNotificationRepository(campaigns.open(), publishing),
    },
    {
      provide: OPERATIONAL_NOTIFICATION_PORT,
      useFactory: () => notificationAdapter(process.env),
    },
    {
      provide: DISCORD_OPERATIONAL_NOTIFICATION_PORT,
      useFactory: () => discordNotificationAdapter(process.env),
    },
    {
      provide: OperationalAlertsService,
      inject: [
        OPERATIONAL_NOTIFICATION_STORE,
        OPERATIONAL_NOTIFICATION_PORT,
        DISCORD_OPERATIONAL_NOTIFICATION_PORT,
      ],
      useFactory: (
        open: OperationalNotificationStoreFactory,
        port: OperationalNotificationPort,
        discord: OperationalNotificationPort,
      ) => new OperationalAlertsService(open, [port, discord]),
    },
  ],
  exports: [
    OperationalAlertsService,
    OPERATIONAL_NOTIFICATION_PORT,
    DISCORD_OPERATIONAL_NOTIFICATION_PORT,
  ],
})
export class OperationalNotificationsModule {}
