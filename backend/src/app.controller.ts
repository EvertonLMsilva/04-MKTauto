import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(
    @Req() request?: Request,
    @Res({ passthrough: true }) response?: Response,
  ): string | void {
    if (request?.headers.accept?.includes('text/html')) {
      response?.redirect('/operations');
      return;
    }
    return this.appService.getHello();
  }
}
