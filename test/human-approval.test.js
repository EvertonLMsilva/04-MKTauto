import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HUMAN_APPROVAL_DECISION_VERSION,
  humanApprovalDecisionContentHash,
  humanApprovalDecisionId,
  validateHumanApprovalDecision,
} from "../src/domain/human-approval-contracts.js";
import { HumanApprovalRepository } from "../src/human-approval-repository.js";
import { HumanApprovalService } from "../src/human-approval-service.js";

const H = (digit) => digit.repeat(64);
const identity = Object.freeze({
  projectId: "project_approval", projectVersion: 1, pipelineRunId: "run_approval",
  videoRenderId: "video_render:approval:final", videoRenderRevision: 2,
  videoRenderContentHash: H("8"), qualityControlReportId: "quality_control:approval",
  qualityControlReportContentHash: H("9"),
});

test("contrato fecha identidade exata, decisões e política de justificativa", () => {
  const value = decision();
  assert.deepEqual(validateHumanApprovalDecision(value), value);
  assert.equal(value.humanApprovalDecisionId, humanApprovalDecisionId(identity));
  assert.throws(() => validateHumanApprovalDecision({ ...value, decision: "CHANGES_REQUESTED" }), /INVALID_DECISION/);
  assert.throws(() => validateHumanApprovalDecision(rehashed({ ...value, decision: "REJECTED", justification: null })), /JUSTIFICATION_REQUIRED/);
  assert.throws(() => validateHumanApprovalDecision(rehashed({ ...value, actor: "sk-secret" })), /INVALID_PUBLIC_TEXT/);
  assert.notEqual(humanApprovalDecisionId(identity), humanApprovalDecisionId({ ...identity, videoRenderContentHash: H("7") }));
  assert.notEqual(humanApprovalDecisionId(identity), humanApprovalDecisionId({ ...identity, qualityControlReportContentHash: H("6") }));
});

test("service aprova PASS/WARN, rejeita, deduplica retry e detecta conflito lógico", () => {
  for (const result of ["PASS", "WARN"]) {
    const fixture = serviceFixture(result);
    const first = fixture.service.decide(request());
    const retry = fixture.service.decide(request());
    assert.deepEqual(retry, first);
    assert.equal(fixture.registered.length, 1);
    assert.equal(first.decision, "APPROVED");
    assert.equal(first.qualityControlReportContentHash, identity.qualityControlReportContentHash);
    assert.throws(() => fixture.service.decide(request({ actor: "outro_operador" })), conflict);
    assert.throws(() => fixture.service.decide(request({ decision: "REJECTED", justification: "A legenda precisa de correção." })), conflict);
  }

  const rejected = serviceFixture("FAIL");
  assert.throws(() => rejected.service.decide(request()), (error) => error.code === "HUMAN_APPROVAL_QC_FAILED");
  assert.equal(rejected.service.decide(request({ decision: "REJECTED", justification: "QC obrigatório falhou." })).decision, "REJECTED");
});

test("service rejeita render ou QC divergente e nova identidade exige nova decisão", () => {
  const fixture = serviceFixture("PASS");
  fixture.service.decide(request());
  assert.throws(() => fixture.service.decide(request({ videoRenderRevision: 3 })), (error) => error.code === "HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH");
  assert.throws(() => fixture.service.decide(request({ videoRenderContentHash: H("7") })), (error) => error.code === "HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH");
  assert.throws(() => fixture.service.decide(request({ qualityControlReportContentHash: H("6") })), (error) => error.code === "HUMAN_APPROVAL_QC_BINDING_MISMATCH");
  assert.equal(fixture.registered.length, 1);
});

test("repository aplica migration 025, mantém histórico imutável e consulta aprovação por escopo exato", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-human-approval-"));
  const path = join(root, "catalog.sqlite");
  const repository = new HumanApprovalRepository(path);
  try {
    assert.equal(repository.db.prepare("PRAGMA user_version").get().user_version, 32);
    repository.db.exec("PRAGMA foreign_keys = OFF; DROP TRIGGER human_approval_decisions_validate_binding;");
    const approved = decision();
    assert.deepEqual(repository.registerHumanApprovalDecision(approved), approved);
    assert.deepEqual(repository.registerHumanApprovalDecision(approved), approved);
    assert.deepEqual(repository.findHumanApprovalDecision(identity), approved);
    assert.deepEqual(repository.findApprovedHumanApprovalDecision(identity), approved);
    assert.equal(repository.findApprovedHumanApprovalDecision({ ...identity, videoRenderContentHash: H("7") }), null);
    assert.deepEqual(repository.listHumanApprovalDecisionsByPipelineRun(identity.pipelineRunId), [approved]);
    assert.throws(() => repository.registerHumanApprovalDecision(rehashed({ ...approved, actor: "outro_operador" })), /HUMAN_APPROVAL_DECISION_CONFLICT/);
    assert.throws(() => repository.db.prepare("UPDATE human_approval_decisions SET actor = 'outro'").run(), /IMMUTABLE_HUMAN_APPROVAL_DECISION/);
    assert.throws(() => repository.db.prepare("DELETE FROM human_approval_decisions").run(), /IMMUTABLE_HUMAN_APPROVAL_DECISION/);
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

function decision(overrides = {}) {
  const value = {
    schemaVersion: HUMAN_APPROVAL_DECISION_VERSION,
    humanApprovalDecisionId: humanApprovalDecisionId(identity),
    ...identity,
    decision: "APPROVED", actor: "operador_local", justification: null,
    decidedAt: "2026-09-30T18:00:00.000Z", contentHash: "", ...overrides,
  };
  value.contentHash = humanApprovalDecisionContentHash(value);
  return value;
}

function rehashed(value) { const copy = { ...value, contentHash: "" }; copy.contentHash = humanApprovalDecisionContentHash(copy); return copy; }
function request(overrides = {}) { return { ...identity, decision: "APPROVED", actor: "operador_local", justification: null, ...overrides }; }
function conflict(error) { return error.code === "HUMAN_APPROVAL_DECISION_CONFLICT"; }

function serviceFixture(result) {
  const decisions = new Map(); const registered = [];
  const render = { videoRenderId: identity.videoRenderId, revision: identity.videoRenderRevision, contentHash: identity.videoRenderContentHash, pipelineRunId: identity.pipelineRunId, projectId: identity.projectId, projectVersion: identity.projectVersion };
  const qc = { qualityControlReportId: identity.qualityControlReportId, contentHash: identity.qualityControlReportContentHash, videoRenderId: identity.videoRenderId, videoRenderContentHash: identity.videoRenderContentHash, pipelineRunId: identity.pipelineRunId, projectId: identity.projectId, projectVersion: identity.projectVersion, result, approvalBlocked: result === "FAIL" };
  const repository = {
    getVideoRender: () => render,
    getQualityControlReport: (id) => id === qc.qualityControlReportId ? qc : null,
    getHumanApprovalDecision: (id) => decisions.get(id) ?? null,
    registerHumanApprovalDecision: (value) => { registered.push(value); decisions.set(value.humanApprovalDecisionId, value); return value; },
    findApprovedHumanApprovalDecision: (scope) => { const value = decisions.get(humanApprovalDecisionId(scope)); return value?.decision === "APPROVED" ? value : null; },
  };
  return { service: new HumanApprovalService({ repository, now: () => "2026-09-30T18:00:00.000Z" }), registered };
}
