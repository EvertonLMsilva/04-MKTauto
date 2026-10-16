import type { QualityControlReport } from '../domain/media.types.js';
import {
  validateQualityControlReport,
  qualityControlReportIdentityHash,
} from '../domain/quality-control-contracts.js';
import { MediaDatabase } from './media-database.js';
import { getP4 } from './p4-qc.reader.js';
export class QualityControlRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'QualityControlRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class QualityControlRepository extends MediaDatabase {
  getQualityControlReport(reportId: string): QualityControlReport | null {
    requireIdentifier(reportId, 'qualityControlReportId');
    const p4 = getP4(this, 'qc_report', reportId);
    if (p4) return validateQualityControlReport(p4);
    const row = this.db
      .prepare(
        'SELECT * FROM quality_control_reports WHERE quality_control_report_id = ?',
      )
      .get(reportId);
    if (!row) return null;
    try {
      const report = validateQualityControlReport(
        JSON.parse(String(row.payload_json)),
      );
      const findings = this.db
        .prepare(
          `SELECT code, status, subject_type, subject_id, message, observed, expected
        FROM quality_control_findings WHERE quality_control_report_id = ? ORDER BY position`,
        )
        .all(reportId)
        .map((finding: any) => ({
          code: finding.code,
          status: finding.status,
          subjectType: finding.subject_type,
          subjectId: finding.subject_id,
          message: finding.message,
          observed: finding.observed,
          expected: finding.expected,
        }));
      const exact =
        row.schema_version === report.schemaVersion &&
        row.policy_version === report.policyVersion &&
        row.pipeline_run_id === report.pipelineRunId &&
        row.project_id === report.projectId &&
        row.project_version === report.projectVersion &&
        row.video_render_id === report.videoRenderId &&
        row.video_render_content_hash === report.videoRenderContentHash &&
        row.result === report.result &&
        row.approval_blocked === Number(report.approvalBlocked) &&
        row.checked_at === report.checkedAt &&
        row.content_hash === report.contentHash &&
        row.identity_hash === qualityControlReportIdentityHash(report) &&
        JSON.stringify(findings) === JSON.stringify(report.findings);
      if (!exact) throw new Error('relatório persistido divergente');
      return report;
    } catch (caught) {
      throw failure(
        'INVALID_PERSISTED_QUALITY_CONTROL_REPORT',
        'qualityControlReportId',
        'relatório persistido inválido',
        { cause: caught },
      );
    }
  }
  findQualityControlReport(
    policyVersion: string,
    videoRenderId: string,
    videoRenderContentHash: string,
  ): QualityControlReport | null {
    if (policyVersion === 'quality-control-policy/2.0.0') {
      const row = this.db
        .prepare(
          "SELECT artifact_id FROM p4_artifacts WHERE kind='qc_report' AND json_extract(payload_json,'$.videoRenderId')=? AND json_extract(payload_json,'$.videoRenderContentHash')=?",
        )
        .get(videoRenderId, videoRenderContentHash);
      return row
        ? this.getQualityControlReport(row.artifact_id as string)
        : null;
    }
    const row = this.db
      .prepare(
        `SELECT quality_control_report_id FROM quality_control_reports
      WHERE policy_version = ? AND video_render_id = ? AND video_render_content_hash = ?`,
      )
      .get(policyVersion, videoRenderId, videoRenderContentHash);
    return row
      ? this.getQualityControlReport(row.quality_control_report_id as string)
      : null;
  }
}
function requireIdentifier(value: any, field: any): any {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw failure('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function failure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
): any {
  return new QualityControlRepositoryError(code, field, message, options);
}
