import { adaptationHash } from './domain/video-adaptation-contracts.js';
import { validateAudioConfig, p4Fail } from './domain/p4-video-contracts.js';

export function getP4(repository, kind, id) {
  const row = repository.db.prepare('SELECT identity_hash,payload_json FROM p4_artifacts WHERE kind=? AND artifact_id=?').get(kind,id);
  if (!row) return null;
  const value = JSON.parse(row.payload_json); if (adaptationHash(value) !== row.identity_hash) p4Fail('P4_PERSISTED_INTEGRITY_INVALID');
  return Object.freeze(value);
}
export function putP4(repository, kind, id, value, runId = null) {
  const prior = getP4(repository,kind,id);
  if (prior) { if (adaptationHash(prior)!==adaptationHash(value)) p4Fail('P4_IDENTITY_CONFLICT'); return prior; }
  repository.db.prepare('INSERT INTO p4_artifacts VALUES (?,?,?,?,?)').run(kind,id,adaptationHash(value),runId,JSON.stringify(value));
  return getP4(repository,kind,id);
}
export function registerAudioConfig(repository, value) {
  const config=validateAudioConfig(value);
  if (!repository.db.prepare('SELECT 1 FROM affiliate_campaign_revisions WHERE campaign_id=?').get(config.campaignId)) p4Fail('P4_CAMPAIGN_NOT_FOUND');
  const prior=repository.db.prepare("SELECT artifact_id FROM p4_artifacts WHERE kind='audio_config' AND json_extract(payload_json,'$.campaignId')=? AND json_extract(payload_json,'$.revision')=?").get(config.campaignId,config.revision);
  const id=`audio_config:${adaptationHash(config)}`;
  if (prior && prior.artifact_id!==id) p4Fail('P4_AUDIO_REVISION_CONFLICT');
  putP4(repository,'audio_config',id,config); return { id, contentHash:adaptationHash(config), config };
}
