import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AffiliateService } from './application/affiliate.service.js';
import {
  ContractValidationError,
  AffiliateRepositoryError,
} from './domain/affiliate.errors.js';
import type {
  RegisterProductDto,
  RegisterCampaignDto,
  CreateBriefingDto,
} from './application/affiliate-commands.dto.js';

@Controller('affiliate')
export class AffiliateController {
  constructor(
    @Inject(AffiliateService) private readonly affiliate: AffiliateService,
  ) {}
  @Post('products')
  registerProduct(@Body() command: RegisterProductDto) {
    return this.respond(() => this.affiliate.registerProduct(command));
  }
  @Get('products/:productId/revisions/:revision')
  getProduct(
    @Param('productId') id: string,
    @Param('revision') revision: string,
  ) {
    return this.respond(
      () => this.affiliate.getProduct(id, this.parseRevision(revision)),
      'productId',
    );
  }
  @Post('campaigns')
  registerCampaign(@Body() command: RegisterCampaignDto) {
    return this.respond(() => this.affiliate.registerCampaign(command));
  }
  @Get('campaigns/:campaignId/revisions/:revision')
  getCampaign(
    @Param('campaignId') id: string,
    @Param('revision') revision: string,
  ) {
    return this.respond(
      () => this.affiliate.getCampaign(id, this.parseRevision(revision)),
      'campaignId',
    );
  }
  @Post('briefings')
  createBriefing(@Body() command: CreateBriefingDto) {
    return this.respond(() => this.affiliate.createBriefing(command));
  }
  @Get('briefings/:briefingId')
  getBriefing(@Param('briefingId') id: string) {
    return this.respond(() => this.affiliate.getBriefing(id), 'briefingId');
  }
  private parseRevision(raw: string) {
    const revision = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(revision))
      throw new AffiliateRepositoryError(
        'INVALID_AFFILIATE_REVISION',
        'revision',
      );
    return revision;
  }
  private async respond<T>(operation: () => Promise<T>, missingField?: string) {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof AffiliateRepositoryError) {
        const response = { code: error.code, field: error.field };
        if (
          [
            'AFFILIATE_IDEMPOTENCY_CONFLICT',
            'AFFILIATE_REVISION_CONFLICT',
          ].includes(error.code)
        )
          throw new ConflictException(response);
        if (
          [
            'PROJECT_NOT_FOUND',
            'AFFILIATE_PRODUCT_NOT_FOUND',
            'AFFILIATE_CAMPAIGN_NOT_FOUND',
          ].includes(error.code)
        )
          throw new NotFoundException(response);
        if (
          ['INVALID_AFFILIATE_INPUT', 'INVALID_AFFILIATE_REVISION'].includes(
            error.code,
          )
        )
          throw new BadRequestException(response);
        // Persisted-integrity errors retain deterministic code/field, never causes.
        if (
          [
            'INVALID_PERSISTED_AFFILIATE_DATA',
            'AFFILIATE_HASH_MISMATCH',
            'AFFILIATE_SCOPE_MISMATCH',
            'AFFILIATE_REFERENCE_MISSING',
          ].includes(error.code)
        )
          throw new InternalServerErrorException(response);
      }
      throw new InternalServerErrorException({
        code: 'AFFILIATE_OPERATION_FAILED',
      });
    }
    if (result === null)
      throw new NotFoundException({
        code: 'AFFILIATE_RECORD_NOT_FOUND',
        field: missingField,
      });
    return result;
  }
}
