import { createHash } from 'node:crypto';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import { PostgresMediaCatalogSession } from './postgres-media-catalog.session.js';
import { PostgresMediaVoiceRepository } from './postgres-media-voice.persistence.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import {
  validateAlignment,
  serializeSubtitles,
  SUBTITLE_PRESENTATION_POLICY,
} from '../domain/alignment-contracts.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { adaptationHash } from '../domain/media-hash.js';
import { inspectMvpWav } from './physical-media-inspection.js';
import { digest, documentBytes } from './local-evidence-storage.js';
import {
  localEvidenceLineage,
  type LocalSubtitleDocument,
  type LocalSubtitleProof,
} from './postgres-media-subtitle.contracts.js';
import { MEDIA_SUBTITLE_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-subtitle.migrations.js';

export const subtitleFailure = (code: string, field: string, message: string) =>
  new MediaAssetRepositoryError(code, field, message);
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface LocalSubtitleRecord {
  document: LocalSubtitleDocument;
  documentHash: string;
  alignmentDocumentHash: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  createdAt: string;
}
export interface AsyncLocalSubtitleRepository {
  registerLocalSubtitle(
    documentHash: string,
    alignmentDocumentHash: string,
  ): Promise<LocalSubtitleRecord>;
  getLocalSubtitle(id: string): Promise<LocalSubtitleRecord | null>;
  close(): Promise<void>;
}
function sha(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw subtitleFailure(
      'LOCAL_SUBTITLE_HASH_INVALID',
      field,
      'hash inválido',
    );
}
function json(source: LocalSubtitleProof, documentHash: string) {
  sha(documentHash, 'documentHash');
  const bytes = proofBytes(
    () => source.readEvidence(documentHash, 'json'),
    'documentHash',
  );
  if (bytes.length > 20971520 || digest(bytes) !== documentHash)
    throw subtitleFailure(
      'LOCAL_FILE_HASH_MISMATCH',
      'documentHash',
      'documento divergente',
    );
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw subtitleFailure(
      'LOCAL_SUBTITLE_CONTRACT_INVALID',
      'documentHash',
      'JSON inválido',
    );
  }
  if (digest(documentBytes(value)) !== documentHash)
    throw subtitleFailure(
      'LOCAL_SUBTITLE_DOCUMENT_NONCANONICAL',
      'documentHash',
      'serialização canônica requerida',
    );
  return value;
}
function proofBytes(read: () => Buffer, field: string): Buffer {
  try {
    const value = read();
    if (!Buffer.isBuffer(value)) throw new Error();
    return value;
  } catch {
    throw subtitleFailure(
      'LOCAL_SUBTITLE_PROOF_UNAVAILABLE',
      field,
      'evidência não disponível para verificação',
    );
  }
}
function document(value: unknown): LocalSubtitleDocument {
  const d = value as LocalSubtitleDocument;
  const keys = [
    'subtitleId',
    'alignmentId',
    'evidenceHash',
    'voiceTrackId',
    'scriptId',
    'scriptContentHash',
    'srtHash',
    'assHash',
  ];
  if (
    !d ||
    typeof d !== 'object' ||
    Array.isArray(d) ||
    Object.keys(d).sort().join() !== keys.sort().join()
  )
    throw subtitleFailure(
      'LOCAL_SUBTITLE_CONTRACT_INVALID',
      'document',
      'campos divergentes',
    );
  for (const field of [
    'subtitleId',
    'alignmentId',
    'voiceTrackId',
    'scriptId',
  ] as const)
    if (
      typeof d[field] !== 'string' ||
      !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(d[field])
    )
      throw subtitleFailure('LOCAL_SUBTITLE_ID_INVALID', field, 'ID inválido');
  for (const field of [
    'evidenceHash',
    'scriptContentHash',
    'srtHash',
    'assHash',
  ] as const)
    sha(d[field], field);
  return d;
}
export async function verifySubtitleSchema(
  database: PostgresDatabase,
): Promise<void> {
  await PostgresMediaCatalogSession.verify(database);
  const rows = (
    await database.query(
      'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
      [],
      'media',
    )
  ).rows;
  if (
    MEDIA_SUBTITLE_POSTGRES_MIGRATION_REGISTRY.some(
      (m) =>
        !rows.some(
          (r) =>
            r.version === m.version &&
            r.name === m.name &&
            r.checksum === postgresMigrationChecksum(m.sql),
        ),
    )
  )
    throw subtitleFailure(
      'MEDIA_SUBTITLE_SCHEMA_VERSION_UNSUPPORTED',
      'schemaVersion',
      'migration v11 requerida',
    );
}
export async function verifyStoredLocalLineage(
  session: PostgresMediaCatalogSession,
  id: string,
  expected: ReturnType<typeof validateArtifactLineage>,
) {
  const row = (
    await session.query(
      'content',
      'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
      [id],
    )
  ).rows[0];
  if (!row)
    throw subtitleFailure(
      'LOCAL_LINEAGE_INVALID',
      'artifactId',
      'linhagem ausente',
    );
  const inputs = (
    await session.query(
      'content',
      'SELECT position,kind,input_id AS "inputId",content_hash AS "contentHash" FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
      [id],
    )
  ).rows;
  const actual = validateArtifactLineage({
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
    inputs,
    generationMetadata:
      row.generation_metadata_json === null
        ? null
        : JSON.parse(row.generation_metadata_json),
    createdAt: row.created_at,
  });
  if (
    row.identity_hash !== hash(actual) ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  )
    throw subtitleFailure(
      'LOCAL_LINEAGE_INVALID',
      'artifactId',
      'linhagem divergente',
    );
}
export class PostgresMediaSubtitleRepository implements AsyncLocalSubtitleRepository {
  constructor(
    private readonly session: PostgresMediaCatalogSession,
    private readonly proof?: LocalSubtitleProof,
  ) {}
  async close(): Promise<void> {
    this.session.close();
  }
  private async verify(documentHash: string, alignmentDocumentHash: string) {
    if (!this.proof)
      throw subtitleFailure(
        'MEDIA_SUBTITLE_PROOF_SOURCE_REQUIRED',
        'evidence',
        'fonte de prova explícita requerida',
      );
    const d = document(json(this.proof, documentHash)),
      evidence = validateAlignment(json(this.proof, alignmentDocumentHash));
    const voice = await new PostgresMediaVoiceRepository(
        this.session,
      ).getVoiceTrack(d.voiceTrackId),
      script = await this.session.getScript(d.scriptId);
    if (!voice || !script)
      throw subtitleFailure(
        'LOCAL_SUBTITLE_BINDING_INVALID',
        'document',
        'voz ou roteiro ausentes',
      );
    if (voice.origin === 'SYNTHETIC_TTS')
      throw subtitleFailure(
        'MEDIA_SUBTITLE_NARRATION_CONTEXT_REQUIRED',
        'voiceTrackId',
        'adaptação de narração sintética requer seu contexto canônico',
      );
    if (
      evidence.output.alignmentId !== d.alignmentId ||
      evidence.output.evidenceHash !== d.evidenceHash ||
      evidence.input.audioAssetId !== d.voiceTrackId ||
      evidence.input.scriptId !== d.scriptId ||
      evidence.input.scriptVersion !== script.revision ||
      voice.scriptId !== script.scriptId ||
      voice.scriptContentHash !== script.contentHash ||
      d.scriptContentHash !== script.contentHash ||
      evidence.input.audioSha256 !== voice.contentHash ||
      evidence.input.durationMs !== voice.durationMilliseconds ||
      evidence.input.canonicalText !== script.fullNarration
    )
      throw subtitleFailure(
        'LOCAL_SUBTITLE_BINDING_INVALID',
        'document',
        'alinhamento/voz/roteiro divergentes',
      );
    const audio = proofBytes(
      () => this.proof!.readAudio(voice.contentHash),
      'voiceTrackId',
    );
    if (
      audio.length > 20971520 ||
      digest(audio) !== voice.contentHash ||
      inspectMvpWav(audio).durationMilliseconds !== voice.durationMilliseconds
    )
      throw subtitleFailure(
        'ALIGNMENT_CURRENT_BINDING_INVALID',
        'voiceTrackId',
        'áudio real divergente',
      );
    if (!(await this.proof.alignmentVerifier.verify(evidence, audio)))
      throw subtitleFailure(
        'ALIGNMENT_PROVENANCE_UNVERIFIED',
        'alignmentId',
        'status/hash não comprovam proveniência',
      );
    const srt = proofBytes(
        () => this.proof!.readEvidence(d.srtHash, 'srt'),
        'srtHash',
      ),
      ass = proofBytes(
        () => this.proof!.readEvidence(d.assHash, 'ass'),
        'assHash',
      );
    if (
      srt.length > 20971520 ||
      ass.length > 20971520 ||
      digest(srt) !== d.srtHash ||
      digest(ass) !== d.assHash
    )
      throw subtitleFailure(
        'LOCAL_FILE_HASH_MISMATCH',
        'subtitles',
        'SRT/ASS divergentes',
      );
    // Validation only: compare existing bytes with the unchanged pure serializer; produce no files.
    const presentation = {
        frameRate: 30,
        durationMs: evidence.input.durationMs,
      },
      expected = serializeSubtitles(evidence.output.segments, presentation);
    if (
      !srt.equals(Buffer.from(expected.srt)) ||
      !ass.equals(Buffer.from(expected.ass))
    )
      throw subtitleFailure(
        'LOCAL_SUBTITLE_PRESENTATION_INVALID',
        'subtitles',
        'bytes não correspondem à política canônica',
      );
    const presentationHash = adaptationHash({
      policy: SUBTITLE_PRESENTATION_POLICY,
      presentation,
      srt: expected.srt,
      ass: expected.ass,
    });
    if (
      d.subtitleId !==
      `subtitle_local:${evidence.output.evidenceHash}:${presentationHash}`
    )
      throw subtitleFailure(
        'LOCAL_SUBTITLE_ID_INVALID',
        'subtitleId',
        'identidade canônica divergente',
      );
    const alignmentColumns = {
      alignment_id: d.alignmentId,
      document_hash: alignmentDocumentHash,
      evidence_hash: d.evidenceHash,
      pipeline_run_id: voice.pipelineRunId,
      project_id: voice.projectId,
      project_version: voice.projectVersion,
      voice_track_id: voice.voiceTrackId,
      voice_track_content_hash: voice.contentHash,
      script_id: script.scriptId,
      script_content_hash: script.contentHash,
      script_revision: script.revision,
      duration_milliseconds: voice.durationMilliseconds,
      created_at: voice.createdAt,
    };
    const subtitleColumns = {
      subtitle_id: d.subtitleId,
      alignment_id: d.alignmentId,
      evidence_hash: d.evidenceHash,
      voice_track_id: d.voiceTrackId,
      script_id: d.scriptId,
      script_content_hash: d.scriptContentHash,
      srt_hash: d.srtHash,
      ass_hash: d.assHash,
      document_hash: documentHash,
      identity_hash: adaptationHash(d),
      pipeline_run_id: voice.pipelineRunId,
      project_id: voice.projectId,
      project_version: voice.projectVersion,
      created_at: voice.createdAt,
      payload_json: JSON.stringify(d),
    };
    const alignmentLineage = localEvidenceLineage(
      d.alignmentId,
      'local_alignment',
      voice,
      alignmentDocumentHash,
      [
        { inputId: voice.voiceTrackId, contentHash: voice.contentHash },
        { inputId: script.scriptId, contentHash: script.contentHash },
      ],
    );
    const subtitleLineage = localEvidenceLineage(
      d.subtitleId,
      'local_subtitles',
      voice,
      documentHash,
      [
        { inputId: d.alignmentId, contentHash: alignmentDocumentHash },
        { inputId: script.scriptId, contentHash: script.contentHash },
        { inputId: voice.voiceTrackId, contentHash: voice.contentHash },
      ],
    );
    return {
      d,
      alignmentColumns,
      subtitleColumns,
      alignmentLineage,
      subtitleLineage,
      record: {
        document: structuredClone(d),
        documentHash,
        alignmentDocumentHash,
        pipelineRunId: voice.pipelineRunId,
        projectId: voice.projectId,
        projectVersion: voice.projectVersion,
        createdAt: voice.createdAt,
      } satisfies LocalSubtitleRecord,
    };
  }
  private async insert(
    table: 'local_alignments' | 'local_subtitles',
    columns: Record<string, unknown>,
    idColumn: string,
    lineage: ReturnType<typeof validateArtifactLineage>,
  ) {
    const prior = (
      await this.session.query(
        'media',
        `SELECT * FROM media.${table} WHERE ${idColumn}=$1`,
        [columns[idColumn]],
      )
    ).rows[0];
    if (prior) {
      const expected = { ...columns };
      delete expected.payload_json;
      if (Object.entries(expected).some(([k, v]) => prior[k] !== v))
        throw subtitleFailure(
          'LOCAL_ID_REUSED',
          idColumn,
          'identidade já registrada com evidência divergente',
        );
      await verifyStoredLocalLineage(
        this.session,
        String(columns[idColumn]),
        lineage,
      );
      return;
    }
    if (
      (
        await this.session.query(
          'content',
          'SELECT 1 FROM content.artifact_lineage WHERE artifact_id=$1',
          [columns[idColumn]],
        )
      ).rows.length
    )
      throw subtitleFailure(
        'LOCAL_ID_REUSED',
        idColumn,
        'ID de artefato ocupado',
      );
    const a = lineage;
    await this.session.query(
      'content',
      'INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,$12)',
      [
        a.artifactId,
        a.schemaVersion,
        a.artifactType,
        a.artifactVersion,
        hash(a),
        a.pipelineRunId,
        a.projectId,
        a.projectVersion,
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
  async registerLocalSubtitle(
    documentHash: string,
    alignmentDocumentHash: string,
  ): Promise<LocalSubtitleRecord> {
    return this.session.run(async () => {
      const v = await this.verify(documentHash, alignmentDocumentHash);
      await this.insert(
        'local_alignments',
        v.alignmentColumns,
        'alignment_id',
        v.alignmentLineage,
      );
      await this.insert(
        'local_subtitles',
        v.subtitleColumns,
        'subtitle_id',
        v.subtitleLineage,
      );
      return (await this.read(v.d.subtitleId))!;
    }, true);
  }
  private async read(id: string): Promise<LocalSubtitleRecord | null> {
    const row = (
      await this.session.query(
        'media',
        'SELECT * FROM media.local_subtitles WHERE subtitle_id=$1',
        [id],
      )
    ).rows[0];
    if (!row) return null;
    const alignment = (
      await this.session.query(
        'media',
        'SELECT * FROM media.local_alignments WHERE alignment_id=$1',
        [row.alignment_id],
      )
    ).rows[0];
    if (!alignment)
      throw subtitleFailure(
        'LOCAL_SUBTITLE_BINDING_INVALID',
        'alignmentId',
        'alinhamento ausente',
      );
    const v = await this.verify(row.document_hash, alignment.document_hash);
    const expected = { ...v.subtitleColumns };
    delete (expected as Record<string, unknown>).payload_json;
    if (
      JSON.stringify(document(JSON.parse(row.payload_json))) !==
        JSON.stringify(v.d) ||
      Object.entries(expected).some(([k, x]) => row[k] !== x) ||
      Object.entries(v.alignmentColumns).some(([k, x]) => alignment[k] !== x)
    )
      throw subtitleFailure(
        'INVALID_PERSISTED_LOCAL_SUBTITLE',
        'subtitleId',
        'metadados persistidos divergentes',
      );
    await verifyStoredLocalLineage(this.session, id, v.subtitleLineage);
    await verifyStoredLocalLineage(
      this.session,
      v.d.alignmentId,
      v.alignmentLineage,
    );
    return v.record;
  }
  async getLocalSubtitle(id: string): Promise<LocalSubtitleRecord | null> {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(id))
      throw subtitleFailure(
        'LOCAL_SUBTITLE_ID_INVALID',
        'subtitleId',
        'ID inválido',
      );
    return this.session.run(() => this.read(id));
  }
}
export class PostgresMediaSubtitlePersistence {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly proof?: LocalSubtitleProof,
  ) {}
  async open(readOnly = false): Promise<AsyncLocalSubtitleRepository> {
    await verifySubtitleSchema(this.database);
    return new PostgresMediaSubtitleRepository(
      new PostgresMediaCatalogSession(this.database, readOnly),
      this.proof,
    );
  }
}
