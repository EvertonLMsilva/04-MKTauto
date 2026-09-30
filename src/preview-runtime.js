import { ArtifactLineageService } from "./artifact-lineage-service.js";
import { CompositionPlanService } from "./composition-plan-service.js";
import { CostLedgerRepository } from "./cost-ledger-repository.js";
import { CostLedgerService } from "./cost-ledger-service.js";
import { SUBTITLE_RENDER_DURATION_TOLERANCE_MILLISECONDS, SUBTITLE_RENDER_POLICY_VERSION } from "./domain/subtitle-render-contracts.js";
import { loadFfmpegVideoConfig } from "./ffmpeg-video-config.js";
import { loadOpenAIConfig } from "./openai-config.js";
import { loadOpenAIImageConfig } from "./openai-image-config.js";
import { loadOpenAIVoiceConfig } from "./openai-voice-config.js";
import { MediaAcquisitionService } from "./media-acquisition-service.js";
import { PipelineRunService } from "./pipeline-run-service.js";
import { RealPreviewService } from "./real-preview-service.js";
import { ScriptGenerationService } from "./script-generation-service.js";
import { SubtitleGenerationService } from "./subtitle-generation-service.js";
import { SubtitleRenderingService } from "./subtitle-rendering-service.js";
import { SubtitleTrackRepository } from "./subtitle-track-repository.js";
import { VideoCompositionService } from "./video-composition-service.js";
import { VideoRenderRepository } from "./video-render-repository.js";
import { VoiceGenerationService } from "./voice-generation-service.js";
import { VoiceTrackRepository } from "./voice-track-repository.js";
import { CompositionArtifactCatalog } from "./adapters/composition-artifact-catalog.js";
import { FfmpegSubtitleRenderer } from "./adapters/ffmpeg-subtitle-renderer.js";
import { FfmpegVideoComposer } from "./adapters/ffmpeg-video-composer.js";
import { LocalCompositionReferenceResolver } from "./adapters/local-composition-reference-resolver.js";
import { LocalPreviewVerifier } from "./adapters/local-preview-verifier.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenAIImageAdapter } from "./adapters/openai-image.js";
import { OpenAIVoiceAdapter } from "./adapters/openai-voice.js";

export function createPreviewRuntime({ database, env = process.env }) {
  const repositories = [];
  try {
    const videoRepository = repository(VideoRenderRepository, database, repositories);
    const voiceRepository = repository(VoiceTrackRepository, database, repositories);
    const subtitleRepository = repository(SubtitleTrackRepository, database, repositories);
    const costRepository = repository(CostLedgerRepository, database, repositories);

    const scriptConfig = loadOpenAIConfig(env);
    const voiceConfig = loadOpenAIVoiceConfig(env);
    const imageConfig = loadOpenAIImageConfig(env);
    const videoConfig = loadFfmpegVideoConfig(env);
    const referenceResolver = new LocalCompositionReferenceResolver(videoConfig);
    const artifactCatalog = new CompositionArtifactCatalog({ voiceRepository, mediaRepository: videoRepository });
    const composer = new FfmpegVideoComposer(videoConfig, { artifactCatalog, referenceResolver });
    const subtitleRenderer = new FfmpegSubtitleRenderer(subtitleConfig(videoConfig), { referenceResolver });

    const pipelineRuns = new PipelineRunService(videoRepository);
    const lookup = Object.freeze({ getScript: (scriptId) => videoRepository.getScript(scriptId) });
    const previews = new RealPreviewService({
      pipelineRuns,
      scripts: new ScriptGenerationService(videoRepository, new OpenAIAdapter(scriptConfig)),
      voices: new VoiceGenerationService(voiceRepository, new OpenAIVoiceAdapter(voiceConfig)),
      media: new MediaAcquisitionService(videoRepository, new OpenAIImageAdapter(imageConfig)),
      plans: new CompositionPlanService(videoRepository),
      videos: new VideoCompositionService(videoRepository, composer),
      subtitles: new SubtitleGenerationService(subtitleRepository),
      subtitleRendering: new SubtitleRenderingService(videoRepository, subtitleRenderer),
      previewVerifier: new LocalPreviewVerifier(referenceResolver),
      costs: new CostLedgerService(costRepository),
      lookup,
      lineage: new ArtifactLineageService(videoRepository),
    });

    return Object.freeze({
      selections: Object.freeze({ get: (selectionId) => videoRepository.getSelection(selectionId) }),
      pipelineRuns,
      previews,
      lookup,
      referenceResolver,
      close: () => closeAll(repositories),
    });
  } catch (caught) {
    closeAll(repositories);
    throw caught;
  }
}

function repository(Type, database, repositories) {
  const value = new Type(database);
  repositories.push(value);
  return value;
}

function subtitleConfig(config) {
  return Object.freeze({
    policyVersion: SUBTITLE_RENDER_POLICY_VERSION,
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    renderRoot: config.renderRoot,
    stagingRoot: config.stagingRoot,
    widthPixels: config.widthPixels,
    heightPixels: config.heightPixels,
    frameRate: config.frameRate,
    videoCodec: config.videoCodec,
    videoProfile: config.videoProfile,
    videoLevel: config.videoLevel,
    crf: config.crf,
    preset: config.preset,
    pixelFormat: config.pixelFormat,
    audioCodec: "copy",
    audioSampleRate: config.audioSampleRate,
    audioChannels: config.audioChannels,
    gopSize: config.gopSize,
    durationToleranceMilliseconds: SUBTITLE_RENDER_DURATION_TOLERANCE_MILLISECONDS,
    maxInputBytes: config.maxOutputBytes,
    maxOutputBytes: config.maxOutputBytes,
    timeoutMs: config.timeoutMs,
    maxLogBytes: config.maxLogBytes,
    fontFamily: "Arial",
    fontProvider: "libass-default",
  });
}

function closeAll(repositories) {
  while (repositories.length > 0) repositories.pop().close();
}
