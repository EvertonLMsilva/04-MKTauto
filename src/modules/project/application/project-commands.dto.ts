/** Runtime validation is performed by the Project domain and command contracts. */
export interface ProjectInputDto {
  id: string;
  name: string;
  version?: number;
  niche: string;
  subniches?: string[];
  audience: { profile: string; language?: string };
  channel?: Record<string, unknown>;
  references?: readonly Record<string, unknown>[];
  schemaVersion?: string;
}

export interface CreateProjectDto {
  idempotencyKey: string;
  actor: string;
  occurredAt: string;
  project: ProjectInputDto;
}

export interface CreateProjectVersionDto extends CreateProjectDto {
  expectedVersion: number;
}

export interface ArchiveProjectDto {
  idempotencyKey: string;
  actor: string;
  occurredAt: string;
  projectId: string;
  expectedVersion: number;
}
