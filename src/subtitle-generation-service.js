import { createHash } from "node:crypto";
import {
  SUBTITLE_STYLE_POLICY,
  SubtitleGenerationError,
  generateSubtitleCues,
  serializeSubtitleAss,
  serializeSubtitleSrt,
  subtitleCueContentHash,
} from "./domain/subtitle-generation.js";
import {
  SUBTITLE_TRACK_CONTRACT_VERSION,
  subtitleTrackContentHash,
  validateSubtitleTrack,
} from "./domain/subtitle-track-contracts.js";

const REQUEST_FIELDS = Object.freeze([
  "pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash",
  "voiceTrackId", "voiceTrackContentHash", "stylePolicyVersion", "requestedAt",
]);

export class SubtitleGenerationService {
  constructor(repository) {
    const methods = ["getRun", "getScript", "getVoiceTrack", "getSubtitleTrack", "registerSubtitleTrack"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de geração de legenda obrigatório");
    this.repository = repository;
  }

  generate(value) {
    try {
      const request = validateRequest(value);
      const subtitleTrackId = identityFor(request);
      const prior = this.repository.getSubtitleTrack(subtitleTrackId);
      if (prior) {
        verifyTrackBinding(prior, request);
        return resultFor(prior);
      }
      const run = this.repository.getRun(request.pipelineRunId);
      if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
      verifyScope(run, request);
      const script = this.repository.getScript(request.scriptId);
      if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
      verifyScript(script, request);
      const voice = this.repository.getVoiceTrack(request.voiceTrackId);
      if (!voice) throw failure("VOICE_TRACK_NOT_FOUND", "voiceTrackId", "faixa de voz não encontrada");
      verifyVoice(voice, request);
      const language = run.projectSnapshot?.project?.audience?.language;
      if (script.language !== language || voice.language !== language) {
        throw failure("SUBTITLE_GENERATION_LANGUAGE_MISMATCH", "language", "idioma diverge da cadeia persistida");
      }
      const cues = generateSubtitleCues(script.fullNarration, voice.durationMilliseconds);
      const candidate = {
        schemaVersion: SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackId,
        pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion,
        scriptId: request.scriptId, scriptContentHash: request.scriptContentHash,
        voiceTrackId: request.voiceTrackId, voiceTrackContentHash: request.voiceTrackContentHash,
        language, timeUnit: "MILLISECONDS", durationMilliseconds: voice.durationMilliseconds,
        stylePolicyVersion: request.stylePolicyVersion, cues, createdAt: request.requestedAt,
        revision: 1, supersedesSubtitleTrackId: null, contentHash: "0".repeat(64),
      };
      candidate.contentHash = subtitleTrackContentHash(candidate);
      const track = validateSubtitleTrack(candidate);
      const prepared = resultFor(track);
      const persisted = this.repository.registerSubtitleTrack(track);
      return deepFreeze({ ...prepared, subtitleTrack: persisted });
    } catch (caught) {
      if (caught instanceof SubtitleGenerationError) throw caught;
      if (typeof caught?.code === "string" && typeof caught?.field === "string") {
        throw failure(caught.code, caught.field, "geração de legenda não concluída", { cause: caught });
      }
      if (typeof caught?.code === "string" && typeof caught?.path === "string") {
        throw failure(caught.code, caught.path, "conteúdo de legenda inválido", { cause: caught });
      }
      throw failure("SUBTITLE_GENERATION_FAILED", "subtitleTrack", "não foi possível gerar a legenda", { cause: caught });
    }
  }
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_SUBTITLE_GENERATION_REQUEST", "request", "solicitação inválida");
  for (const key of Object.keys(value)) if (!REQUEST_FIELDS.includes(key)) throw failure("UNKNOWN_FIELD", `request.${key}`, "campo não autorizado");
  for (const key of REQUEST_FIELDS) if (!(key in value)) throw failure("REQUIRED_FIELD", `request.${key}`, "campo obrigatório");
  for (const key of ["pipelineRunId", "projectId", "scriptId", "voiceTrackId"]) identifier(value[key], key);
  for (const key of ["scriptContentHash", "voiceTrackContentHash"]) hash(value[key], key);
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1) throw failure("INVALID_PROJECT_VERSION", "projectVersion", "versão inválida");
  if (value.stylePolicyVersion !== SUBTITLE_STYLE_POLICY.version) throw failure("UNSUPPORTED_STYLE_POLICY", "stylePolicyVersion", "política não suportada");
  if (typeof value.requestedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.requestedAt) || !Number.isFinite(Date.parse(value.requestedAt))) {
    throw failure("INVALID_TIMESTAMP", "requestedAt", "instante inválido");
  }
  return deepFreeze(value);
}

function identityFor(request) {
  const identity = [request.pipelineRunId, request.projectId, request.projectVersion, request.scriptId,
    request.scriptContentHash, request.voiceTrackId, request.voiceTrackContentHash, request.stylePolicyVersion].join("\n");
  return `subtitle_track:${sha256(identity)}`;
}

function verifyScope(value, request) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (value[field] !== request[field]) throw failure("SUBTITLE_GENERATION_SCOPE_MISMATCH", field, "escopo divergente");
  }
  if (value.projectSnapshot?.project?.id !== request.projectId || value.projectSnapshot?.project?.version !== request.projectVersion) {
    throw failure("SUBTITLE_GENERATION_SCOPE_MISMATCH", "projectSnapshot", "snapshot divergente");
  }
}
function verifyScript(script, request) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (script[field] !== request[field]) throw failure("SUBTITLE_GENERATION_SCOPE_MISMATCH", field, "roteiro fora do escopo");
  if (script.contentHash !== request.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
}
function verifyVoice(voice, request) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash"]) if (voice[field] !== request[field]) throw failure("SUBTITLE_GENERATION_SCOPE_MISMATCH", field, "voz fora do escopo");
  if (voice.contentHash !== request.voiceTrackContentHash) throw failure("VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash", "hash da voz divergente");
}
function verifyTrackBinding(track, request) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash", "voiceTrackId", "voiceTrackContentHash", "stylePolicyVersion"]) {
    if (track[field] !== request[field]) throw failure("SUBTITLE_GENERATION_IDENTITY_MISMATCH", field, "legenda persistida diverge da solicitação");
  }
}
function resultFor(track) {
  const srt = serializeSubtitleSrt(track);
  const ass = serializeSubtitleAss(track);
  return deepFreeze({ subtitleTrack: track, cueContentHash: subtitleCueContentHash(track.cues), srt, srtContentHash: sha256(srt), ass, assContentHash: sha256(ass) });
}
function identifier(value, field) { if (typeof value !== "string" || value.length > 200 || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function hash(value, field) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw failure("INVALID_HASH", field, "hash inválido"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return Object.freeze(value); Object.values(value).forEach(freeze); return Object.freeze(value); }
function failure(code, field, message, options) { return new SubtitleGenerationError(code, field, message, options); }
