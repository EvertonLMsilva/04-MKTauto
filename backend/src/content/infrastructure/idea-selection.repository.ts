import type { IdeaSelection } from '../domain/content.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
  validateArtifactLineage,
} from '../domain/artifact-lineage-contracts.js';
import { validateIdeaSelection } from '../domain/idea-selection-contracts.js';
import { IdeaRepository } from './idea.repository.js';
export class IdeaSelectionRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'IdeaSelectionRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class IdeaSelectionRepository extends IdeaRepository {
  registerSelection(value: unknown): IdeaSelection {
    let selection;
    try {
      selection = validateIdeaSelection(value);
    } catch (caught) {
      throw mapError(caught);
    }
    return this.#transaction(() => {
      const prior = this.db
        .prepare(
          'SELECT content_hash FROM idea_selections WHERE idea_selection_id = ?',
        )
        .get(selection.ideaSelectionId);
      if (prior) {
        if (prior.content_hash !== selection.contentHash) {
          throw failure(
            'IDEA_SELECTION_ID_REUSED',
            'ideaSelectionId',
            'ID já usado com decisão incompatível',
          );
        }
        return this.getSelection(selection.ideaSelectionId)!;
      }
      const run = this.getRun(selection.pipelineRunId);
      if (!run)
        throw failure(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
          'execução não encontrada',
        );
      verifyScope(run, selection, 'IDEA_SELECTION_RUN_SCOPE_MISMATCH');
      const idea = this.getIdea(selection.ideaCandidateId);
      if (!idea)
        throw failure(
          'IDEA_CANDIDATE_NOT_FOUND',
          'ideaCandidateId',
          'ideia não encontrada',
        );
      const score = this.getScore(selection.ideaScoreId);
      if (!score)
        throw failure(
          'IDEA_SCORE_NOT_FOUND',
          'ideaScoreId',
          'score não encontrado',
        );
      verifySelectedArtifacts(selection, idea, score);
      const previous = this.#validateRevision(selection);
      this.#insertLineage(selection, previous);
      this.db
        .prepare(
          `INSERT INTO idea_selections
        (idea_selection_id, schema_version, pipeline_run_id, project_id, project_version,
         idea_batch_id, idea_candidate_id, idea_score_id, idea_content_hash,
         idea_score_content_hash, decision, actor_type, actor_id, decided_at,
         editorial_rationale, revision, supersedes_idea_selection_id, content_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          selection.ideaSelectionId,
          selection.schemaVersion,
          selection.pipelineRunId,
          selection.projectId,
          selection.projectVersion,
          selection.ideaBatchId,
          selection.ideaCandidateId,
          selection.ideaScoreId,
          selection.ideaContentHash,
          selection.ideaScoreContentHash,
          selection.decision,
          selection.actor.type,
          selection.actor.id,
          selection.decidedAt,
          selection.editorialRationale,
          selection.revision,
          selection.supersedesIdeaSelectionId,
          selection.contentHash,
          JSON.stringify(selection),
        );
      return this.getSelection(selection.ideaSelectionId)!;
    });
  }
  getSelection(ideaSelectionId: string): IdeaSelection | null {
    requireIdentifier(ideaSelectionId, 'ideaSelectionId', 200);
    const row = this.db
      .prepare('SELECT * FROM idea_selections WHERE idea_selection_id = ?')
      .get(ideaSelectionId);
    if (!row) return null;
    try {
      const selection = validateIdeaSelection(
        JSON.parse(String(row.payload_json)),
      );
      if (selection.contentHash !== row.content_hash)
        throw new Error('hash divergente');
      verifyPersistedColumns(selection, row);
      const idea = this.getIdea(selection.ideaCandidateId);
      const score = this.getScore(selection.ideaScoreId);
      if (!idea || !score) throw new Error('artefato selecionado ausente');
      verifySelectedArtifacts(selection, idea, score);
      return selection;
    } catch (caught) {
      throw failure(
        'INVALID_PERSISTED_IDEA_SELECTION',
        'ideaSelectionId',
        'seleção persistida inválida',
        { cause: caught },
      );
    }
  }
  listSelectionsByPipelineRun(pipelineRunId: string): IdeaSelection[] {
    requireIdentifier(pipelineRunId, 'pipelineRunId');
    return this.db
      .prepare(
        `SELECT idea_selection_id FROM idea_selections
      WHERE pipeline_run_id = ?
      ORDER BY decided_at, idea_batch_id, revision, idea_selection_id`,
      )
      .all(pipelineRunId)
      .map(({ idea_selection_id: id }: any) => this.getSelection(id)!);
  }
  listSelectionsByBatch(ideaBatchId: string): IdeaSelection[] {
    requireIdentifier(ideaBatchId, 'ideaBatchId', 200);
    return this.db
      .prepare(
        `SELECT idea_selection_id FROM idea_selections
      WHERE idea_batch_id = ? ORDER BY revision, idea_selection_id`,
      )
      .all(ideaBatchId)
      .map(({ idea_selection_id: id }: any) => this.getSelection(id)!);
  }
  #validateRevision(selection: any): any {
    if (selection.revision === 1) {
      const existing = this.db
        .prepare(
          'SELECT 1 FROM idea_selections WHERE idea_batch_id = ? LIMIT 1',
        )
        .get(selection.ideaBatchId);
      if (existing)
        throw failure(
          'IDEA_SELECTION_REVISION_CONFLICT',
          'revision',
          'revisão já registrada',
        );
      return null;
    }
    const previous = this.getSelection(selection.supersedesIdeaSelectionId);
    if (!previous)
      throw failure(
        'SUPERSEDED_SELECTION_NOT_FOUND',
        'supersedesIdeaSelectionId',
        'decisão anterior não encontrada',
      );
    for (const field of [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'ideaBatchId',
    ]) {
      if (previous[field as keyof typeof previous] !== selection[field])
        throw failure(
          'IDEA_SELECTION_SUPERSESSION_SCOPE_MISMATCH',
          field,
          'decisão anterior fora do escopo',
        );
    }
    if (previous.revision + 1 !== selection.revision) {
      throw failure(
        'IDEA_SELECTION_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
    }
    return previous;
  }
  #insertLineage(selection: any, previous: any): any {
    const inputs = [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: selection.ideaCandidateId,
        contentHash: selection.ideaContentHash,
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: selection.ideaScoreId,
        contentHash: selection.ideaScoreContentHash,
      },
    ];
    if (previous)
      inputs.push({
        position: 3,
        kind: 'INTERNAL_ARTIFACT',
        inputId: previous.ideaSelectionId,
        contentHash: previous.contentHash,
      });
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: selection.ideaSelectionId,
      artifactType: 'idea_selection',
      artifactVersion: selection.revision,
      pipelineRunId: selection.pipelineRunId,
      projectId: selection.projectId,
      projectVersion: selection.projectVersion,
      contentIdentity: `idea-selection:${selection.ideaBatchId}`,
      hashAlgorithm: 'sha256',
      contentHash: selection.contentHash,
      inputs,
      generationMetadata: null,
      createdAt: selection.decidedAt,
    });
    this.db
      .prepare(
        `INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        artifact.artifactId,
        artifact.schemaVersion,
        artifact.artifactType,
        artifact.artifactVersion,
        sha256(JSON.stringify(artifact)),
        artifact.pipelineRunId,
        artifact.projectId,
        artifact.projectVersion,
        artifact.contentIdentity,
        artifact.hashAlgorithm,
        artifact.contentHash,
        artifact.createdAt,
      );
    const insert = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    artifact.inputs.forEach((input: any) =>
      insert.run(
        artifact.artifactId,
        input.position,
        input.kind,
        input.inputId,
        input.contentHash,
      ),
    );
  }
  #transaction<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapError(caught);
    }
  }
}
function verifySelectedArtifacts(selection: any, idea: any, score: any): any {
  for (const field of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'ideaBatchId',
    'ideaCandidateId',
  ]) {
    if (idea[field] !== selection[field])
      throw failure(
        'IDEA_SELECTION_IDEA_SCOPE_MISMATCH',
        field,
        'ideia fora do escopo',
      );
  }
  for (const field of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'ideaBatchId',
    'ideaCandidateId',
    'ideaScoreId',
  ]) {
    if (score[field] !== selection[field])
      throw failure(
        'IDEA_SELECTION_SCORE_SCOPE_MISMATCH',
        field,
        'score fora do escopo',
      );
  }
  if (idea.contentHash !== selection.ideaContentHash)
    throw failure(
      'IDEA_CONTENT_HASH_MISMATCH',
      'ideaContentHash',
      'hash da ideia divergente',
    );
  if (score.contentHash !== selection.ideaScoreContentHash)
    throw failure(
      'IDEA_SCORE_CONTENT_HASH_MISMATCH',
      'ideaScoreContentHash',
      'hash do score divergente',
    );
}
function verifyPersistedColumns(selection: any, row: any): any {
  const expected: any = {
    idea_selection_id: selection.ideaSelectionId,
    schema_version: selection.schemaVersion,
    pipeline_run_id: selection.pipelineRunId,
    project_id: selection.projectId,
    project_version: selection.projectVersion,
    idea_batch_id: selection.ideaBatchId,
    idea_candidate_id: selection.ideaCandidateId,
    idea_score_id: selection.ideaScoreId,
    idea_content_hash: selection.ideaContentHash,
    idea_score_content_hash: selection.ideaScoreContentHash,
    decision: selection.decision,
    actor_type: selection.actor.type,
    actor_id: selection.actor.id,
    decided_at: selection.decidedAt,
    editorial_rationale: selection.editorialRationale,
    revision: selection.revision,
    supersedes_idea_selection_id: selection.supersedesIdeaSelectionId,
    content_hash: selection.contentHash,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
  }
}
function verifyScope(stored: any, expected: any, code: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion']) {
    if (stored[field] !== expected[field])
      throw failure(code, field, 'escopo divergente');
  }
}
function requireIdentifier(value: any, field: any, max: any = 80): any {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw failure('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function mapError(caught: any): any {
  if (caught instanceof IdeaSelectionRepositoryError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'contrato de seleção inválido', {
      cause: caught,
    });
  const message = String(caught?.message);
  if (
    message.includes('idea_selections.idea_batch_id, idea_selections.revision')
  )
    return failure(
      'IDEA_SELECTION_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('idea_selections.supersedes_idea_selection_id'))
    return failure(
      'IDEA_SELECTION_ALREADY_SUPERSEDED',
      'supersedesIdeaSelectionId',
      'decisão já substituída',
      { cause: caught },
    );
  if (
    message.includes(
      'artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version',
    )
  )
    return failure(
      'IDEA_SELECTION_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('artifact_lineage.artifact_id'))
    return failure(
      'IDEA_SELECTION_ID_REUSED',
      'ideaSelectionId',
      'ID já registrado',
      { cause: caught },
    );
  if (message.includes('IMMUTABLE_IDEA_SELECTION'))
    return failure(
      'IMMUTABLE_IDEA_SELECTION',
      'ideaSelectionId',
      'decisão imutável',
      { cause: caught },
    );
  if (message.includes('IDEA_SELECTION_SCOPE_MISMATCH'))
    return failure(
      'IDEA_SELECTION_SCOPE_MISMATCH',
      'ideaCandidateId',
      'artefatos fora do escopo',
      { cause: caught },
    );
  if (message.includes('IDEA_SELECTION_REVISION_MISMATCH'))
    return failure(
      'IDEA_SELECTION_REVISION_MISMATCH',
      'revision',
      'revisão inválida',
      { cause: caught },
    );
  if (typeof caught?.code === 'string' && caught.code.startsWith('ERR_SQLITE'))
    return failure(
      'IDEA_SELECTION_PERSISTENCE_FAILED',
      'ideaSelection',
      'não foi possível persistir a decisão',
      { cause: caught },
    );
  return caught;
}
function sha256(value: any): any {
  return createHash('sha256').update(value).digest('hex');
}
function failure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
): any {
  return new IdeaSelectionRepositoryError(code, field, message, options);
}
