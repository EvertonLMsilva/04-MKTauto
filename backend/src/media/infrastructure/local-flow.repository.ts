import { createHash } from 'node:crypto';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { VideoRenderRepository } from './video-render.reader.js';
import {
  LocalEvidenceStorage,
  documentBytes,
} from './local-evidence-storage.js';
import { adaptationHash } from '../domain/media-hash.js';
import { ttsHash } from '../../finance/domain/tts-financial-contracts.js';
import { localFail } from '../domain/alignment-contracts.js';
import {
  validateVoiceTrack,
  voiceTrackIdentityHash,
} from '../domain/voice-track-contracts.js';
import {
  validateVideoRender,
  videoRenderIdentityHash,
} from '../domain/video-render-contracts.js';
export class LocalFlowRepository extends VideoRenderRepository {
  paidTtsGrant(id: string) {
    const row = this.db
      .prepare(
        'SELECT d.request_hash,d.approval_hash,a.approval_json FROM tts_risk_dispatches_v2 d JOIN tts_financial_approvals a ON a.operation_id=d.operation_id WHERE d.operation_id=?',
      )
      .get(id);
    if (!row) localFail('TTS_DISPATCH_EVIDENCE_REQUIRED');
    const approval = JSON.parse(row.approval_json);
    if (
      ttsHash(approval) !== row.approval_hash ||
      approval.requestHash !== row.request_hash ||
      approval.acceptsUnboundedCost !== true
    )
      localFail('TTS_DISPATCH_EVIDENCE_REQUIRED');
    return { requestHash: row.request_hash, actorId: approval.approvedBy };
  }
  localVoiceIds(runId: string, scriptId: string, scriptHash: string): string[] {
    return this.db
      .prepare(
        `SELECT v.voice_track_id FROM voice_tracks v
       JOIN artifact_lineage a ON a.artifact_id=v.voice_track_id
       WHERE v.pipeline_run_id=? AND v.script_id=? AND v.script_content_hash=?
       AND ((v.origin IN ('AUTHORIZED_RECORDING','OPERATOR_RECORDING') AND v.provider IS NULL)
         OR (v.origin='SYNTHETIC_TTS' AND v.provider IN ('local_piper','local_espeak_ng','openai')))
       AND v.commercial_use_allowed=1
       AND a.artifact_type='voice_track' AND a.generation_metadata_json IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM voice_tracks n WHERE n.supersedes_voice_track_id=v.voice_track_id)
       ORDER BY v.voice_track_id`,
      )
      .all(runId, scriptId, scriptHash)
      .map((row: { voice_track_id: string }) => String(row.voice_track_id));
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw e;
    }
  }
  putArtifact(
    id: string,
    type: string,
    scope: any,
    hash: string,
    inputs: { inputId: string; contentHash: string; kind?: string }[],
    documentHash: string,
    revision = 1,
    taskType = 'local-evidence',
  ) {
    const artifact = validateArtifactLineage({
      schemaVersion: 'artifact-lineage/1.0.0',
      artifactId: id,
      artifactType: type,
      artifactVersion: revision,
      pipelineRunId: scope.pipelineRunId,
      projectId: scope.projectId,
      projectVersion: scope.projectVersion,
      contentIdentity: null,
      hashAlgorithm: 'sha256',
      contentHash: hash,
      inputs: inputs.map((x, i) => ({
        position: i + 1,
        kind: x.kind ?? 'INTERNAL_ARTIFACT',
        inputId: x.inputId,
        contentHash: x.contentHash,
      })),
      generationMetadata: {
        provider: 'local',
        model: 'local-flow/1',
        taskType,
        promptVersion: 'none',
        configurationHash: documentHash,
        publicConfiguration: null,
      },
      createdAt: scope.createdAt,
    });
    const previous = this.getArtifact(id);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(artifact))
        localFail('LOCAL_ID_REUSED');
      return;
    }
    this.db
      .prepare(
        `INSERT INTO artifact_lineage (artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        artifact.schemaVersion,
        type,
        revision,
        createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
        scope.pipelineRunId,
        scope.projectId,
        scope.projectVersion,
        null,
        'sha256',
        hash,
        JSON.stringify(artifact.generationMetadata),
        scope.createdAt,
      );
    for (const x of artifact.inputs)
      this.db
        .prepare(
          'INSERT INTO artifact_lineage_inputs (artifact_id,position,kind,input_id,content_hash) VALUES (?,?,?,?,?)',
        )
        .run(id, x.position, x.kind, x.inputId, x.contentHash);
  }
  document<T>(id: string, type: string, files: LocalEvidenceStorage): T {
    const artifact = this.getArtifact(id);
    if (!artifact || artifact.artifactType !== type)
      localFail('LOCAL_ARTIFACT_NOT_FOUND');
    const hash = (artifact.generationMetadata as { configurationHash: string })
      .configurationHash;
    const value = JSON.parse(
      files.read(hash, 'json', 20971520).toString(),
    ) as T;
    for (const x of artifact.inputs) {
      if (
        x.kind === 'INTERNAL_ARTIFACT' &&
        this.getArtifact(x.inputId)?.contentHash !== x.contentHash
      )
        localFail('LOCAL_LINEAGE_INVALID');
    }
    return value;
  }
  saveDocument(
    id: string,
    type: string,
    value: unknown,
    scope: any,
    inputs: { inputId: string; contentHash: string; kind?: string }[],
    files: LocalEvidenceStorage,
  ) {
    const bytes = documentBytes(value),
      hash = files.put(bytes, 'json');
    this.putArtifact(id, type, scope, hash, inputs, hash);
    return value;
  }
  registerLocalVoice(raw: unknown, documentHash: string, rightsHash: string) {
    const v = validateVoiceTrack(raw);
    const previous = this.getVoiceTrack(v.voiceTrackId);
    if (previous) {
      const lineage = this.getArtifact(v.voiceTrackId);
      if (
        adaptationHash(previous) !== adaptationHash(v) ||
        (lineage?.generationMetadata as { configurationHash?: string })
          ?.configurationHash !== documentHash
      )
        localFail('LOCAL_ID_REUSED');
      return previous;
    }
    this.putArtifact(
      v.voiceTrackId,
      'voice_track',
      v,
      v.contentHash,
      [
        { inputId: v.scriptId, contentHash: v.scriptContentHash },
        {
          inputId: `rights:${rightsHash}`,
          contentHash: rightsHash,
          kind: 'EXTERNAL_INPUT',
        },
      ],
      documentHash,
      v.revision,
    );
    this.db
      .prepare(
        `INSERT INTO voice_tracks (voice_track_id,schema_version,identity_hash,pipeline_run_id,project_id,project_version,script_id,script_content_hash,language,voice_style,duration_milliseconds,audio_format,content_hash,storage_reference,origin,provider,usage_basis,commercial_use_allowed,created_at,revision,supersedes_voice_track_id,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        v.voiceTrackId,
        v.schemaVersion,
        voiceTrackIdentityHash(v),
        v.pipelineRunId,
        v.projectId,
        v.projectVersion,
        v.scriptId,
        v.scriptContentHash,
        v.language,
        v.voiceStyle,
        v.durationMilliseconds,
        v.audioFormat,
        v.contentHash,
        v.storageReference,
        v.origin,
        v.provider,
        v.rights.usageBasis,
        1,
        v.createdAt,
        v.revision,
        v.supersedesVoiceTrackId,
        JSON.stringify(v),
      );
    return this.getVoiceTrack(v.voiceTrackId);
  }
  registerBurned(
    raw: unknown,
    subtitleId: string,
    files: LocalEvidenceStorage,
  ) {
    const v = validateVideoRender(raw);
    const previous = this.getVideoRender(v.videoRenderId);
    if (previous) {
      if (adaptationHash(previous) !== adaptationHash(v))
        localFail('LOCAL_ID_REUSED');
      return previous;
    }
    const subtitle = this.getArtifact(subtitleId);
    const source = this.getVideoRender(v.supersedesVideoRenderId) as any;
    if (
      !subtitle ||
      !source ||
      source.revision !== 1 ||
      source.compositionPlanId !== v.compositionPlanId ||
      source.pipelineRunId !== v.pipelineRunId
    )
      localFail('LOCAL_RENDER_BINDING_INVALID');
    const doc = files.put(documentBytes(v), 'json');
    this.putArtifact(
      v.videoRenderId,
      'video_render',
      v,
      v.contentHash,
      [
        {
          inputId: v.compositionPlanId,
          contentHash: v.compositionPlanContentHash,
        },
        { inputId: source.videoRenderId, contentHash: source.contentHash },
        { inputId: subtitleId, contentHash: subtitle.contentHash },
      ],
      doc,
      2,
      'subtitle-burn-in',
    );
    this.db
      .prepare(
        `INSERT INTO video_renders (video_render_id,schema_version,identity_hash,pipeline_run_id,project_id,project_version,composition_plan_id,composition_plan_content_hash,output_aspect_ratio,duration_milliseconds,container_format,width_pixels,height_pixels,content_hash,logical_reference,created_at,revision,supersedes_video_render_id,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        v.videoRenderId,
        v.schemaVersion,
        videoRenderIdentityHash(v),
        v.pipelineRunId,
        v.projectId,
        v.projectVersion,
        v.compositionPlanId,
        v.compositionPlanContentHash,
        v.outputAspectRatio,
        v.durationMilliseconds,
        v.containerFormat,
        v.widthPixels,
        v.heightPixels,
        v.contentHash,
        v.logicalReference,
        v.createdAt,
        v.revision,
        v.supersedesVideoRenderId,
        JSON.stringify(v),
      );
    return this.getVideoRender(v.videoRenderId);
  }
}
