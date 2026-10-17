import type { AffiliateEvidence } from '../../affiliate/domain/affiliate-contracts.js';
import { HumanApprovalService } from '../../publishing/application/human-approval.service.js';
import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import { LocalEvidenceStorage } from './local-evidence-storage.js';
import type { QualityControlReport } from '../domain/media.types.js';
import {
  validateQualityControlReport,
  qualityControlReportIdentityHash,
} from '../domain/quality-control-contracts.js';
import { MediaDatabase } from './media-database.js';
import {
  getP4,
  getTemporalQC,
  validateCurrentTemporalQC,
} from './p4-qc.reader.js';
import {
  mediaIdentityHash,
  p4Fail,
  p4ReportHash,
  temporalReportId,
  temporalResult,
  validateTemporalEvidence,
  validateTemporalReport,
  type TemporalValidator,
  type TemporalMediaIdentity,
} from '../domain/p4-qc-contracts.js';
import { adaptationHash } from '../domain/media-hash.js';
import { MediaAssetRepository } from './media-asset.repository.js';
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
export class QualityControlRepository extends MediaAssetRepository {
  private readonly temporalValidator?: TemporalValidator;
  constructor(
    path: ConstructorParameters<typeof MediaDatabase>[0],
    operations: ConstructorParameters<typeof MediaDatabase>[1],
    content: ConstructorParameters<typeof MediaDatabase>[2],
    options: { readOnly?: boolean; temporalValidator?: TemporalValidator } = {},
  ) {
    super(path, operations, content, options);
    this.temporalValidator = options.temporalValidator;
  }
  async reviewTemporalMedia(
    mediaAssetId: string,
    input: any,
    principal: unknown,
  ) {
    const asset = this.getMediaAsset(mediaAssetId);
    const reference =
      input?.referenceImage &&
      this.getMediaAsset(input.referenceImage.mediaAssetId);
    if (
      !asset ||
      !reference ||
      asset.assetType !== 'VIDEO' ||
      reference.assetType !== 'IMAGE' ||
      asset.technicalProperties.format !== 'mp4' ||
      reference.technicalProperties.format !== 'png' ||
      reference.scriptId !== asset.scriptId ||
      reference.scriptContentHash !== asset.scriptContentHash
    )
      p4Fail('HUMAN_APPROVAL_REFERENCE_REQUIRED');
    for (const candidate of [asset!, reference!]) {
      if (!candidate.rights.commercialUseAllowed)
        p4Fail('COMMERCIAL_USE_REQUIRED');
      const matching = candidate.rights.evidence?.filter(
        (e: AffiliateEvidence) =>
          e.mediaAuthorization?.mediaRef === candidate.mediaReference &&
          e.mediaAuthorization?.contentHash === candidate.contentHash,
      );
      if (
        !matching?.length ||
        matching.some(
          (e: AffiliateEvidence) =>
            e.mediaAuthorization?.localProcessing !== true ||
            e.mediaAuthorization.processing !== 'GRANTED' ||
            e.mediaAuthorization.commercialUse !== 'GRANTED',
        )
      )
        p4Fail('MEDIA_PROCESSING_RIGHTS_REQUIRED');
    }
    // An image being public (including Shopee) never grants transfer to fal.ai.
    assertMediaProcessingRights(
      reference!.rights.evidence,
      {
        mediaRef: reference!.mediaReference,
        contentHash: reference!.contentHash,
      },
      'fal_ai',
    );
    if (
      !process.env.FFMPEG_MEDIA_ROOT ||
      !process.env.LOCAL_MEDIA_EVIDENCE_ROOT
    )
      p4Fail('HUMAN_APPROVAL_TECHNICAL_REQUIRED');
    new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).read(
      reference!.contentHash,
      'png',
      33554432,
    );
    if (!this.temporalValidator?.verifyReferenceImage)
      p4Fail('HUMAN_APPROVAL_TECHNICAL_REQUIRED');
    const referenceTechnical = await this.temporalValidator!
      .verifyReferenceImage!({
      mediaReference: reference!.mediaReference,
      contentHash: reference!.contentHash,
    });
    const automatic: any = await this.evaluateTemporalMedia(mediaAssetId, true);
    if (!automatic.evidence.provenance)
      p4Fail('HUMAN_APPROVAL_TECHNICAL_REQUIRED');
    const technical = JSON.parse(
      new LocalEvidenceStorage(process.env.LOCAL_MEDIA_EVIDENCE_ROOT!)
        .read(automatic.evidence.provenance.contentHash, 'json')
        .toString('utf8'),
    );
    const report = await HumanApprovalService.reviewTemporal({
      input,
      principal,
      asset,
      reference,
      automatic,
      technical,
      referenceTechnical,
    });
    const audit = report.evidence.provenance.parameters.humanReview;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(
          `SELECT artifact_id FROM p4_artifacts WHERE kind='qc_report'
        AND json_extract(payload_json,'$.evidence.provenance.parameters.humanReview.decisionKey')=? LIMIT 1`,
        )
        .get(audit.decisionKey);
      if (row) {
        const prior = getP4(this, 'qc_report', row.artifact_id);
        if (
          prior.evidence.provenance.parameters.humanReview.requestHash !==
          audit.requestHash
        )
          p4Fail('HUMAN_APPROVAL_DECISION_CONFLICT');
        validateCurrentTemporalQC(this, prior, report.identity);
        this.db.exec('COMMIT');
        return prior;
      }
      this.db
        .prepare(
          'INSERT INTO p4_artifacts(kind,artifact_id,identity_hash,pipeline_run_id,payload_json) VALUES (?,?,?,?,?)',
        )
        .run(
          'qc_report',
          report.qualityControlReportId,
          adaptationHash(report),
          asset!.pipelineRunId,
          JSON.stringify(report),
        );
      this.db.exec('COMMIT');
      return report;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async evaluateTemporalMedia(mediaAssetId: string, automaticOnly = false) {
    // Read via the existing Media validator, including persisted identity integrity.
    const asset = this.getMediaAsset(mediaAssetId);
    if (!asset || asset.assetType !== 'VIDEO')
      p4Fail('TEMPORAL_VIDEO_REQUIRED');
    const identity: TemporalMediaIdentity = {
      mediaAssetId: asset.mediaAssetId,
      mediaReference: asset.mediaReference,
      contentHash: asset.contentHash,
      scriptContentHash: asset.scriptContentHash,
      visualDirectionPosition: asset.visualDirectionPosition,
    };
    mediaIdentityHash(identity.mediaReference, identity.contentHash);
    const validator = this.temporalValidator;
    if (
      validator &&
      (!validator.id.trim() ||
        !validator.version.trim() ||
        validator.id === asset.provider ||
        validator.id === 'fal_ai')
    )
      p4Fail('TEMPORAL_INDEPENDENT_VALIDATOR_REQUIRED');
    const evidence = validateTemporalEvidence(
      validator
        ? await validator.evaluate(Object.freeze({ ...identity }))
        : {
            mediaReference: identity.mediaReference,
            contentHash: identity.contentHash,
            motion: 'NOT_VALIDATED',
            continuity: 'NOT_VALIDATED',
            fidelity: 'NOT_VALIDATED',
            motionBasis: 'UNKNOWN',
            provenance: null,
          },
      identity,
    );
    if (
      validator &&
      (evidence.provenance?.validator !== validator.id ||
        evidence.provenance.version !== validator.version)
    )
      p4Fail('TEMPORAL_VALIDATOR_MISMATCH');
    const report = {
      schemaVersion: 'temporal-quality-control/1.0.0',
      qualityControlReportId: temporalReportId(identity, evidence),
      identity,
      evidence,
      result: temporalResult(evidence),
      contentHash: '',
    };
    report.contentHash = p4ReportHash(report);
    validateTemporalReport(report, identity);
    const prior = getP4(this, 'qc_report', report.qualityControlReportId);
    if (prior) {
      validateTemporalReport(prior, identity);
      if (prior.contentHash !== report.contentHash)
        p4Fail('TEMPORAL_REPORT_CONFLICT');
      return !automaticOnly && validator?.id === 'offline-temporal-ffmpeg'
        ? getTemporalQC(this, identity)
        : prior;
    }
    this.db
      .prepare(
        'INSERT OR IGNORE INTO p4_artifacts (kind,artifact_id,identity_hash,pipeline_run_id,payload_json) VALUES (?,?,?,?,?)',
      )
      .run(
        'qc_report',
        report.qualityControlReportId,
        adaptationHash(report),
        asset.pipelineRunId,
        JSON.stringify(report),
      );
    return validateTemporalReport(
      getP4(this, 'qc_report', report.qualityControlReportId),
      identity,
    );
  }
  getTemporalMediaQC(identity: TemporalMediaIdentity) {
    return getTemporalQC(this, identity);
  }
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
