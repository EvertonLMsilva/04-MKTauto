import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResearchService } from './application/research.service.js';
import { ContractValidationError } from '../project/domain/project.errors.js';
import { TrendStoreError } from './domain/research.errors.js';
import { ResearchReadError } from './infrastructure/sqlite-research.reader.js';

@Controller('research')
export class ResearchController {
  constructor(
    @Inject(ResearchService) private readonly research: ResearchService,
  ) {}
  @Post('catalog-operations') record(@Body() value: unknown) {
    return this.respond(() => this.research.execute('recordOperation', value));
  }
  @Post('analysis-records') recordAnalysis(@Body() value: unknown) {
    return this.respond(() => this.research.execute('recordAnalysis', value));
  }
  @Post('analyses') analyze(@Body() value: unknown) {
    return this.respond(() => this.research.analyze(value));
  }
  @Get('catalogs/:id') catalog(@Param('id') id: string) {
    return this.respond(() => this.research.get('getRun', id));
  }
  @Get('catalogs/:id/ranking') ranking(@Param('id') id: string) {
    return this.respond(() => this.research.ranking(id));
  }
  @Get('operations/:id') operation(@Param('id') id: string) {
    return this.respond(() => this.research.get('getOperation', id));
  }
  @Get('candidates/:id/history') history(@Param('id') id: string) {
    return this.respond(() => this.research.get('getCandidateHistory', id));
  }
  @Post('runs') begin(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('beginResearchDailyRun', value),
    );
  }
  @Get('runs/:id') run(@Param('id') id: string) {
    return this.respond(() => this.research.get('getResearchDailyRun', id));
  }
  @Post('runs/finish') finish(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('finishResearchDailyRun', value),
    );
  }
  @Post('artifacts') artifact(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('recordResearchArtifact', value),
    );
  }
  @Get('runs/:id/artifact') getArtifact(@Param('id') id: string) {
    return this.respond(() => this.research.get('getResearchArtifact', id));
  }
  @Post('shortlists') shortlist(@Body() value: unknown) {
    return this.respond(() => this.research.shortlist(value));
  }
  @Post('shortlist-records') recordShortlist(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('recordResearchShortlist', value),
    );
  }
  @Get('shortlists/:id') getShortlist(@Param('id') id: string) {
    return this.respond(() => this.research.getShortlist(id));
  }
  @Post('reference-runs') beginReference(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('beginReferenceAnalysisRun', value),
    );
  }
  @Post('reference-runs/finish') finishReference(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('finishReferenceAnalysisRun', value),
    );
  }
  @Get('reference-runs/:id') reference(@Param('id') id: string) {
    return this.respond(() => this.research.get('getReferenceAnalysisRun', id));
  }
  @Post('insights') insight(@Body() value: unknown) {
    return this.respond(() =>
      this.research.execute('recordReferenceInsight', value),
    );
  }
  @Get('insights/:id') getInsight(@Param('id') id: string) {
    return this.respond(() => this.research.getInsight(id));
  }
  private async respond<T>(operation: () => T): Promise<Awaited<T>> {
    try {
      const result = await operation();
      if (result === null)
        throw new NotFoundException({ code: 'RESEARCH_NOT_FOUND' });
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error instanceof ContractValidationError)
        throw new BadRequestException({ code: error.code, field: error.path });
      if (error instanceof ResearchReadError)
        throw new InternalServerErrorException({
          code: error.code,
          field: error.field,
        });
      if (error instanceof TrendStoreError) {
        const body = { code: error.code };
        if (/NOT_FOUND/.test(error.code)) throw new NotFoundException(body);
        if (/REUSED|CONFLICT|IMMUTABLE/.test(error.code))
          throw new ConflictException(body);
        if (error.code === 'SQLITE_BUSY')
          throw new ServiceUnavailableException(body);
        throw new BadRequestException(body);
      }
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new BadRequestException({ code: 'INVALID_RESEARCH_REQUEST' });
      throw new InternalServerErrorException({ code: 'RESEARCH_UNAVAILABLE' });
    }
  }
}
