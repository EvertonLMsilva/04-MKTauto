import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import { OperationsError } from '../../content-operations/domain/operations-contracts.js';
import type { ContentService } from '../../content/application/content.service.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { ArtifactLineageRepositoryError } from './lineage-errors.js';

export class MediaDatabase {
  readonly db: DatabaseSync;
  constructor(
    path: string,
    private readonly operations: Pick<ContentOperationsService, 'get'>,
    private readonly content: Pick<ContentService, 'getScript'>,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) {
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      preflight.exec('PRAGMA busy_timeout=5000;');
      if (
        ![39, 40, 41, 42].includes(
          Number(preflight.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(preflight.prepare('PRAGMA user_version').get()?.user_version) >=
          41 &&
          preflight
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw new Error('MEDIA_SCHEMA_VERSION_UNSUPPORTED');
    } finally {
      preflight.close();
    }
    this.db = new DatabaseSync(path, { readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec(
        readOnly ? 'PRAGMA query_only=ON;' : 'PRAGMA foreign_keys=ON;',
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  getRun(id: string) {
    try {
      return this.operations.get(id);
    } catch (error) {
      if (
        error instanceof OperationsError &&
        error.code === 'PIPELINE_RUN_NOT_FOUND'
      )
        return null;
      throw error;
    }
  }
  getScript(id: string) {
    return this.content.getScript(id);
  }
  getArtifact(
    artifactId: string,
  ): {
    artifactId: string;
    artifactType: string;
    contentHash: string;
    inputs: {
      position: number;
      kind: string;
      inputId: string;
      contentHash: string;
    }[];
    [key: string]: unknown;
  } | null {
    if (
      typeof artifactId !== 'string' ||
      artifactId.length > 200 ||
      !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(artifactId)
    )
      throw new ArtifactLineageRepositoryError(
        'INVALID_IDENTIFIER',
        'artifactId',
        'identificador inválido',
      );
    const row = this.db
      .prepare('SELECT * FROM artifact_lineage WHERE artifact_id=?')
      .get(artifactId);
    if (!row) return null;
    const inputs = this.db
      .prepare(
        'SELECT position,kind,input_id,content_hash FROM artifact_lineage_inputs WHERE artifact_id=? ORDER BY position',
      )
      .all(artifactId);
    try {
      const artifact = validateArtifactLineage({
        schemaVersion: row.schema_version,
        artifactId: row.artifact_id,
        artifactType: row.artifact_type,
        artifactVersion: row.artifact_version,
        pipelineRunId: row.pipeline_run_id,
        projectId: row.project_id,
        projectVersion: row.project_version,
        contentIdentity: row.content_identity,
        hashAlgorithm: row.hash_algorithm,
        contentHash: row.content_hash,
        inputs: inputs.map((input) => ({
          position: input.position,
          kind: input.kind,
          inputId: input.input_id,
          contentHash: input.content_hash,
        })),
        generationMetadata:
          row.generation_metadata_json === null
            ? null
            : JSON.parse(String(row.generation_metadata_json)),
        createdAt: row.created_at,
      });
      if (
        createHash('sha256').update(JSON.stringify(artifact)).digest('hex') !==
        row.identity_hash
      )
        throw new ArtifactLineageRepositoryError(
          'INVALID_PERSISTED_ARTIFACT',
          'artifactId',
          'integridade do artefato persistido inválida',
        );
      return artifact;
    } catch (cause) {
      if (cause instanceof ArtifactLineageRepositoryError) throw cause;
      if (
        cause instanceof ContractValidationError ||
        cause instanceof SyntaxError
      )
        throw new ArtifactLineageRepositoryError(
          'INVALID_PERSISTED_ARTIFACT',
          'artifactId',
          'artefato persistido inválido',
          { cause },
        );
      throw cause;
    }
  }
}
