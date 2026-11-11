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
/** Defaults preserve the synchronous SQLite contract; pg opts in explicitly. */
export type ProjectResult<T, Async extends boolean = false> = Async extends true
  ? Promise<T>
  : T;
export interface CommandRecord {
  idempotencyKey: string;
  commandType: 'CREATE_PROJECT' | 'CREATE_PROJECT_VERSION' | 'ARCHIVE_PROJECT';
  payloadHash: string;
  actor: string;
  occurredAt: string;
}
export interface ProjectActions<Async extends boolean = false> {
  create(snapshot: ProjectSnapshot): ProjectResult<ProjectSnapshot, Async>;
  createVersion(
    snapshot: ProjectSnapshot,
    expectedVersion: number,
  ): ProjectResult<ProjectSnapshot, Async>;
  archive(
    projectId: string,
    expectedVersion: number,
  ): ProjectResult<ProjectRecord, Async>;
}
/** Every operation and its receipt run on one adapter-owned transaction. */
export interface ProjectRepository<Async extends boolean = false> {
  get(
    projectId: string,
    version?: number,
  ): ProjectResult<ProjectSnapshot | null, Async>;
  executeCommand<T extends CommandResult>(
    record: CommandRecord,
    operation: (actions: ProjectActions<Async>) => ProjectResult<T, Async>,
  ): ProjectResult<T, Async>;
  close(): ProjectResult<void, Async>;
}
export interface ProjectRepositoryFactory<Async extends boolean = false> {
  open(readOnly?: boolean): ProjectResult<ProjectRepository<Async>, Async>;
}
