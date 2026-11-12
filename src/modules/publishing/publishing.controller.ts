import { Req, UseGuards } from '@nestjs/common';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
  serverApprovalRequest,
} from './application/local-qc.guard.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
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
import {
  instagramCaption,
  facebookCaption,
} from './domain/social-publication-contracts.js';
@Controller('publishing')
export class PublishingController {
  constructor(
    @Inject(PublishingService) private readonly publishing: PublishingService,
    @Inject(InstagramPublicationService)
    private readonly instagram: InstagramPublicationService,
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
  @Post('approvals')
  @UseGuards(LocalQcGuard)
  decide(@Body() value: unknown, @Req() request: any) {
    const input = serverApprovalRequest(value, request[QC_REVIEWER_CONTEXT]);
    return this.respond(() => this.publishing.decide(input));
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
    return this.respond(() => {
      const value = this.publishing.package(hash);
      return value
        ? {
            ...value,
            finalCaption:
              value.platform === 'facebook'
                ? facebookCaption(value)
                : instagramCaption(value),
          }
        : null;
    });
  }
  @Get('packages/:hash/manual-handoff')
  @UseGuards(LocalQcGuard)
  manualHandoff(@Param('hash') hash: string) {
    return this.respond(() => this.publishing.manualHandoff(hash));
  }
  @Post('reviews') review(@Body() value: unknown) {
    return this.command(value, (input, key) =>
      this.publishing.review(input, key),
    );
  }
  @Post('approval-revocations') revokeApproval(@Body() value: unknown) {
    return this.respond(() => this.publishing.revokeApproval(value));
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
  @Post('executions/:id/commercial-results') recordExecutionResults(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.command(value, (input, key) =>
      this.publishing.recordCommercialResults(
        { kind: 'execution', id },
        input,
        key,
      ),
    );
  }
  @Get('executions/:id/commercial-results') executionSummary(
    @Param('id') id: string,
  ) {
    return this.respond(() =>
      this.publishing.commercialSummary({ kind: 'execution', id }),
    );
  }
  @Post('social-operations/:id/commercial-results') recordOperationResults(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.command(value, (input, key) =>
      this.publishing.recordCommercialResults(
        { kind: 'operation', id },
        input,
        key,
      ),
    );
  }
  @Get('social-operations/:id/commercial-results') operationSummary(
    @Param('id') id: string,
  ) {
    return this.respond(() =>
      this.publishing.commercialSummary({ kind: 'operation', id }),
    );
  }
  @Post('manual-publications/:id/commercial-results') recordPublicationResults(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.command(value, (input, key) =>
      this.publishing.recordCommercialResults(
        { kind: 'publication', id },
        input,
        key,
      ),
    );
  }
  @Get('manual-publications/:id/commercial-results') publicationSummary(
    @Param('id') id: string,
  ) {
    return this.respond(() =>
      this.publishing.commercialSummary({ kind: 'publication', id }),
    );
  }
  @Get('manual-publications/:id/results') results(@Param('id') id: string) {
    return this.respond(() => this.publishing.results(id));
  }
  @Post('social-operations/:id/receipt') async receipt(
    @Param('id') id: string,
  ) {
    try {
      return await this.instagram.receipt(id);
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
  }
  @Get('social-operations/:id') socialOperation(@Param('id') id: string) {
    return this.respond(() => this.publishing.socialOperation(id));
  }
  @Get('social-operations/:id/history') socialHistory(@Param('id') id: string) {
    return this.respond(() => this.publishing.socialHistory(id));
  }
}
