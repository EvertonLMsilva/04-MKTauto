import {
  Controller,
  Post,
  HttpCode,
  Body,
  Inject,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { ContractValidationError } from './domain/affiliate.errors.js';
import { errorCode } from './infrastructure/discovery-error.js';

@Controller('affiliate/feed-qualifications/preview')
export class QualificationPreviewController {
  constructor(
    @Inject(QualificationPreviewService)
    private readonly service: QualificationPreviewService,
  ) {}
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
