import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PublishingService } from './application/publishing.service.js';
import { exact } from './domain/manual-distribution-contracts.js';
@Controller('publishing')
export class PublishingController {
  constructor(
    @Inject(PublishingService) private readonly publishing: PublishingService,
  ) {}
  private respond(action: () => unknown) {
    try {
      return action();
    } catch (error: any) {
      if (
        typeof error.code === 'string' &&
        /^(DISTRIBUTION_|HUMAN_APPROVAL_|SOCIAL_|AFFILIATE_|P4_|INVALID_|UNSUPPORTED_|CONTENT_HASH_|DECISION_ID_|JUSTIFICATION_|UNKNOWN_|REQUIRED_)/.test(
          error.code,
        )
      ) {
        const response = { code: error.code, field: error.field ?? error.path };
        if (/CONFLICT|IDEMPOTENCY/.test(error.code))
          throw new ConflictException(response);
        throw new BadRequestException(response);
      }
      throw new InternalServerErrorException({
        code: 'PUBLISHING_UNAVAILABLE',
      });
    }
  }
  private command(
    value: any,
    action: (input: unknown, key: string) => unknown,
  ) {
    return this.respond(() => {
      exact(value, ['input', 'idempotencyKey']);
      return action(value.input, value.idempotencyKey);
    });
  }
  @Post('approvals') decide(@Body() value: unknown) {
    return this.respond(() => this.publishing.decide(value));
  }
  @Get('approvals') approvals(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.publishing.approvals(id));
  }
  @Get('approvals/:id') approval(@Param('id') id: string) {
    return this.respond(() => this.publishing.approval(id));
  }
  @Post('packages') prepare(@Body() value: unknown) {
    return this.command(value, (input, key) =>
      this.publishing.prepare(input, key),
    );
  }
  @Get('packages/:hash') package(@Param('hash') hash: string) {
    return this.respond(() => this.publishing.package(hash));
  }
  @Post('reviews') review(@Body() value: unknown) {
    return this.command(value, (input, key) =>
      this.publishing.review(input, key),
    );
  }
  @Get('packages/:hash/review') packageReview(@Param('hash') hash: string) {
    return this.respond(() => this.publishing.packageReview(hash));
  }
  @Post('manual-publications') recordPublication(@Body() value: unknown) {
    return this.command(value, (input, key) =>
      this.publishing.recordPublication(input, key),
    );
  }
  @Get('manual-publications') publications(@Query('packageHash') hash: string) {
    return this.respond(() => this.publishing.publications(hash));
  }
  @Get('manual-publications/:id') publication(@Param('id') id: string) {
    return this.respond(() => this.publishing.publication(id));
  }
  @Post('results') recordResults(@Body() value: unknown) {
    return this.command(value, (input, key) =>
      this.publishing.recordResults(input, key),
    );
  }
  @Get('manual-publications/:id/results') results(@Param('id') id: string) {
    return this.respond(() => this.publishing.results(id));
  }
  @Get('social-operations/:id') socialOperation(@Param('id') id: string) {
    return this.respond(() => this.publishing.socialOperation(id));
  }
  @Get('social-operations/:id/history') socialHistory(@Param('id') id: string) {
    return this.respond(() => this.publishing.socialHistory(id));
  }
}
