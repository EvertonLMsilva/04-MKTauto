import {
  QUALITY_CONTROL_POLICY_VERSION,
  QUALITY_CONTROL_REPORT_VERSION,
  aggregateQualityControlStatus,
  qualityControlReportContentHash,
  qualityControlReportId,
  validateQualityControlReport,
} from "./domain/quality-control-contracts.js";

const DURATION_TOLERANCE_MILLISECONDS = 34;
const SUBTITLE_RENDER_POLICY_VERSION = "ffmpeg-subtitle-render-policy/1.0.0";
const MAX_OUTPUT_BYTES = 524288000;

export class QualityControlError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "QualityControlError"; this.code = code; this.field = field; }
}

export class QualityControlService {
  constructor({ repository, voices, inspector, now = () => new Date().toISOString() }) {
    requireMethods(repository, ["findQualityControlReport", "registerQualityControlReport", "getRun", "getScript", "getMediaAsset", "getCompositionPlan", "getVideoRender", "getSubtitleTrack", "getArtifact"], "repository");
    requireMethods(voices, ["getVoiceTrack"], "voices"); requireMethods(inspector, ["inspect"], "inspector");
    this.repository = repository; this.voices = voices; this.inspector = inspector; this.now = now;
  }

  async inspect(value, { signal } = {}) {
    const request = validateRequest(value); abort(signal);
    const prior = this.repository.findQualityControlReport(QUALITY_CONTROL_POLICY_VERSION, request.videoRenderId, request.videoRenderContentHash);
    if (prior) return prior;
    try {
      const chain = loadChain(this.repository, this.voices, request); abort(signal);
      const facts = await this.inspector.inspect({ videoRender: chain.videoRender, mediaAssets: chain.mediaAssets }, { signal }); abort(signal);
      const findings = evaluateQualityControl({ ...chain, facts });
      const artifacts = artifactReferences(chain); const result = aggregateQualityControlStatus(findings);
      const report = {
        schemaVersion: QUALITY_CONTROL_REPORT_VERSION,
        qualityControlReportId: qualityControlReportId(QUALITY_CONTROL_POLICY_VERSION, chain.videoRender.videoRenderId, chain.videoRender.contentHash),
        policyVersion: QUALITY_CONTROL_POLICY_VERSION,
        pipelineRunId: chain.videoRender.pipelineRunId, projectId: chain.videoRender.projectId, projectVersion: chain.videoRender.projectVersion,
        videoRenderId: chain.videoRender.videoRenderId, videoRenderContentHash: chain.videoRender.contentHash,
        artifacts, result, approvalBlocked: result === "FAIL", findings, checkedAt: this.now(), contentHash: "",
      };
      report.contentHash = qualityControlReportContentHash(report);
      return this.repository.registerQualityControlReport(validateQualityControlReport(report));
    } catch (caught) { if (caught instanceof QualityControlError) throw caught; if (caught?.code === "QUALITY_INSPECTION_CANCELLED") throw failure("QUALITY_CONTROL_CANCELLED", "signal", "controle de qualidade cancelado", { cause: caught }); throw failure("QUALITY_CONTROL_FAILED", safeField(caught?.field), "controle de qualidade não concluído", { cause: caught }); }
  }
}

