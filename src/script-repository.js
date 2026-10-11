import { createHash, randomUUID } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { AI_CALL_TELEMETRY_CONTRACT_VERSION, validateAiCallTelemetry } from "./domain/ai-call-telemetry-contracts.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { validateCostEvent } from "./domain/cost-event-contracts.js";
import { validateScript } from "./domain/script-contracts.js";
import {
  SCRIPT_GENERATION_REQUEST_VERSION,
  scriptGenerationRequestHash,
  validateScriptGenerationRequest,
} from "./domain/script-generation-contracts.js";
import { IdeaSelectionRepository } from "./idea-selection-repository.js";
import { AffiliateRepository } from "./affiliate-repository.js";

export class ScriptRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "ScriptRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class ScriptRepository extends IdeaSelectionRepository {
  claimScriptGeneration(request) {
    return this.#transaction(() => {
      const prior = this.db.prepare('SELECT * FROM script_generation_claims WHERE generation_request_id = ?').get(request.generationRequestId);
      if (prior && prior.request_hash !== request.contentHash) throw new ScriptRepositoryError('GENERATION_REQUEST_ID_REUSED', 'generationRequestId', 'conteúdo divergente');
      const currentTime = Date.now();
      if (prior && !(prior.state === 'RETRYABLE' || (prior.state === 'RESERVED' && prior.reserved_until <= currentTime))) return { acquired: false, state: prior.state };
      const ownerToken = randomUUID();
      if (prior) this.db.prepare("UPDATE script_generation_claims SET state = 'RESERVED', owner_token = ?, reserved_until = ? WHERE generation_request_id = ?").run(ownerToken, currentTime + 30000, request.generationRequestId);
      else this.db.prepare("INSERT INTO script_generation_claims VALUES (?, ?, 'RESERVED', ?, ?)").run(request.generationRequestId, request.contentHash, ownerToken, currentTime + 30000);
      return { acquired: true, ownerToken };
    });
  }

  transitionScriptGeneration(request, ownerToken, fromState, toState) {
    const allowed = { RESERVED: ['DISPATCHING', 'RETRYABLE'], DISPATCHING: ['TERMINAL', 'RECONCILIATION_PENDING'] };
    if (!allowed[fromState]?.includes(toState)) throw new ScriptRepositoryError('GENERATION_STATE_TRANSITION_INVALID', 'state', 'transição não permitida');
    const result = this.db.prepare('UPDATE script_generation_claims SET state = ? WHERE generation_request_id = ? AND request_hash = ? AND owner_token = ? AND state = ?').run(toState, request.generationRequestId, request.contentHash, ownerToken, fromState);
    if (result.changes !== 1) throw new ScriptRepositoryError('GENERATION_CLAIM_LOST', 'generationRequestId', 'reserva não pertence ao executor');
  }

  resolveRunBriefing(pipelineRunId, expectedBriefingId) {
    return new AffiliateRepository(this).resolveRunBriefing(pipelineRunId, expectedBriefingId);
  }

  prepareScriptGeneration(request, pipelineRunId, expectedBriefingId) {
    return new AffiliateRepository(this).prepareScriptGeneration(request, pipelineRunId, expectedBriefingId);
  }

  verifyScriptGenerationContext(request, pipelineRunId, briefing) {
    return new AffiliateRepository(this).verifyScriptGenerationContext(request, pipelineRunId, briefing);
  }

  registerScript(value) {
    let script;
    try { script = validateScript(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidatedScript(script, null, true));
  }

  registerGeneratedScript({ request: requestValue, script: scriptValue, generationMetadata, telemetry: telemetryValue, costEvent: costEventValue }) {
    let request;
    let script;
    let telemetry;
    let costEvent;
    try {
      request = validateScriptGenerationRequest(requestValue);
      script = validateScript(scriptValue);
      telemetry = validateAiCallTelemetry(telemetryValue);
      costEvent = costEventValue === null ? null : validateCostEvent(costEventValue);
    } catch (caught) { throw mapError(caught); }
    return this.#transaction(() => {
      if (telemetry.logicalCallId !== request.generationRequestId || telemetry.requestHash !== request.contentHash) {
        throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
      }
      verifyTelemetry({ telemetry, request, script, generationMetadata, costEvent });
      const priorTelemetry = this.#priorTelemetry(telemetry);
      if (priorTelemetry) {
        const priorGeneration = this.getScriptGeneration(request.generationRequestId);
        if (!priorGeneration || priorTelemetry.outcome !== "SUCCESS") throw failure("AI_CALL_ID_REUSED", "aiCallId", "identidade já usada com resultado incompatível");
        return priorGeneration.script;
      }
      const prior = this.db.prepare(`SELECT request_hash, script_id
        FROM script_generation_requests WHERE generation_request_id = ?`).get(request.generationRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash) throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
        return this.getScript(prior.script_id);
      }
      if (request.ideaSelectionId !== script.ideaSelectionId) throw failure("GENERATION_REQUEST_SCOPE_MISMATCH", "ideaSelectionId", "solicitação diverge do roteiro");
      if (request.requestedAt !== script.createdAt) throw failure("GENERATION_REQUEST_SCOPE_MISMATCH", "requestedAt", "solicitação diverge do roteiro");
      if (script.scriptId !== `script:${request.generationRequestId}`) throw failure("GENERATION_REQUEST_SCOPE_MISMATCH", "scriptId", "solicitação diverge do roteiro");
      const created = this.#registerValidatedScript(script, generationMetadata, false);
      this.db.prepare(`INSERT INTO script_generation_requests
        (generation_request_id, schema_version, request_hash, script_id, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run(request.generationRequestId, request.schemaVersion, request.contentHash, created.scriptId, request.requestedAt);
      this.#insertCostEvent(costEvent);
      this.#insertTelemetry(telemetry);
      return created;
    });
  }

  registerFailedAiCall({ request: requestValue, telemetry: telemetryValue, costEvent: costEventValue }) {
    let request;
    let telemetry;
    let costEvent;
    try {
      request = validateScriptGenerationRequest(requestValue);
      telemetry = validateAiCallTelemetry(telemetryValue);
      costEvent = costEventValue === null ? null : validateCostEvent(costEventValue);
    } catch (caught) { throw mapError(caught); }
    return this.#transaction(() => {
      if (telemetry.logicalCallId !== request.generationRequestId || telemetry.requestHash !== request.contentHash) {
        throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
      }
      const selection = this.getSelection(request.ideaSelectionId);
      if (!selection) throw failure("IDEA_SELECTION_NOT_FOUND", "ideaSelectionId", "seleção não encontrada");
      verifyFailedTelemetry({ telemetry, request, selection, costEvent });
      const prior = this.#priorTelemetry(telemetry);
      if (prior) return prior;
      if (telemetry.outcome !== "FAILURE") throw failure("INVALID_AI_CALL_OUTCOME", "outcome", "falha exige resultado FAILURE");
      this.#insertCostEvent(costEvent);
      this.#insertTelemetry(telemetry);
      return this.getAiCallTelemetry(telemetry.aiCallId);
    });
  }

  getAiCallTelemetry(aiCallId) {
    requireIdentifier(aiCallId, "aiCallId", 200);
    const row = this.db.prepare("SELECT * FROM ai_call_telemetry WHERE ai_call_id = ?").get(aiCallId);
    if (!row) return null;
    try {
      const telemetry = validateAiCallTelemetry(telemetryFromRow(row));
      if (sha256(JSON.stringify(telemetry)) !== row.identity_hash) throw new Error("integridade inválida");
      return telemetry;
    } catch (caught) {
      throw failure("INVALID_PERSISTED_AI_CALL_TELEMETRY", "aiCallId", "telemetria persistida inválida", { cause: caught });
    }
  }

  getAiCallTelemetryByLogicalCall(logicalCallId) {
    requireIdentifier(logicalCallId, "logicalCallId", 200);
    const row = this.db.prepare("SELECT ai_call_id FROM ai_call_telemetry WHERE logical_call_id = ?").get(logicalCallId);
    return row ? this.getAiCallTelemetry(row.ai_call_id) : null;
  }

  getScriptGeneration(generationRequestId) {
    requireIdentifier(generationRequestId, "generationRequestId", 180);
    const row = this.db.prepare(`SELECT * FROM script_generation_requests
      WHERE generation_request_id = ?`).get(generationRequestId);
    if (!row) return null;
    try {
      if (row.schema_version !== SCRIPT_GENERATION_REQUEST_VERSION || !/^[a-f0-9]{64}$/.test(row.request_hash)) throw new Error("identidade inválida");
      const script = this.getScript(row.script_id);
      const lineage = this.getArtifact(row.script_id);
      if (!script || !lineage?.generationMetadata) throw new Error("geração incompleta");
      const expectedHash = scriptGenerationRequestHash({
        schemaVersion: row.schema_version,
        generationRequestId: row.generation_request_id,
        ideaSelectionId: script.ideaSelectionId,
        requestedAt: row.created_at,
        contentHash: row.request_hash,
      });
      if (row.script_id !== `script:${row.generation_request_id}` || script.createdAt !== row.created_at || expectedHash !== row.request_hash) throw new Error("vínculo inválido");
      return deepFreeze({ requestHash: row.request_hash, script, generationMetadata: lineage.generationMetadata });
    } catch (caught) {
      throw failure("INVALID_PERSISTED_SCRIPT_GENERATION", "generationRequestId", "geração persistida inválida", { cause: caught });
    }
  }

  #registerValidatedScript(script, generationMetadata, allowExisting) {
    const prior = this.db.prepare("SELECT content_hash FROM scripts WHERE script_id = ?").get(script.scriptId);
    if (prior) {
      if (!allowExisting || prior.content_hash !== script.contentHash) throw failure("SCRIPT_ID_REUSED", "scriptId", "ID já usado com roteiro incompatível");
      return this.getScript(script.scriptId);
    }

    const run = this.getRun(script.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(run, script, "SCRIPT_RUN_SCOPE_MISMATCH");
    const selection = this.getSelection(script.ideaSelectionId);
    if (!selection) throw failure("IDEA_SELECTION_NOT_FOUND", "ideaSelectionId", "seleção não encontrada");
    verifySelection(script, selection);
    verifyProjectCompatibility(script, run.projectSnapshot);
    const previous = this.#validateRevision(script);
    this.#insertLineage(script, previous, generationMetadata);
    this.db.prepare(`INSERT INTO scripts
        (script_id, schema_version, pipeline_run_id, project_id, project_version,
         idea_selection_id, idea_selection_content_hash, idea_candidate_id,
         idea_content_hash, language, content_format, estimated_duration_seconds,
         origin, created_at, revision, supersedes_script_id, content_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        script.scriptId, script.schemaVersion, script.pipelineRunId, script.projectId,
        script.projectVersion, script.ideaSelectionId, script.ideaSelectionContentHash,
        script.ideaCandidateId, script.ideaContentHash, script.language,
        script.contentFormat, script.estimatedDurationSeconds, script.origin,
        script.createdAt, script.revision, script.supersedesScriptId,
        script.contentHash, JSON.stringify(script),
      );
    return this.getScript(script.scriptId);
  }

  getScript(scriptId) {
    requireIdentifier(scriptId, "scriptId", 200);
    const row = this.db.prepare("SELECT * FROM scripts WHERE script_id = ?").get(scriptId);
    if (!row) return null;
    try {
      const script = validateScript(JSON.parse(row.payload_json));
      verifyPersistedColumns(script, row);
      const run = this.getRun(script.pipelineRunId);
      if (!run) throw new Error("execução ausente");
      verifyScope(run, script, "SCRIPT_RUN_SCOPE_MISMATCH");
      const selection = this.getSelection(script.ideaSelectionId);
      if (!selection) throw new Error("seleção ausente");
      verifySelection(script, selection);
      verifyProjectCompatibility(script, run.projectSnapshot);
      return script;
    } catch (caught) {
      throw failure("INVALID_PERSISTED_SCRIPT", "scriptId", "roteiro persistido inválido", { cause: caught });
    }
  }

  listScriptsByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT script_id FROM scripts WHERE pipeline_run_id = ?
      ORDER BY created_at, idea_selection_id, revision, script_id`).all(pipelineRunId)
      .map(({ script_id: id }) => this.getScript(id));
  }

  listScriptsBySelection(ideaSelectionId) {
    requireIdentifier(ideaSelectionId, "ideaSelectionId", 200);
    return this.db.prepare(`SELECT script_id FROM scripts WHERE idea_selection_id = ?
      ORDER BY revision, script_id`).all(ideaSelectionId)
      .map(({ script_id: id }) => this.getScript(id));
  }

  #priorTelemetry(telemetry) {
    const byId = this.db.prepare("SELECT identity_hash FROM ai_call_telemetry WHERE ai_call_id = ?").get(telemetry.aiCallId);
    const byLogical = this.db.prepare("SELECT ai_call_id, identity_hash FROM ai_call_telemetry WHERE logical_call_id = ?").get(telemetry.logicalCallId);
    if (!byId && !byLogical) return null;
    if (!byId || !byLogical || byLogical.ai_call_id !== telemetry.aiCallId
      || byId.identity_hash !== sha256(JSON.stringify(telemetry))
      || byLogical.identity_hash !== byId.identity_hash) {
      throw failure("AI_CALL_ID_REUSED", "aiCallId", "identidade já usada com telemetria incompatível");
    }
    return this.getAiCallTelemetry(telemetry.aiCallId);
  }

  #insertCostEvent(event) {
    if (event === null) return;
    const identityHash = sha256(JSON.stringify(event));
    const prior = this.db.prepare("SELECT identity_hash FROM cost_events WHERE cost_event_id = ?").get(event.costEventId);
    if (prior) {
      if (prior.identity_hash !== identityHash) throw failure("COST_EVENT_ID_REUSED", "costEventId", "identidade de custo incompatível");
      return;
    }
    this.db.prepare(`INSERT INTO cost_events
      (cost_event_id, schema_version, identity_hash, category, pipeline_run_id,
       project_id, project_version, content_identity, artifact_id, amount, currency,
       occurred_at, origin, attribution_rule_version, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.costEventId, event.schemaVersion, identityHash, event.category,
        event.pipelineRunId, event.projectId, event.projectVersion, event.contentIdentity,
        event.artifactId, event.amount, event.currency, event.occurredAt, event.origin,
        event.attributionRuleVersion, event.recordedAt);
  }

  #insertTelemetry(value) {
    this.db.prepare(`INSERT INTO ai_call_telemetry
      (ai_call_id, logical_call_id, schema_version, identity_hash, request_hash,
       pipeline_run_id, project_id, project_version, artifact_id, cost_event_id,
       provider, model, task_type, prompt_version, input_tokens, output_tokens,
       cached_input_tokens, usage_origin, cost_amount, currency, cost_origin,
       latency_ms, occurred_at, fallback, input_hash, output_hash, outcome,
       failure_code, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(value.aiCallId, value.logicalCallId, value.schemaVersion,
        sha256(JSON.stringify(value)), value.requestHash, value.pipelineRunId,
        value.projectId, value.projectVersion, value.artifactId, value.costEventId,
        value.provider, value.model, value.taskType, value.promptVersion,
        value.inputTokens, value.outputTokens, value.cachedInputTokens,
        value.usageOrigin, value.costAmount, value.currency, value.costOrigin,
        value.latencyMs, value.occurredAt,
        value.fallback === null ? null : Number(value.fallback), value.inputHash,
        value.outputHash, value.outcome, value.failureCode, value.recordedAt);
  }

  #validateRevision(script) {
    if (script.revision === 1) {
      const existing = this.db.prepare("SELECT 1 FROM scripts WHERE idea_selection_id = ? LIMIT 1").get(script.ideaSelectionId);
      if (existing) throw failure("SCRIPT_REVISION_CONFLICT", "revision", "revisão já registrada");
      return null;
    }
    const previous = this.getScript(script.supersedesScriptId);
    if (!previous) throw failure("SUPERSEDED_SCRIPT_NOT_FOUND", "supersedesScriptId", "roteiro anterior não encontrado");
    for (const field of ["pipelineRunId", "projectId", "projectVersion", "ideaSelectionId", "ideaCandidateId", "language", "contentFormat"]) {
      if (previous[field] !== script[field]) throw failure("SCRIPT_SUPERSESSION_SCOPE_MISMATCH", field, "roteiro anterior fora do escopo");
    }
    if (previous.revision + 1 !== script.revision) throw failure("SCRIPT_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
    return previous;
  }

  #insertLineage(script, previous, generationMetadata = null) {
    const inputs = [{
      position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.ideaSelectionId,
      contentHash: script.ideaSelectionContentHash,
    }];
    if (previous) inputs.push({
      position: 2, kind: "INTERNAL_ARTIFACT", inputId: previous.scriptId,
      contentHash: previous.contentHash,
    });
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: script.scriptId,
      artifactType: "script",
      artifactVersion: script.revision,
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      contentIdentity: `script:${script.ideaSelectionId}`,
      hashAlgorithm: "sha256",
      contentHash: script.contentHash,
      inputs,
      generationMetadata,
      createdAt: script.createdAt,
    });
    this.db.prepare(`INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      artifact.artifactId, artifact.schemaVersion, artifact.artifactType,
      artifact.artifactVersion, sha256(JSON.stringify(artifact)), artifact.pipelineRunId,
      artifact.projectId, artifact.projectVersion, artifact.contentIdentity,
      artifact.hashAlgorithm, artifact.contentHash,
      artifact.generationMetadata === null ? null : JSON.stringify(artifact.generationMetadata),
      artifact.createdAt,
    );
    const insert = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    artifact.inputs.forEach((input) => insert.run(artifact.artifactId, input.position, input.kind, input.inputId, input.contentHash));
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

