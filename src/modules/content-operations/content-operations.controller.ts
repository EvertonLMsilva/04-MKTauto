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
import { ContentOperationsService } from './application/content-operations.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
import {
  OperationsError,
  record,
  exact,
  fail,
} from './domain/operations-contracts.js';

@Controller('content-operations/runs')
export class ContentOperationsController {
  constructor(
    @Inject(ContentOperationsService)
    private readonly operations: ContentOperationsService,
  ) {}
  @Post()
  start(@Body() value: unknown) {
    return this.respond(() => this.operations.start(value));
  }
  @Get()
  list(
    @Query('projectId') id: string,
    @Query('projectVersion') version: string,
  ) {
    return this.respond(() => {
      if (typeof version !== 'string' || !/^[1-9]\d*$/.test(version))
        fail('INVALID_PROJECT_VERSION', 'projectVersion');
      return this.operations.list(id, Number(version));
    });
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.respond(() => this.operations.get(id));
  }
  @Get(':id/checkpoints')
  checkpoints(@Param('id') id: string) {
    return this.respond(() => this.operations.checkpoints(id));
  }
  @Post(':id/transitions')
  transition(@Param('id') id: string, @Body() value: unknown) {
    return this.respond(() => {
      record(value, 'transition');
      exact(
        value,
        value && 'error' in value
          ? ['nextState', 'completedAt', 'error']
          : ['nextState', 'completedAt'],
        'transition',
      );
      if (typeof value.nextState !== 'string')
        fail('INVALID_PIPELINE_RUN_TRANSITION', 'state');
      if (typeof value.completedAt !== 'string')
        fail('INVALID_TIMESTAMP', 'completedAt');
      return this.operations.transition(
        id,
        value.nextState,
        value.completedAt,
        value.error,
      );
    });
  }
  @Post(':id/resume')
  resume(@Param('id') id: string, @Body() value: unknown) {
    return this.respond(() => {
      record(value, 'resume');
      exact(value, ['resumedAt'], 'resume');
      if (typeof value.resumedAt !== 'string')
        fail('INVALID_TIMESTAMP', 'resumedAt');
      return this.operations.resume(id, value.resumedAt);
    });
  }
  private async respond<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (e) {
      if (e instanceof ContractValidationError)
        throw new BadRequestException({ code: e.code, field: e.path });
      if (e instanceof OperationsError) {
        const response = { code: e.code, field: e.field };
        if (
          ['PIPELINE_RUN_NOT_FOUND', 'PROJECT_SNAPSHOT_NOT_FOUND'].includes(
            e.code,
          )
        )
          throw new NotFoundException(response);
        if (
          [
            'PIPELINE_RUN_ID_REUSED',
            'INVALID_PIPELINE_RUN_TRANSITION',
            'IMMUTABLE_PIPELINE_RUN_IDENTITY',
          ].includes(e.code)
        )
          throw new ConflictException(response);
        if (['INVALID_PERSISTED_PIPELINE_RUN'].includes(e.code))
          throw new InternalServerErrorException(response);
        if (e.code.startsWith('INVALID_') || e.code.startsWith('SNAPSHOT_'))
          throw new BadRequestException(response);
      }
      throw new InternalServerErrorException({
        code: 'CONTENT_OPERATION_FAILED',
      });
    }
  }
}
