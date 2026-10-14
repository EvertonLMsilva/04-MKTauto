import type { ProjectSnapshot } from './project-snapshot-reader.port.js';
import type {
  CreateProjectDto,
  CreateProjectVersionDto,
  ArchiveProjectDto,
} from '../project-commands.dto.js';

export const PROJECT_COMMANDS = Symbol('PROJECT_COMMANDS');
export interface ArchivedProject {
  readonly id: string;
  readonly latestVersion: number;
  readonly archivedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly snapshot: ProjectSnapshot;
}
export interface ProjectCommands {
  createProject(command: CreateProjectDto): Promise<ProjectSnapshot>;
  createProjectVersion(
    command: CreateProjectVersionDto,
  ): Promise<ProjectSnapshot>;
  archiveProject(command: ArchiveProjectDto): Promise<ArchivedProject>;
}
export class ProjectCommandError extends Error {
  constructor(
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(code);
  }
}
