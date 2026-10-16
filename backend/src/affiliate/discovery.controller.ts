import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AffiliateDiscoveryService } from './application/discovery.service.js';
import { ContractValidationError } from './domain/affiliate.errors.js';
import { errorCode } from './infrastructure/discovery-error.js';
@Controller('affiliate/discovery/selections')
export class DiscoveryController {
  constructor(
    @Inject(AffiliateDiscoveryService)
    private readonly discovery: AffiliateDiscoveryService,
  ) {}
  @Post() select(@Body() input: unknown) {
    return this.respond(() => this.discovery.select(input));
  }
  @Get(':discoveryRunId') get(@Param('discoveryRunId') id: string) {
    return this.respond(() => this.discovery.get(id));
  }
  private async respond<T>(operation: () => T | Promise<T>) {
    try {
      const result = await operation();
      if (result === null)
        throw new NotFoundException({ code: 'DISCOVERY_RECORD_NOT_FOUND' });
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      const code = errorCode(error);
      if (
        error instanceof ContractValidationError ||
        code === 'DISCOVERY_FIELDS_INVALID' ||
        code === 'DISCOVERY_PROJECT_VERSION_INVALID'
      )
        throw new BadRequestException({ code });
      if (code === 'DISCOVERY_PROJECT_NOT_FOUND')
        throw new NotFoundException({ code });
      if (code === 'DISCOVERY_IDEMPOTENCY_CONFLICT')
        throw new ConflictException({ code });
      if (code?.startsWith('EXTERNAL_CATALOG_'))
        throw new ServiceUnavailableException({ code });
      throw new InternalServerErrorException({
        code:
          code === 'DISCOVERY_PERSISTED_INTEGRITY'
            ? code
            : 'DISCOVERY_OPERATION_FAILED',
      });
    }
  }
}