export function evaluateQualityControl(context) {
  const { run, script, voiceTrack: voice, mediaAssets: assets, compositionPlan: plan, sourceVideoRender: source, subtitleTrack: track, videoRender: video, lineages, facts } = context;
  const findings = []; const add = (code, pass, subjectType, subjectId, message, observed, expected, failStatus = "FAIL") => findings.push(Object.freeze({ code, status: pass ? "PASS" : failStatus, subjectType, subjectId, message, observed: printable(observed), expected: printable(expected) }));
  const vf = facts?.video ?? {};
  add("FILE_EXISTS", vf.exists === true, "VIDEO_RENDER", video.videoRenderId, "Arquivo final localizado.", vf.exists, true);
  add("FILE_ACCESSIBLE", vf.accessible === true, "VIDEO_RENDER", video.videoRenderId, "Arquivo final acessível.", vf.accessible, true);
  add("FILE_NON_EMPTY", Number.isSafeInteger(vf.sizeBytes) && vf.sizeBytes > 0, "VIDEO_RENDER", video.videoRenderId, "Arquivo final não vazio.", vf.sizeBytes, ">0");
  add("FILE_READABLE", vf.readable === true, "VIDEO_RENDER", video.videoRenderId, "Arquivo final legível.", vf.readable, true);
  add("FILE_SIZE_SUPPORTED", Number.isSafeInteger(vf.sizeBytes) && vf.sizeBytes <= context.maxOutputBytes, "VIDEO_RENDER", video.videoRenderId, "Tamanho dentro do limite da política.", vf.sizeBytes, `<=${context.maxOutputBytes}`);
  add("VIDEO_DECODABLE", vf.decodeSucceeded === true, "VIDEO_RENDER", video.videoRenderId, "Vídeo e áudio decodificáveis.", vf.decodeSucceeded, true);
  add("PROBE_VALID", vf.probeSucceeded === true, "VIDEO_RENDER", video.videoRenderId, "Metadados técnicos legíveis.", vf.probeSucceeded, true);
  add("CONTAINER_SUPPORTED", Array.isArray(vf.containerNames) && vf.containerNames.includes("mp4") && video.containerFormat === "mp4", "VIDEO_RENDER", video.videoRenderId, "Container suportado e coerente.", vf.containerNames?.join(",") || "none", "mp4");
  add("VIDEO_SHA256_MATCH", vf.sha256 === video.contentHash, "VIDEO_RENDER", video.videoRenderId, "SHA-256 físico corresponde ao render final.", vf.sha256, video.contentHash);
  const videos = streams(vf, "video"); const audios = streams(vf, "audio"); const subtitles = streams(vf, "subtitle");
  add("VIDEO_STREAM_PRESENT", videos.length === 1, "VIDEO_RENDER", video.videoRenderId, "Stream de vídeo único presente.", videos.length, 1);
  add("AUDIO_STREAM_PRESENT", audios.length === 1, "VIDEO_RENDER", video.videoRenderId, "Stream de áudio único presente.", audios.length, 1);
  add("STREAM_LAYOUT_EXACT", (vf.streams?.length ?? 0) === 2 && videos.length === 1 && audios.length === 1 && subtitles.length === 0, "VIDEO_RENDER", video.videoRenderId, "Layout de streams corresponde ao burn-in.", `${videos.length}/${audios.length}/${subtitles.length}`, "1/1/0");
  const videoStream = videos[0] ?? {}; const audioStream = audios[0] ?? {};
  add("VIDEO_RESOLUTION_MATCH", videoStream.widthPixels === video.widthPixels && videoStream.heightPixels === video.heightPixels && video.widthPixels === 1080 && video.heightPixels === 1920, "VIDEO_RENDER", video.videoRenderId, "Resolução física corresponde à política.", `${videoStream.widthPixels ?? "none"}x${videoStream.heightPixels ?? "none"}`, "1080x1920");
  add("VIDEO_ASPECT_RATIO_9_16", video.outputAspectRatio === "9:16" && videoStream.widthPixels * 16 === videoStream.heightPixels * 9, "VIDEO_RENDER", video.videoRenderId, "Proporção física é 9:16.", video.outputAspectRatio, "9:16");
  add("VIDEO_DURATION_MATCH", within(vf.durationMilliseconds, video.durationMilliseconds) && within(videoStream.durationMilliseconds, video.durationMilliseconds) && within(audioStream.durationMilliseconds, video.durationMilliseconds), "VIDEO_RENDER", video.videoRenderId, "Duração de container e streams corresponde ao render.", vf.durationMilliseconds, video.durationMilliseconds);
  add("STREAMS_COHERENT", videoStream.codec === "h264" && videoStream.profile === "High" && videoStream.widthPixels === 1080 && videoStream.heightPixels === 1920 && videoStream.pixelFormat === "yuv420p" && videoStream.frameRate === "30/1" && videoStream.averageFrameRate === "30/1" && audioStream.codec === "aac" && audioStream.profile === "LC" && audioStream.sampleRate === 48000 && audioStream.channels === 1, "VIDEO_RENDER", video.videoRenderId, "Codecs e propriedades dos streams são coerentes.", `${videoStream.codec ?? "none"}/${audioStream.codec ?? "none"}`, "h264/aac");
  add("TIMELINE_VALID", validTimeline(plan, vf, videoStream, audioStream), "COMPOSITION_PLAN", plan.compositionPlanId, "Timeline é contígua e inicia em zero.", plan.continuityMode, "CONTIGUOUS");
  const finalLineage = lineages.get(video.videoRenderId);
  const expectedFinal = [input(1, plan), input(2, source), input(3, track)];
  const burnIn = exactLineage(finalLineage, video, expectedFinal) && finalLineage?.generationMetadata?.taskType === "subtitle-burn-in" && finalLineage?.generationMetadata?.publicConfiguration?.renderPolicyVersion === SUBTITLE_RENDER_POLICY_VERSION && subtitles.length === 0;
  add("SUBTITLE_BURN_IN_MATCH", burnIn, "SUBTITLE_TRACK", track.subtitleTrackId, "Legenda esperada está vinculada ao burn-in final.", track.contentHash, expectedFinal[2].contentHash);
  add("PIPELINE_SCOPE_MATCH", run?.pipelineRunId === video.pipelineRunId && run?.projectId === video.projectId && run?.projectVersion === video.projectVersion && run?.projectSnapshot?.project?.id === video.projectId && run?.projectSnapshot?.project?.version === video.projectVersion, "PIPELINE_RUN", video.pipelineRunId, "Execução e snapshot correspondem ao render.", `${run?.projectId ?? "none"}@${run?.projectVersion ?? "none"}`, `${video.projectId}@${video.projectVersion}`);
  add("SCRIPT_LINEAGE_MATCH", exactLineage(lineages.get(script.scriptId), script, [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.ideaSelectionId, contentHash: script.ideaSelectionContentHash }]), "SCRIPT", script.scriptId, "Lineage do roteiro é exata.", script.contentHash, script.contentHash);
  add("VOICE_LINEAGE_MATCH", exactLineage(lineages.get(voice.voiceTrackId), voice, [input(1, script)]) && voice.scriptId === script.scriptId && voice.scriptContentHash === script.contentHash, "VOICE_TRACK", voice.voiceTrackId, "Lineage da voz é exata.", voice.contentHash, plan.voiceTrackContentHash);
  add("VOICE_RIGHTS_VALID", voice.rights?.commercialUseAllowed === true, "VOICE_TRACK", voice.voiceTrackId, "Direitos comerciais da voz permanecem válidos.", voice.rights?.commercialUseAllowed, true);
  add("COMPOSITION_LINEAGE_MATCH", exactLineage(lineages.get(plan.compositionPlanId), plan, [input(1, script), input(2, voice), ...assets.map((asset, index) => input(index + 3, asset))]), "COMPOSITION_PLAN", plan.compositionPlanId, "Lineage do plano é exata.", plan.contentHash, video.compositionPlanContentHash);
  add("SOURCE_VIDEO_LINEAGE_MATCH", exactLineage(lineages.get(source.videoRenderId), source, [input(1, plan)]) && video.supersedesVideoRenderId === source.videoRenderId && video.revision === 2, "VIDEO_RENDER", source.videoRenderId, "Render final sucede a composição exata.", video.supersedesVideoRenderId, source.videoRenderId);
  add("SUBTITLE_LINEAGE_MATCH", exactLineage(lineages.get(track.subtitleTrackId), track, [input(1, script), input(2, voice)]) && track.scriptContentHash === script.contentHash && track.voiceTrackContentHash === voice.contentHash && track.durationMilliseconds === voice.durationMilliseconds, "SUBTITLE_TRACK", track.subtitleTrackId, "Lineage da legenda é exata.", track.contentHash, expectedFinal[2].contentHash);
  assets.forEach((asset, index) => {
    const physical = facts.media?.find(({ mediaAssetId }) => mediaAssetId === asset.mediaAssetId) ?? {};
    add("MEDIA_LINEAGE_MATCH", exactLineage(lineages.get(asset.mediaAssetId), asset, [input(1, script)]) && plan.segments[index]?.mediaAssetId === asset.mediaAssetId && plan.segments[index]?.mediaAssetContentHash === asset.contentHash, "MEDIA_ASSET", asset.mediaAssetId, "Lineage e referência do ativo são exatas.", asset.contentHash, plan.segments[index]?.mediaAssetContentHash ?? null);
    add("MEDIA_ORIGIN_VALID", ["OPERATOR_OWNED", "AUTHORIZED_THIRD_PARTY", "PROVIDER_GENERATED", "PROVIDER_LICENSED"].includes(asset.origin), "MEDIA_ASSET", asset.mediaAssetId, "Origem do ativo permanece declarada.", asset.origin, "allowed");
    add("MEDIA_RIGHTS_VALID", asset.rights?.commercialUseAllowed === true, "MEDIA_ASSET", asset.mediaAssetId, "Direitos comerciais do ativo permanecem válidos.", asset.rights?.commercialUseAllowed, true);
    add("MEDIA_REFERENCE_VALID", /^media:sha256_[a-f0-9]{64}$/.test(asset.mediaReference) && physical.exists === true && physical.accessible === true && physical.readable === true, "MEDIA_ASSET", asset.mediaAssetId, "Referência física do ativo é válida e acessível.", physical.errorKind ?? "accessible", "accessible");
    add("MEDIA_SHA256_MATCH", physical.sha256 === asset.contentHash, "MEDIA_ASSET", asset.mediaAssetId, "SHA-256 físico do ativo corresponde ao contrato.", physical.sha256, asset.contentHash);
  });
  const headroomPass = Number.isSafeInteger(vf.sizeBytes) && vf.sizeBytes <= Math.floor(context.maxOutputBytes * 0.9);
  add("VIDEO_SIZE_HEADROOM", headroomPass, "VIDEO_RENDER", video.videoRenderId, "Margem de tamanho permanece visível.", vf.sizeBytes, `<=${Math.floor(context.maxOutputBytes * 0.9)}`, "WARN");
  return Object.freeze(findings);
}

