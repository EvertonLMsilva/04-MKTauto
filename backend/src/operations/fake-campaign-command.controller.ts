import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FakeCampaignCommandGuard } from './fake-campaign-command.guard.js';
import { FakeCampaignCommandService } from './fake-campaign-command.service.js';
import { QC_REVIEWER_CONTEXT } from '../publishing/application/local-qc.guard.js';
import { QcIdentityError } from '../publishing/application/local-qc-identity.js';

/** Controlled browser facade. POST only accepts confirmed commands; acceptance
 * returns the actual persisted state, never PUBLISHED. GET has no side effects.
 * Enable privately with QC_FAKE_COMMANDS_ENABLED=true and an explicit comma-
 * separated QC_FAKE_COMMAND_OPERATORS allowlist. No credentials in these flags. */
@Controller('operations/campaign-commands')
@UseGuards(FakeCampaignCommandGuard)
export class FakeCampaignCommandController {
  constructor(
    @Inject(FakeCampaignCommandService)
    private readonly commands: FakeCampaignCommandService,
  ) {}
  private async respond(action: () => unknown) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof QcIdentityError)
        throw new HttpException({ code: error.code }, error.status);
      const raw =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      const code = /^[A-Z][A-Z0-9_]{1,99}$/.test(raw)
        ? raw
        : 'FAKE_COMMAND_FAILED';
      const status = /CONFLICT|REUSED/.test(code)
        ? 409
        : /NOT_FOUND/.test(code)
          ? 404
          : /CONFIGURATION|UNAVAILABLE|SCHEMA|PROVIDER_FORBIDDEN/.test(code)
            ? 503
            : /INVALID|REQUIRED|MISMATCH|FORBIDDEN|DISABLED|UNCONFIRMED/.test(
                  code,
                )
              ? 400
              : 500;
      throw new HttpException({ code }, status);
    }
  }
  @Post('campaigns') register(@Body() value: unknown, @Req() req: any) {
    return this.respond(() =>
      this.commands.register(value, req[QC_REVIEWER_CONTEXT]),
    );
  }
  @Post('executions/fake') prepare(@Body() value: unknown, @Req() req: any) {
    return this.respond(() =>
      this.commands.prepare(value, req[QC_REVIEWER_CONTEXT]),
    );
  }
  @Get('executions/:id') detail(@Param('id') id: string, @Req() req: any) {
    return this.respond(() =>
      this.commands.detail(id, req[QC_REVIEWER_CONTEXT]),
    );
  }
  @Post('executions/:id/resume') resume(
    @Param('id') id: string,
    @Body() value: unknown,
    @Req() req: any,
  ) {
    return this.respond(() =>
      this.commands.resume(id, value, req[QC_REVIEWER_CONTEXT]),
    );
  }
}
