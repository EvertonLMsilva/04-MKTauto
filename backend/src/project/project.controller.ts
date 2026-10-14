import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import type {
  CreateProjectDto,
  CreateProjectVersionDto,
  ArchiveProjectDto,
} from './application/project-commands.dto.js';
import { ProjectService } from './application/project.service.js';

@Controller('projects')
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly projects: ProjectService,
  ) {}

  @Get(':projectId')
  getCurrent(@Param('projectId') projectId: string) {
    return this.projects.getCurrent(projectId);
  }

  @Post()
  create(@Body() command: CreateProjectDto) {
    return this.projects.create(command);
  }

  @Post(':projectId/versions')
  createVersion(
    @Param('projectId') projectId: string,
    @Body() command: CreateProjectVersionDto,
  ) {
    return this.projects.createVersion(projectId, command);
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  archive(
    @Param('projectId') projectId: string,
    @Body() command: ArchiveProjectDto,
  ) {
    return this.projects.archive(projectId, command);
  }

  @Get(':projectId/versions/:version')
  getVersion(
    @Param('projectId') projectId: string,
    @Param('version') version: string,
  ) {
    return this.projects.getVersion(projectId, version);
  }
}
