import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Query,
  UseGuards,
  Inject,
  HttpException,
  StreamableFile,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  LocalQcGuard,
  QC_REVIEWER_CONTEXT,
} from '../publishing/application/local-qc.guard.js';
import { operationalQcSessions } from '../publishing/application/local-qc-session.js';
import { OperationsService } from './operations.service.js';
import {
  operationsPage,
  operationsScript,
  operationsStyles,
} from './operations-page.js';
type QcRequest = Request & { [QC_REVIEWER_CONTEXT]?: unknown };

@Controller('operations')
export class OperationsController {
  constructor(
    @Inject(OperationsService) private readonly operations: OperationsService,
  ) {}
  private async respond<T>(action: () => T | Promise<T>) {
    try {
      return await action();
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'OPERATIONS_UNAVAILABLE';
      const status =
        error &&
        typeof error === 'object' &&
        'status' in error &&
        typeof error.status === 'number'
          ? error.status
          : /NOT_FOUND/.test(code)
            ? 404
            : /CONFLICT|STALE|REUSED|BLOCKED/.test(code)
              ? 409
              : /UNAVAILABLE|CONFIGURATION|SCHEMA/.test(code)
                ? 503
                : /REQUIRED|INVALID|MISMATCH|RIGHTS|AUDIO/.test(code)
                  ? 400
                  : 500;
      throw new HttpException({ code }, status);
    }
  }
  private headers(response: Response, type: string) {
    response.type(type).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
  }
  @Get() page(@Res({ passthrough: true }) response: Response) {
    this.headers(response, 'html');
    return operationsPage;
  }
  @Get('app.js') script(@Res({ passthrough: true }) response: Response) {
    this.headers(response, 'application/javascript');
    return operationsScript;
  }
  @Get('styles.css') styles(@Res({ passthrough: true }) response: Response) {
    this.headers(response, 'css');
    return operationsStyles;
  }
  @Post('session') login(
    @Body() input: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set('Cache-Control', 'no-store');
    return this.respond(async () => {
      const session = await operationalQcSessions.login(input, request);
      response.set('Set-Cookie', session.cookie);
      return { operatorId: session.operatorId, csrfToken: session.csrfToken };
    });
  }
  @Get('session') session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.set('Cache-Control', 'no-store');
    return this.respond(() => operationalQcSessions.current(request));
  }
  @Post('logout') logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(() => {
      response.set('Set-Cookie', operationalQcSessions.logout(request));
      return { loggedOut: true };
    });
  }
  @Get('instagram/connection') @UseGuards(LocalQcGuard) instagramConnection() {
    return this.respond(() => this.operations.instagramConnection());
  }
  @Post('instagram/connection/check')
  @UseGuards(LocalQcGuard)
  checkInstagramConnection(@Body() value: unknown) {
    return this.respond(() => this.operations.checkInstagramConnection(value));
  }
  @Get('executions') @UseGuards(LocalQcGuard) list() {
    return this.respond(() => this.operations.list());
  }
  @Get('executions/:id') @UseGuards(LocalQcGuard) detail(
    @Param('id') id: string,
  ) {
    return this.respond(() => this.operations.detail(id));
  }
  @Post('executions/:id/advance') @UseGuards(LocalQcGuard) advance(
    @Param('id') id: string,
  ) {
    return this.respond(() => this.operations.advance(id));
  }
  @Post('executions/:id/retry') @UseGuards(LocalQcGuard) retry(
    @Param('id') id: string,
  ) {
    return this.respond(() => this.operations.retry(id));
  }
  @Post('executions/:id/media/:mediaId/context')
  @UseGuards(LocalQcGuard)
  context(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() input: { referenceId?: string },
  ) {
    return this.respond(() => {
      if (
        !input ||
        Object.keys(input).some((key) => key !== 'referenceId') ||
        (input.referenceId !== undefined &&
          typeof input.referenceId !== 'string')
      )
        throw Object.assign(new Error('INVALID_REVIEW_CONTEXT'), {
          code: 'INVALID_REVIEW_CONTEXT',
        });
      return this.operations.reviewContext(id, mediaId, input.referenceId);
    });
  }
  @Get('executions/:id/media/:mediaId/:referenceId/file')
  @UseGuards(LocalQcGuard)
  file(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Param('referenceId') referenceId: string,
    @Query('kind') kind: string,
  ) {
    return this.respond(async () => {
      if (!['video', 'reference'].includes(kind))
        throw Object.assign(new Error('INVALID_MEDIA_KIND'), {
          code: 'INVALID_MEDIA_KIND',
        });
      return new StreamableFile(
        await this.operations.reviewBytes(
          id,
          mediaId,
          referenceId,
          kind as 'video' | 'reference',
        ),
        {
          type: kind === 'video' ? 'video/mp4' : 'image/png',
          disposition: 'inline',
        },
      );
    });
  }
  @Post('executions/:id/audio')
  @UseGuards(LocalQcGuard)
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 20971520, files: 1, fields: 3, fieldSize: 2000 },
    }),
  )
  audio(
    @Param('id') id: string,
    @Body() input: Record<string, string>,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() request: QcRequest,
  ) {
    return this.respond(() => {
      if (
        !file ||
        Object.keys(input).sort().join(',') !==
          'commercialUseAllowed,statement,usageBasis'
      )
        throw Object.assign(new Error('LOCAL_RIGHTS_EVIDENCE_REQUIRED'), {
          code: 'LOCAL_RIGHTS_EVIDENCE_REQUIRED',
        });
      return this.operations.recording(
        id,
        {
          audioBase64: file.buffer.toString('base64'),
          usageBasis: input.usageBasis,
          commercialUseAllowed: input.commercialUseAllowed === 'true',
          statement: input.statement,
        },
        request[QC_REVIEWER_CONTEXT],
      );
    });
  }
  @Post('executions/:id/final-review') @UseGuards(LocalQcGuard) finalReview(
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() request: QcRequest,
  ) {
    return this.respond(() =>
      this.operations.finalDecision(id, input, request[QC_REVIEWER_CONTEXT]),
    );
  }
  @Get('executions/:id/instagram')
  @UseGuards(LocalQcGuard)
  instagramStatus(@Param('id') id: string) {
    return this.respond(() => this.operations.instagramStatus(id));
  }
  @Post('executions/:id/instagram/package')
  @UseGuards(LocalQcGuard)
  instagramPackage(@Param('id') id: string, @Body() value: unknown) {
    return this.respond(() => this.operations.prepareInstagram(id, value));
  }
  @Post('executions/:id/instagram/schedule')
  @UseGuards(LocalQcGuard)
  instagramSchedule(
    @Param('id') id: string,
    @Body() value: unknown,
    @Req() request: QcRequest,
  ) {
    return this.respond(() =>
      this.operations.scheduleInstagram(
        id,
        value,
        request[QC_REVIEWER_CONTEXT],
      ),
    );
  }
  @Post('executions/:id/instagram/cancel')
  @UseGuards(LocalQcGuard)
  instagramCancel(@Param('id') id: string) {
    return this.respond(() => this.operations.cancelInstagram(id));
  }
  @Post('executions/:id/instagram/refresh')
  @UseGuards(LocalQcGuard)
  instagramRefresh(@Param('id') id: string) {
    return this.respond(() => this.operations.refreshInstagram(id));
  }
  @Get('executions/:id/final.mp4') @UseGuards(LocalQcGuard) final(
    @Param('id') id: string,
    @Query('download') download: string,
  ) {
    return this.respond(
      async () =>
        new StreamableFile(await this.operations.finalBytes(id), {
          type: 'video/mp4',
          disposition:
            download === '1'
              ? 'attachment; filename="video-final.mp4"'
              : 'inline',
        }),
    );
  }
}
