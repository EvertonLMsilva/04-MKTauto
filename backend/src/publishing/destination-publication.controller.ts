import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { exact } from './domain/manual-distribution-contracts.js';
@Controller('publishing/executions')
@UseGuards(LocalQcGuard)
export class DestinationPublicationController {
  constructor(
    @Inject(DestinationPublicationService)
    private readonly service: DestinationPublicationService,
  ) {}
  @Get(':id/destinations') status(@Param('id') id: string) {
    return this.service.status(id);
  }
  @Post(':id/facebook-reels') async publish(
    @Param('id') id: string,
    @Body() body: { accountId: string },
  ) {
    exact(body, ['accountId']);
    try {
      return await this.service.execute(id, 'FACEBOOK_REELS', body.accountId);
    } catch (error: any) {
      throw new ConflictException({
        code: /^[A-Z_]+$/.test(error?.code ?? '')
          ? error.code
          : 'SOCIAL_PUBLICATION_UNAVAILABLE',
      });
    }
  }
}