function loadChain(repository, voices, request) {
  const videoRender = required(repository.getVideoRender(request.videoRenderId), "VIDEO_RENDER_NOT_FOUND", "videoRenderId");
  if (videoRender.contentHash !== request.videoRenderContentHash || videoRender.revision !== 2) throw failure("QUALITY_CONTROL_VIDEO_BINDING_MISMATCH", "videoRenderId", "QC exige o render final exato");
  if (videoRender.pipelineRunId !== request.pipelineRunId) throw failure("QUALITY_CONTROL_SCOPE_MISMATCH", "pipelineRunId", "execução divergente");
  const run = required(repository.getRun(request.pipelineRunId), "PIPELINE_RUN_NOT_FOUND", "pipelineRunId");
  const compositionPlan = required(repository.getCompositionPlan(videoRender.compositionPlanId), "COMPOSITION_PLAN_NOT_FOUND", "compositionPlanId");
  const script = required(repository.getScript(compositionPlan.scriptId), "SCRIPT_NOT_FOUND", "scriptId");
  const voiceTrack = required(voices.getVoiceTrack(compositionPlan.voiceTrackId), "VOICE_TRACK_NOT_FOUND", "voiceTrackId");
  const mediaAssets = compositionPlan.segments.map((segment) => required(repository.getMediaAsset(segment.mediaAssetId), "MEDIA_ASSET_NOT_FOUND", "mediaAssetId"));
  const finalLineage = required(repository.getArtifact(videoRender.videoRenderId), "VIDEO_LINEAGE_NOT_FOUND", "videoRenderId");
  const sourceVideoRender = required(repository.getVideoRender(finalLineage.inputs?.[1]?.inputId), "SOURCE_VIDEO_RENDER_NOT_FOUND", "videoRenderId");
  const subtitleTrack = required(repository.getSubtitleTrack(finalLineage.inputs?.[2]?.inputId), "SUBTITLE_TRACK_NOT_FOUND", "subtitleTrackId");
  const artifacts = [script, voiceTrack, ...mediaAssets, compositionPlan, sourceVideoRender, subtitleTrack, videoRender];
  const lineages = new Map(artifacts.map((artifact) => [artifactId(artifact), repository.getArtifact(artifactId(artifact))]));
  return { run, script, voiceTrack, mediaAssets, compositionPlan, sourceVideoRender, subtitleTrack, videoRender, lineages, maxOutputBytes: MAX_OUTPUT_BYTES };
}

