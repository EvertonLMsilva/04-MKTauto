import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { subtitleTrackIdentityHash, validateSubtitleTrack } from "./domain/subtitle-track-contracts.js";
import { VoiceTrackRepository } from "./voice-track-repository.js";

export class SubtitleTrackRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "SubtitleTrackRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class SubtitleTrackRepository extends VoiceTrackRepository {
  registerSubtitleTrack(value) {
    let track;
    try { track = validateSubtitleTrack(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidated(track));
  }

  getSubtitleTrack(subtitleTrackId) {
    requireIdentifier(subtitleTrackId, "subtitleTrackId", 200);
    const row = this.db.prepare("SELECT * FROM subtitle_tracks WHERE subtitle_track_id = ?").get(subtitleTrackId);
    if (!row) return null;
    try {
      const track = validateSubtitleTrack(JSON.parse(row.payload_json));
      verifyPersistedColumns(track, row);
      if (subtitleTrackIdentityHash(track) !== row.identity_hash) throw new Error("identidade divergente");
      const cues = this.db.prepare(`SELECT position, text, start_milliseconds, end_milliseconds
        FROM subtitle_cues WHERE subtitle_track_id = ? ORDER BY position`).all(subtitleTrackId);
      if (JSON.stringify(cues.map(mapCue)) !== JSON.stringify(track.cues)) throw new Error("cues divergentes");
      const run = this.getRun(track.pipelineRunId);
      const script = this.getScript(track.scriptId);
      const voice = this.getVoiceTrack(track.voiceTrackId);
      if (!run || !script || !voice) throw new Error("escopo ausente");
      verifyScope(run, track, "SUBTITLE_TRACK_RUN_SCOPE_MISMATCH");
      verifyScript(track, script);
      verifyVoice(track, voice);
      verifySnapshot(track, run.projectSnapshot);
      const previous = track.revision === 1 ? null : this.getSubtitleTrack(track.supersedesSubtitleTrackId);
      verifyRevision(track, previous);
      const lineage = this.getArtifact(track.subtitleTrackId);
      const expected = lineageFor(track, previous);
      if (!lineage || lineage.artifactType !== "subtitle_track"
        || lineage.artifactVersion !== track.revision
        || lineage.contentIdentity !== expected.contentIdentity
        || lineage.contentHash !== track.contentHash
        || JSON.stringify(lineage.inputs) !== JSON.stringify(expected.inputs)) throw new Error("linhagem divergente");
      return track;
    } catch (caught) {
      if (caught instanceof SubtitleTrackRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_SUBTITLE_TRACK", "subtitleTrackId", "legenda persistida inválida", { cause: caught });
    }
  }

  listSubtitleTracksByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT subtitle_track_id FROM subtitle_tracks WHERE pipeline_run_id = ?
      ORDER BY created_at, script_id, voice_track_id, revision, subtitle_track_id`).all(pipelineRunId)
      .map(({ subtitle_track_id: id }) => this.getSubtitleTrack(id));
  }

  listSubtitleTracksByScript(scriptId) {
    requireIdentifier(scriptId, "scriptId", 200);
    return this.db.prepare(`SELECT subtitle_track_id FROM subtitle_tracks WHERE script_id = ?
      ORDER BY voice_track_id, revision, subtitle_track_id`).all(scriptId)
      .map(({ subtitle_track_id: id }) => this.getSubtitleTrack(id));
  }

  listSubtitleTracksByVoiceTrack(voiceTrackId) {
    requireIdentifier(voiceTrackId, "voiceTrackId", 200);
    return this.db.prepare(`SELECT subtitle_track_id FROM subtitle_tracks WHERE voice_track_id = ?
      ORDER BY script_id, revision, subtitle_track_id`).all(voiceTrackId)
      .map(({ subtitle_track_id: id }) => this.getSubtitleTrack(id));
  }

  #registerValidated(track) {
    const identityHash = subtitleTrackIdentityHash(track);
    const prior = this.db.prepare("SELECT identity_hash FROM subtitle_tracks WHERE subtitle_track_id = ?").get(track.subtitleTrackId);
    if (prior) {
      if (prior.identity_hash !== identityHash) throw failure("SUBTITLE_TRACK_ID_REUSED", "subtitleTrackId", "ID já usado com legenda incompatível");
      return this.getSubtitleTrack(track.subtitleTrackId);
    }
    const logicalPrior = this.db.prepare(`SELECT subtitle_track_id FROM subtitle_tracks
      WHERE script_id = ? AND voice_track_id = ? AND revision = ?`).get(track.scriptId, track.voiceTrackId, track.revision);
    if (logicalPrior) throw failure("SUBTITLE_TRACK_REVISION_CONFLICT", "revision", "revisão já registrada para roteiro e voz");
    const run = this.getRun(track.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(run, track, "SUBTITLE_TRACK_RUN_SCOPE_MISMATCH");
    const script = this.getScript(track.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    verifyScript(track, script);
    const voice = this.getVoiceTrack(track.voiceTrackId);
    if (!voice) throw failure("VOICE_TRACK_NOT_FOUND", "voiceTrackId", "faixa de voz não encontrada");
    verifyVoice(track, voice);
    verifySnapshot(track, run.projectSnapshot);
    const previous = track.revision === 1 ? null : this.getSubtitleTrack(track.supersedesSubtitleTrackId);
    verifyRevision(track, previous);
    this.#insertLineage(lineageFor(track, previous));
    this.db.prepare(`INSERT INTO subtitle_tracks
      (subtitle_track_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, script_id, script_content_hash, voice_track_id,
       voice_track_content_hash, language, time_unit, duration_milliseconds,
       style_policy_version, created_at, revision, supersedes_subtitle_track_id,
       content_hash, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      track.subtitleTrackId, track.schemaVersion, identityHash, track.pipelineRunId,
      track.projectId, track.projectVersion, track.scriptId, track.scriptContentHash,
      track.voiceTrackId, track.voiceTrackContentHash, track.language, track.timeUnit,
      track.durationMilliseconds, track.stylePolicyVersion, track.createdAt, track.revision,
      track.supersedesSubtitleTrackId, track.contentHash, JSON.stringify(track),
    );
    const insertCue = this.db.prepare(`INSERT INTO subtitle_cues
      (subtitle_track_id, position, text, start_milliseconds, end_milliseconds)
      VALUES (?, ?, ?, ?, ?)`);
    for (const cue of track.cues) insertCue.run(track.subtitleTrackId, cue.position, cue.text, cue.startMilliseconds, cue.endMilliseconds);
    return this.getSubtitleTrack(track.subtitleTrackId);
  }

  #insertLineage(artifact) {
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
    if (script[field] !== track[field]) throw failure("SUBTITLE_TRACK_SCRIPT_SCOPE_MISMATCH", field, "roteiro fora do escopo");
  }
  if (script.contentHash !== track.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
}

