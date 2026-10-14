import type { DatabaseSync } from 'node:sqlite';
import {
  qualityControlReportContentHash,
  qualityControlReportId,
  qualityControlReportIdentityHash,
} from '../../src/media/domain/quality-control-contracts.js';
import { p4ReportHash } from '../../src/media/domain/p4-qc-contracts.js';
import { adaptationHash } from '../../src/media/domain/media-hash.js';
export function qcReport(pipelineRunId = 'run_e04_001') {
  const ref = (id: string) => ({ id, contentHash: 'b'.repeat(64) });
  const value = {
    schemaVersion: 'quality-control-report/1.0.0',
    qualityControlReportId: qualityControlReportId(
      'quality-control-policy/1.0.0',
      'render_001',
      'b'.repeat(64),
    ),
    policyVersion: 'quality-control-policy/1.0.0',
    pipelineRunId,
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    videoRenderId: 'render_001',
    videoRenderContentHash: 'b'.repeat(64),
    artifacts: {
      script: ref('script_001'),
      voiceTrack: ref('voice_001'),
      mediaAssets: [{ position: 1, ...ref('media_001') }],
      compositionPlan: ref('plan_001'),
      subtitleTrack: ref('subtitle_001'),
      videoRender: ref('render_001'),
    },
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      {
        code: 'FILE_EXISTS',
        status: 'PASS',
        subjectType: 'VIDEO_RENDER',
        subjectId: 'render_001',
        message: 'Arquivo final localizado.',
        observed: 'true',
        expected: 'true',
      },
    ],
    checkedAt: '2026-09-28T14:02:00.000Z',
    contentHash: '',
  };
  value.contentHash = qualityControlReportContentHash(value);
  return value;
}
export function seedQc(db: DatabaseSync, value = qcReport()) {
  // Historical-result fixture only: no render or pipeline execution is needed.
  // Like the legacy QC reader fixture, isolate persisted reports from render
  // provisioning. This fixture is never used to validate report registration.
  db.exec(
    'PRAGMA foreign_keys=OFF; DROP TRIGGER quality_control_reports_validate_binding;',
  );
  db.prepare(
    'INSERT INTO quality_control_reports (quality_control_report_id,schema_version,policy_version,identity_hash,pipeline_run_id,project_id,project_version,video_render_id,video_render_content_hash,result,approval_blocked,checked_at,content_hash,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    value.qualityControlReportId,
    value.schemaVersion,
    value.policyVersion,
    qualityControlReportIdentityHash(value),
    value.pipelineRunId,
    value.projectId,
    value.projectVersion,
    value.videoRenderId,
    value.videoRenderContentHash,
    value.result,
    Number(value.approvalBlocked),
    value.checkedAt,
    value.contentHash,
    JSON.stringify(value),
  );
  for (const [findingIndex, finding] of value.findings.entries())
    db.prepare(
      'INSERT INTO quality_control_findings VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      value.qualityControlReportId,
      findingIndex + 1,
      finding.code,
      finding.status,
      finding.subjectType,
      finding.subjectId,
      finding.message,
      finding.observed,
      finding.expected,
    );
  db.exec('PRAGMA foreign_keys=ON;');
  return value;
}
export function p4Qc() {
  const value = {
    schemaVersion: 'quality-control-report/2.0.0',
    qualityControlReportId: 'qc_p4_001',
    policyVersion: 'quality-control-policy/2.0.0',
    pipelineRunId: 'run_e04_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    videoRenderId: 'render_p4_001',
    videoRenderContentHash: 'c'.repeat(64),
    origin: {
      schemaVersion: 'video-origin/1.0.0',
      kind: 'LEGACY_COMPOSITION',
      videoRenderId: 'source_001',
      videoRenderContentHash: 'd'.repeat(64),
    },
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'FILE_INTEGRITY',
      'LINEAGE',
      'PROFILE',
      'AUDIO',
      'PROCESSING_RIGHTS',
      'COMMERCIAL_RIGHTS',
      'NARRATION_RIGHTS',
    ].map((code) => ({ code, status: 'PASS' })),
    checkedAt: '2026-09-28T14:02:00.000Z',
    contentHash: '',
  };
  value.contentHash = p4ReportHash(value);
  return value;
}
export function seedP4Qc(db: DatabaseSync, value = p4Qc()) {
  db.prepare('INSERT INTO p4_artifacts VALUES (?,?,?,?,?)').run(
    'qc_report',
    value.qualityControlReportId,
    adaptationHash(value),
    value.pipelineRunId,
    JSON.stringify(value),
  );
  return value;
}
