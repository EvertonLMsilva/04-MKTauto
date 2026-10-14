import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ProjectModule } from './project/project.module.js';
import { AffiliateModule } from './affiliate/affiliate.module.js';
import { ContentOperationsModule } from './content-operations/content-operations.module.js';
import { ContentModule } from './content/content.module.js';
import { MediaModule } from './media/media.module.js';

@Module({
  imports: [
    ProjectModule,
    AffiliateModule,
    ContentOperationsModule,
    ContentModule,
    MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