function verifySelection(script, selection) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "ideaCandidateId"]) {
    if (selection[field] !== script[field]) throw failure("SCRIPT_SELECTION_SCOPE_MISMATCH", field, "seleção fora do escopo");
  }
  if (selection.decision !== "SELECTED") throw failure("IDEA_SELECTION_NOT_SELECTED", "ideaSelectionId", "seleção não está aprovada");
  if (selection.contentHash !== script.ideaSelectionContentHash) throw failure("IDEA_SELECTION_CONTENT_HASH_MISMATCH", "ideaSelectionContentHash", "hash da seleção divergente");
  if (selection.ideaContentHash !== script.ideaContentHash) throw failure("IDEA_CONTENT_HASH_MISMATCH", "ideaContentHash", "hash da ideia divergente");
}

function verifyProjectCompatibility(script, snapshot) {
  if (snapshot.project.audience.language !== script.language) throw failure("SCRIPT_LANGUAGE_MISMATCH", "language", "idioma diverge do projeto");
  if (snapshot.channel.format !== script.contentFormat) throw failure("SCRIPT_CONTENT_FORMAT_MISMATCH", "contentFormat", "formato diverge do projeto");
  const duration = script.estimatedDurationSeconds;
  if (duration < snapshot.channel.minDurationSeconds || duration > snapshot.channel.maxDurationSeconds) {
    throw failure("SCRIPT_DURATION_OUT_OF_RANGE", "estimatedDurationSeconds", "duração fora dos limites do projeto");
  }
}

