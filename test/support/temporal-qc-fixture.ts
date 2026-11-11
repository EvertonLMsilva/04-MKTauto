import { falFixture } from './fal-fixture.js';
import { CompositionPlanRepository } from '../../src/modules/media/infrastructure/composition-plan.reader.js';
import { MediaPersistence } from '../../src/modules/media/infrastructure/media.persistence.js';
import { MediaService } from '../../src/modules/media/application/media.service.js';
import { compositionPlanContentHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
import { voiceTrackIdentityHash } from '../../src/modules/media/domain/voice-track-contracts.js';
import { createHash } from 'node:crypto';
import { validateArtifactLineage } from '../../src/modules/content/domain/artifact-lineage-contracts.js';
import { mediaAcquisitionRequestHash } from '../../src/modules/media/domain/media-acquisition-contracts.js';

// Synthetic metadata only, seeded into the real schema. No physical media or analyzer.
export function fixture(
  _mixed = true,
  beforeContent?: (context: {
    database: string;
    projectId: string;
    pipelineRunId: string;
  }) => void,
  acquiredVideo?: {
    operationId: string;
    contentHash: string;
    width: number;
    height: number;
  },
) {
  const f = falFixture();
  const time = '2026-10-16T12:00:00Z';
  const snapshot = f.base.create({
    id: 'temporal_project',
    name: 'Temporal QC',
    version: 1,
    niche: 'Tecnologia',
    subniches: ['Fones'],
    audience: { profile: 'Adultos', language: 'pt-BR' },
    references: [],
    channel: {
      productionProfile: 'MIXED_MEDIA_V2',
      publishing: {
        contentsPerDay: 1,
        networks: ['instagram'],
        timezone: 'America/Sao_Paulo',
        times: ['10:00'],
      },
    },
  });
  f.base.startRun({
    execution: {
      pipelineRunId: 'temporal_run',
      projectId: snapshot.project.id,
      projectVersion: 1,
      startedAt: time,
    },
    projectSnapshot: snapshot,
  });
  beforeContent?.({
    database: f.database,
    projectId: snapshot.project.id,
    pipelineRunId: 'temporal_run',
  });
  const scope = {
    pipelineRunId: 'temporal_run',
    projectId: snapshot.project.id,
    projectVersion: 1,
  };
  const script = {
    ...scope,
    scriptId: 'temporal_script',
    contentHash: 'b'.repeat(64),
    visualDirections: [{ position: 1 }, { position: 2 }],
  };
  const repository = new CompositionPlanRepository(
    f.database,
    { get: (id) => f.base.getRun(id)! },
    { getScript: () => script as any },
  );
  const db = repository.db;
  // Bypass editorial selection seeding only. All Media and composition constraints remain active.
  db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER scripts_validate_scope;');
  db.prepare(
    `INSERT INTO scripts (script_id,schema_version,pipeline_run_id,project_id,project_version,
    idea_selection_id,idea_selection_content_hash,idea_candidate_id,idea_content_hash,language,content_format,
    estimated_duration_seconds,origin,created_at,revision,supersedes_script_id,content_hash,payload_json)
    VALUES (?,'script/1.0.0',?,?,1,'selection_test',?,'idea_test',?,'pt-BR','short_video',10,'OPERATOR',?,1,NULL,?,?)`,
  ).run(
    script.scriptId,
    scope.pipelineRunId,
    scope.projectId,
    'a'.repeat(64),
    'a'.repeat(64),
    time,
    script.contentHash,
    JSON.stringify(script),
  );
  db.exec('PRAGMA foreign_keys=ON;');
  const voice = {
    ...scope,
    schemaVersion: 'voice-track/1.0.0',
    voiceTrackId: 'temporal_voice',
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    language: 'pt-BR',
    voiceStyle: 'informative',
    durationMilliseconds: 10000,
    audioFormat: 'wav',
    contentHash: 'c'.repeat(64),
    storageReference: 'voice:test',
    origin: 'OPERATOR_RECORDING',
    provider: null,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    createdAt: time,
    revision: 1,
    supersedesVoiceTrackId: null,
  };
  function lineage(id: string, type: string, hash: string) {
    const value = {
      schemaVersion: 'artifact-lineage/1.0.0',
      artifactId: id,
      artifactType: type,
      artifactVersion: 1,
      ...scope,
      contentIdentity: `${type}:${id}`,
      hashAlgorithm: 'sha256',
      contentHash: hash,
      inputs: [],
      generationMetadata: null,
      createdAt: time,
    };
    db.prepare(
      `INSERT INTO artifact_lineage (artifact_id,schema_version,artifact_type,artifact_version,identity_hash,
      pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at)
      VALUES (?,?,?,1,?,?,?,1,?,'sha256',?,NULL,?)`,
    ).run(
      id,
      value.schemaVersion,
      type,
      createHash('sha256')
        .update(JSON.stringify(validateArtifactLineage(value)))
        .digest('hex'),
      scope.pipelineRunId,
      scope.projectId,
      value.contentIdentity,
      hash,
      time,
    );
  }
  lineage(script.scriptId, 'script', script.contentHash);
  lineage(voice.voiceTrackId, 'voice_track', voice.contentHash);
  db.prepare(
    `INSERT INTO voice_tracks (voice_track_id,schema_version,identity_hash,pipeline_run_id,project_id,project_version,
    script_id,script_content_hash,language,voice_style,duration_milliseconds,audio_format,content_hash,storage_reference,
    origin,provider,usage_basis,commercial_use_allowed,created_at,revision,supersedes_voice_track_id,payload_json)
    VALUES (?,?,?,?,?,1,?,?,'pt-BR','informative',10000,'wav',?,?,'OPERATOR_RECORDING',NULL,'OWNED',1,?,1,NULL,?)`,
  ).run(
    voice.voiceTrackId,
    voice.schemaVersion,
    voiceTrackIdentityHash(voice),
    scope.pipelineRunId,
    scope.projectId,
    script.scriptId,
    script.contentHash,
    voice.contentHash,
    voice.storageReference,
    time,
    JSON.stringify(voice),
  );
  const assets = [0, 1].map((index) => ({
    schemaVersion: 'media-asset/1.0.0',
    mediaAssetId:
      index && acquiredVideo
        ? `media_asset:${acquiredVideo.operationId}`
        : `temporal_asset_${index}`,
    ...scope,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: index + 1,
    assetType: index ? 'VIDEO' : 'IMAGE',
    technicalProperties: {
      format: index ? 'mp4' : 'png',
      widthPixels: index && acquiredVideo ? acquiredVideo.width : 1080,
      heightPixels: index && acquiredVideo ? acquiredVideo.height : 1920,
      durationMilliseconds: index ? 6000 : null,
    },
    contentHash:
      index && acquiredVideo
        ? acquiredVideo.contentHash
        : (index ? 'e' : 'd').repeat(64),
    mediaReference: `media:sha256_${index && acquiredVideo ? acquiredVideo.contentHash : (index ? 'e' : 'd').repeat(64)}`,
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    createdAt: time,
    revision: 1,
    supersedesMediaAssetId: null,
  }));
  assets.forEach((asset) => {
    if (asset.assetType === 'VIDEO' && acquiredVideo) {
      const body = {
        schemaVersion: 'media-acquisition-request/1.0.0',
        mediaAcquisitionRequestId: acquiredVideo.operationId,
        scriptId: script.scriptId,
        scriptContentHash: script.contentHash,
        visualDirectionPosition: asset.visualDirectionPosition,
        assetType: 'VIDEO',
        requestedAt: asset.createdAt,
      };
      repository.registerAcquiredMediaAsset({
        request: { ...body, contentHash: mediaAcquisitionRequestHash(body) },
        mediaAsset: asset,
      });
    } else repository.registerMediaAsset(asset);
  });
  const value: any = {
    schemaVersion: 'composition-plan/2.0.0',
    compositionPlanId: 'temporal_plan',
    ...scope,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId,
    voiceTrackContentHash: voice.contentHash,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 10000,
    productionProfile: 'MIXED_MEDIA_V2',
    compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
    createdAt: time,
    revision: 1,
    supersedesCompositionPlanId: null,
    segments: assets.map((asset, i) => ({
      position: i + 1,
      visualDirectionPosition: i + 1,
      mediaAssetId: asset.mediaAssetId,
      mediaAssetContentHash: asset.contentHash,
      startMilliseconds: i ? 4000 : 0,
      endMilliseconds: i ? 10000 : 4000,
      mediaType: asset.assetType,
      sourceStartMilliseconds: 0,
      playbackMode: 'TRIM',
      originalAudioMuted: true,
      framingStrategy: 'COVER_CROP_9_16',
      transition: {
        policyVersion: 'composition-transition/1.0.0',
        type: 'CUT',
        durationMilliseconds: 0,
      },
    })),
  };
  value.contentHash = compositionPlanContentHash(value);
  const operations = { get: (id: string) => f.base.getRun(id)! };
  const content = { getScript: () => script as any };
  const media = new MediaService(
    new MediaPersistence(f.database, operations, content),
  );
  return {
    path: f.database,
    repository: Object.assign(repository, { getRun: operations.get }),
    script,
    assets,
    value,
    media,
    close() {
      repository.close();
      f.cleanup();
    },
  };
}
