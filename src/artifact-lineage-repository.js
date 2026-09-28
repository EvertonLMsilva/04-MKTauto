import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { PipelineRunRepository } from "./pipeline-run-repository.js";

export class ArtifactLineageRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "ArtifactLineageRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class ArtifactLineageRepository extends PipelineRunRepository {
  registerArtifact(value) {
    const artifact = validateArtifactLineage(value);
    const identityHash = stableHash(artifact);
    return this.#transaction(() => {
      const prior = this.db.prepare("SELECT identity_hash FROM artifact_lineage WHERE artifact_id = ?")
        .get(artifact.artifactId);
      if (prior) {
        if (prior.identity_hash !== identityHash) {
          throw failure("ARTIFACT_ID_REUSED", "artifactId", "identidade já usada com conteúdo incompatível");
        }
        return this.getArtifact(artifact.artifactId);
      }

      const logicalPrior = artifact.contentIdentity === null ? null : this.db.prepare(`SELECT artifact_id
        FROM artifact_lineage WHERE artifact_type = ? AND content_identity = ? AND artifact_version = ?`)
        .get(artifact.artifactType, artifact.contentIdentity, artifact.artifactVersion);
      if (logicalPrior) {
        throw failure("ARTIFACT_CONTENT_IDENTITY_REUSED", "contentIdentity", "identidade lógica e versão já registradas");
      }

      const run = this.getRun(artifact.pipelineRunId);
      if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
      if (run.projectId !== artifact.projectId || run.projectVersion !== artifact.projectVersion) {
        const field = run.projectId !== artifact.projectId ? "projectId" : "projectVersion";
        throw failure("ARTIFACT_RUN_SCOPE_MISMATCH", field, "artefato diverge do escopo da execução");
      }
      this.#validateInternalInputs(artifact);

      this.db.prepare(`INSERT INTO artifact_lineage
        (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
         pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
         content_hash, generation_metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(artifact.artifactId, artifact.schemaVersion, artifact.artifactType,
          artifact.artifactVersion, identityHash, artifact.pipelineRunId, artifact.projectId,
          artifact.projectVersion, artifact.contentIdentity, artifact.hashAlgorithm,
          artifact.contentHash, jsonOrNull(artifact.generationMetadata), artifact.createdAt);
      const insertInput = this.db.prepare(`INSERT INTO artifact_lineage_inputs
        (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
      for (const input of artifact.inputs) {
        insertInput.run(artifact.artifactId, input.position, input.kind, input.inputId, input.contentHash);
      }
      return this.getArtifact(artifact.artifactId);
    });
  }

  getArtifact(artifactId) {
    requireIdentifier(artifactId, "artifactId");
    const row = this.db.prepare("SELECT * FROM artifact_lineage WHERE artifact_id = ?").get(artifactId);
    if (!row) return null;
    const inputs = this.db.prepare(`SELECT position, kind, input_id, content_hash
      FROM artifact_lineage_inputs WHERE artifact_id = ? ORDER BY position`).all(artifactId);
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
        generationMetadata: parseNullableJson(row.generation_metadata_json),
        createdAt: row.created_at,
      });
      if (stableHash(artifact) !== row.identity_hash) {
        throw failure("INVALID_PERSISTED_ARTIFACT", "artifactId", "integridade do artefato persistido inválida");
      }
      return artifact;
    } catch (caught) {
      if (caught instanceof ArtifactLineageRepositoryError) throw caught;
      if (caught instanceof ContractValidationError || caught instanceof SyntaxError) {
        throw failure("INVALID_PERSISTED_ARTIFACT", "artifactId", "artefato persistido inválido", { cause: caught });
      }
      throw caught;
    }
  }

  listByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT artifact_id FROM artifact_lineage
      WHERE pipeline_run_id = ? ORDER BY created_at, artifact_id`).all(pipelineRunId)
      .map(({ artifact_id: artifactId }) => this.getArtifact(artifactId));
  }

  #validateInternalInputs(artifact) {
    artifact.inputs.forEach((input, index) => {
      if (input.kind !== "INTERNAL_ARTIFACT") return;
      const prior = this.db.prepare(`SELECT pipeline_run_id, project_id, project_version, content_hash
        FROM artifact_lineage WHERE artifact_id = ?`).get(input.inputId);
      if (!prior) {
        throw failure("ARTIFACT_INPUT_NOT_FOUND", `inputs.${index}.inputId`, "artefato de entrada não encontrado");
      }
      if (prior.pipeline_run_id !== artifact.pipelineRunId
        || prior.project_id !== artifact.projectId
        || prior.project_version !== artifact.projectVersion) {
        throw failure("ARTIFACT_INPUT_SCOPE_MISMATCH", `inputs.${index}.inputId`, "entrada pertence a outro escopo");
      }
      if (prior.content_hash !== input.contentHash) {
        throw failure("ARTIFACT_INPUT_HASH_MISMATCH", `inputs.${index}.contentHash`, "hash diverge da entrada persistida");
      }
    });
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(caught);
    }
  }
}

function requireIdentifier(value, field) {
  if (typeof value !== "string" || value.length > 200 || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) {
    throw failure("INVALID_IDENTIFIER", field, "identificador inválido");
  }
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jsonOrNull(value) {
  return value === null ? null : JSON.stringify(value);
}

function parseNullableJson(value) {
  return value === null ? null : JSON.parse(value);
}

function mapSqliteError(caught) {
  if (caught instanceof ArtifactLineageRepositoryError) return caught;
  const message = String(caught?.message);
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) {
    return failure("ARTIFACT_CONTENT_IDENTITY_REUSED", "contentIdentity", "identidade lógica e versão já registradas", { cause: caught });
  }
  if (message.includes("ARTIFACT_RUN_SCOPE_MISMATCH")) {
    return failure("ARTIFACT_RUN_SCOPE_MISMATCH", "projectVersion", "artefato diverge do escopo da execução", { cause: caught });
  }
  if (message.includes("IMMUTABLE_ARTIFACT_INPUT")) {
    return failure("IMMUTABLE_ARTIFACT_INPUT", "inputs", "linhagem é imutável", { cause: caught });
  }
  if (message.includes("IMMUTABLE_ARTIFACT")) {
    return failure("IMMUTABLE_ARTIFACT", "artifactId", "artefato é imutável", { cause: caught });
  }
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) {
    return failure("ARTIFACT_PERSISTENCE_FAILED", "artifact", "não foi possível persistir o artefato", { cause: caught });
  }
  return caught;
}

function failure(code, field, message, options) {
  return new ArtifactLineageRepositoryError(code, field, message, options);
}
