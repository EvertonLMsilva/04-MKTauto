import {
  ContentStorageError,
  contentStorageMarker,
} from './content-storage.errors.js';
import { runContentIo, mapContentIo } from '../application/content-io.js';
import type {
  AffiliateEditorialSelection,
  EditorialScript,
} from '../domain/content.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
  validateArtifactLineage,
} from '../domain/artifact-lineage-contracts.js';
import { validateScript } from '../domain/script-contracts.js';
import { validateAffiliateEditorialSelection } from '../domain/affiliate-editorial-contracts.js';
import { IdeaSelectionRepository } from './idea-selection.repository.js';
export class ScriptRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ScriptRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class ScriptRepository extends IdeaSelectionRepository {
  registerAffiliateEditorialSelection(
    value: unknown,
  ): AffiliateEditorialSelection {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        const selection = validateAffiliateEditorialSelection(value);
        return yield this.#transaction(
          function* (this: any): Generator<unknown, any, any> {
            const prior = yield this.getAffiliateEditorialSelection(
              selection.selectionId,
            );
            if (prior) {
              if (prior.contentHash !== selection.contentHash)
                throw failure(
                  'AFFILIATE_EDITORIAL_ID_REUSED',
                  'selectionId',
                  'decisão divergente',
                );
              return prior;
            }
            yield this.#verifyAffiliateSelection(selection);
            yield this.sql
              .prepare(
                'INSERT INTO affiliate_editorial_selections VALUES (?,?,?,?,?,?,?)',
              )
              .run(
                selection.selectionId,
                selection.pipelineRunId,
                selection.projectId,
                selection.projectVersion,
                selection.briefingId,
                selection.contentHash,
                JSON.stringify(selection),
              );
            const artifact = validateArtifactLineage({
              schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
              artifactId: selection.selectionId,
              artifactType: 'affiliate_editorial_selection',
              artifactVersion: 1,
              pipelineRunId: selection.pipelineRunId,
              projectId: selection.projectId,
              projectVersion: selection.projectVersion,
              contentIdentity: selection.selectionId,
              hashAlgorithm: 'sha256',
              contentHash: selection.contentHash,
              inputs: [
                {
                  position: 1,
                  kind: 'EXTERNAL_INPUT',
                  inputId: selection.briefingId,
                  contentHash: selection.briefingHash,
                },
              ],
              generationMetadata: null,
              createdAt: selection.decidedAt,
            });
            yield this.#persistLineage(artifact);
            return selection;
          }.bind(this),
        );
      }.call(this),
    );
  }
  getAffiliateEditorialSelection(
    id: string,
  ): AffiliateEditorialSelection | null {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        requireIdentifier(id, 'selectionId', 200);
        const row = yield this.sql
          .prepare(
            'SELECT * FROM affiliate_editorial_selections WHERE selection_id=?',
          )
          .get(id);
        if (!row) return null;
        const value = validateAffiliateEditorialSelection(
          JSON.parse(String(row.payload_json)),
        );
        if (
          value.selectionId !== id ||
          value.contentHash !== row.content_hash ||
          value.pipelineRunId !== row.pipeline_run_id ||
          value.projectId !== row.project_id ||
          value.projectVersion !== row.project_version ||
          value.briefingId !== row.briefing_id
        )
          throw failure(
            'INVALID_PERSISTED_AFFILIATE_EDITORIAL',
            'selectionId',
            'dados divergentes',
          );
        yield this.#verifyAffiliateSelection(value);
        return value;
      }.call(this),
    );
  }
  #verifyAffiliateSelection(selection: any): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        const run = yield this.getRun(selection.pipelineRunId);
        if (!run)
          throw failure(
            'PIPELINE_RUN_NOT_FOUND',
            'pipelineRunId',
            'execução ausente',
          );
        verifyScope(run, selection, 'AFFILIATE_EDITORIAL_SCOPE_MISMATCH');
        const briefing = yield this.affiliate.resolveRunBriefing(
          selection.pipelineRunId,
          selection.briefingId,
        );
        if (!briefing || briefing.contentHash !== selection.briefingHash)
          throw failure(
            'AFFILIATE_EDITORIAL_BRIEFING_MISMATCH',
            'briefingHash',
            'briefing divergente',
          );
        const evidence = new Map<string, any>(
          briefing.evidence.map((item: any) => [item.id, item]),
        );
        if (selection.actor.type === 'AUTOMATION') {
          if (
            selection.actor.productId !== briefing.productId ||
            selection.actor.campaignId !== briefing.campaignId
          )
            throw failure(
              'AFFILIATE_AUTOMATION_SCOPE_MISMATCH',
              'actor',
              'produto ou campanha divergente',
            );
          if (
            !selection.evidenceRefs.some(
              (id: any) => evidence.get(id)?.kind === 'MEDIA_USAGE_RIGHT',
            )
          )
            throw failure(
              'AFFILIATE_AUTOMATION_RIGHTS_REQUIRED',
              'evidenceRefs',
              'direitos de mídia ausentes',
            );
        }
        if (
          selection.evidenceRefs.some((id: any) => !evidence.has(id)) ||
          !selection.evidenceRefs.some(
            (id: any) => evidence.get(id)?.kind === 'PRODUCT_SPECIFICATION',
          )
        )
          throw failure(
            'AFFILIATE_EDITORIAL_EVIDENCE_REQUIRED',
            'evidenceRefs',
            'evidência comercial ausente',
          );
      }.call(this),
    );
  }
  #verifyScriptSelection(script: any): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        if (script.schemaVersion === 'script/2.0.0') {
          const selection = yield this.getAffiliateEditorialSelection(
            script.editorialSelectionId,
          );
          if (
            !selection ||
            selection.contentHash !== script.editorialSelectionContentHash
          )
            throw failure(
              'AFFILIATE_EDITORIAL_SELECTION_MISMATCH',
              'editorialSelectionId',
              'seleção divergente',
            );
          if (
            script.origin === 'AUTOMATION' &&
            selection.actor.type !== 'AUTOMATION'
          )
            throw failure(
              'AFFILIATE_AUTOMATION_REQUIRED',
              'actor',
              'roteiro automático exige seleção AUTOMATION',
            );
          verifyScope(selection, script, 'SCRIPT_SELECTION_SCOPE_MISMATCH');
          const briefing = yield this.affiliate.resolveRunBriefing(
            script.pipelineRunId,
            selection.briefingId,
          );
          if (script.cta !== briefing!.cta)
            throw failure(
              'AFFILIATE_SCRIPT_CTA_MISMATCH',
              'cta',
              'CTA divergente',
            );
        } else {
          const selection = yield this.getSelection(script.ideaSelectionId);
          if (!selection)
            throw failure(
              'IDEA_SELECTION_NOT_FOUND',
              'ideaSelectionId',
              'seleção não encontrada',
            );
          verifySelection(script, selection);
        }
      }.call(this),
    );
  }
  registerScript(value: unknown): EditorialScript {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        let script;
        try {
          script = validateScript(value);
        } catch (caught) {
          throw mapError(caught);
        }
        return yield this.#transaction(
          function* (this: any): Generator<unknown, any, any> {
            return yield this.#registerValidatedScript(script, null, true);
          }.bind(this),
        );
      }.call(this),
    );
  }
  #registerValidatedScript(
    script: any,
    generationMetadata: any,
    allowExisting: any,
  ): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        const prior = yield this.sql
          .prepare('SELECT content_hash FROM scripts WHERE script_id = ?')
          .get(script.scriptId);
        if (prior) {
          if (!allowExisting || prior.content_hash !== script.contentHash)
            throw failure(
              'SCRIPT_ID_REUSED',
              'scriptId',
              'ID já usado com roteiro incompatível',
            );
          return yield this.getScript(script.scriptId);
        }
        const run = yield this.getRun(script.pipelineRunId);
        if (!run)
          throw failure(
            'PIPELINE_RUN_NOT_FOUND',
            'pipelineRunId',
            'execução não encontrada',
          );
        verifyScope(run, script, 'SCRIPT_RUN_SCOPE_MISMATCH');
        yield this.#verifyScriptSelection(script);
        verifyProjectCompatibility(script, run.projectSnapshot);
        const previous = yield this.#validateRevision(script);
        yield this.#insertLineage(script, previous, generationMetadata);
        yield this.sql
          .prepare(
            `INSERT INTO scripts
        (script_id, schema_version, pipeline_run_id, project_id, project_version,
         idea_selection_id, idea_selection_content_hash, idea_candidate_id,
         idea_content_hash, language, content_format, estimated_duration_seconds,
         origin, created_at, revision, supersedes_script_id, content_hash, payload_json,
         commercial_selection_id, commercial_selection_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            script.scriptId,
            script.schemaVersion,
            script.pipelineRunId,
            script.projectId,
            script.projectVersion,
            script.ideaSelectionId ?? null,
            script.ideaSelectionContentHash ?? null,
            script.ideaCandidateId ?? null,
            script.ideaContentHash ?? null,
            script.language,
            script.contentFormat,
            script.estimatedDurationSeconds,
            script.origin,
            script.createdAt,
            script.revision,
            script.supersedesScriptId,
            script.contentHash,
            JSON.stringify(script),
            script.editorialSelectionId ?? null,
            script.editorialSelectionContentHash ?? null,
          );
        return yield this.getScript(script.scriptId);
      }.call(this),
    );
  }
  getScript(scriptId: string): EditorialScript | null {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        requireIdentifier(scriptId, 'scriptId', 200);
        const row = yield this.sql
          .prepare('SELECT * FROM scripts WHERE script_id = ?')
          .get(scriptId);
        if (!row) return null;
        try {
          const script = validateScript(JSON.parse(String(row.payload_json)));
          verifyPersistedColumns(script, row);
          const run = yield this.getRun(script.pipelineRunId);
          if (!run) throw new Error('execução ausente');
          verifyScope(run, script, 'SCRIPT_RUN_SCOPE_MISMATCH');
          yield this.#verifyScriptSelection(script);
          verifyProjectCompatibility(script, run.projectSnapshot);
          return script;
        } catch (caught) {
          throw failure(
            'INVALID_PERSISTED_SCRIPT',
            'scriptId',
            'roteiro persistido inválido',
            { cause: caught },
          );
        }
      }.call(this),
    );
  }
  listScriptsByPipelineRun(pipelineRunId: string): EditorialScript[] {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        requireIdentifier(pipelineRunId, 'pipelineRunId');
        return yield mapContentIo(
          yield this.sql
            .prepare(
              `SELECT script_id FROM scripts WHERE pipeline_run_id = ?
      ORDER BY created_at, idea_selection_id, revision, script_id`,
            )
            .all(pipelineRunId),
          function* (
            this: any,
            { script_id: id }: any,
          ): Generator<unknown, any, any> {
            return (yield this.getScript(id))!;
          }.bind(this),
        );
      }.call(this),
    );
  }
  listScriptsBySelection(ideaSelectionId: string): EditorialScript[] {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        requireIdentifier(ideaSelectionId, 'ideaSelectionId', 200);
        return yield mapContentIo(
          yield this.sql
            .prepare(
              `SELECT script_id FROM scripts WHERE idea_selection_id = ?
      ORDER BY revision, script_id`,
            )
            .all(ideaSelectionId),
          function* (
            this: any,
            { script_id: id }: any,
          ): Generator<unknown, any, any> {
            return (yield this.getScript(id))!;
          }.bind(this),
        );
      }.call(this),
    );
  }
  #validateRevision(script: any): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        if (script.revision === 1) {
          const existing =
            script.schemaVersion === 'script/2.0.0'
              ? yield this.sql
                  .prepare(
                    'SELECT 1 FROM scripts WHERE commercial_selection_id=? LIMIT 1',
                  )
                  .get(script.editorialSelectionId)
              : yield this.sql
                  .prepare(
                    'SELECT 1 FROM scripts WHERE idea_selection_id = ? LIMIT 1',
                  )
                  .get(script.ideaSelectionId);
          if (existing)
            throw failure(
              'SCRIPT_REVISION_CONFLICT',
              'revision',
              'revisão já registrada',
            );
          return null;
        }
        const previous = yield this.getScript(script.supersedesScriptId);
        if (!previous)
          throw failure(
            'SUPERSEDED_SCRIPT_NOT_FOUND',
            'supersedesScriptId',
            'roteiro anterior não encontrado',
          );
        for (const field of [
          'schemaVersion',
          'editorialSelectionId',
          'pipelineRunId',
          'projectId',
          'projectVersion',
          'ideaSelectionId',
          'ideaCandidateId',
          'language',
          'contentFormat',
        ]) {
          if (previous[field as keyof typeof previous] !== script[field])
            throw failure(
              'SCRIPT_SUPERSESSION_SCOPE_MISMATCH',
              field,
              'roteiro anterior fora do escopo',
            );
        }
        if (previous.revision + 1 !== script.revision)
          throw failure(
            'SCRIPT_REVISION_MISMATCH',
            'revision',
            'revisão não é sucessora imediata',
          );
        return previous;
      }.call(this),
    );
  }
  #insertLineage(
    script: any,
    previous: any,
    generationMetadata: any = null,
  ): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        const inputs = [
          {
            position: 1,
            kind: 'INTERNAL_ARTIFACT',
            inputId: script.editorialSelectionId ?? script.ideaSelectionId,
            contentHash:
              script.editorialSelectionContentHash ??
              script.ideaSelectionContentHash,
          },
        ];
        if (previous)
          inputs.push({
            position: 2,
            kind: 'INTERNAL_ARTIFACT',
            inputId: previous.scriptId,
            contentHash: previous.contentHash,
          });
        const artifact = validateArtifactLineage({
          schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
          artifactId: script.scriptId,
          artifactType: 'script',
          artifactVersion: script.revision,
          pipelineRunId: script.pipelineRunId,
          projectId: script.projectId,
          projectVersion: script.projectVersion,
          contentIdentity: `script:${script.editorialSelectionId ?? script.ideaSelectionId}`,
          hashAlgorithm: 'sha256',
          contentHash: script.contentHash,
          inputs,
          generationMetadata,
          createdAt: script.createdAt,
        });
        yield this.#persistLineage(artifact);
      }.call(this),
    );
  }
  #persistLineage(artifact: any): any {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.sql
          .prepare(
            `INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            artifact.generationMetadata === null
              ? null
              : JSON.stringify(artifact.generationMetadata),
            artifact.createdAt,
          );
        const insert = this.sql.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
        yield mapContentIo(
          artifact.inputs,
          function* (this: any, input: any): Generator<unknown, any, any> {
            return yield insert.run(
              artifact.artifactId,
              input.position,
              input.kind,
              input.inputId,
              input.contentHash,
            );
          }.bind(this),
        );
      }.call(this),
    );
  }
  #transaction<T>(operation: () => Generator<unknown, T, any>): T {
    return runContentIo(
      function* (this: any): Generator<unknown, any, any> {
        try {
          return yield this.transaction(() => runContentIo(operation()));
        } catch (caught) {
          throw mapError(caught);
        }
      }.call(this),
    );
  }
}
function verifySelection(script: any, selection: any): any {
  for (const field of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'ideaCandidateId',
  ]) {
    if (selection[field] !== script[field])
      throw failure(
        'SCRIPT_SELECTION_SCOPE_MISMATCH',
        field,
        'seleção fora do escopo',
      );
  }
  if (selection.decision !== 'SELECTED')
    throw failure(
      'IDEA_SELECTION_NOT_SELECTED',
      'ideaSelectionId',
      'seleção não está aprovada',
    );
  if (selection.contentHash !== script.ideaSelectionContentHash)
    throw failure(
      'IDEA_SELECTION_CONTENT_HASH_MISMATCH',
      'ideaSelectionContentHash',
      'hash da seleção divergente',
    );
  if (selection.ideaContentHash !== script.ideaContentHash)
    throw failure(
      'IDEA_CONTENT_HASH_MISMATCH',
      'ideaContentHash',
      'hash da ideia divergente',
    );
}
function verifyProjectCompatibility(script: any, snapshot: any): any {
  if (snapshot.project.audience.language !== script.language)
    throw failure(
      'SCRIPT_LANGUAGE_MISMATCH',
      'language',
      'idioma diverge do projeto',
    );
  if (snapshot.channel.format !== script.contentFormat)
    throw failure(
      'SCRIPT_CONTENT_FORMAT_MISMATCH',
      'contentFormat',
      'formato diverge do projeto',
    );
  const duration = script.estimatedDurationSeconds;
  if (
    duration < snapshot.channel.minDurationSeconds ||
    duration > snapshot.channel.maxDurationSeconds
  ) {
    throw failure(
      'SCRIPT_DURATION_OUT_OF_RANGE',
      'estimatedDurationSeconds',
      'duração fora dos limites do projeto',
    );
  }
}
function verifyPersistedColumns(script: any, row: any): any {
  const expected: any = {
    script_id: script.scriptId,
    schema_version: script.schemaVersion,
    pipeline_run_id: script.pipelineRunId,
    project_id: script.projectId,
    project_version: script.projectVersion,
    idea_selection_id: script.ideaSelectionId ?? null,
    idea_selection_content_hash: script.ideaSelectionContentHash ?? null,
    idea_candidate_id: script.ideaCandidateId ?? null,
    idea_content_hash: script.ideaContentHash ?? null,
    commercial_selection_id: script.editorialSelectionId ?? null,
    commercial_selection_hash: script.editorialSelectionContentHash ?? null,
    language: script.language,
    content_format: script.contentFormat,
    estimated_duration_seconds: script.estimatedDurationSeconds,
    origin: script.origin,
    created_at: script.createdAt,
    revision: script.revision,
    supersedes_script_id: script.supersedesScriptId,
    content_hash: script.contentHash,
  };
  for (const [field, value] of Object.entries(expected))
    if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}
