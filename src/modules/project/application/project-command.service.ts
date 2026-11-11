import { Inject, Injectable } from '@nestjs/common';
import { PROJECT_REPOSITORY } from './ports/project-repository.port.js';
import type { ProjectRepositoryFactory } from './ports/project-repository.port.js';
import type { ProjectCommands } from './ports/project-commands.port.js';
import type {
  CreateProjectDto,
  CreateProjectVersionDto,
  ArchiveProjectDto,
} from './project-commands.dto.js';
import { ProjectApplicationService } from './project-application.service.js';
import type {
  CommandResult,
  ProjectResult,
} from './ports/project-repository.port.js';
import type { ProjectSnapshot } from '../domain/project-contracts.js';
import type { ProjectRecord } from './ports/project-repository.port.js';

@Injectable()
export class ProjectCommandService<
  Async extends boolean = false,
> implements ProjectCommands {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly persistence: ProjectRepositoryFactory<Async>,
  ) {}
  createProject(command: CreateProjectDto) {
    return this.execute<ProjectSnapshot>((service) =>
      service.createProject(command),
    );
  }
  createProjectVersion(command: CreateProjectVersionDto) {
    return this.execute<ProjectSnapshot>((service) =>
      service.createProjectVersion(command),
    );
  }
  archiveProject(command: ArchiveProjectDto) {
    return this.execute<ProjectRecord>((service) =>
      service.archiveProject(command),
    ) as ReturnType<ProjectCommands['archiveProject']>;
  }
  private async execute<T extends CommandResult>(
    run: (service: ProjectApplicationService<Async>) => ProjectResult<T, Async>,
  ): Promise<T> {
    const repository = await this.persistence.open();
    try {
      return await run(new ProjectApplicationService<Async>(repository));
    } finally {
      await repository.close();
    }
  }
}
