import { ContractValidationError } from "./domain/contracts.js";
import { qualityControlReportIdentityHash, validateQualityControlReport } from "./domain/quality-control-contracts.js";
import { VideoRenderRepository } from "./video-render-repository.js";

export class QualityControlRepositoryError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "QualityControlRepositoryError"; this.code = code; this.field = field; }
}

export class QualityControlRepository extends VideoRenderRepository {
  registerQualityControlReport(value) {
    let report; try { report = validateQualityControlReport(value); } catch (caught) { throw mapError(caught); }
    const identityHash = qualityControlReportIdentityHash(report);
    return this.#transaction(() => {
      const prior = this.db.prepare("SELECT identity_hash FROM quality_control_reports WHERE quality_control_report_id = ?").get(report.qualityControlReportId);
      if (prior) {
        if (prior.identity_hash !== identityHash) throw failure("QUALITY_CONTROL_REPORT_ID_REUSED", "qualityControlReportId", "identidade já usada com relatório divergente");
        return this.getQualityControlReport(report.qualityControlReportId);
      }
      const logical = this.db.prepare(`SELECT quality_control_report_id FROM quality_control_reports
        WHERE policy_version = ? AND video_render_id = ? AND video_render_content_hash = ?`)
        .get(report.policyVersion, report.videoRenderId, report.videoRenderContentHash);
      if (logical) throw failure("QUALITY_CONTROL_ALREADY_RECORDED", "videoRenderId", "render já possui QC nesta política");
      const render = this.getVideoRender(report.videoRenderId);
      if (!render) throw failure("VIDEO_RENDER_NOT_FOUND", "videoRenderId", "render final não encontrado");
      if (render.contentHash !== report.videoRenderContentHash || render.revision !== 2) throw failure("QUALITY_CONTROL_VIDEO_BINDING_MISMATCH", "videoRenderId", "QC não corresponde ao render final exato");
      for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (render[field] !== report[field]) throw failure("QUALITY_CONTROL_SCOPE_MISMATCH", field, "QC fora do escopo do render");
      this.db.prepare(`INSERT INTO quality_control_reports
        (quality_control_report_id, schema_version, policy_version, identity_hash,
         pipeline_run_id, project_id, project_version, video_render_id,
         video_render_content_hash, result, approval_blocked, checked_at,
         content_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        report.qualityControlReportId, report.schemaVersion, report.policyVersion, identityHash,
        report.pipelineRunId, report.projectId, report.projectVersion, report.videoRenderId,
        report.videoRenderContentHash, report.result, Number(report.approvalBlocked),
        report.checkedAt, report.contentHash, JSON.stringify(report),
      );
      const insert = this.db.prepare(`INSERT INTO quality_control_findings
        (quality_control_report_id, position, code, status, subject_type, subject_id,
         message, observed, expected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      report.findings.forEach((finding, index) => insert.run(
        report.qualityControlReportId, index + 1, finding.code, finding.status,
        finding.subjectType, finding.subjectId, finding.message, finding.observed, finding.expected,
      ));
      return this.getQualityControlReport(report.qualityControlReportId);
    });
  }

  getQualityControlReport(reportId) {
    requireIdentifier(reportId, "qualityControlReportId");
    const row = this.db.prepare("SELECT * FROM quality_control_reports WHERE quality_control_report_id = ?").get(reportId);
    if (!row) return null;
    try {
      const report = validateQualityControlReport(JSON.parse(row.payload_json));
      const findings = this.db.prepare(`SELECT code, status, subject_type, subject_id, message, observed, expected
        FROM quality_control_findings WHERE quality_control_report_id = ? ORDER BY position`).all(reportId)
        .map((finding) => ({ code: finding.code, status: finding.status, subjectType: finding.subject_type, subjectId: finding.subject_id, message: finding.message, observed: finding.observed, expected: finding.expected }));
      const exact = row.schema_version === report.schemaVersion && row.policy_version === report.policyVersion
        && row.pipeline_run_id === report.pipelineRunId && row.project_id === report.projectId
        && row.project_version === report.projectVersion && row.video_render_id === report.videoRenderId
        && row.video_render_content_hash === report.videoRenderContentHash && row.result === report.result
        && row.approval_blocked === Number(report.approvalBlocked) && row.checked_at === report.checkedAt
        && row.content_hash === report.contentHash && row.identity_hash === qualityControlReportIdentityHash(report)
        && JSON.stringify(findings) === JSON.stringify(report.findings);
      if (!exact) throw new Error("relatório persistido divergente");
      return report;
    } catch (caught) { throw failure("INVALID_PERSISTED_QUALITY_CONTROL_REPORT", "qualityControlReportId", "relatório persistido inválido", { cause: caught }); }
  }

  findQualityControlReport(policyVersion, videoRenderId, videoRenderContentHash) {
    const row = this.db.prepare(`SELECT quality_control_report_id FROM quality_control_reports
      WHERE policy_version = ? AND video_render_id = ? AND video_render_content_hash = ?`)
      .get(policyVersion, videoRenderId, videoRenderContentHash);
    return row ? this.getQualityControlReport(row.quality_control_report_id) : null;
  }

  #transaction(operation) {
    try { this.db.exec("BEGIN IMMEDIATE"); const value = operation(); this.db.exec("COMMIT"); return value; }
    catch (caught) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw mapSqliteError(caught); }
  }
}

function requireIdentifier(value, field) { if (typeof value !== "string" || value.length > 200 || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) { if (caught instanceof QualityControlRepositoryError) return caught; if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "relatório de QC inválido", { cause: caught }); return caught; }
function mapSqliteError(caught) { if (caught instanceof QualityControlRepositoryError) return caught; const message = String(caught?.message ?? ""); if (message.includes("QUALITY_CONTROL_VIDEO_BINDING_MISMATCH")) return failure("QUALITY_CONTROL_VIDEO_BINDING_MISMATCH", "videoRenderId", "QC não corresponde ao render final exato", { cause: caught }); if (message.includes("UNIQUE constraint failed")) return failure("QUALITY_CONTROL_CONFLICT", "qualityControlReportId", "QC concorrente divergente", { cause: caught }); return caught; }
function failure(code, field, message, options) { return new QualityControlRepositoryError(code, field, message, options); }
