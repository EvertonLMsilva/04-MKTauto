import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PROJECT_SNAPSHOT_READER } from './ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from './ports/project-snapshot-reader.port.js';
import {
  PROJECT_COMMANDS,
  ProjectCommandError,
} from './ports/project-commands.port.js';
import type { ProjectCommands } from './ports/project-commands.port.js';
import type {
  CreateProjectDto,
  CreateProjectVersionDto,
  ArchiveProjectDto,
} from './project-commands.dto.js';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly reader: ProjectSnapshotReader,
    @Optional()
    @Inject(PROJECT_COMMANDS)
    private readonly commands?: ProjectCommands,
  ) {}

  async getCurrent(projectId: string) {
    this.validateId(projectId);
    return this.read(projectId);
  }

  create(command: CreateProjectDto) {
    return this.execute('createProject', command);
  }
  createVersion(projectId: string, command: CreateProjectVersionDto) {
    this.validateId(projectId);
    if (command?.project?.id !== projectId)
      throw new BadRequestException({ code: 'PROJECT_ID_MISMATCH' });
    return this.execute('createProjectVersion', command);
  }
  archive(projectId: string, command: ArchiveProjectDto) {
    this.validateId(projectId);
    if (command?.projectId !== projectId)
      throw new BadRequestException({ code: 'PROJECT_ID_MISMATCH' });
    return this.execute('archiveProject', command);
  }
  private async execute<K extends keyof ProjectCommands>(
    operation: K,
    command: Parameters<ProjectCommands[K]>[0],
  ) {
    try {
      if (!this.commands) throw new Error('Project commands unavailable');
      const invoke = this.commands[operation] as (
        value: Parameters<ProjectCommands[K]>[0],
      ) => ReturnType<ProjectCommands[K]>;
      return await invoke.call(this.commands, command);
    } catch (error) {
      if (error instanceof ProjectCommandError) {
        const response = { code: error.code, field: error.field };
        if (error.code === 'PROJECT_NOT_FOUND')
          throw new NotFoundException(response);
        if (
          [
            'PROJECT_ID_CONFLICT',
            'PROJECT_VERSION_CONFLICT',
            'EXPECTED_VERSION_MISMATCH',
            'PROJECT_ARCHIVED',
            'IDEMPOTENCY_KEY_REUSED',
          ].includes(error.code)
        )
          throw new ConflictException(response);
        if (error.code.startsWith('IMMUTABLE_'))
          throw new InternalServerErrorException({
            code: 'PROJECT_COMMAND_FAILED',
          });
        throw new BadRequestException(response);
      }
      throw new InternalServerErrorException({
        code: 'PROJECT_COMMAND_FAILED',
      });
    }
  }
  private validateId(projectId: string) {
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(projectId))
      throw new BadRequestException({
        code: 'INVALID_PROJECT_ID',
        field: 'projectId',
      });
  }

  async getVersion(projectId: string, rawVersion: string) {
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/.test(projectId)) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_ID',
        field: 'projectId',
      });
    }
    const version = Number(rawVersion);
    if (!/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version)) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_VERSION',
        field: 'version',
      });
    }
    return this.read(projectId, version);
  }

  private async read(projectId: string, version?: number) {
    let snapshot;
    try {
      snapshot = await this.reader.get(projectId, version);
    } catch {
      throw new InternalServerErrorException({
        code: 'PROJECT_READ_FAILED',
        message: 'Não foi possível consultar o projeto.',
      });
    }
    if (snapshot === null) {
      throw new NotFoundException({
        code: 'PROJECT_SNAPSHOT_NOT_FOUND',
        field: 'version',
      });
    }
    return snapshot;
  }
}
