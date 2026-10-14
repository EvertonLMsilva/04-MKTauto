import type {
  IdeaWithScore,
  IdeaCandidate,
  IdeaScore,
  IdeaBatch,
  IdeaScoringPolicy,
} from '../domain/content.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  validateArtifactLineage,
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
} from '../domain/artifact-lineage-contracts.js';
import {
  validateIdeaCandidate,
  validateIdeaScore,
  DEFAULT_IDEA_SCORING_POLICY,
} from '../domain/idea-contracts.js';
import { ContentDatabase } from './content-database.js';
import {
  createIdeaCandidates,
  IdeaScoringError,
  scoreIdeaCandidates,
} from '../domain/idea-scoring.js';
export class IdeaRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'IdeaRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class IdeaRepository extends ContentDatabase {
  registerBatch(
    value: unknown,
    {
      policy = DEFAULT_IDEA_SCORING_POLICY,
    }: { policy?: IdeaScoringPolicy } = {},
  ): IdeaWithScore[] {
    validateSubmission(value);
    return this.#transaction(() => {
      const run = this.getRun(value.pipelineRunId);
      if (!run)
        throw failure(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
          'execução não encontrada',
        );
      verifyScope(run, value, 'IDEA_RUN_SCOPE_MISMATCH');
      const shortlist = this.#getShortlist(value.researchShortlistId);
      verifyScope(shortlist, value, 'IDEA_SHORTLIST_SCOPE_MISMATCH');
      if (shortlist.state === 'FAILED')
        throw failure(
          'IDEA_SHORTLIST_UNAVAILABLE',
          'researchShortlistId',
          'shortlist falha não pode alimentar ideias',
        );
      const ideas = createIdeaCandidates({
        ...value,
        projectSnapshot: run.projectSnapshot,
        shortlist,
      });
      const insights = this.#loadInsights(ideas, value);
      this.#validateReferenceEvidence(ideas, insights);
      const scores = scoreIdeaCandidates({
        ideas,
        projectSnapshot: run.projectSnapshot,
        shortlist,
        policy,
      });
      const requestHash = stableHash({ ideas, scores });
      const prior = this.db
        .prepare(
          'SELECT request_hash FROM idea_batches WHERE idea_batch_id = ?',
        )
        .get(value.ideaBatchId);
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw failure(
            'IDEA_BATCH_ID_REUSED',
            'ideaBatchId',
            'lote já usado com conteúdo incompatível',
          );
        return this.#listByBatch(value.ideaBatchId);
      }
      this.db
        .prepare(
          `INSERT INTO idea_batches
        (idea_batch_id, request_hash, pipeline_run_id, project_id, project_version,
         research_shortlist_id, policy_version, origin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.ideaBatchId,
          requestHash,
          value.pipelineRunId,
          value.projectId,
          value.projectVersion,
          value.researchShortlistId,
          policy.version,
          value.origin,
          new Date(value.createdAt).toISOString(),
        );
      for (const idea of ideas)
        this.#insertIdea(
          idea,
          shortlist,
          insights.get(idea.referenceInsightId),
        );
      for (const score of scores)
        this.#insertScore(
          score,
          ideas.find(
            ({ ideaCandidateId }) => ideaCandidateId === score.ideaCandidateId,
          )!,
        );
      return this.#listByBatch(value.ideaBatchId);
    });
  }
  getIdea(ideaCandidateId: string): IdeaCandidate | null {
    requireIdentifier(ideaCandidateId, 'ideaCandidateId', 200);
    const row = this.db
      .prepare(
        'SELECT payload_json, content_hash FROM idea_candidates WHERE idea_candidate_id = ?',
      )
      .get(ideaCandidateId);
    if (!row) return null;
    try {
      const idea = validateIdeaCandidate(JSON.parse(String(row.payload_json)));
      verifyContentHash(idea, row.content_hash);
      return idea;
    } catch (caught) {
      if (caught instanceof IdeaRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_IDEA_CANDIDATE',
        'ideaCandidateId',
        'ideia persistida inválida',
        { cause: caught },
      );
    }
  }
  getScore(ideaScoreId: string): IdeaScore | null {
    requireIdentifier(ideaScoreId, 'ideaScoreId', 200);
    const row = this.db
      .prepare(
        'SELECT payload_json, content_hash FROM idea_scores WHERE idea_score_id = ?',
      )
      .get(ideaScoreId);
    if (!row) return null;
    try {
      const score = validateIdeaScore(JSON.parse(String(row.payload_json)));
      verifyContentHash(score, row.content_hash);
      return score;
    } catch (caught) {
      if (caught instanceof IdeaRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_IDEA_SCORE',
        'ideaScoreId',
        'score persistido inválido',
        { cause: caught },
      );
    }
  }
  getIdeaWithScore(ideaCandidateId: string): IdeaWithScore | null {
    const idea = this.getIdea(ideaCandidateId);
    if (!idea) return null;
    const scoreId = this.db
      .prepare(
        'SELECT idea_score_id FROM idea_scores WHERE idea_candidate_id = ?',
      )
      .get(ideaCandidateId)?.idea_score_id;
    if (!scoreId)
      throw failure(
        'INVALID_PERSISTED_IDEA_SCORE',
        'ideaCandidateId',
        'score obrigatório ausente',
      );
    return Object.freeze({ idea, score: this.getScore(scoreId as string)! });
  }
  listIdeasByPipelineRun(pipelineRunId: string): IdeaWithScore[] {
    requireIdentifier(pipelineRunId, 'pipelineRunId');
    return this.db
      .prepare(
        `SELECT c.idea_candidate_id FROM idea_candidates c
      JOIN idea_batches b ON b.idea_batch_id = c.idea_batch_id
      JOIN idea_scores s ON s.idea_candidate_id = c.idea_candidate_id
      WHERE c.pipeline_run_id = ?
      ORDER BY b.created_at, b.idea_batch_id, s.rank, c.idea_candidate_id`,
      )
      .all(pipelineRunId)
      .map(({ idea_candidate_id: id }: any) => this.getIdeaWithScore(id)!);
  }
  #listByBatch(ideaBatchId: any): IdeaWithScore[] {
    return this.db
      .prepare(
        `SELECT c.idea_candidate_id FROM idea_candidates c
      JOIN idea_scores s ON s.idea_candidate_id = c.idea_candidate_id
      WHERE c.idea_batch_id = ? ORDER BY s.rank, c.idea_candidate_id`,
      )
      .all(ideaBatchId)
      .map(({ idea_candidate_id: id }: any) => this.getIdeaWithScore(id)!);
  }
  #getShortlist(artifactId: any): any {
    const shortlist = this.research.getShortlist(artifactId);
    if (!shortlist)
      throw failure(
        'RESEARCH_SHORTLIST_NOT_FOUND',
        'researchShortlistId',
        'shortlist não encontrada',
      );
    return shortlist;
  }
  #loadInsights(proposals: any, scope: any): any {
    const result = new Map<
      string | null,
      import('../../research/domain/research.types.js').ReferenceInsight | null
    >([[null, null]]);
    for (const proposal of proposals) {
      if (
        proposal.referenceInsightId === null ||
        result.has(proposal.referenceInsightId)
      )
        continue;
      const insight = this.research.getInsight(proposal.referenceInsightId);
      if (!insight)
        throw failure(
          'REFERENCE_INSIGHT_NOT_FOUND',
          'referenceInsightId',
          'insight não encontrado',
        );
      verifyScope(insight, scope, 'IDEA_REFERENCE_SCOPE_MISMATCH');
      result.set(proposal.referenceInsightId, insight);
    }
    return result;
  }
  #validateReferenceEvidence(ideas: any, insights: any): any {
    for (const idea of ideas) {
      if (idea.referenceInsightId === null) continue;
      const insight = insights.get(idea.referenceInsightId);
      const evidence = new Set(
        insight.references.flatMap((reference: any) =>
          reference.evidence.map(({ evidenceId }: any) => evidenceId),
        ),
      );
      idea.referenceEvidenceIds.forEach((id: any, index: any) => {
        if (!evidence.has(id))
          throw failure(
            'REFERENCE_EVIDENCE_NOT_FOUND',
            `referenceEvidenceIds.${index}`,
            'evidência não pertence ao insight',
          );
      });
    }
  }
  #insertIdea(idea: any, shortlist: any, insight: any): any {
    const inputs = [
      {
        position: 1,
        kind: 'EXTERNAL_INPUT',
        inputId: shortlist.artifactId,
        contentHash: shortlist.contentHash,
      },
    ];
    if (insight)
      inputs.push({
        position: 2,
        kind: 'EXTERNAL_INPUT',
        inputId: insight.artifactId,
        contentHash: insight.contentHash,
      });
    this.#insertLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: idea.ideaCandidateId,
      artifactType: 'idea_candidate',
      artifactVersion: 1,
      pipelineRunId: idea.pipelineRunId,
      projectId: idea.projectId,
      projectVersion: idea.projectVersion,
      contentIdentity: idea.contentIdentity,
      hashAlgorithm: 'sha256',
      contentHash: idea.contentHash,
      inputs,
      generationMetadata: null,
      createdAt: idea.createdAt,
    });
    this.db
      .prepare(
        `INSERT INTO idea_candidates
      (idea_candidate_id, idea_batch_id, schema_version, pipeline_run_id, project_id,
       project_version, content_identity, content_hash, research_shortlist_id,
       reference_insight_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        idea.ideaCandidateId,
        idea.ideaBatchId,
        idea.schemaVersion,
        idea.pipelineRunId,
        idea.projectId,
        idea.projectVersion,
        idea.contentIdentity,
        idea.contentHash,
        idea.researchShortlistId,
        idea.referenceInsightId,
        JSON.stringify(idea),
        idea.createdAt,
      );
    const insert = this.db.prepare(`INSERT INTO idea_candidate_evidence
      (idea_candidate_id, kind, position, evidence_id) VALUES (?, ?, ?, ?)`);
    idea.evidenceCandidateIds.forEach((id: any, index: any) =>
      insert.run(idea.ideaCandidateId, 'RESEARCH_CANDIDATE', index + 1, id),
    );
    idea.referenceEvidenceIds.forEach((id: any, index: any) =>
      insert.run(idea.ideaCandidateId, 'REFERENCE_EVIDENCE', index + 1, id),
    );
  }
  #insertScore(score: any, idea: any): any {
    this.#insertLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: score.ideaScoreId,
      artifactType: 'idea_score',
      artifactVersion: 1,
      pipelineRunId: score.pipelineRunId,
      projectId: score.projectId,
      projectVersion: score.projectVersion,
      contentIdentity: null,
      hashAlgorithm: 'sha256',
      contentHash: score.contentHash,
      inputs: [
        {
          position: 1,
          kind: 'INTERNAL_ARTIFACT',
          inputId: idea.ideaCandidateId,
          contentHash: idea.contentHash,
        },
      ],
      generationMetadata: null,
      createdAt: score.calculatedAt,
    });
    this.db
      .prepare(
        `INSERT INTO idea_scores
      (idea_score_id, idea_candidate_id, idea_batch_id, schema_version, pipeline_run_id,
       project_id, project_version, policy_version, total, rank, content_hash,
       payload_json, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        score.ideaScoreId,
        score.ideaCandidateId,
        score.ideaBatchId,
        score.schemaVersion,
        score.pipelineRunId,
        score.projectId,
        score.projectVersion,
        score.policyVersion,
        score.total,
        score.rank,
        score.contentHash,
        JSON.stringify(score),
        score.calculatedAt,
      );
  }
  #insertLineage(value: any): any {
    const artifact = validateArtifactLineage(value);
    if (
      this.db
        .prepare('SELECT 1 FROM artifact_lineage WHERE artifact_id = ?')
        .get(artifact.artifactId)
    ) {
      throw failure(
        'IDEA_ARTIFACT_ID_REUSED',
        'ideaCandidateId',
        'ID já usado na linhagem',
      );
    }
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
        identityHash(artifact),
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
function validateSubmission(input: unknown): asserts input is IdeaBatch {
  const value = input as IdeaBatch;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw failure('INVALID_IDEA_BATCH', 'batch', 'objeto obrigatório');
  const fields = [
    'ideaBatchId',
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'researchShortlistId',
    'origin',
    'createdAt',
    'proposals',
  ];
  for (const key of Object.keys(value))
    if (!fields.includes(key))
      throw failure('UNKNOWN_IDEA_BATCH_FIELD', key, 'campo não permitido');
  for (const key of fields)
    if (!(key in value))
      throw failure('REQUIRED_IDEA_BATCH_FIELD', key, 'campo obrigatório');
  requireIdentifier(value.ideaBatchId, 'ideaBatchId', 200);
  requireIdentifier(value.pipelineRunId, 'pipelineRunId');
  requireIdentifier(value.projectId, 'projectId');
  requireIdentifier(value.researchShortlistId, 'researchShortlistId', 200);
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1)
    throw failure(
      'INVALID_PROJECT_VERSION',
      'projectVersion',
      'versão inválida',
    );
  if (!['OPERATOR', 'EXTERNAL_CONSUMER'].includes(value.origin))
    throw failure('INVALID_IDEA_ORIGIN', 'origin', 'origem inválida');
  if (
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw failure('INVALID_TIMESTAMP', 'createdAt', 'instante inválido');
  if (
    !Array.isArray(value.proposals) ||
    value.proposals.length === 0 ||
    value.proposals.length > 100
  )
    throw failure(
      'INVALID_IDEA_BATCH',
      'proposals',
      'informe de 1 a 100 ideias',
    );
}
function verifyScope(stored: any, expected: any, code: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion']) {
    if (stored[field] !== expected[field])
      throw failure(code, field, 'escopo divergente');
  }
}
function verifyContentHash(value: any, persistedHash: any): any {
  const { contentHash, ...content } = value;
  if (contentHash !== persistedHash || stableHash(content) !== contentHash)
    throw failure('CONTENT_HASH_MISMATCH', 'contentHash', 'hash divergente');
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
  if (caught instanceof IdeaRepositoryError) return caught;
  if (caught instanceof IdeaScoringError)
    return failure(caught.code, caught.field, 'entrada de ideia inválida', {
      cause: caught,
    });
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'contrato de ideia inválido', {
      cause: caught,
    });
  if (caught instanceof Error && 'code' in caught && 'field' in caught) {
    if (caught.code === 'INVALID_PERSISTED_RESEARCH_SHORTLIST')
      return failure(
        String(caught.code),
        String(caught.field),
        'shortlist persistida inválida',
        { cause: caught },
      );
    if (caught.code === 'INVALID_PERSISTED_REFERENCE_INSIGHT')
      return failure(
        String(caught.code),
        String(caught.field),
        'insight persistido inválido',
        { cause: caught },
      );
  }
  const message = String(caught?.message);
  if (message.includes('idea_candidates.content_identity'))
    return failure(
      'IDEA_CONTENT_IDENTITY_REUSED',
      'contentIdentity',
      'conteúdo já registrado',
      { cause: caught },
    );
  if (
    message.includes('idea_candidates.idea_candidate_id') ||
    message.includes('artifact_lineage.artifact_id')
  )
    return failure(
      'IDEA_CANDIDATE_ID_REUSED',
      'ideaCandidateId',
      'ID já registrado',
      { cause: caught },
    );
  if (message.includes('IDEA_BATCH_SCOPE_MISMATCH'))
    return failure(
      'IDEA_SHORTLIST_SCOPE_MISMATCH',
      'researchShortlistId',
      'shortlist fora do escopo',
      { cause: caught },
    );
  if (message.includes('IMMUTABLE_IDEA'))
    return failure(
      'IMMUTABLE_IDEA_RECORD',
      'ideaCandidateId',
      'registro imutável',
      { cause: caught },
    );
  if (typeof caught?.code === 'string' && caught.code.startsWith('ERR_SQLITE'))
    return failure(
      'IDEA_PERSISTENCE_FAILED',
      'ideaBatch',
      'não foi possível persistir o lote',
      { cause: caught },
    );
  return caught;
}
function identityHash(value: any): any {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function stableHash(value: any): any {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
function stableJson(value: any): any {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key: any) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function failure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
): any {
  return new IdeaRepositoryError(code, field, message, options);
}
