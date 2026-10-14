// Legacy provisions immutable fixtures only; no rendering or providers.
const { ARTIFACT_LINEAGE_CONTRACT_VERSION } = await import(
  new URL('../../../src/domain/artifact-lineage-contracts.js', import.meta.url)
    .href
);
const { COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanContentHash } =
  await import(
    new URL(
      '../../../src/domain/composition-plan-contracts.js',
      import.meta.url,
    ).href
  );
const { MEDIA_ASSET_CONTRACT_VERSION } = await import(
  new URL('../../../src/domain/media-asset-contracts.js', import.meta.url).href
);
const { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } =
  await import(
    new URL('../../../src/domain/script-contracts.js', import.meta.url).href
  );
const { VIDEO_RENDER_CONTRACT_VERSION } = await import(
  new URL('../../../src/domain/video-render-contracts.js', import.meta.url).href
);
const { VOICE_TRACK_CONTRACT_VERSION } = await import(
  new URL('../../../src/domain/voice-track-contracts.js', import.meta.url).href
);
const { PIPELINE_HANDOFF_CONTRACT_VERSION } = await import(
  new URL('../../../src/project-pipeline-handoff.js', import.meta.url).href
);
const { PipelineRunService } = await import(
  new URL('../../../src/pipeline-run-service.js', import.meta.url).href
);
const { VoiceTrackRepository } = await import(
  new URL('../../../src/voice-track-repository.js', import.meta.url).href
);
const { VideoRenderRepository } = await import(
  new URL('../../../src/video-render-repository.js', import.meta.url).href
);
const STARTED_AT = '2026-09-28T12:00:00.000Z';
export function setup(path: any): any {
  const repository = new VideoRenderRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: 'run_e07_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    startedAt: STARTED_AT,
  });
  const script = persistedScript();
  repository.registerArtifact({
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
    artifactId: script.scriptId,
    artifactType: 'script',
    artifactVersion: 1,
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    contentIdentity: 'script:selection_001',
    hashAlgorithm: 'sha256',
    contentHash: script.contentHash,
    inputs: [],
    generationMetadata: null,
    createdAt: script.createdAt,
  });
  repository.db.exec(
    'PRAGMA foreign_keys = OFF; DROP TRIGGER scripts_validate_scope;',
  );
  repository.db
    .prepare(
      `INSERT INTO scripts
    (script_id, schema_version, pipeline_run_id, project_id, project_version,
     idea_selection_id, idea_selection_content_hash, idea_candidate_id,
     idea_content_hash, language, content_format, estimated_duration_seconds,
     origin, created_at, revision, supersedes_script_id, content_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      script.scriptId,
      script.schemaVersion,
      script.pipelineRunId,
      script.projectId,
      script.projectVersion,
      script.ideaSelectionId,
      script.ideaSelectionContentHash,
      script.ideaCandidateId,
      script.ideaContentHash,
      script.language,
      script.contentFormat,
      script.estimatedDurationSeconds,
      script.origin,
      script.createdAt,
      script.revision,
      script.supersedesScriptId,
      script.contentHash,
      JSON.stringify(script),
    );
  repository.db.exec('PRAGMA foreign_keys = ON;');
  repository.getScript = (id: any) => (id === script.scriptId ? script : null);
  const voice = voiceTrack(script);
  const voiceRepository = new VoiceTrackRepository(path);
  voiceRepository.getScript = (id: any) =>
    id === script.scriptId ? script : null;
  voiceRepository.registerVoiceTrack(voice);
  voiceRepository.close();
  const assets = [
    mediaAsset(script),
    mediaAsset(script, {
      mediaAssetId: 'media_asset_002',
      visualDirectionPosition: 2,
      assetType: 'VIDEO',
      technicalProperties: {
        format: 'mp4',
        widthPixels: 1080,
        heightPixels: 1920,
        durationMilliseconds: 6000,
      },
      contentHash: 'e'.repeat(64),
      mediaReference: 'media:asset_002',
    }),
  ];
  assets.forEach((asset: any) => repository.registerMediaAsset(asset));
  const compositionPlan = plan(script, voice, assets);
  repository.registerCompositionPlan(compositionPlan);
  return { repository, compositionPlan };
}
export function persistedScript(): any {
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION,
    scriptId: 'script_001',
    pipelineRunId: 'run_e07_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    ideaSelectionId: 'selection_001',
    ideaSelectionContentHash: 'a'.repeat(64),
    ideaCandidateId: 'idea_candidate_1',
    ideaContentHash: 'b'.repeat(64),
    language: 'pt-BR',
    contentFormat: 'short_video',
    hook: 'Organize a rotina com dois passos simples.',
    narrativeBlocks: [
      {
        position: 1,
        purpose: 'EXPLANATION',
        narration:
          'Escolha uma tarefa pequena e conclua antes de iniciar outra.',
      },
    ],
    fullNarration: '',
    visualDirections: [
      {
        position: 1,
        blockPosition: 1,
        description: 'Lista simples aparecendo em tela.',
      },
      {
        position: 2,
        blockPosition: 1,
        description: 'Pessoa marcando a tarefa concluída.',
      },
    ],
    cta: 'Salve para testar depois.',
    estimatedDurationSeconds: 30,
    sensitiveClaims: [],
    reviewFlags: [],
    origin: 'OPERATOR',
    createdAt: '2026-09-28T14:00:00.000Z',
    revision: 1,
    supersedesScriptId: null,
    contentHash: '0'.repeat(64),
  };
  value.fullNarration = [
    value.hook,
    ...value.narrativeBlocks.map(({ narration }: any) => narration),
    value.cta,
  ].join('\n\n');
  value.contentHash = scriptContentHash(value);
  return validateScript(value);
}
export function voiceTrack(script: any): any {
  return {
    schemaVersion: VOICE_TRACK_CONTRACT_VERSION,
    voiceTrackId: 'voice_track_001',
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    language: script.language,
    voiceStyle: 'informative',
    durationMilliseconds: 10000,
    audioFormat: 'mp3',
    contentHash: 'c'.repeat(64),
    storageReference: 'object:voice/voice_track_001',
    origin: 'SYNTHETIC_TTS',
    provider: 'provider_test',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    createdAt: '2026-09-28T19:00:00.000Z',
    revision: 1,
    supersedesVoiceTrackId: null,
  };
}
export function mediaAsset(script: any, overrides: any = {}): any {
  return {
    schemaVersion: MEDIA_ASSET_CONTRACT_VERSION,
    mediaAssetId: 'media_asset_001',
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: 1,
    assetType: 'IMAGE',
    technicalProperties: {
      format: 'png',
      widthPixels: 1080,
      heightPixels: 1920,
      durationMilliseconds: null,
    },
    contentHash: 'd'.repeat(64),
    mediaReference: 'media:asset_001',
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    createdAt: '2026-09-28T21:00:00.000Z',
    revision: 1,
    supersedesMediaAssetId: null,
    ...overrides,
  };
}
export function plan(script: any, voice: any, assets: any): any {
  const value = {
    schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION,
    compositionPlanId: 'composition_plan_001',
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId,
    voiceTrackContentHash: voice.contentHash,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: voice.durationMilliseconds,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: assets[0].mediaAssetId,
        mediaAssetContentHash: assets[0].contentHash,
        startMilliseconds: 0,
        endMilliseconds: 4000,
      },
      {
        position: 2,
        visualDirectionPosition: 2,
        mediaAssetId: assets[1].mediaAssetId,
        mediaAssetContentHash: assets[1].contentHash,
        startMilliseconds: 4000,
        endMilliseconds: 10000,
      },
    ],
    createdAt: '2026-09-28T23:00:00.000Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '0'.repeat(64),
  };
  value.contentHash = compositionPlanContentHash(value);
  return value;
}
export function render(compositionPlan: any, overrides: any = {}): any {
  return {
    schemaVersion: VIDEO_RENDER_CONTRACT_VERSION,
    videoRenderId: 'video_render_001',
    pipelineRunId: compositionPlan.pipelineRunId,
    projectId: compositionPlan.projectId,
    projectVersion: compositionPlan.projectVersion,
    compositionPlanId: compositionPlan.compositionPlanId,
    compositionPlanContentHash: compositionPlan.contentHash,
    outputAspectRatio: compositionPlan.outputAspectRatio,
    durationMilliseconds: 10000,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    contentHash: 'f'.repeat(64),
    logicalReference: 'render:output_001',
    createdAt: '2026-09-28T23:30:00.000Z',
    revision: 1,
    supersedesVideoRenderId: null,
    ...overrides,
  };
}
export function project(): any {
  return {
    id: 'project_curiosidades_ia',
    name: 'Curiosidades IA',
    version: 1,
    niche: 'inteligência artificial',
    subniches: ['ferramentas'],
    audience: {
      profile: 'Pessoas interessadas em tecnologia',
      language: 'pt-BR',
    },
    references: [],
    channel: {
      voiceStyle: 'informative',
      publishing: {
        contentsPerDay: 1,
        networks: ['instagram'],
        timezone: 'America/Sao_Paulo',
        times: ['10:00'],
      },
    },
  };
}
