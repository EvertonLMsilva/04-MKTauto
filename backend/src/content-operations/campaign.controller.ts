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
        : /CONFLICT|CLAIM_LOST|TERMINAL|RECONCILIATION_REQUIRED|NOT_RECOVERABLE/.test(
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
  @Get(':id') get(@Param('id') id: string) {
    return this.respond(() => this.campaigns.get(id));
  }
  @Get(':id/history') history(@Param('id') id: string) {
    return this.respond(() => this.campaigns.history(id));
  }
  @Post(':id/resume') resume(@Param('id') id: string, @Body() value?: unknown) {
    return this.respond(() => this.campaigns.resume(id, value));
  }
  @Post(':id/cancel') cancel(@Param('id') id: string) {
    return this.respond(() => this.campaigns.cancel(id));
  }
  @Post(':id/approvals') approve(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.respond(() => this.campaigns.approve(id, value));
  }
}
