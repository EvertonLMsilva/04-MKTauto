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
import type { CommandResult } from './ports/project-repository.port.js';

@Injectable()
export class ProjectCommandService implements ProjectCommands {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly persistence: ProjectRepositoryFactory,
  ) {}
  createProject(command: CreateProjectDto) {
    return this.execute((service) => service.createProject(command));
  }
  createProjectVersion(command: CreateProjectVersionDto) {
    return this.execute((service) => service.createProjectVersion(command));
  }
  archiveProject(command: ArchiveProjectDto) {
    return this.execute((service) =>
      service.archiveProject(command),
    ) as ReturnType<ProjectCommands['archiveProject']>;
  }
  private async execute<T extends CommandResult>(
    run: (service: ProjectApplicationService) => T,
  ): Promise<T> {
    const repository = this.persistence.open();
    try {
      return run(new ProjectApplicationService(repository));
    } finally {
      repository.close();
    }
  }
}
