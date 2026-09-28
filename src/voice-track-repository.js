import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { validateVoiceTrack, voiceTrackIdentityHash } from "./domain/voice-track-contracts.js";
import {
  VOICE_GENERATION_REQUEST_VERSION,
  validateVoiceGenerationRequest,
  voiceGenerationRequestHash,
} from "./domain/voice-generation-contracts.js";
import { ScriptRepository } from "./script-repository.js";

export class VoiceTrackRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "VoiceTrackRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class VoiceTrackRepository extends ScriptRepository {
  registerVoiceTrack(value) {
    let track;
    try { track = validateVoiceTrack(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidatedVoiceTrack(track, true));
  }

  registerGeneratedVoiceTrack({ request: requestValue, voiceTrack: trackValue }) {
    let request;
    let track;
    try {
      request = validateVoiceGenerationRequest(requestValue);
      track = validateVoiceTrack(trackValue);
    } catch (caught) { throw mapError(caught); }
    return this.#transaction(() => {
      const prior = this.db.prepare(`SELECT request_hash, voice_track_id
        FROM voice_generation_requests WHERE generation_request_id = ?`).get(request.generationRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash) throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
        return this.getVoiceTrack(prior.voice_track_id);
      }
      verifyGenerationBinding(request, track);
      const created = this.#registerValidatedVoiceTrack(track, false);
      this.db.prepare(`INSERT INTO voice_generation_requests
        (generation_request_id, schema_version, request_hash, script_id,
         script_content_hash, voice_track_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        request.generationRequestId, request.schemaVersion, request.contentHash,
        request.scriptId, request.scriptContentHash, created.voiceTrackId, request.requestedAt,
      );
      return created;
    });
  }

  getVoiceGeneration(generationRequestId) {
    requireIdentifier(generationRequestId, "generationRequestId", 180);
    const row = this.db.prepare(`SELECT * FROM voice_generation_requests
      WHERE generation_request_id = ?`).get(generationRequestId);
    if (!row) return null;
    try {
      const voiceTrack = this.getVoiceTrack(row.voice_track_id);
      if (!voiceTrack || row.schema_version !== VOICE_GENERATION_REQUEST_VERSION) throw new Error("geração incompleta");
      const expectedHash = voiceGenerationRequestHash({
        schemaVersion: row.schema_version,
        generationRequestId: row.generation_request_id,
        scriptId: row.script_id,
        scriptContentHash: row.script_content_hash,
        requestedAt: row.created_at,
        contentHash: row.request_hash,
      });
      if (expectedHash !== row.request_hash
        || voiceTrack.voiceTrackId !== `voice_track:${row.generation_request_id}`
        || voiceTrack.scriptId !== row.script_id
        || voiceTrack.scriptContentHash !== row.script_content_hash
        || voiceTrack.createdAt !== row.created_at) throw new Error("vínculo inválido");
      return deepFreeze({ requestHash: row.request_hash, voiceTrack });
    } catch (caught) {
      if (caught instanceof VoiceTrackRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_VOICE_GENERATION", "generationRequestId", "geração persistida inválida", { cause: caught });
    }
  }

  getVoiceTrack(voiceTrackId) {
    requireIdentifier(voiceTrackId, "voiceTrackId", 200);
    const row = this.db.prepare("SELECT * FROM voice_tracks WHERE voice_track_id = ?").get(voiceTrackId);
    if (!row) return null;
    try {
      const track = validateVoiceTrack(JSON.parse(row.payload_json));
      verifyPersistedColumns(track, row);
      if (voiceTrackIdentityHash(track) !== row.identity_hash) throw new Error("identidade divergente");
      const run = this.getRun(track.pipelineRunId);
      const script = this.getScript(track.scriptId);
      if (!run || !script) throw new Error("escopo ausente");
      verifyScope(run, track, "VOICE_TRACK_RUN_SCOPE_MISMATCH");
      verifyScript(track, script);
      verifySnapshot(track, run.projectSnapshot);
      const lineage = this.getArtifact(track.voiceTrackId);
      if (!lineage || lineage.artifactType !== "voice_track" || lineage.contentHash !== track.contentHash) throw new Error("linhagem divergente");
      return track;
    } catch (caught) {
      if (caught instanceof VoiceTrackRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_VOICE_TRACK", "voiceTrackId", "faixa persistida inválida", { cause: caught });
    }
  }

  listVoiceTracksByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT voice_track_id FROM voice_tracks WHERE pipeline_run_id = ?
      ORDER BY created_at, script_id, revision, voice_track_id`).all(pipelineRunId)
      .map(({ voice_track_id: id }) => this.getVoiceTrack(id));
  }

  listVoiceTracksByScript(scriptId) {
    requireIdentifier(scriptId, "scriptId", 200);
    return this.db.prepare(`SELECT voice_track_id FROM voice_tracks WHERE script_id = ?
      ORDER BY revision, voice_track_id`).all(scriptId)
      .map(({ voice_track_id: id }) => this.getVoiceTrack(id));
  }

  #registerValidatedVoiceTrack(track, allowExisting) {
    const identityHash = voiceTrackIdentityHash(track);
    const prior = this.db.prepare("SELECT identity_hash FROM voice_tracks WHERE voice_track_id = ?").get(track.voiceTrackId);
    if (prior) {
      if (!allowExisting || prior.identity_hash !== identityHash) throw failure("VOICE_TRACK_ID_REUSED", "voiceTrackId", "ID já usado com faixa incompatível");
      return this.getVoiceTrack(track.voiceTrackId);
    }
    const logicalPrior = this.db.prepare("SELECT voice_track_id FROM voice_tracks WHERE script_id = ? AND revision = ?")
      .get(track.scriptId, track.revision);
    if (logicalPrior) throw failure("VOICE_TRACK_REVISION_CONFLICT", "revision", "revisão já registrada para o roteiro");

    const run = this.getRun(track.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(run, track, "VOICE_TRACK_RUN_SCOPE_MISMATCH");
    const script = this.getScript(track.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    verifyScript(track, script);
    verifySnapshot(track, run.projectSnapshot);
    const previous = this.#validateRevision(track);
    this.#insertLineage(track, previous);
    this.db.prepare(`INSERT INTO voice_tracks
      (voice_track_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, script_id, script_content_hash, language, voice_style,
       duration_milliseconds, audio_format, content_hash, storage_reference, origin,
       provider, usage_basis, commercial_use_allowed, created_at, revision,
       supersedes_voice_track_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(
      track.voiceTrackId, track.schemaVersion, identityHash, track.pipelineRunId,
      track.projectId, track.projectVersion, track.scriptId, track.scriptContentHash,
      track.language, track.voiceStyle, track.durationMilliseconds, track.audioFormat,
      track.contentHash, track.storageReference, track.origin, track.provider,
      track.rights.usageBasis, track.createdAt, track.revision,
      track.supersedesVoiceTrackId, JSON.stringify(track),
    );
    return this.getVoiceTrack(track.voiceTrackId);
  }

  #validateRevision(track) {
    if (track.revision === 1) return null;
    const previous = this.getVoiceTrack(track.supersedesVoiceTrackId);
    if (!previous) throw failure("SUPERSEDED_VOICE_TRACK_NOT_FOUND", "supersedesVoiceTrackId", "faixa anterior não encontrada");
    for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "language", "voiceStyle"]) {
      if (previous[field] !== track[field]) throw failure("VOICE_TRACK_SUPERSESSION_SCOPE_MISMATCH", field, "faixa anterior fora do escopo");
    }
    if (previous.revision + 1 !== track.revision) throw failure("VOICE_TRACK_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
    return previous;
  }

  #insertLineage(track, previous) {
    const inputs = [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: track.scriptId, contentHash: track.scriptContentHash }];
    if (previous) inputs.push({ position: 2, kind: "INTERNAL_ARTIFACT", inputId: previous.voiceTrackId, contentHash: previous.contentHash });
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: track.voiceTrackId,
      artifactType: "voice_track",
      artifactVersion: track.revision,
      pipelineRunId: track.pipelineRunId,
      projectId: track.projectId,
      projectVersion: track.projectVersion,
      contentIdentity: `voice-track:${track.scriptId}`,
      hashAlgorithm: "sha256",
      contentHash: track.contentHash,
      inputs,
      generationMetadata: null,
      createdAt: track.createdAt,
    });
    this.db.prepare(`INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).run(
      artifact.artifactId, artifact.schemaVersion, artifact.artifactType,
      artifact.artifactVersion, sha256(JSON.stringify(artifact)), artifact.pipelineRunId,
      artifact.projectId, artifact.projectVersion, artifact.contentIdentity,
      artifact.hashAlgorithm, artifact.contentHash, artifact.createdAt,
    );
    const insert = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    for (const input of artifact.inputs) insert.run(artifact.artifactId, input.position, input.kind, input.inputId, input.contentHash);
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapError(caught);
    }
  }
}

