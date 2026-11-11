import {
  Body,
  Controller,
  Inject,
  Post,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EditorialFlowService } from './application/editorial-flow.service.js';

@Controller('content')
export class EditorialFlowController {
  constructor(
    @Inject(EditorialFlowService)
    private readonly editorial: EditorialFlowService,
  ) {}
  @Post('editorial-generations')
  async generate(@Body() value: unknown) {
    try {
      return await this.editorial.generate(value);
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const coded = error as Error & {
          code: string;
          field?: string;
          path?: string;
        };
        const body = {
          code: coded.code,
          field: coded.field ?? coded.path ?? 'request',
        };
        if (/PERSISTENCE_FAILED|INVALID_PERSISTED/.test(body.code))
          throw new InternalServerErrorException(body);
        if (body.code === 'EDITORIAL_PROVIDER_UNAVAILABLE')
          throw new ServiceUnavailableException(body);
        if (body.code.endsWith('NOT_FOUND')) throw new NotFoundException(body);
        if (/CONFLICT|REUSED|RUNNING|UNKNOWN/.test(body.code))
          throw new ConflictException(body);
        throw new BadRequestException(body);
      }
      throw new InternalServerErrorException({ code: 'EDITORIAL_UNAVAILABLE' });
    }
  }
}
