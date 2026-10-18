import { TEMPORAL_ANALYSIS_POLICY } from './offline-temporal.validator.js';
import { campaignReviewRights } from './campaign-review-rights.js';
import { operationalQcIdentity } from '../../publishing/application/local-qc-identity.js';
import { LocalEvidenceStorage } from './local-evidence-storage.js';
import { adaptationHash } from '../domain/media-hash.js';
import { p4Fail } from '../domain/p4-qc-contracts.js';
import {
  validateTemporalReport,
  type TemporalMediaIdentity,
} from '../domain/p4-qc-contracts.js';
export function getTemporalQC(
  repository: any,
  identity: TemporalMediaIdentity,
): any {
  const row = repository.db
    .prepare(
      `SELECT artifact_id FROM p4_artifacts WHERE kind='qc_report'
    AND json_extract(payload_json,'$.schemaVersion')='temporal-quality-control/1.0.0'
    AND json_extract(payload_json,'$.identity.mediaAssetId')=?
    ORDER BY rowid DESC LIMIT 1`,
    )
    .get(identity.mediaAssetId);
  if (!row) return null;
  const report = validateTemporalReport(
    getP4(repository, 'qc_report', row.artifact_id),
    identity,
  );
  return validateCurrentTemporalQC(repository, report, identity);
}
export function validateCurrentTemporalQC(
  repository: any,
  report: any,
  identity: TemporalMediaIdentity,
): any {
  validateTemporalReport(report, identity);
  if (
    report.result === 'PASS' &&
    report.evidence.provenance?.validator !== 'authenticated-human-qc'
  )
    p4Fail('AUTHENTICATED_HUMAN_REVIEW_REQUIRED');
  if (report.evidence.provenance?.validator === 'authenticated-human-qc') {
    const parameters = report.evidence.provenance.parameters,
      audit = parameters.humanReview;
    if (
      !audit ||
      audit.schemaVersion !== 'human-temporal-review/1.0.0' ||
      Object.keys(parameters).sort().join(',') !== 'humanReview,signature' ||
      !operationalQcIdentity.verifyReview(
        audit.actor,
        audit.credentialFingerprint,
        adaptationHash(audit),
        parameters.signature,
      )
    )
      p4Fail('HUMAN_APPROVAL_REVIEW_INVALID');
    const automatic = validateTemporalReport(
      getP4(repository, 'qc_report', audit.automaticReportId),
      identity,
    );
    if (
      automatic.evidence.provenance?.validator !== 'offline-temporal-ffmpeg' ||
      automatic.evidence.provenance.version !== '1.1.0' ||
      adaptationHash(automatic.evidence.provenance.parameters.policy) !==
        adaptationHash(TEMPORAL_ANALYSIS_POLICY)
    )
      p4Fail('HUMAN_APPROVAL_REVIEW_STALE');
    if (!process.env.LOCAL_MEDIA_EVIDENCE_ROOT)
      p4Fail('HUMAN_APPROVAL_TECHNICAL_REQUIRED');
    new LocalEvidenceStorage(process.env.LOCAL_MEDIA_EVIDENCE_ROOT!).read(
      automatic.evidence.provenance.contentHash,
      'json',
    );
    const expected = audit.decision === 'APPROVED' ? 'PASS' : 'FAIL';
    if (
      !['APPROVED', 'REJECTED'].includes(audit.decision) ||
      ['motion', 'continuity', 'fidelity'].some(
        (criterion) => report.evidence[criterion] !== expected,
      ) ||
      (expected === 'PASS' &&
        (automatic.result === 'FAIL' ||
          report.evidence.motionBasis !== 'SUBJECT_MOTION')) ||
      report.evidence.provenance.version !== '1.0.0' ||
      report.evidence.provenance.contentHash !== adaptationHash(audit) ||
      report.evidence.provenance.reference !==
        'human-review:sha256_' + adaptationHash(audit)
    )
      p4Fail('HUMAN_APPROVAL_REVIEW_INVALID');
    const asset = repository.getMediaAsset(identity.mediaAssetId),
      reference = repository.getMediaAsset(audit.referenceImage.mediaAssetId);
    if (
      automatic.contentHash !== audit.automaticReportHash ||
      !asset ||
      asset.revision !== audit.assetRevision ||
      adaptationHash(asset.rights) !== audit.assetRightsHash ||
      !reference ||
      audit.referenceTechnical?.schemaVersion !==
        'reference-image-analysis/1.0.0' ||
      audit.referenceTechnical.contentHash !== reference.contentHash ||
      audit.referenceTechnical.validator !== 'offline-temporal-ffmpeg' ||
      audit.referenceTechnical.version !== '1.1.0' ||
      audit.referenceTechnical.policyHash !==
        adaptationHash(TEMPORAL_ANALYSIS_POLICY) ||
      audit.referenceTechnical.width !==
        reference.technicalProperties.widthPixels ||
      audit.referenceTechnical.height !==
        reference.technicalProperties.heightPixels ||
      !/^[a-f0-9]{64}$/.test(audit.referenceTechnical.frameHash) ||
      reference.revision !== audit.referenceImage.revision ||
      reference.contentHash !== audit.referenceImage.contentHash ||
      adaptationHash(reference.rights) !== audit.referenceRightsHash
    )
      p4Fail('HUMAN_APPROVAL_REVIEW_STALE');
    const currentScope = campaignReviewRights(repository, asset, reference);
    if (
      adaptationHash({ scope: currentScope }) !==
      adaptationHash({ scope: audit.rightsScope ?? null })
    )
      p4Fail('HUMAN_APPROVAL_REVIEW_STALE');
    if (!process.env.FFMPEG_MEDIA_ROOT)
      p4Fail('HUMAN_APPROVAL_TECHNICAL_REQUIRED');
    const storage = new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!);
    storage.read(identity.contentHash, 'mp4', 33554432);
    storage.read(reference.contentHash, 'png', 33554432);
  }
  return report;
}
export function getP4(repository: any, kind: any, id: any): any {
  const row = repository.db
    .prepare(
      'SELECT identity_hash,payload_json FROM p4_artifacts WHERE kind=? AND artifact_id=?',
    )
    .get(kind, id);
  if (!row) return null;
  const value = JSON.parse(row.payload_json);
  if (adaptationHash(value) !== row.identity_hash)
    p4Fail('P4_PERSISTED_INTEGRITY_INVALID');
  return Object.freeze(value);
}
