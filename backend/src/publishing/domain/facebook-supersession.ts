import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import type { FacebookSessionObservation } from './facebook-upload-session.js';
import { socialFail } from './social-publication-contracts.js';

export interface FacebookSupersessionRequest {
  originalOperationId: string;
  revision: number;
  decisionId: string;
  actor: string;
  reason: string;
  remoteObservation: FacebookSessionObservation;
  acceptResidualRisk: true;
  expectedVersion: number;
}
export interface FacebookSuccessorAuthorization {
  operationId: string;
  packageHash: string;
  preparationDecisionId: string;
  authorizationId: string;
  actor: string;
  authorizedAt: string;
  expiresAt: string;
  acceptResidualRisk: true;
}
export type FacebookLineageEvidence = readonly {
  operationId: string;
  version: number;
  contentHash: string;
  observation: FacebookSessionObservation;
}[];
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\r\n]/.test(value) ||
    value.includes('\0')
  )
    socialFail('SOCIAL_SUPERSESSION_INVALID');
}
export function validateSupersessionRequest(
  value: FacebookSupersessionRequest,
): FacebookSupersessionRequest {
  if (
    !value ||
    Object.keys(value).sort().join(',') !==
      'acceptResidualRisk,actor,decisionId,expectedVersion,originalOperationId,reason,remoteObservation,revision'
  )
    socialFail('SOCIAL_SUPERSESSION_INVALID');
  text(value.originalOperationId, 200);
  text(value.decisionId, 200);
  text(value.actor, 100);
  text(value.reason, 2000);
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 0 ||
    value.acceptResidualRisk !== true
  )
    socialFail('SOCIAL_SUPERSESSION_INVALID');
  const o = value.remoteObservation;
  if (
    !o ||
    Object.keys(o).sort().join(',') !==
      'bytesTransferred,createdAt,fields,graphVersion,observedAt,pageId,processingStatus,progress,publicationStatus,uploadStatus,videoId,videoStatus' ||
    !/^\d{5,64}$/.test(o.videoId) ||
    !/^\d{5,64}$/.test(o.pageId) ||
    !/^v\d{2}\.0$/.test(o.graphVersion) ||
    ![o.createdAt, o.observedAt].every((v) => Number.isFinite(Date.parse(v))) ||
    !['UNKNOWN', 'CONSISTENT', 'CONFLICT'].includes(o.progress) ||
    (o.bytesTransferred !== null &&
      (!Number.isSafeInteger(o.bytesTransferred) || o.bytesTransferred < 0))
  )
    socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
  for (const status of [
    o.videoStatus,
    o.uploadStatus,
    o.processingStatus,
    o.publicationStatus,
  ])
    if (!/^[a-z_]{1,32}$/.test(status))
      socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
  const fields = [
    'videoStatus',
    'uploadStatus',
    'bytesTransferred',
    'bytesTransfered',
    'sourceFileSize',
    'uploadErrors',
    'processingErrors',
    'publishingErrors',
    'processingStatus',
    'publicationStatus',
  ];
  if (!o.fields || Object.keys(o.fields).some((k) => !fields.includes(k)))
    socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
  for (const [k, f] of Object.entries(o.fields)) {
    if (
      !f ||
      typeof f.present !== 'boolean' ||
      Object.keys(f).sort().join(',') !==
        (f.present ? 'present,value' : 'present')
    )
      socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
    if (f.present && f.value !== null) {
      if (k.endsWith('Errors')) {
        if (
          !Array.isArray(f.value) ||
          f.value.some(
            (e) =>
              !e ||
              Object.keys(e).some(
                (k) => !['code', 'error_subcode'].includes(k),
              ) ||
              Object.values(e).some((v) => !Number.isSafeInteger(v)),
          )
        )
          socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
      } else if (
        ['bytesTransferred', 'bytesTransfered', 'sourceFileSize'].includes(k)
      ) {
        if (!Number.isSafeInteger(f.value) || Number(f.value) < 0)
          socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
      } else if (typeof f.value !== 'string' || !/^[a-z_]{1,32}$/.test(f.value))
        socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
    }
  }
  return JSON.parse(JSON.stringify(value));
}
export function observationFingerprint(o: FacebookSessionObservation) {
  const { observedAt: _time, ...body } = o;
  return affiliateHash(body);
}
export function assertSupersessionObservation(
  o: FacebookSessionObservation,
  op: any,
  history: any[],
  now: string,
) {
  const age = Date.parse(now) - Date.parse(o.observedAt),
    creation = history.find((e) => e.state === 'CREATING_CONTAINER');
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 60000 ||
    o.videoId !== op.containerId ||
    'facebook_reels:' + o.pageId !== op.accountId ||
    !creation ||
    !Number.isFinite(Date.parse(o.createdAt)) ||
    Math.abs(Date.parse(o.createdAt) - Date.parse(creation.updatedAt)) >
      30000 ||
    o.progress === 'CONFLICT' ||
    (o.bytesTransferred !== null && o.bytesTransferred !== 0) ||
    o.videoStatus !== 'uploading' ||
    !['not_started', 'in_progress'].includes(o.uploadStatus) ||
    o.processingStatus !== 'not_started' ||
    o.publicationStatus !== 'not_started' ||
    Object.entries(o.fields).some(([k, f]) => {
      if (!f.present || f.value === null) return false;
      if (k.endsWith('Errors'))
        return !Array.isArray(f.value) || f.value.length > 0;
      if (['bytesTransferred', 'bytesTransfered'].includes(k))
        return f.value !== 0;
      const statuses: Record<string, string> = {
        videoStatus: o.videoStatus,
        uploadStatus: o.uploadStatus,
        processingStatus: o.processingStatus,
        publicationStatus: o.publicationStatus,
      };
      return k in statuses && f.value !== statuses[k];
    })
  )
    socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
}
export function assertSupersessionEligible(
  op: any,
  history: any[],
  expectedVersion: number,
) {
  if (
    op.network !== 'FACEBOOK_REELS' ||
    op.version !== expectedVersion ||
    op.state !== 'PROCESSING' ||
    op.uploadStage !== 'PENDING' ||
    !op.containerId ||
    op.mediaId ||
    op.remoteReceipt ||
    op.transferEvidence ||
    op.requiresReconciliation ||
    op.uncertainStage ||
    op.uploadAudit?.length ||
    history.length !== op.version + 1 ||
    history.some((e, i) => e.version !== i) ||
    history.at(-1)?.contentHash !== op.contentHash ||
    history.filter((e) => e.state === 'CREATING_CONTAINER').length !== 1 ||
    history.some(
      (e) =>
        ['PUBLISHING', 'PUBLISHED'].includes(e.state) ||
        ['UPLOADING', 'ACKNOWLEDGED'].includes(e.uploadStage) ||
        e.remoteReceipt ||
        e.mediaId ||
        e.transferEvidence ||
        e.uploadAudit?.length,
    )
  )
    socialFail('SOCIAL_SUPERSESSION_INELIGIBLE');
}
export function assertSuccessorAuthorization(
  op: any,
  record: any,
  grant: FacebookSuccessorAuthorization | undefined,
  now: string,
) {
  if (!record) return;
  if (
    !grant ||
    Object.keys(grant).sort().join(',') !==
      'acceptResidualRisk,actor,authorizationId,authorizedAt,expiresAt,operationId,packageHash,preparationDecisionId' ||
    grant.operationId !== op.operationId ||
    grant.packageHash !== op.packageHash ||
    grant.preparationDecisionId !== record.authorization_id ||
    grant.acceptResidualRisk !== true
  )
    socialFail('SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED');
  text(grant.authorizationId, 200);
  text(grant.actor, 100);
  const authorized = Date.parse(grant.authorizedAt),
    expires = Date.parse(grant.expiresAt),
    at = Date.parse(now);
  if (
    ![authorized, expires, at].every(Number.isFinite) ||
    authorized <= Date.parse(record.superseded_at) ||
    authorized > at ||
    expires <= at ||
    expires - authorized > 600000 ||
    grant.authorizationId === record.authorization_id
  )
    socialFail('SOCIAL_SUCCESSOR_AUTHORIZATION_REQUIRED');
}
