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
import { ContentService } from './application/content.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
import { ContractValidationError as AffiliateContractValidationError } from '../affiliate/domain/affiliate.errors.js';

@Controller('content')
export class ContentController {
  constructor(
    @Inject(ContentService) private readonly content: ContentService,
  ) {}
  @Post('idea-batches') batch(@Body() value: unknown) {
    return this.respond(() => this.content.registerBatch(value));
  }
  @Get('ideas') ideas(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.content.listIdeas(id));
  }
  @Get('ideas/:id') idea(@Param('id') id: string) {
    return this.respond(() => this.content.getIdea(id));
  }
  @Post('idea-selections') select(@Body() value: unknown) {
    return this.respond(() => this.content.selectIdea(value));
  }
  @Get('idea-selections') selections(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.content.listSelections(id));
  }
  @Get('idea-selections/:id') selection(@Param('id') id: string) {
    return this.respond(() => this.content.getSelection(id));
  }
  @Post('affiliate-selections') affiliate(@Body() value: unknown) {
    return this.respond(() => this.content.selectAffiliate(value));
  }
  @Get('affiliate-selections/:id') affiliateSelection(@Param('id') id: string) {
    return this.respond(() => this.content.getAffiliateSelection(id));
  }
  @Post('scripts') script(@Body() value: unknown) {
    return this.respond(() => this.content.registerScript(value));
  }
  @Get('scripts') scripts(@Query('pipelineRunId') id: string) {
    return this.respond(() => this.content.listScripts(id));
  }
  @Get('scripts/:id') getScript(@Param('id') id: string) {
    return this.respond(() => this.content.getScript(id));
  }
  private async respond<T>(operation: () => T): Promise<Awaited<T>> {
    let result: Awaited<T>;
    try {
      result = await operation();
    } catch (error) {
      if (
        error instanceof ContractValidationError ||
        error instanceof AffiliateContractValidationError
      )
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
      throw new InternalServerErrorException({ code: 'CONTENT_UNAVAILABLE' });
    }
    if (result === null)
      throw new NotFoundException({ code: 'CONTENT_NOT_FOUND' });
    return result;
  }
}