function artifactReferences({ script, voiceTrack, mediaAssets, compositionPlan, subtitleTrack, videoRender }) { const ref = (id, contentHash) => ({ id, contentHash }); return { script: ref(script.scriptId, script.contentHash), voiceTrack: ref(voiceTrack.voiceTrackId, voiceTrack.contentHash), mediaAssets: mediaAssets.map((asset, index) => ({ position: index + 1, id: asset.mediaAssetId, contentHash: asset.contentHash })), compositionPlan: ref(compositionPlan.compositionPlanId, compositionPlan.contentHash), subtitleTrack: ref(subtitleTrack.subtitleTrackId, subtitleTrack.contentHash), videoRender: ref(videoRender.videoRenderId, videoRender.contentHash) }; }
function validateRequest(value) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["pipelineRunId", "videoRenderId", "videoRenderContentHash"].includes(key))) throw failure("QUALITY_CONTROL_REQUEST_INVALID", "request", "requisição de QC inválida"); for (const field of ["pipelineRunId", "videoRenderId"]) if (typeof value[field] !== "string" || !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value[field])) throw failure("QUALITY_CONTROL_REQUEST_INVALID", field, "identificador inválido"); if (typeof value.videoRenderContentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.videoRenderContentHash)) throw failure("QUALITY_CONTROL_REQUEST_INVALID", "videoRenderContentHash", "hash inválido"); return Object.freeze({ ...value }); }
function exactLineage(lineage, artifact, inputs) { return Boolean(lineage) && lineage.pipelineRunId === artifact.pipelineRunId && lineage.projectId === artifact.projectId && lineage.projectVersion === artifact.projectVersion && lineage.artifactId === artifactId(artifact) && lineage.contentHash === artifact.contentHash && JSON.stringify(lineage.inputs) === JSON.stringify(inputs); }
function artifactId(value) { return value.videoRenderId ?? value.subtitleTrackId ?? value.compositionPlanId ?? value.mediaAssetId ?? value.voiceTrackId ?? value.scriptId; }
function input(position, artifact) { return { position, kind: "INTERNAL_ARTIFACT", inputId: artifactId(artifact), contentHash: artifact.contentHash }; }
function streams(videoFacts, type) { return Array.isArray(videoFacts.streams) ? videoFacts.streams.filter((stream) => stream.type === type) : []; }
function within(actual, expected) { return Number.isSafeInteger(actual) && Math.abs(actual - expected) <= DURATION_TOLERANCE_MILLISECONDS; }
function validTimeline(plan, videoFacts, videoStream, audioStream) { if (plan.timelineUnit !== "MILLISECOND" || plan.continuityMode !== "CONTIGUOUS" || plan.durationMilliseconds < 1 || !within(videoFacts.durationMilliseconds, plan.durationMilliseconds) || !within(videoStream.durationMilliseconds, plan.durationMilliseconds) || !within(audioStream.durationMilliseconds, plan.durationMilliseconds)) return false; return plan.segments.every((segment, index) => segment.position === index + 1 && segment.startMilliseconds === (index === 0 ? 0 : plan.segments[index - 1].endMilliseconds) && segment.endMilliseconds > segment.startMilliseconds) && plan.segments.at(-1)?.endMilliseconds === plan.durationMilliseconds && (videoFacts.startMilliseconds === null || Math.abs(videoFacts.startMilliseconds) <= 1) && (videoStream.startMilliseconds === null || Math.abs(videoStream.startMilliseconds) <= 1) && (audioStream.startMilliseconds === null || Math.abs(audioStream.startMilliseconds) <= 1); }
function printable(value) { if (value === null || value === undefined) return null; if (typeof value === "boolean" || typeof value === "number") return String(value); const text = String(value); return text.length > 300 ? text.slice(0, 300) : text; }
function required(value, code, field) { if (!value) throw failure(code, field, "artefato necessário não encontrado"); return value; }
function requireMethods(value, methods, name) { if (!value || methods.some((method) => typeof value[method] !== "function")) throw new TypeError(`${name} obrigatório`); }
function safeField(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,119}$/.test(value) ? value : "qualityControl"; }
function abort(signal) { if (signal?.aborted) throw failure("QUALITY_CONTROL_CANCELLED", "signal", "controle de qualidade cancelado"); }
function failure(code, field, message, options) { return new QualityControlError(code, field, message, options); }
