import { ProjectRepositoryError } from './project.errors.js';
export function assertProjectTransition(
  project: { latestVersion: number; archivedAt: string | null } | undefined,
  expectedVersion: number,
  nextVersion?: number,
): void {
  if (!project)
    throw new ProjectRepositoryError(
      'PROJECT_NOT_FOUND',
      'project.id',
      'projeto não encontrado',
    );
  if (project.archivedAt)
    throw new ProjectRepositoryError(
      'PROJECT_ARCHIVED',
      'project.id',
      nextVersion === undefined
        ? 'projeto já arquivado'
        : 'projeto arquivado não aceita versões',
    );
  if (project.latestVersion !== expectedVersion)
    throw new ProjectRepositoryError(
      'EXPECTED_VERSION_MISMATCH',
      'expectedVersion',
      `esperada ${expectedVersion}; atual ${project.latestVersion}`,
    );
  if (nextVersion !== undefined && nextVersion !== expectedVersion + 1)
    throw new ProjectRepositoryError(
      'PROJECT_VERSION_CONFLICT',
      'project.version',
      'a nova versão deve suceder a versão esperada',
    );
}
