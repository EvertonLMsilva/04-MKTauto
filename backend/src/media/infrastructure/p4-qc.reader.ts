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
  return validateTemporalReport(
    getP4(repository, 'qc_report', row.artifact_id),
    identity,
  );
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
