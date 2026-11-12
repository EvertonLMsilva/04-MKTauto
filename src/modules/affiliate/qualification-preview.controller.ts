import {
  Controller,
  Post,
  HttpCode,
  Body,
  Inject,
  Optional,
  Req,
  UseGuards,
  HttpException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { ContractValidationError } from './domain/affiliate.errors.js';
import { errorCode } from './infrastructure/discovery-error.js';
import { AffiliateReviewRegistrationService } from './application/affiliate-review-registration.service.js';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
} from '../publishing/application/local-qc.guard.js';
import { QcIdentityError } from '../publishing/application/local-qc-identity.js';

@Controller('affiliate/feed-qualifications/preview')
export class QualificationPreviewController {
  constructor(
    @Inject(QualificationPreviewService)
    private readonly service: QualificationPreviewService,
    @Optional()
    @Inject(AffiliateReviewRegistrationService)
    private readonly registration?: AffiliateReviewRegistrationService,
  ) {}
  @Post('register')
  @HttpCode(200)
  @UseGuards(LocalQcGuard)
  async register(
    @Body() input: unknown,
    @Req() request: Record<symbol, unknown>,
  ) {
    try {
      if (!this.registration)
        throw new ServiceUnavailableException({
          code: 'AFFILIATE_REVIEW_UNAVAILABLE',
        });
      return await this.registration.register(
        input,
        request[QC_REVIEWER_CONTEXT],
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof QcIdentityError)
        throw new HttpException({ code: error.code }, error.status);
      const code = errorCode(error);
      if (
        code === 'FEED_QUALIFICATION_REPORT_CHANGED' ||
        code === 'AFFILIATE_REVIEW_STALE' ||
        code === 'AFFILIATE_IDEMPOTENCY_CONFLICT' ||
        code === 'AFFILIATE_REVISION_CONFLICT'
      )
        throw new ConflictException({ code });
      if (
        error instanceof ContractValidationError ||
        (code?.startsWith('AFFILIATE_REVIEW_') &&
          code !== 'AFFILIATE_REVIEW_COMMIT_UNAVAILABLE')
      )
        throw new BadRequestException({ code });
      throw new ServiceUnavailableException({
        code: 'AFFILIATE_REVIEW_UNAVAILABLE',
      });
    }
  }
  @Post()
  @HttpCode(200)
  async preview(@Body() input: unknown) {
    return this.respond(() => this.service.preview(input));
  }
  @Post('batch')
  @HttpCode(200)
  async previewBatch(@Body() input: unknown) {
    return this.respond(() => this.service.previewBatch(input));
  }
  private async respond<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      const code = errorCode(error);
      if (code === 'FEED_QUALIFICATION_REPORT_CHANGED')
        throw new ConflictException({ code });
      if (
        error instanceof ContractValidationError ||
        code?.startsWith('QUALIFICATION_PREVIEW_')
      )
        throw new BadRequestException({ code });
      throw new ServiceUnavailableException({
        code: 'QUALIFICATION_PREVIEW_UNAVAILABLE',
      });
    }
  }
}
