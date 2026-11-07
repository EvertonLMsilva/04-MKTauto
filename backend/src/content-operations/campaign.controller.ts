import { Req, UseGuards } from '@nestjs/common';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
  serverApprovalRequest,
} from '../publishing/application/local-qc.guard.js';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  HttpException,
} from '@nestjs/common';
import { CampaignAdministration } from './application/campaign-administration.js';
@Controller('content-operations/campaign-executions')
export class CampaignController {
  constructor(
    @Inject(CampaignAdministration)
    private readonly campaigns: CampaignAdministration,
  ) {}
  private async respond<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'CAMPAIGN_OPERATION_FAILED';
      const status = code.endsWith('NOT_FOUND')
        ? 404
        : /CONFLICT|AMBIGUOUS|SCOPE_MISMATCH|CLAIM_LOST|TERMINAL|RECONCILIATION_REQUIRED|NOT_RECOVERABLE/.test(
              code,
            )
          ? 409
          : /INVALID|REQUIRED|MISMATCH/.test(code)
            ? 400
            : 500;
      throw new HttpException({ code }, status);
    }
  }
  @Post() schedule(@Body() value: unknown) {
    return this.respond(() => this.campaigns.schedule(value));
  }
  @Post('local') startLocal(@Body() value: unknown) {
    return this.respond(() => this.campaigns.startLocal(value));
  }
  @Get(':id/result') result(@Param('id') id: string) {
    return this.respond(() => this.campaigns.result(id));
  }
  @Post('legacy-recovery')
  @UseGuards(LocalQcGuard)
  recoverLegacy(@Body() value: unknown) {
    return this.respond(() => this.campaigns.recoverLegacy(value));
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.respond(() => this.campaigns.get(id));
  }
  @Get(':id/history') history(@Param('id') id: string) {
    return this.respond(() => this.campaigns.history(id));
  }
  @Get(':id/review')
  @UseGuards(LocalQcGuard)
  review(@Param('id') id: string, @Req() request: any) {
    const identity = serverApprovalRequest({}, request[QC_REVIEWER_CONTEXT]);
    return this.respond(() =>
      this.campaigns.operatorReview(id, identity.actor),
    );
  }
  @Post(':id/package-approvals')
  @UseGuards(LocalQcGuard)
  packageApproval(
    @Param('id') id: string,
    @Body() value: unknown,
    @Req() request: any,
  ) {
    const input = serverApprovalRequest(value, request[QC_REVIEWER_CONTEXT]);
    return this.respond(() =>
      this.campaigns.operatorDecision(id, 'package', input),
    );
  }
  @Post(':id/resume') resume(@Param('id') id: string, @Body() value?: unknown) {
    return this.respond(() => this.campaigns.resume(id, value));
  }
  @Post(':id/cancel') cancel(@Param('id') id: string) {
    return this.respond(() => this.campaigns.cancel(id));
  }
  @Post(':id/approvals')
  @UseGuards(LocalQcGuard)
  approve(
    @Param('id') id: string,
    @Body() value: unknown,
    @Req() request: any,
  ) {
    const input = serverApprovalRequest(value, request[QC_REVIEWER_CONTEXT]);
    return this.respond(() =>
      Object.hasOwn(input, 'reviewId')
        ? this.campaigns.operatorDecision(id, 'render', input)
        : this.campaigns.approve(id, input),
    );
  }
}
