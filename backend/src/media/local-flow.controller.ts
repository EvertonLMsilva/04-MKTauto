import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { LocalFlowService } from './application/local-flow.service.js';
@Controller('media/local')
export class LocalFlowController {
  constructor(
    @Inject(LocalFlowService) private readonly flow: LocalFlowService,
  ) {}
  private async respond<T>(action: () => T | Promise<T>) {
    try {
      return await action();
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : 'LOCAL_MEDIA_FAILED';
      const body = { code };
      if (/NOT_FOUND/.test(code)) throw new NotFoundException(body);
      if (/UNAVAILABLE|CONFIGURATION_REQUIRED/.test(code))
        throw new ServiceUnavailableException(body);
      if (/REUSED|CONFLICT|PREVIEW_BLOCKED/.test(code))
        throw new ConflictException(body);
      if (code === 'LOCAL_MEDIA_FAILED' || code.startsWith('ERR_SQLITE'))
        throw new InternalServerErrorException(body);
      throw new BadRequestException(body);
    }
  }
  @Post('audio') ingest(@Body() value: unknown) {
    return this.respond(() => this.flow.ingest(value));
  }
  @Post('alignments') alignment(@Body() value: unknown) {
    return this.respond(() => this.flow.acceptAlignment(value));
  }
  @Post('alignments/:id/subtitles') subtitles(@Param('id') id: string) {
    return this.respond(() => this.flow.subtitles(id));
  }
  @Post('compositions') compose(@Body() value: unknown) {
    return this.respond(() => this.flow.compose(value));
  }
  @Post('renders/:id/subtitles/:subtitleId') burn(
    @Param('id') id: string,
    @Param('subtitleId') subtitleId: string,
  ) {
    return this.respond(() => this.flow.burn(id, subtitleId));
  }
  @Post('renders/:id/qc') qc(@Param('id') id: string) {
    return this.respond(() => this.flow.qc(id));
  }
  @Get('previews/:id') preview(@Param('id') id: string) {
    return this.respond(() => this.flow.preview(id));
  }
  @Get('previews/:id/file') file(@Param('id') id: string) {
    return this.respond(
      async () =>
        new StreamableFile(await this.flow.previewBytes(id), {
          type: 'video/mp4',
          disposition: 'inline',
        }),
    );
  }
}