function verifyPersistedColumns(script, row) {
  const expected = {
    script_id: script.scriptId, schema_version: script.schemaVersion,
    pipeline_run_id: script.pipelineRunId, project_id: script.projectId,
    project_version: script.projectVersion, idea_selection_id: script.ideaSelectionId,
    idea_selection_content_hash: script.ideaSelectionContentHash,
    idea_candidate_id: script.ideaCandidateId, idea_content_hash: script.ideaContentHash,
    language: script.language, content_format: script.contentFormat,
    estimated_duration_seconds: script.estimatedDurationSeconds, origin: script.origin,
    created_at: script.createdAt, revision: script.revision,
    supersedes_script_id: script.supersedesScriptId, content_hash: script.contentHash,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}

function verifyTelemetry({ telemetry, request, script, generationMetadata, costEvent }) {
  const expected = {
    aiCallId: `ai_call:${request.generationRequestId}`,
    logicalCallId: request.generationRequestId,
    requestHash: request.contentHash,
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    artifactId: script.scriptId,
    outcome: "SUCCESS",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (telemetry[field] !== value) throw failure("AI_CALL_TELEMETRY_SCOPE_MISMATCH", field, "telemetria diverge da geração");
  }
  for (const field of ["provider", "model", "taskType", "promptVersion"]) {
    if (telemetry[field] !== generationMetadata?.[field]) throw failure("AI_CALL_TELEMETRY_METADATA_MISMATCH", field, "metadado diverge da linhagem");
  }
  verifyCostLink(telemetry, costEvent, `script:${script.ideaSelectionId}`);
}

function verifyFailedTelemetry({ telemetry, request, selection, costEvent }) {
  const expected = {
    aiCallId: `ai_call:${request.generationRequestId}`,
    logicalCallId: request.generationRequestId,
    requestHash: request.contentHash,
    pipelineRunId: selection.pipelineRunId,
    projectId: selection.projectId,
    projectVersion: selection.projectVersion,
    artifactId: null,
    outcome: "FAILURE",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (telemetry[field] !== value) throw failure("AI_CALL_TELEMETRY_SCOPE_MISMATCH", field, "telemetria diverge da geração");
  }
  verifyCostLink(telemetry, costEvent, `script:${selection.ideaSelectionId}`);
}

function verifyCostLink(telemetry, event, contentIdentity) {
  if (telemetry.costEventId === null) {
    if (event !== null) throw failure("AI_CALL_COST_MISMATCH", "costEvent", "custo ausente na telemetria");
    return;
  }
  if (event === null) throw failure("AI_CALL_COST_MISMATCH", "costEvent", "evento de custo ausente");
  const expected = {
    costEventId: telemetry.costEventId,
    category: "ai_cost",
    pipelineRunId: telemetry.pipelineRunId,
    projectId: telemetry.projectId,
    projectVersion: telemetry.projectVersion,
    contentIdentity,
    artifactId: telemetry.artifactId,
    amount: telemetry.costAmount,
    currency: telemetry.currency,
    occurredAt: telemetry.occurredAt,
    origin: `ai_telemetry:${telemetry.costOrigin}`,
    attributionRuleVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    recordedAt: telemetry.recordedAt,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (event[field] !== value) throw failure("AI_CALL_COST_MISMATCH", field, "evento de custo diverge da telemetria");
  }
}

function telemetryFromRow(row) {
  return {
    schemaVersion: row.schema_version,
    aiCallId: row.ai_call_id,
    logicalCallId: row.logical_call_id,
    requestHash: row.request_hash,
    pipelineRunId: row.pipeline_run_id,
    projectId: row.project_id,
    projectVersion: row.project_version,
    artifactId: row.artifact_id,
    costEventId: row.cost_event_id,
    provider: row.provider,
    model: row.model,
    taskType: row.task_type,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    usageOrigin: row.usage_origin,
    costAmount: row.cost_amount,
    currency: row.currency,
    costOrigin: row.cost_origin,
    latencyMs: row.latency_ms,
    occurredAt: row.occurred_at,
    fallback: row.fallback === null ? null : row.fallback === 1,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    outcome: row.outcome,
    failureCode: row.failure_code,
    recordedAt: row.recorded_at,
  };
}

function verifyScope(stored, expected, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente");
}
function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) {
  if (caught instanceof ScriptRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de roteiro inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("scripts.idea_selection_id, scripts.revision")) return failure("SCRIPT_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("scripts.supersedes_script_id")) return failure("SCRIPT_ALREADY_SUPERSEDED", "supersedesScriptId", "roteiro já substituído", { cause: caught });
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) return failure("SCRIPT_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("SCRIPT_ID_REUSED", "scriptId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_SCRIPT")) return failure("IMMUTABLE_SCRIPT", "scriptId", "roteiro imutável", { cause: caught });
  if (message.includes("SCRIPT_SCOPE_MISMATCH")) return failure("SCRIPT_SCOPE_MISMATCH", "ideaSelectionId", "artefatos fora do escopo", { cause: caught });
  if (message.includes("SCRIPT_REVISION_MISMATCH")) return failure("SCRIPT_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (message.includes("AI_CALL_TELEMETRY_SCOPE_MISMATCH")) return failure("AI_CALL_TELEMETRY_SCOPE_MISMATCH", "aiCallId", "telemetria fora do escopo", { cause: caught });
  if (message.includes("IMMUTABLE_AI_CALL_TELEMETRY")) return failure("IMMUTABLE_AI_CALL_TELEMETRY", "aiCallId", "telemetria é imutável", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("SCRIPT_PERSISTENCE_FAILED", "script", "não foi possível persistir o roteiro", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new ScriptRepositoryError(code, field, message, options); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
