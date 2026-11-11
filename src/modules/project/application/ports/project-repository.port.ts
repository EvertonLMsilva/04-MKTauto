import type { ProjectSnapshot } from '../../domain/project-contracts.js';
export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
export interface ProjectRecord {
  readonly id: string;
  readonly latestVersion: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly snapshot: ProjectSnapshot;
}
export type CommandResult = ProjectSnapshot | ProjectRecord;
export interface CommandRecord {
  idempotencyKey: string;
  commandType: 'CREATE_PROJECT' | 'CREATE_PROJECT_VERSION' | 'ARCHIVE_PROJECT';
  payloadHash: string;
  actor: string;
  occurredAt: string;
}
export interface ProjectActions {
  create(snapshot: ProjectSnapshot): ProjectSnapshot;
  createVersion(
    snapshot: ProjectSnapshot,
    expectedVersion: number,
  ): ProjectSnapshot;
  archive(projectId: string, expectedVersion: number): ProjectRecord;
}
/** Operations and callbacks run synchronously within a single SQLite transaction. */
export interface ProjectRepository {
  get(projectId: string, version?: number): ProjectSnapshot | null;
  executeCommand<T extends CommandResult>(
    record: CommandRecord,
    operation: (actions: ProjectActions) => T,
  ): T;
  close(): void;
}
export interface ProjectRepositoryFactory {
  open(readOnly?: boolean): ProjectRepository;
}
