import { QcIdentityError } from '../publishing/application/local-qc-identity.js';
import { UseGuards, Req, HttpException, Optional } from '@nestjs/common';
import { FalAcquisitionService } from './application/fal-acquisition.service.js';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
} from '../publishing/application/local-qc.guard.js';
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
  ServiceUnavailableException,
} from '@nestjs/common';
import { MediaService } from './application/media.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
@Controller('media')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Optional()
    @Inject(FalAcquisitionService)
    private readonly fal?: FalAcquisitionService,
  ) {}
  @Get('controlled-fal/readiness')
  @UseGuards(LocalQcGuard)
  controlledReadiness() {
    return this.respond(() => {
      if (!this.fal)
        throw new ServiceUnavailableException({ code: 'FAL_LIVE_DISABLED' });
      return this.fal.controlledReadiness();
    });
  }
  @Post('controlled-fal/execute')
  @UseGuards(LocalQcGuard)
  async controlledExecution(@Body() value: any, @Req() request: any) {
    try {
      if (!this.fal)
        throw new ServiceUnavailableException({ code: 'FAL_LIVE_DISABLED' });
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'confirmation,input'
      )
        throw new BadRequestException({
          code: 'FAL_EXECUTION_AUTHORIZATION_REQUIRED',
        });
      return await this.fal.acquirePrepared(value.input, undefined, {
        principal: request[QC_REVIEWER_CONTEXT],
        confirmation: value.confirmation,
      });
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
  }
  @Post('assets/:id/temporal-analysis')
  @UseGuards(LocalQcGuard)
  async temporalAnalysis(@Param('id') id: string) {
    try {
      return await this.media.evaluateTemporalMedia(id);
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
  }
  @Post('assets/:id/temporal-reviews')
  @UseGuards(LocalQcGuard)
  async temporalReview(
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() request: any,
  ) {
    try {
      return await this.media.reviewTemporalMedia(
        id,
        input,
        request[QC_REVIEWER_CONTEXT],
      );
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
  }
  @Post('compositions') async compose(@Body() value: unknown) {
    try {
      return await this.media.compose(value);
    } catch (error) {
      return this.respond(() => {
        throw error;
      });
    }
  }
  @Get('compositions/:id') compositionReceipt(@Param('id') id: string) {
    return this.respond(() => this.media.compositionReceipt(id));
  }
  @Get('renders/:id') render(@Param('id') id: string) {
    return this.respond(() => this.media.getVideoRender(id));
  }
  @Post('composition-plans') registerPlan(@Body() value: unknown) {
    return this.respond(() => this.media.registerCompositionPlan(value));
  }
  @Get('composition-plans/:id') plan(@Param('id') id: string) {
    return this.respond(() => this.media.getCompositionPlan(id));
  }
  @Get('composition-plans') plans(
    @Query('pipelineRunId') run?: string,
    @Query('scriptId') script?: string,
  ) {
    if ((run === undefined) === (script === undefined))
      throw new BadRequestException({
        code: 'COMPOSITION_PLAN_QUERY_REQUIRED',
      });
    return this.respond(() =>
      script !== undefined
        ? this.media.listCompositionPlansByScript(script)
        : this.media.listCompositionPlansByPipelineRun(run!),
    );
  }
  @Post('assets') register(@Body() value: unknown) {
    return this.respond(() => this.media.register(value));
  }
  @Get('assets') list(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.media.listRun(id));
  }
  @Get('assets/:id') get(@Param('id') id: string) {
    return this.respond(() => this.media.get(id));
  }
  @Post('acquisitions') acquire(@Body() value: unknown) {
    return this.respond(() => this.media.recordAcquisition(value));
  }
  @Get('acquisitions/:id') acquisition(@Param('id') id: string) {
    return this.respond(() => this.media.acquisition(id));
  }
  @Post('selections') select(@Body() value: unknown) {
    return this.respond(() => this.media.recordSelection(value));
  }
  @Get('selections/:id') selection(@Param('id') id: string) {
    return this.respond(() => this.media.selection(id));
  }
  @Get('quality-control-reports/:id') report(@Param('id') id: string) {
    return this.respond(() => this.media.report(id));
  }
  @Get('quality-control-reports') find(
    @Query('policyVersion') policy: string,
    @Query('videoRenderId') id: string,
    @Query('videoRenderContentHash') hash: string,
  ) {
    if (
      [policy, id, hash].some(
        (value) => typeof value !== 'string' || value.length === 0,
      )
    )
      throw new BadRequestException({ code: 'QUALITY_CONTROL_QUERY_REQUIRED' });
    return this.respond(() => this.media.findReport(policy, id, hash));
  }
  private respond<T>(action: () => T): T {
    let result: T;
    try {
      result = action();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof QcIdentityError)
        throw new HttpException({ code: error.code }, error.status);
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof Error && 'code' in error && 'field' in error) {
        const body = { code: String(error.code), field: String(error.field) };
        if (body.code === 'COMPOSER_UNAVAILABLE')
          throw new ServiceUnavailableException(body);
        if (/PERSISTENCE_FAILED|INVALID_PERSISTED/.test(body.code))
          throw new InternalServerErrorException(body);
        if (body.code.endsWith('NOT_FOUND')) throw new NotFoundException(body);
        if (/REUSED|CONFLICT|SUPERSEDED/.test(body.code))
          throw new ConflictException(body);
        throw new BadRequestException(body);
      }
      throw new InternalServerErrorException({ code: 'MEDIA_UNAVAILABLE' });
    }
    if (result === null)
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND' });
    return result;
  }
}
