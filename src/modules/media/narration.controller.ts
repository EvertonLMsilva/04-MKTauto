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
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
} from '../publishing/application/local-qc.guard.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import { narrationEnvelope } from './domain/narration-contracts.js';
import {
  isTtsRiskRequest,
  ttsFail,
} from '../finance/domain/tts-financial-contracts.js';
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
    return this.respond(() => {
      const { plan } = narrationEnvelope(value, ['plan', 'approval']);
      if (isTtsRiskRequest(this.narration.prepare(plan).request))
        ttsFail('TTS_AUTHENTICATED_APPROVAL_REQUIRED');
      return this.narration.approve(value);
    });
  }

  @Post('risk-authorizations')
  @UseGuards(LocalQcGuard)
  authorizeRisk(
    @Body() value: unknown,
    @Req() request: Request & { [QC_REVIEWER_CONTEXT]?: unknown },
  ) {
    return this.respond(() => {
      const principal = operationalQcIdentity.assertActive(
        request[QC_REVIEWER_CONTEXT],
      );
      const { plan, approval } = narrationEnvelope(value, ['plan', 'approval']);
      if (!isTtsRiskRequest(this.narration.prepare(plan).request))
        ttsFail('TTS_INVALID_POLICY');
      const accepted = narrationEnvelope(approval, [
        'requestHash',
        'approvalReference',
        'acceptsUnboundedCost',
        'expiresAt',
        'policyVersion',
      ]);
      return this.narration.approve({
        plan,
        approval: {
          ...accepted,
          approvedBy: principal.id,
          approvedAt: new Date().toISOString(),
        },
      });
    });
  }

  @Post('risk-executions')
  @UseGuards(LocalQcGuard)
  async executeRisk(@Body() value: unknown) {
    try {
      const { plan } = narrationEnvelope(value, ['plan']);
      return await this.narration.execute(plan);
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
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
