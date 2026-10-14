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
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AffiliateRunContextService } from './application/affiliate-run-context.service.js';
import { commandEnvelope } from './application/affiliate-commands.dto.js';
import {
  ContractValidationError,
  AffiliateRepositoryError,
} from './domain/affiliate.errors.js';

@Controller('affiliate')
export class AffiliateRunContextController {
  constructor(
    @Inject(AffiliateRunContextService)
    private readonly contexts: AffiliateRunContextService,
  ) {}
  @Post('run-bindings')
  bindRun(@Body() command: unknown) {
    return this.respond(() => {
      commandEnvelope(command, [
        'idempotencyKey',
        'pipelineRunId',
        'briefingId',
      ]);
      const { idempotencyKey, ...input } = command;
      return this.contexts.bindRun(input, idempotencyKey as string);
    });
  }
  @Get('runs/:pipelineRunId')
  getRun(
    @Param('pipelineRunId') id: string,
    @Query('expectedBriefingId') expectedBriefingId?: string,
  ) {
    return this.respond(() => this.contexts.inspectRun(id, expectedBriefingId));
  }
  private respond<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof AffiliateRepositoryError) {
        const response = { code: error.code, field: error.field };
        if (
          [
            'AFFILIATE_IDEMPOTENCY_CONFLICT',
            'AFFILIATE_RUN_BINDING_CONFLICT',
            'AFFILIATE_RUN_SCOPE_MISMATCH',
            'AFFILIATE_RUN_BINDING_TOO_LATE',
            'AFFILIATE_BRIEFING_NOT_BOUND',
            'AFFILIATE_SCRIPT_CONTEXT_CONFLICT',
          ].includes(error.code)
        )
          throw new ConflictException(response);
        if (
          ['PIPELINE_RUN_NOT_FOUND', 'AFFILIATE_BRIEFING_NOT_FOUND'].includes(
            error.code,
          )
        )
          throw new NotFoundException(response);
        if (error.code === 'INVALID_AFFILIATE_INPUT')
          throw new BadRequestException(response);
        if (
          [
            'INVALID_PERSISTED_PIPELINE_RUN',
            'INVALID_PERSISTED_AFFILIATE_DATA',
            'AFFILIATE_HASH_MISMATCH',
            'AFFILIATE_SCOPE_MISMATCH',
            'AFFILIATE_REFERENCE_MISSING',
          ].includes(error.code)
        )
          throw new InternalServerErrorException(response);
      }
      throw new InternalServerErrorException({
        code: 'AFFILIATE_OPERATION_FAILED',
      });
    }
  }
}