function verifyScript(track, script) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "language"]) {
    if (script[field] !== track[field]) throw failure("VOICE_TRACK_SCRIPT_SCOPE_MISMATCH", field, "roteiro fora do escopo");
  }
  if (script.contentHash !== track.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
}

function verifyGenerationBinding(request, track) {
  if (request.scriptId !== track.scriptId) throw failure("VOICE_GENERATION_SCOPE_MISMATCH", "scriptId", "solicitação diverge da faixa");
  if (request.scriptContentHash !== track.scriptContentHash) throw failure("VOICE_GENERATION_SCOPE_MISMATCH", "scriptContentHash", "solicitação diverge da faixa");
  if (request.requestedAt !== track.createdAt) throw failure("VOICE_GENERATION_SCOPE_MISMATCH", "requestedAt", "solicitação diverge da faixa");
  if (track.voiceTrackId !== `voice_track:${request.generationRequestId}`) throw failure("VOICE_GENERATION_SCOPE_MISMATCH", "voiceTrackId", "solicitação diverge da faixa");
  if (track.revision !== 1 || track.supersedesVoiceTrackId !== null) throw failure("VOICE_GENERATION_SCOPE_MISMATCH", "revision", "geração inicial inválida");
}

function verifySnapshot(track, snapshot) {
  if (snapshot.project.audience.language !== track.language) throw failure("VOICE_TRACK_LANGUAGE_MISMATCH", "language", "idioma diverge do projeto");
  if (snapshot.channel.voiceStyle !== track.voiceStyle) throw failure("VOICE_TRACK_STYLE_MISMATCH", "voiceStyle", "estilo de voz diverge do projeto");
}

