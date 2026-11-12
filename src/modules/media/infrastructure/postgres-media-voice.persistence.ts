import { createHash } from 'node:crypto';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import {
  validateVoiceTrack,
  voiceTrackIdentityHash,
} from '../domain/voice-track-contracts.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import {
  PostgresMediaCatalogSession,
  mediaCatalogError,
  mediaCatalogFailure as fail,
} from './postgres-media-catalog.session.js';
import { MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-voice.migrations.js';

// Typed metadata for this async port; runtime validation remains exclusively canonical.
export interface VoiceTrack {
  schemaVersion: 'voice-track/1.0.0';
  voiceTrackId: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptContentHash: string;
  language: string;
  voiceStyle: string;
  durationMilliseconds: number;
  audioFormat: 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac';
  contentHash: string;
  storageReference: string;
  origin: 'SYNTHETIC_TTS' | 'OPERATOR_RECORDING' | 'AUTHORIZED_RECORDING';
  provider: string | null;
  rights: {
    usageBasis: 'OWNED' | 'LICENSED' | 'PROVIDER_TERMS';
    commercialUseAllowed: true;
  };
  createdAt: string;
  revision: number;
  supersedesVoiceTrackId: string | null;
}
export interface AsyncMediaVoiceRepository {
  registerLocalVoice(
    value: unknown,
    documentHash: string,
    rightsHash: string,
  ): Promise<VoiceTrack>;
  getVoiceTrack(id: string): Promise<VoiceTrack | null>;
  listVoiceTracksByPipelineRun(id: string): Promise<VoiceTrack[]>;
  listVoiceTracksByScript(id: string): Promise<VoiceTrack[]>;
  getVoiceTrackSuccessor(id: string): Promise<VoiceTrack | null>;
  close(): Promise<void>;
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identifier(id: string, field: string, max = 200) {
  if (
    typeof id !== 'string' ||
    id.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(id)
  )
    throw fail('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function evidenceHash(value: string, field: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw fail(
      'LOCAL_RIGHTS_EVIDENCE_REQUIRED',
      field,
      'referência hash de evidência requerida',
    );
}
function supported(v: VoiceTrack) {
  if (v.origin === 'SYNTHETIC_TTS') {
    if (
      v.provider === null ||
      !['local_piper', 'local_espeak_ng', 'local_kokoro'].includes(v.provider)
    )
      throw fail(
        'MEDIA_VOICE_FINANCE_DEPENDENCY_REQUIRED',
        'provider',
        'origem não suportada sem contrato financeiro e evidências coordenadas',
      );
    if (v.rights.usageBasis !== 'LICENSED')
      throw fail(
        'LOCAL_RIGHTS_EVIDENCE_REQUIRED',
        'rights.usageBasis',
        'voz local requer licença',
      );
  } else if (
    v.provider !== null ||
    !['OWNED', 'LICENSED'].includes(v.rights.usageBasis)
  )
    throw fail(
      'LOCAL_AUTHORIZED_AUDIO_REQUIRED',
      'origin',
      'gravação própria ou autorizada requerida',
    );
  // Preserve opaque references accepted by the canonical validator; bind a declared CAS hash.
  if (
    v.storageReference.startsWith('object:voice/sha256/') &&
    v.storageReference !== `object:voice/sha256/${v.contentHash}`
  )
    throw fail(
      'LOCAL_AUDIO_HASH_MISMATCH',
      'storageReference',
      'referência CAS divergente',
    );
}
function lineage(v: VoiceTrack, documentHash: string, rightsHash: string) {
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: v.voiceTrackId,
    artifactType: 'voice_track',
    artifactVersion: v.revision,
    pipelineRunId: v.pipelineRunId,
    projectId: v.projectId,
    projectVersion: v.projectVersion,
    contentIdentity: null,
    hashAlgorithm: 'sha256',
    contentHash: v.contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: v.scriptId,
        contentHash: v.scriptContentHash,
      },
      {
        position: 2,
        kind: 'EXTERNAL_INPUT',
        inputId: `rights:${rightsHash}`,
        contentHash: rightsHash,
      },
    ],
    generationMetadata: {
      provider: 'local',
      model: 'local-flow/1',
      taskType: 'local-evidence',
      promptVersion: 'none',
      configurationHash: documentHash,
      publicConfiguration: null,
    },
    createdAt: v.createdAt,
  });
}
function columns(
  v: VoiceTrack,
  documentHash: string,
  rightsHash: string,
): Record<string, unknown> {
  return {
    voice_track_id: v.voiceTrackId,
    schema_version: v.schemaVersion,
    identity_hash: voiceTrackIdentityHash(v),
    pipeline_run_id: v.pipelineRunId,
    project_id: v.projectId,
    project_version: v.projectVersion,
    script_id: v.scriptId,
    script_content_hash: v.scriptContentHash,
    language: v.language,
    voice_style: v.voiceStyle,
    duration_milliseconds: v.durationMilliseconds,
    audio_format: v.audioFormat,
    content_hash: v.contentHash,
    storage_reference: v.storageReference,
    origin: v.origin,
    provider: v.provider,
    usage_basis: v.rights.usageBasis,
    commercial_use_allowed: 1,
    created_at: v.createdAt,
    revision: v.revision,
    supersedes_voice_track_id: v.supersedesVoiceTrackId,
    payload_json: JSON.stringify(v),
    document_hash: documentHash,
    rights_hash: rightsHash,
  };
}
export class PostgresMediaVoiceRepository implements AsyncMediaVoiceRepository {
  constructor(private readonly session: PostgresMediaCatalogSession) {}
  async close(): Promise<void> {
    this.session.close();
  }
  private async scope(v: VoiceTrack) {
    const run = await this.session.getRun(v.pipelineRunId);
    const script = await this.session.getScript(v.scriptId);
    if (
      !run ||
      !script ||
      script.contentHash !== v.scriptContentHash ||
      script.language !== v.language ||
      (['pipelineRunId', 'projectId', 'projectVersion'] as const).some(
        (k) => run[k] !== v[k] || script[k] !== v[k],
      )
    )
      throw fail(
        'LOCAL_SCRIPT_BINDING_INVALID',
        'scriptId',
        'run, roteiro ou versão incompatíveis',
      );
  }
  private async previous(v: VoiceTrack, seen: Set<string>) {
    if (v.revision === 1) return null;
    const p = v.supersedesVoiceTrackId
      ? await this.read(v.supersedesVoiceTrackId, seen)
      : null;
    if (
      !p ||
      (
        [
          'scriptId',
          'pipelineRunId',
          'projectId',
          'projectVersion',
          'language',
          'voiceStyle',
        ] as const
      ).some((k) => p[k] !== v[k]) ||
      p.revision + 1 !== v.revision
    )
      throw fail(
        'VOICE_TRACK_REVISION_MISMATCH',
        'revision',
        'supersession requer revisão imediata no mesmo escopo',
      );
    return p;
  }
  async registerLocalVoice(
    value: unknown,
    documentHash: string,
    rightsHash: string,
  ): Promise<VoiceTrack> {
    let v: VoiceTrack;
    try {
      v = validateVoiceTrack(value);
    } catch (error) {
      throw mediaCatalogError(error);
    }
    evidenceHash(documentHash, 'documentHash');
    evidenceHash(rightsHash, 'rightsHash');
    supported(v);
    return this.session.run(async () => {
      const row = (
        await this.session.query(
          'media',
          'SELECT identity_hash,document_hash,rights_hash FROM media.voice_tracks WHERE voice_track_id=$1',
          [v.voiceTrackId],
        )
      ).rows[0];
      if (row) {
        if (
          row.identity_hash !== voiceTrackIdentityHash(v) ||
          row.document_hash !== documentHash ||
          row.rights_hash !== rightsHash
        )
          throw fail(
            'LOCAL_ID_REUSED',
            'voiceTrackId',
            'ID ou evidências reutilizados com conteúdo divergente',
          );
        return (await this.read(v.voiceTrackId, new Set()))!;
      }
      await this.scope(v);
      await this.previous(v, new Set([v.voiceTrackId]));
      if (
        (
          await this.session.query(
            'media',
            'SELECT 1 FROM media.voice_tracks WHERE script_id=$1 AND revision=$2',
            [v.scriptId, v.revision],
          )
        ).rows.length
      )
        throw fail(
          'VOICE_TRACK_REVISION_CONFLICT',
          'revision',
          'revisão já registrada',
        );
      const a = lineage(v, documentHash, rightsHash);
      await this.session.query(
        'content',
        `INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
          JSON.stringify(a.generationMetadata),
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
      const c = columns(v, documentHash, rightsHash);
      // Column names originate only from the fixed mapping above; every value is parameterized.
      await this.session.query(
        'media',
        `INSERT INTO media.voice_tracks(${Object.keys(c).join(',')}) VALUES(${Object.keys(
          c,
        )
          .map((_, i) => `$${i + 1}`)
          .join(',')})`,
        Object.values(c),
      );
      return (await this.read(v.voiceTrackId, new Set()))!;
    }, true);
  }
  async getVoiceTrack(id: string): Promise<VoiceTrack | null> {
    identifier(id, 'voiceTrackId');
    return this.session.run(() => this.read(id, new Set()));
  }
  private async read(
    id: string,
    seen: Set<string>,
  ): Promise<VoiceTrack | null> {
    if (seen.has(id))
      throw fail(
        'INVALID_PERSISTED_VOICE_TRACK',
        'voiceTrackId',
        'ciclo de supersession',
      );
    seen.add(id);
    const row = (
      await this.session.query(
        'media',
        'SELECT * FROM media.voice_tracks WHERE voice_track_id=$1',
        [id],
      )
    ).rows[0];
    if (!row) return null;
    try {
      const v = validateVoiceTrack(JSON.parse(row.payload_json));
      supported(v);
      evidenceHash(row.document_hash, 'documentHash');
      evidenceHash(row.rights_hash, 'rightsHash');
      const expected = columns(v, row.document_hash, row.rights_hash);
      delete expected.payload_json;
      if (Object.entries(expected).some(([k, value]) => row[k] !== value))
        throw new Error('INVALID_COLUMNS');
      await this.scope(v);
      await this.previous(v, seen);
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
        JSON.stringify(actual) !==
          JSON.stringify(lineage(v, row.document_hash, row.rights_hash))
      )
        throw new Error('INVALID_LINEAGE');
      return v;
    } catch (error) {
      if (
        error instanceof MediaAssetRepositoryError &&
        error.code === 'MEDIA_CONTENT_CONTEXT_REQUIRED'
      )
        throw error;
      throw fail(
        'INVALID_PERSISTED_VOICE_TRACK',
        'voiceTrackId',
        'faixa persistida inválida',
      );
    }
  }
  private async list(sql: string, id: string): Promise<VoiceTrack[]> {
    return this.session.run(async () => {
      const rows = (await this.session.query('media', sql, [id])).rows;
      const values: VoiceTrack[] = [];
      for (const row of rows)
        values.push((await this.read(row.voice_track_id, new Set()))!);
      return values;
    });
  }
  async listVoiceTracksByPipelineRun(id: string): Promise<VoiceTrack[]> {
    identifier(id, 'pipelineRunId', 80);
    return this.list(
      'SELECT voice_track_id FROM media.voice_tracks WHERE pipeline_run_id=$1 ORDER BY created_at,script_id,revision,voice_track_id',
      id,
    );
  }
  async listVoiceTracksByScript(id: string): Promise<VoiceTrack[]> {
    identifier(id, 'scriptId');
    return this.list(
      'SELECT voice_track_id FROM media.voice_tracks WHERE script_id=$1 ORDER BY revision,voice_track_id',
      id,
    );
  }
  async getVoiceTrackSuccessor(id: string): Promise<VoiceTrack | null> {
    identifier(id, 'voiceTrackId');
    const rows = await this.list(
      'SELECT voice_track_id FROM media.voice_tracks WHERE supersedes_voice_track_id=$1',
      id,
    );
    return rows[0] ?? null;
  }
}
export class PostgresMediaVoicePersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<AsyncMediaVoiceRepository> {
    await PostgresMediaCatalogSession.verify(this.database);
    const rows = (
      await this.database.query(
        'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        [],
        'media',
      )
    ).rows;
    if (
      MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY.some(
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
        'MEDIA_VOICE_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'migration v8 requerida',
      );
    return new PostgresMediaVoiceRepository(
      new PostgresMediaCatalogSession(this.database, readOnly),
    );
  }
}
