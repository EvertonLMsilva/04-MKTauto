import { adaptationHash } from '../domain/media-hash.js';
import { p4Fail } from '../domain/p4-qc-contracts.js';
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
