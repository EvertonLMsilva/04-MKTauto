import {
  CampaignError,
  identifier,
} from '../content-operations/domain/campaign.js';
import {
  validateAffiliateCampaign,
  affiliateIdentifier,
} from '../affiliate/domain/affiliate-contracts.js';
import {
  localRequestInput,
  localSchedule,
} from '../content-operations/application/native-campaign-workflow.js';
import { assertMediaProcessingRights } from '../media/domain/media-processing-rights.js';
import type { LocalImageSource } from '../media/application/local-flow.port.js';

const imageOrigins: readonly LocalImageSource['origin'][] = [
  'OPERATOR_OWNED',
  'AUTHORIZED_THIRD_PARTY',
];
const usageBases: readonly LocalImageSource['rights']['usageBasis'][] = [
  'OWNED',
  'LICENSED',
  'EXPLICIT_PERMISSION',
];

export const FAKE_COMMAND_RESULT_VERSION = 'fake-campaign-command-result/1.0.0';
function exact(value: unknown, keys: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys
  )
    throw new CampaignError('FAKE_COMMAND_PAYLOAD_INVALID');
  return value as Record<string, unknown>;
}
function confirmed(value: unknown, keys: string) {
  const input = exact(value, keys);
  if (input.mode !== 'FAKE' || input.confirmation !== true)
    throw new CampaignError('FAKE_COMMAND_CONFIRMATION_REQUIRED');
  return input;
}
/** Registration delegates the exact official Affiliate DTO; it does not create
 * products, projects, sources, executions or publication authorizations. */
export function registerFakeCampaignInput(value: unknown) {
  const input = confirmed(value, 'campaign,confirmation,idempotencyKey,mode');
  return {
    idempotencyKey: affiliateIdentifier(input.idempotencyKey, 'idempotencyKey'),
    campaign: validateAffiliateCampaign(input.campaign),
  };
}
/** Single-shot preparation, using only an already-authorized local image.
 * No policy, provider, account, recurrence or effective mode comes from JSON. */
export function controlledFakeInput(value: unknown) {
  const input = confirmed(value, 'confirmation,mode,request');
  const r = exact(
    input.request,
    'campaignId,campaignRevision,localImage,projectVersion,requestId,requestedAt',
  );
  localRequestInput(r);
  affiliateIdentifier(r.campaignId, 'campaignId');
  identifier(r.requestId);
  const image = exact(
    r.localImage,
    'contentHash,mediaReference,origin,provider,rights',
  );
  if (
    typeof image.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(image.contentHash) ||
    typeof image.mediaReference !== 'string' ||
    !image.mediaReference.trim() ||
    image.mediaReference.length > 2048 ||
    !imageOrigins.some((origin) => origin === image.origin) ||
    image.provider !== null
  )
    throw new CampaignError('FAKE_COMMAND_LOCAL_IMAGE_INVALID');
  const rights = exact(
    image.rights,
    'commercialUseAllowed,evidence,usageBasis',
  );
  if (
    rights.commercialUseAllowed !== true ||
    !usageBases.some((basis) => basis === rights.usageBasis)
  )
    throw new CampaignError('FAKE_COMMAND_LOCAL_IMAGE_INVALID');
  assertMediaProcessingRights(
    rights.evidence,
    { mediaRef: image.mediaReference, contentHash: image.contentHash },
    null,
  );
  return r;
}
/** Separate opt-in command; the single-occurrence DTO never accepts recurrence. */
export function controlledFakeRecurrenceInput(value: unknown) {
  const input = confirmed(value, 'confirmation,mode,request');
  const r = exact(
    input.request,
    'campaignId,campaignRevision,localImage,projectVersion,recurrence,requestId,requestedAt',
  );
  exact(r.recurrence, 'enabled,time,timeZone');
  localRequestInput(r);
  if (!localSchedule(r))
    throw new CampaignError('FAKE_RECURRENCE_SCHEDULE_REQUIRED');
  const { recurrence: _recurrence, ...single } = r;
  controlledFakeInput({
    mode: input.mode,
    confirmation: input.confirmation,
    request: single,
  });
  return r;
}
/** Optimistic concurrency uses the official execution version. An ambiguous
 * resume must be followed by GET; an old version never queues another attempt. */
export function controlledFakeResumeInput(value: unknown) {
  const input = confirmed(value, 'confirmation,expectedVersion,mode');
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1
  )
    throw new CampaignError('INVALID_EXECUTION_VERSION');
  return Number(input.expectedVersion);
}
