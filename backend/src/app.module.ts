import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ProjectModule } from './project/project.module.js';
import { AffiliateModule } from './affiliate/affiliate.module.js';
import { ContentOperationsModule } from './content-operations/content-operations.module.js';

@Module({
  imports: [ProjectModule, AffiliateModule, ContentOperationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