function verifyVoice(track, voice) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash", "language"]) {
    if (voice[field] !== track[field]) throw failure("SUBTITLE_TRACK_VOICE_SCOPE_MISMATCH", field, "faixa de voz fora do escopo");
  }
  if (voice.contentHash !== track.voiceTrackContentHash) throw failure("VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash", "hash da voz divergente");
  if (voice.durationMilliseconds !== track.durationMilliseconds) throw failure("SUBTITLE_TRACK_VOICE_DURATION_MISMATCH", "durationMilliseconds", "duração diverge da voz física registrada");
}

function verifySnapshot(track, snapshot) {
  if (snapshot.project.audience.language !== track.language) throw failure("SUBTITLE_TRACK_LANGUAGE_MISMATCH", "language", "idioma diverge do projeto");
}

function verifyRevision(track, previous) {
  if (track.revision === 1) return;
  if (!previous) throw failure("SUPERSEDED_SUBTITLE_TRACK_NOT_FOUND", "supersedesSubtitleTrackId", "legenda anterior não encontrada");
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "scriptContentHash", "voiceTrackId", "voiceTrackContentHash", "language", "timeUnit", "durationMilliseconds"]) {
    if (previous[field] !== track[field]) throw failure("SUBTITLE_TRACK_SUPERSESSION_SCOPE_MISMATCH", field, "legenda anterior fora do escopo");
  }
  if (previous.revision + 1 !== track.revision) throw failure("SUBTITLE_TRACK_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
}

function lineageFor(track, previous) {
  const inputs = [
    { position: 1, kind: "INTERNAL_ARTIFACT", inputId: track.scriptId, contentHash: track.scriptContentHash },
    { position: 2, kind: "INTERNAL_ARTIFACT", inputId: track.voiceTrackId, contentHash: track.voiceTrackContentHash },
  ];
  if (previous) inputs.push({ position: 3, kind: "INTERNAL_ARTIFACT", inputId: previous.subtitleTrackId, contentHash: previous.contentHash });
  return validateArtifactLineage({
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
    artifactId: track.subtitleTrackId,
    artifactType: "subtitle_track",
    artifactVersion: track.revision,
    pipelineRunId: track.pipelineRunId,
    projectId: track.projectId,
    projectVersion: track.projectVersion,
    contentIdentity: `subtitle-track:${sha256(`${track.scriptId}\n${track.voiceTrackId}`)}`,
    hashAlgorithm: "sha256",
    contentHash: track.contentHash,
    inputs,
    generationMetadata: null,
    createdAt: track.createdAt,
  });
}

function verifyScope(stored, expected, code) { for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente"); }
function verifyPersistedColumns(track, row) {
  const expected = {
    subtitle_track_id: track.subtitleTrackId, schema_version: track.schemaVersion,
    pipeline_run_id: track.pipelineRunId, project_id: track.projectId,
    project_version: track.projectVersion, script_id: track.scriptId,
    script_content_hash: track.scriptContentHash, voice_track_id: track.voiceTrackId,
    voice_track_content_hash: track.voiceTrackContentHash, language: track.language,
    time_unit: track.timeUnit, duration_milliseconds: track.durationMilliseconds,
    style_policy_version: track.stylePolicyVersion, created_at: track.createdAt,
    revision: track.revision, supersedes_subtitle_track_id: track.supersedesSubtitleTrackId,
    content_hash: track.contentHash,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}
function mapCue(row) { return { position: row.position, text: row.text, startMilliseconds: row.start_milliseconds, endMilliseconds: row.end_milliseconds }; }
function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) {
  if (caught instanceof SubtitleTrackRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de legenda inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("subtitle_tracks.script_id, subtitle_tracks.voice_track_id, subtitle_tracks.revision")) return failure("SUBTITLE_TRACK_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("subtitle_tracks.supersedes_subtitle_track_id")) return failure("SUBTITLE_TRACK_ALREADY_SUPERSEDED", "supersedesSubtitleTrackId", "legenda já substituída", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("SUBTITLE_TRACK_ID_REUSED", "subtitleTrackId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_SUBTITLE_TRACK")) return failure("IMMUTABLE_SUBTITLE_TRACK", "subtitleTrackId", "legenda imutável", { cause: caught });
  if (message.includes("SUBTITLE_TRACK_REVISION_MISMATCH")) return failure("SUBTITLE_TRACK_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("SUBTITLE_TRACK_PERSISTENCE_FAILED", "subtitleTrack", "não foi possível persistir a legenda", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new SubtitleTrackRepositoryError(code, field, message, options); }
