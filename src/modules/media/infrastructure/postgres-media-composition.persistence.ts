import { createHash } from 'node:crypto';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import {
  validateCompositionPlan,
  compositionPlanIdentityHash,
} from '../domain/composition-plan-contracts.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { visualScriptMatches } from '../../content/domain/script-visual-lineage.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { CompositionPlanRepositoryError } from './composition-plan.reader.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import { PostgresMediaCatalogSession } from './postgres-media-catalog.session.js';
import { PostgresMediaCatalogRepository } from './postgres-media-catalog.persistence.js';
import { PostgresMediaVoiceRepository } from './postgres-media-voice.persistence.js';
import { MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-composition.migrations.js';

export interface CompositionSegment {
  position: number;
  visualDirectionPosition: number;
  mediaAssetId: string;
  mediaAssetContentHash: string;
  startMilliseconds: number;
  endMilliseconds: number;
  mediaType?: 'IMAGE' | 'VIDEO';
  sourceStartMilliseconds?: number;
  playbackMode?: 'TRIM' | 'LOOP';
  originalAudioMuted?: true;
  framingStrategy?: 'COVER_CROP_9_16' | 'CONTAIN_9_16';
  transition?: {
    policyVersion: 'composition-transition/1.0.0';
    type: 'CUT';
    durationMilliseconds: 0;
  };
  movementRequirement?: 'REAL_MOTION_REQUIRED' | 'STATIC_ALLOWED';
}
export interface CompositionPlan {
  schemaVersion: 'composition-plan/1.0.0' | 'composition-plan/2.0.0';
  compositionPlanId: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptContentHash: string;
  voiceTrackId: string;
  voiceTrackContentHash: string;
  outputAspectRatio: '9:16' | '1:1' | '16:9';
  timelineUnit: 'MILLISECOND';
  continuityMode: 'CONTIGUOUS';
  durationMilliseconds: number;
  segments: CompositionSegment[];
  createdAt: string;
  revision: number;
  supersedesCompositionPlanId: string | null;
  contentHash: string;
  productionProfile?: 'MIXED_MEDIA_V2';
  compositionPolicyVersion?: 'mixed-media-composition-policy/2.0.0';
}
export interface AsyncMediaCompositionRepository {
  registerCompositionPlan(value: unknown): Promise<CompositionPlan>;
  getCompositionPlan(id: string): Promise<CompositionPlan | null>;
  listCompositionPlansByPipelineRun(id: string): Promise<CompositionPlan[]>;
  listCompositionPlansByScript(id: string): Promise<CompositionPlan[]>;
  getCompositionPlanSuccessor(id: string): Promise<CompositionPlan | null>;
  close(): Promise<void>;
}
const fail = (code: string, field: string, message: string) =>
  new CompositionPlanRepositoryError(code, field, message);
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const v2 = (p: CompositionPlan) => p.schemaVersion === 'composition-plan/2.0.0';
function mapped(error: unknown): unknown {
  if (error instanceof CompositionPlanRepositoryError) return error;
  if (error instanceof ContractValidationError)
    return fail(error.code, error.path, 'contrato de plano inválido');
  if (error instanceof MediaAssetRepositoryError)
    return fail(
      error.code === 'MEDIA_ASSET_PERSISTENCE_FAILED'
        ? 'COMPOSITION_PLAN_PERSISTENCE_FAILED'
        : error.code,
      error.field,
      'artefato relacionado ou sessão inválidos',
    );
  return error;
}
function identifier(value: string, field: string, max = 200) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw fail('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function scope(
  stored: { pipelineRunId: string; projectId: string; projectVersion: number },
  p: CompositionPlan,
  code: string,
) {
  for (const k of ['pipelineRunId', 'projectId', 'projectVersion'] as const)
    if (stored[k] !== p[k]) throw fail(code, k, 'escopo divergente');
}
function planColumns(p: CompositionPlan): Record<string, unknown> {
  return {
    composition_plan_id: p.compositionPlanId,
    schema_version: p.schemaVersion,
    identity_hash: compositionPlanIdentityHash(p),
    pipeline_run_id: p.pipelineRunId,
    project_id: p.projectId,
    project_version: p.projectVersion,
    script_id: p.scriptId,
    script_content_hash: p.scriptContentHash,
    voice_track_id: p.voiceTrackId,
    voice_track_content_hash: p.voiceTrackContentHash,
    output_aspect_ratio: p.outputAspectRatio,
    timeline_unit: p.timelineUnit,
    continuity_mode: p.continuityMode,
    duration_milliseconds: p.durationMilliseconds,
    content_hash: p.contentHash,
    created_at: p.createdAt,
    revision: p.revision,
    supersedes_composition_plan_id: p.supersedesCompositionPlanId,
    production_profile: p.productionProfile ?? null,
    composition_policy_version: p.compositionPolicyVersion ?? null,
    payload_json: JSON.stringify(p),
  };
}
function segmentColumns(
  id: string,
  s: CompositionSegment,
): Record<string, unknown> {
  return {
    composition_plan_id: id,
    position: s.position,
    visual_direction_position: s.visualDirectionPosition,
    media_asset_id: s.mediaAssetId,
    media_asset_content_hash: s.mediaAssetContentHash,
    start_milliseconds: s.startMilliseconds,
    end_milliseconds: s.endMilliseconds,
    media_type: s.mediaType ?? null,
    source_start_milliseconds: s.sourceStartMilliseconds ?? null,
    playback_mode: s.playbackMode ?? null,
    original_audio_muted:
      s.originalAudioMuted === undefined ? null : Number(s.originalAudioMuted),
    framing_strategy: s.framingStrategy ?? null,
    transition_policy_version: s.transition?.policyVersion ?? null,
    transition_type: s.transition?.type ?? null,
    transition_duration_milliseconds:
      s.transition?.durationMilliseconds ?? null,
    movement_requirement: s.movementRequirement ?? null,
  };
}
function lineage(p: CompositionPlan) {
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: p.compositionPlanId,
    artifactType: 'composition_plan',
    artifactVersion: p.revision,
    pipelineRunId: p.pipelineRunId,
    projectId: p.projectId,
    projectVersion: p.projectVersion,
    contentIdentity: `composition-plan:${p.scriptId}`,
    hashAlgorithm: 'sha256',
    contentHash: p.contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: p.scriptId,
        contentHash: p.scriptContentHash,
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: p.voiceTrackId,
        contentHash: p.voiceTrackContentHash,
      },
      ...p.segments.map((s, i) => ({
        position: i + 3,
        kind: 'INTERNAL_ARTIFACT',
        inputId: s.mediaAssetId,
        contentHash: s.mediaAssetContentHash,
      })),
    ],
    generationMetadata: null,
    createdAt: p.createdAt,
  });
}
export class PostgresMediaCompositionRepository implements AsyncMediaCompositionRepository {
  private readonly assets: PostgresMediaCatalogRepository;
  private readonly voices: PostgresMediaVoiceRepository;
  constructor(private readonly session: PostgresMediaCatalogSession) {
    this.assets = new PostgresMediaCatalogRepository(session);
    this.voices = new PostgresMediaVoiceRepository(session);
  }
  async close(): Promise<void> {
    this.session.close();
  }
  private async run<T>(work: () => Promise<T>, write = false): Promise<T> {
    try {
      return await this.session.run(work, write);
    } catch (error) {
      throw mapped(error);
    }
  }
  private async related(p: CompositionPlan): Promise<void> {
    const run = await this.session.getRun(p.pipelineRunId);
    if (!run)
      throw fail(
        'PIPELINE_RUN_NOT_FOUND',
        'pipelineRunId',
        'execução não encontrada',
      );
    const script = await this.session.getScript(p.scriptId);
    if (!script)
      throw fail('SCRIPT_NOT_FOUND', 'scriptId', 'roteiro não encontrado');
    const voice = await this.voices.getVoiceTrack(p.voiceTrackId);
    if (!voice)
      throw fail(
        'VOICE_TRACK_NOT_FOUND',
        'voiceTrackId',
        'faixa de voz não encontrada',
      );
    scope(run, p, 'COMPOSITION_PLAN_RUN_SCOPE_MISMATCH');
    scope(script, p, 'COMPOSITION_PLAN_SCRIPT_SCOPE_MISMATCH');
    if (script.contentHash !== p.scriptContentHash)
      throw fail(
        'SCRIPT_CONTENT_HASH_MISMATCH',
        'scriptContentHash',
        'hash do roteiro divergente',
      );
    if (run.projectSnapshot.channel.aspectRatio !== p.outputAspectRatio)
      throw fail(
        'OUTPUT_ASPECT_RATIO_MISMATCH',
        'outputAspectRatio',
        'proporção diverge do snapshot',
      );
    if (
      v2(p) &&
      run.projectSnapshot.channel.productionProfile !== 'MIXED_MEDIA_V2'
    )
      throw fail(
        'PRODUCTION_PROFILE_MISMATCH',
        'productionProfile',
        'perfil diverge do snapshot',
      );
    scope(voice, p, 'VOICE_TRACK_SCOPE_MISMATCH');
    if (
      voice.scriptId !== p.scriptId ||
      voice.scriptContentHash !== p.scriptContentHash
    )
      throw fail(
        'VOICE_TRACK_SCRIPT_MISMATCH',
        'voiceTrackId',
        'voz diverge do roteiro',
      );
    if (voice.contentHash !== p.voiceTrackContentHash)
      throw fail(
        'VOICE_TRACK_CONTENT_HASH_MISMATCH',
        'voiceTrackContentHash',
        'hash da voz divergente',
      );
    if (voice.durationMilliseconds !== p.durationMilliseconds)
      throw fail(
        'VOICE_TRACK_DURATION_MISMATCH',
        'durationMilliseconds',
        'duração diverge da voz',
      );
    if (voice.rights.commercialUseAllowed !== true)
      throw fail(
        'COMMERCIAL_USE_REQUIRED',
        'voiceTrackId',
        'uso comercial da voz não autorizado',
      );
    if (
      JSON.stringify(script.visualDirections.map((s) => s.position)) !==
      JSON.stringify(p.segments.map((s) => s.visualDirectionPosition))
    )
      throw fail(
        'VISUAL_DIRECTION_COVERAGE_MISMATCH',
        'segments',
        'direções visuais sem cobertura exata',
      );
    // Resolve real canonical revisions asynchronously, then reuse the existing pure visual validator.
    const scripts = new Map<string, Record<string, any>>([
      [script.scriptId, script],
    ]);
    let current: Record<string, any> = script;
    for (
      let depth = 0;
      depth < 100 &&
      current.supersedesScriptId &&
      !scripts.has(current.supersedesScriptId);
      depth++
    ) {
      const previous = await this.session.getScript(current.supersedesScriptId);
      if (!previous) break;
      scripts.set(previous.scriptId, previous);
      current = previous;
    }
    for (const [i, s] of p.segments.entries()) {
      const asset = await this.assets.getMediaAsset(s.mediaAssetId);
      if (!asset)
        throw fail(
          'MEDIA_ASSET_NOT_FOUND',
          `segments.${i}.mediaAssetId`,
          'ativo não encontrado',
        );
      scope(asset, p, 'MEDIA_ASSET_SCOPE_MISMATCH');
      if (
        !visualScriptMatches(
          script,
          asset.scriptId,
          asset.scriptContentHash,
          (id) => scripts.get(id) ?? null,
        )
      )
        throw fail(
          'MEDIA_ASSET_SCRIPT_MISMATCH',
          `segments.${i}.mediaAssetId`,
          'ativo diverge do roteiro',
        );
      // SQLite V1 additionally enforces exact script ownership in its segment trigger.
      // Preserve that contract even when the pure visual validator permits reuse.
      if (
        !v2(p) &&
        (asset.scriptId !== p.scriptId ||
          asset.scriptContentHash !== p.scriptContentHash)
      )
        throw fail(
          'COMPOSITION_PLAN_SCOPE_MISMATCH',
          'compositionPlan',
          'V1 requer ativos do próprio roteiro',
        );
      if (asset.visualDirectionPosition !== s.visualDirectionPosition)
        throw fail(
          'MEDIA_ASSET_DIRECTION_MISMATCH',
          `segments.${i}.visualDirectionPosition`,
          'direção divergente',
        );
      if (asset.contentHash !== s.mediaAssetContentHash)
        throw fail(
          'MEDIA_ASSET_CONTENT_HASH_MISMATCH',
          `segments.${i}.mediaAssetContentHash`,
          'hash do ativo divergente',
        );
      if (v2(p) && asset.assetType !== s.mediaType)
        throw fail(
          'MEDIA_ASSET_TYPE_MISMATCH',
          `segments.${i}.mediaType`,
          'tipo divergente',
        );
      if (asset.rights.commercialUseAllowed !== true)
        throw fail(
          'COMMERCIAL_USE_REQUIRED',
          'rights.commercialUseAllowed',
          'uso comercial do ativo não autorizado',
        );
      if (asset.assetType === 'VIDEO') {
        if (
          v2(p) &&
          (s.movementRequirement === 'REAL_MOTION_REQUIRED' ||
            asset.origin === 'PROVIDER_GENERATED')
        )
          throw fail(
            'MEDIA_COMPOSITION_TEMPORAL_QC_DEPENDENCY_REQUIRED',
            `segments.${i}.mediaAssetId`,
            'QC temporal canônico ainda não migrado',
          );
        const duration = asset.technicalProperties.durationMilliseconds!;
        const segmentDuration = s.endMilliseconds - s.startMilliseconds;
        if (v2(p)) {
          if (s.sourceStartMilliseconds! >= duration)
            throw fail(
              'MEDIA_TRIM_START_OUT_OF_RANGE',
              `segments.${i}.sourceStartMilliseconds`,
              'início fora do clipe',
            );
          if (
            s.playbackMode === 'TRIM' &&
            s.sourceStartMilliseconds! + segmentDuration > duration
          )
            throw fail(
              'MEDIA_DURATION_INSUFFICIENT',
              `segments.${i}`,
              'vídeo menor que o trim',
            );
        } else if (duration < segmentDuration)
          throw fail(
            'MEDIA_DURATION_INSUFFICIENT',
            `segments.${i}`,
            'vídeo menor que o trecho',
          );
      }
    }
  }
  private async previous(p: CompositionPlan, seen: Set<string>): Promise<void> {
    if (p.revision === 1) return;
    const previous = p.supersedesCompositionPlanId
      ? await this.read(p.supersedesCompositionPlanId, seen)
      : null;
    if (!previous)
      throw fail(
        'SUPERSEDED_COMPOSITION_PLAN_NOT_FOUND',
        'supersedesCompositionPlanId',
        'plano anterior não encontrado',
      );
    for (const k of [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'scriptId',
      'outputAspectRatio',
      'timelineUnit',
      'continuityMode',
    ] as const)
      if (previous[k] !== p[k])
        throw fail(
          'COMPOSITION_PLAN_SUPERSESSION_SCOPE_MISMATCH',
          k,
          'plano anterior fora do escopo',
        );
    if (previous.revision + 1 !== p.revision)
      throw fail(
        'COMPOSITION_PLAN_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
  }
  private async insert(
    table: 'composition_plans' | 'composition_plan_segments',
    columns: Record<string, unknown>,
  ) {
    await this.session.query(
      'media',
      `INSERT INTO media.${table}(${Object.keys(columns).join(',')}) VALUES(${Object.keys(
        columns,
      )
        .map((_, i) => `$${i + 1}`)
        .join(',')})`,
      Object.values(columns),
    );
  }
  async registerCompositionPlan(value: unknown): Promise<CompositionPlan> {
    let p: CompositionPlan;
    try {
      p = validateCompositionPlan(value);
    } catch (error) {
      throw mapped(error);
    }
    return this.run(async () => {
      const prior = (
        await this.session.query(
          'media',
          'SELECT identity_hash FROM media.composition_plans WHERE composition_plan_id=$1',
          [p.compositionPlanId],
        )
      ).rows[0];
      if (prior) {
        if (prior.identity_hash !== compositionPlanIdentityHash(p))
          throw fail(
            'COMPOSITION_PLAN_ID_REUSED',
            'compositionPlanId',
            'ID reutilizado com plano incompatível',
          );
        return (await this.read(p.compositionPlanId, new Set()))!;
      }
      if (
        (
          await this.session.query(
            'media',
            'SELECT 1 FROM media.composition_plans WHERE script_id=$1 AND revision=$2',
            [p.scriptId, p.revision],
          )
        ).rows.length
      )
        throw fail(
          'COMPOSITION_PLAN_REVISION_CONFLICT',
          'revision',
          'revisão já registrada',
        );
      await this.related(p);
      await this.previous(p, new Set([p.compositionPlanId]));
      const a = lineage(p);
      await this.session.query(
        'content',
        'INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12)',
        [
          a.artifactId,
          a.schemaVersion,
          a.artifactType,
          a.artifactVersion,
          hash(a),
          a.pipelineRunId,
          a.projectId,
          a.projectVersion,
          a.contentIdentity,
          a.hashAlgorithm,
          a.contentHash,
          a.createdAt,
        ],
      );
      for (const input of a.inputs)
        await this.session.query(
          'content',
          'INSERT INTO content.artifact_lineage_inputs(artifact_id,position,kind,input_id,content_hash) VALUES($1,$2,$3,$4,$5)',
          [
            a.artifactId,
            input.position,
            input.kind,
            input.inputId,
            input.contentHash,
          ],
        );
      await this.insert('composition_plans', planColumns(p));
      for (const s of p.segments)
        await this.insert(
          'composition_plan_segments',
          segmentColumns(p.compositionPlanId, s),
        );
      return (await this.read(p.compositionPlanId, new Set()))!;
    }, true);
  }
  async getCompositionPlan(id: string): Promise<CompositionPlan | null> {
    identifier(id, 'compositionPlanId');
    return this.run(() => this.read(id, new Set()));
  }
  private async read(
    id: string,
    seen: Set<string>,
  ): Promise<CompositionPlan | null> {
    if (seen.has(id))
      throw fail(
        'INVALID_PERSISTED_COMPOSITION_PLAN',
        'compositionPlanId',
        'ciclo de supersession',
      );
    seen.add(id);
    const row = (
      await this.session.query(
        'media',
        'SELECT * FROM media.composition_plans WHERE composition_plan_id=$1',
        [id],
      )
    ).rows[0];
    if (!row) return null;
    try {
      const p: CompositionPlan = validateCompositionPlan(
        JSON.parse(row.payload_json),
      );
      const expected = planColumns(p);
      delete expected.payload_json;
      if (Object.entries(expected).some(([k, v]) => row[k] !== v))
        throw new Error('INVALID_COLUMNS');
      const segments = (
        await this.session.query(
          'media',
          'SELECT * FROM media.composition_plan_segments WHERE composition_plan_id=$1 ORDER BY position',
          [id],
        )
      ).rows;
      if (
        segments.length !== p.segments.length ||
        segments.some((r, i) =>
          Object.entries(segmentColumns(id, p.segments[i])).some(
            ([k, v]) => r[k] !== v,
          ),
        )
      )
        throw new Error('INVALID_SEGMENTS');
      await this.related(p);
      await this.previous(p, seen);
      const stored = (
        await this.session.query(
          'content',
          'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
          [id],
        )
      ).rows[0];
      if (!stored) throw new Error('MISSING_LINEAGE');
      const inputs = (
        await this.session.query(
          'content',
          'SELECT position,kind,input_id AS "inputId",content_hash AS "contentHash" FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
          [id],
        )
      ).rows;
      const actual = validateArtifactLineage({
        schemaVersion: stored.schema_version,
        artifactId: stored.artifact_id,
        artifactType: stored.artifact_type,
        artifactVersion: stored.artifact_version,
        pipelineRunId: stored.pipeline_run_id,
        projectId: stored.project_id,
        projectVersion: stored.project_version,
        contentIdentity: stored.content_identity,
        hashAlgorithm: stored.hash_algorithm,
        contentHash: stored.content_hash,
        inputs,
        generationMetadata:
          stored.generation_metadata_json === null
            ? null
            : JSON.parse(stored.generation_metadata_json),
        createdAt: stored.created_at,
      });
      if (
        stored.identity_hash !== hash(actual) ||
        JSON.stringify(actual) !== JSON.stringify(lineage(p))
      )
        throw new Error('INVALID_LINEAGE');
      return p;
    } catch (error) {
      if (
        error instanceof CompositionPlanRepositoryError ||
        error instanceof MediaAssetRepositoryError
      )
        throw mapped(error);
      throw fail(
        'INVALID_PERSISTED_COMPOSITION_PLAN',
        'compositionPlanId',
        'plano persistido inválido',
      );
    }
  }
  private async list(sql: string, id: string): Promise<CompositionPlan[]> {
    return this.run(async () => {
      const rows = (await this.session.query('media', sql, [id])).rows,
        plans: CompositionPlan[] = [];
      for (const row of rows)
        plans.push((await this.read(row.composition_plan_id, new Set()))!);
      return plans;
    });
  }
  async listCompositionPlansByPipelineRun(
    id: string,
  ): Promise<CompositionPlan[]> {
    identifier(id, 'pipelineRunId', 80);
    return this.list(
      'SELECT composition_plan_id FROM media.composition_plans WHERE pipeline_run_id=$1 ORDER BY created_at,script_id,revision,composition_plan_id',
      id,
    );
  }
  async listCompositionPlansByScript(id: string): Promise<CompositionPlan[]> {
    identifier(id, 'scriptId');
    return this.list(
      'SELECT composition_plan_id FROM media.composition_plans WHERE script_id=$1 ORDER BY revision,composition_plan_id',
      id,
    );
  }
  async getCompositionPlanSuccessor(
    id: string,
  ): Promise<CompositionPlan | null> {
    identifier(id, 'compositionPlanId');
    return (
      (
        await this.list(
          'SELECT composition_plan_id FROM media.composition_plans WHERE supersedes_composition_plan_id=$1',
          id,
        )
      )[0] ?? null
    );
  }
}
export class PostgresMediaCompositionPersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<AsyncMediaCompositionRepository> {
    await PostgresMediaCatalogSession.verify(this.database);
    const rows = (
      await this.database.query(
        'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        [],
        'media',
      )
    ).rows;
    if (
      MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY.some(
        (m) =>
          !rows.some(
            (r) =>
              r.version === m.version &&
              r.name === m.name &&
              r.checksum === postgresMigrationChecksum(m.sql),
          ),
      )
    )
      throw fail(
        'MEDIA_COMPOSITION_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'migration v9 requerida',
      );
    return new PostgresMediaCompositionRepository(
      new PostgresMediaCatalogSession(this.database, readOnly),
    );
  }
}
