import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FinanceService } from './application/finance.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}
  @Post('costs') register(@Body() value: unknown) {
    return this.respond(() => this.finance.register(value));
  }
  @Get('costs/:id') get(@Param('id') id: string) {
    return this.respond(() => this.finance.get(id));
  }
  @Get('costs') list(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.finance.listByPipelineRun(id));
  }
  @Get('ledger/:pipelineRunId') ledger(@Param('pipelineRunId') id: string) {
    return this.respond(() => this.finance.getLedgerByPipelineRun(id));
  }
  @Get('usage') usage() {
    return this.respond(() => this.finance.getGlobalUsage());
  }
  @Get('campaigns/:id/usage') campaign(@Param('id') id: string) {
    return this.respond(() => this.finance.getUsage(id));
  }
  @Get('operations/:id') operation(@Param('id') id: string) {
    return this.respond(() => this.finance.getGlobalOperation(id));
  }
  @Get('tts/:id') tts(@Param('id') id: string) {
    return this.respond(() => this.finance.getTts(id));
  }
  @Get('tts/:id/statement') ttsStatement(@Param('id') id: string) {
    return this.respond(() => this.finance.getTtsStatementV2(id));
  }
  @Get('ledger-v2/:pipelineRunId') ledgerV2(
    @Param('pipelineRunId') id: string,
  ) {
    return this.respond(() => this.finance.getLedgerV2ByPipelineRun(id));
  }
  private respond<T>(action: () => T): T {
    let result: T;
    try {
      result = action();
    } catch (error) {
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof Error && 'code' in error) {
        const code = String(error.code),
          field = 'field' in error ? String(error.field) : undefined;
        if (/PERSISTENCE_FAILED|INVALID_PERSISTED|SCHEMA_REQUIRED/.test(code))
          throw new InternalServerErrorException({ code, field });
        if (/NOT_FOUND/.test(code))
          throw new NotFoundException({ code, field });
        if (/CONFLICT|EXCEEDED|REUSED|RECONCILIATION_REQUIRED/.test(code))
          throw new ConflictException({ code, field });
        throw new BadRequestException({ code, field });
      }
      throw error;
    }
    if (result === null)
      throw new NotFoundException({ code: 'FINANCE_RECORD_NOT_FOUND' });
    return result;
  }
}
