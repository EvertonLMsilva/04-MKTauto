import {
  Controller,
  Get,
  Query,
  Inject,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { errorCode } from './infrastructure/discovery-error.js';

@Controller('affiliate/feed-qualifications')
export class FeedQualificationController {
  constructor(
    @Inject(FeedQualificationService)
    private readonly qualification: FeedQualificationService,
  ) {}
  @Get()
  async qualify(@Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).some(
        (k) => !['offset', 'limit', 'reportId'].includes(k),
      )
    )
      throw new BadRequestException({
        code: 'FEED_QUALIFICATION_INVALID_QUERY',
      });
    const integer = (value: unknown) => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || !/^\d+$/.test(value))
        throw new BadRequestException({
          code: 'FEED_QUALIFICATION_INVALID_QUERY',
        });
      return Number(value);
    };
    if (query.reportId !== undefined && typeof query.reportId !== 'string')
      throw new BadRequestException({
        code: 'FEED_QUALIFICATION_INVALID_QUERY',
      });
    try {
      return await this.qualification.qualify({
        offset: integer(query.offset),
        limit: integer(query.limit),
        reportId: query.reportId as string | undefined,
      });
    } catch (error) {
      const code = errorCode(error);
      if (error instanceof BadRequestException) throw error;
      if (code === 'FEED_QUALIFICATION_INVALID_QUERY')
        throw new BadRequestException({ code });
      if (code === 'FEED_QUALIFICATION_REPORT_CHANGED')
        throw new ConflictException({ code });
      throw new ServiceUnavailableException({
        code: code?.startsWith('EXTERNAL_CATALOG_')
          ? code
          : 'FEED_QUALIFICATION_SOURCE_UNAVAILABLE',
      });
    }
  }
}
