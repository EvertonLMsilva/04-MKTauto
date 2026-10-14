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
import { MediaService } from './application/media.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
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
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof Error && 'code' in error && 'field' in error) {
        const body = { code: String(error.code), field: String(error.field) };
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
