import { adaptationHash } from '../domain/media-hash.js';
import { validateAudioConfig, p4Fail } from '../domain/p4-render-contracts.js';
import { videoRequestHash } from '../domain/render-origin-request.js';
export function getP4(repository: any, kind: any, id: any): any {
  const row: any = repository.db
    .prepare(
      'SELECT identity_hash,payload_json FROM p4_artifacts WHERE kind=? AND artifact_id=?',
    )
    .get(kind, id);
  if (!row) return null;
  const value: any = JSON.parse(row.payload_json);
  if (adaptationHash(value) !== row.identity_hash)
    p4Fail('P4_PERSISTED_INTEGRITY_INVALID');
  return Object.freeze(value);
}
export function verifyP4Lineage(repository: any, render: any): any {
  const run: any = repository.getRun(render.pipelineRunId);
  if (
    !run ||
    run.projectId !== render.projectId ||
    run.projectVersion !== render.projectVersion
  )
    p4Fail('P4_RUN_SCOPE_INVALID');
  const origin: any = render.origin;
  let campaignId: any;
  if (origin.kind === 'AI_GENERATED') {
    const row: any = repository.db
      .prepare(
        'SELECT request_hash,request_json,state,result_json FROM video_generation_operations WHERE generation_request_id=?',
      )
      .get(origin.generationRequestId);
    if (!row || row.state !== 'COMPLETED')
      p4Fail('P4_GENERATION_NOT_COMPLETED');
    const request: any = JSON.parse(row.request_json),
      result: any = JSON.parse(row.result_json);
    if (
      row.request_hash !== videoRequestHash(request) ||
      row.request_hash !== origin.requestHash ||
      request.pipelineRunId !== render.pipelineRunId ||
      result.providerRequestId !== origin.providerRequestId ||
      result.videoReference !== origin.sourceReference
    )
      p4Fail('P4_AI_LINEAGE_INVALID');
    campaignId = request.campaignId;
  } else {
    const source: any = repository.getVideoRender(origin.videoRenderId);
    if (
      source?.schemaVersion !== 'video-render/1.0.0' ||
      source.contentHash !== origin.videoRenderContentHash ||
      source.pipelineRunId !== render.pipelineRunId
    )
      p4Fail('P4_LEGACY_LINEAGE_INVALID');
    campaignId = repository.db
      .prepare(
        'SELECT campaign_id FROM affiliate_run_bindings WHERE pipeline_run_id=?',
      )
      .get(render.pipelineRunId)?.campaign_id;
  }
  const config: any = getP4(repository, 'audio_config', render.audioConfigId);
  if (
    !config ||
    adaptationHash(config) !== render.audioConfigHash ||
    config.campaignId !== campaignId
  )
    p4Fail('P4_AUDIO_BINDING_INVALID');
  validateAudioConfig(config);
  if (config.mode === 'PRESERVE' && render.narrationId !== null)
    p4Fail('P4_NARRATION_BINDING_INVALID');
  if (config.mode !== 'PRESERVE') {
    const narration: any = getP4(repository, 'voice_track', render.narrationId);
    if (
      !narration ||
      narration.contentHash !== render.narrationHash ||
      narration.audioConfigId !== render.audioConfigId ||
      narration.sourceId !==
        (origin.generationRequestId ?? origin.videoRenderId) ||
      narration.pipelineRunId !== render.pipelineRunId
    )
      p4Fail('P4_NARRATION_BINDING_INVALID');
  }
  return { run, config };
}
function p4Inputs(render: any): any {
  const o: any = render.origin;
  const inputs: any = [
    o.kind === 'AI_GENERATED'
      ? {
          position: 1,
          kind: 'EXTERNAL_INPUT',
          inputId: `fal_request:${o.providerRequestId}`,
          contentHash: o.sourceContentHash,
        }
      : {
          position: 1,
          kind: 'INTERNAL_ARTIFACT',
          inputId: o.videoRenderId,
          contentHash: o.videoRenderContentHash,
        },
    {
      position: 2,
      kind: 'EXTERNAL_INPUT',
      inputId: render.audioConfigId,
      contentHash: render.audioConfigHash,
    },
  ];
  if (render.narrationId)
    inputs.push({
      position: 3,
      kind: 'EXTERNAL_INPUT',
      inputId: render.narrationId,
      contentHash: render.narrationHash,
    });
  return inputs;
}
export function verifyStoredP4Lineage(repository: any, render: any): any {
  const artifact: any = repository.getArtifact(render.videoRenderId);
  if (
    !artifact ||
    artifact.contentHash !== render.contentHash ||
    artifact.pipelineRunId !== render.pipelineRunId ||
    adaptationHash(artifact.inputs) !== adaptationHash(p4Inputs(render))
  )
    p4Fail('P4_PERSISTED_LINEAGE_INVALID');
}
