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
    try {
      return await this.service.preview(input);
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