function verifyScope(stored, expected, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente");
}

function verifyPersistedColumns(track, row) {
  const expected = {
    voice_track_id: track.voiceTrackId, schema_version: track.schemaVersion,
    pipeline_run_id: track.pipelineRunId, project_id: track.projectId,
    project_version: track.projectVersion, script_id: track.scriptId,
    script_content_hash: track.scriptContentHash, language: track.language,
    voice_style: track.voiceStyle, duration_milliseconds: track.durationMilliseconds,
    audio_format: track.audioFormat, content_hash: track.contentHash,
    storage_reference: track.storageReference, origin: track.origin,
    provider: track.provider, usage_basis: track.rights.usageBasis,
    commercial_use_allowed: Number(track.rights.commercialUseAllowed),
    created_at: track.createdAt, revision: track.revision,
    supersedes_voice_track_id: track.supersedesVoiceTrackId,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}

function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) {
  if (caught instanceof VoiceTrackRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de faixa de voz inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("voice_tracks.script_id, voice_tracks.revision")) return failure("VOICE_TRACK_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("voice_tracks.supersedes_voice_track_id")) return failure("VOICE_TRACK_ALREADY_SUPERSEDED", "supersedesVoiceTrackId", "faixa já substituída", { cause: caught });
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) return failure("VOICE_TRACK_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("VOICE_TRACK_ID_REUSED", "voiceTrackId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_VOICE_TRACK")) return failure("IMMUTABLE_VOICE_TRACK", "voiceTrackId", "faixa imutável", { cause: caught });
  if (message.includes("VOICE_TRACK_SCOPE_MISMATCH")) return failure("VOICE_TRACK_SCOPE_MISMATCH", "scriptId", "artefatos fora do escopo", { cause: caught });
  if (message.includes("VOICE_TRACK_REVISION_MISMATCH")) return failure("VOICE_TRACK_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("VOICE_TRACK_PERSISTENCE_FAILED", "voiceTrack", "não foi possível persistir a faixa", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new VoiceTrackRepositoryError(code, field, message, options); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
