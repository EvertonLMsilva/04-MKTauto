import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { NarrationService } from './application/narration.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';

@Controller('media/narrations')
export class NarrationController {
  constructor(
    @Inject(NarrationService) private readonly narration: NarrationService,
  ) {}

  @Post('preparations') prepare(@Body() value: unknown) {
    return this.respond(() => this.narration.prepare(value));
  }

  @Post('approvals') approve(@Body() value: unknown) {
    return this.respond(() => this.narration.approve(value));
  }

  @Get(':id') get(@Param('id') id: string) {
    return this.respond(() => this.narration.get(id));
  }

  @Post(':id/reconciliations') reconcile(
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return this.respond(() => this.narration.reconcile(id, value));
  }

  private respond<T>(action: () => T): T {
    let result: T;
    try {
      result = action();
    } catch (error) {
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof Error && 'code' in error) {
        const code = String(error.code);
        if (
          /PERSISTENCE_FAILED|INVALID_PERSISTED|PERSISTED_INTEGRITY|SCHEMA/.test(
            code,
          )
        )
          throw new InternalServerErrorException({ code });
        if (/NOT_FOUND/.test(code)) throw new NotFoundException({ code });
        if (/CONFLICT|EXCEEDED|RECONCILIATION_REQUIRED/.test(code))
          throw new ConflictException({ code });
        if (/^TTS_|^GLOBAL_|^INVALID_|^REQUIRED_|^UNKNOWN_FIELD/.test(code))
          throw new BadRequestException({ code });
      }
      throw new InternalServerErrorException({ code: 'NARRATION_UNAVAILABLE' });
    }
    if (result === null)
      throw new NotFoundException({ code: 'TTS_OPERATION_NOT_FOUND' });
    return result;
  }
}
