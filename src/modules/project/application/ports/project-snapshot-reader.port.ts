export const PROJECT_SNAPSHOT_READER = Symbol('PROJECT_SNAPSHOT_READER');
import type { ProjectSnapshot } from '../../domain/project-contracts.js';
export type { ProjectSnapshot } from '../../domain/project-contracts.js';

export interface ProjectSnapshotReader {
  get(projectId: string, version?: number): Promise<ProjectSnapshot | null>;
}