function verifyScope(stored: any, expected: any, code: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion'])
    if (stored[field] !== expected[field])
      throw failure(code, field, 'escopo divergente');
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
  if (caught instanceof ScriptRepositoryError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'contrato de roteiro inválido', {
      cause: caught,
    });
  const message =
    caught instanceof ContentStorageError
      ? contentStorageMarker(caught)
      : String(caught?.message);
  if (message.includes('scripts.idea_selection_id, scripts.revision'))
    return failure(
      'SCRIPT_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('scripts.supersedes_script_id'))
    return failure(
      'SCRIPT_ALREADY_SUPERSEDED',
      'supersedesScriptId',
      'roteiro já substituído',
      { cause: caught },
    );
  if (
    message.includes(
      'artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version',
    )
  )
    return failure(
      'SCRIPT_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('artifact_lineage.artifact_id'))
    return failure('SCRIPT_ID_REUSED', 'scriptId', 'ID já registrado', {
      cause: caught,
    });
  if (message.includes('IMMUTABLE_SCRIPT'))
    return failure('IMMUTABLE_SCRIPT', 'scriptId', 'roteiro imutável', {
      cause: caught,
    });
  if (message.includes('SCRIPT_SCOPE_MISMATCH'))
    return failure(
      'SCRIPT_SCOPE_MISMATCH',
      'ideaSelectionId',
      'artefatos fora do escopo',
      { cause: caught },
    );
  if (message.includes('SCRIPT_REVISION_MISMATCH'))
    return failure('SCRIPT_REVISION_MISMATCH', 'revision', 'revisão inválida', {
      cause: caught,
    });
  if (
    caught instanceof ContentStorageError ||
    (typeof caught?.code === 'string' && caught.code.startsWith('ERR_SQLITE'))
  )
    return failure(
      'SCRIPT_PERSISTENCE_FAILED',
      'script',
      'não foi possível persistir o roteiro',
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
  return new ScriptRepositoryError(code, field, message, options);
}
