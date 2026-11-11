import { createHash } from 'node:crypto';
import {
  CampaignError,
  canonicalJson,
  identifier,
  instant,
} from './campaign.js';
import type { CampaignExecution } from './campaign.js';
import { dailySchedule } from './campaign-schedule.js';

/** Server-owned namespace: generated only by the controlled command, never
 * inferred for ordinary legacy runs. The unique run_id binds the policy to
 * the execution UUID assigned atomically by CampaignRepository. */
export const CONTROLLED_FAKE_RUN_PREFIX = 'run_controlled_fake_v1_';
export interface FakeExecutionPolicy {
  readonly schemaVersion: 'campaign-fake-policy/1.0.0';
  readonly mode: 'FAKE';
  readonly commandId: string;
  readonly actorId: string;
  readonly campaignId: string;
  readonly campaignRevision: number;
  readonly runId: string;
  readonly scheduledAt: string;
  readonly requestHash: string;
  readonly providers: 'LOCAL_ONLY';
  readonly publication: 'DISABLED';
}
const fields =
  'actorId,campaignId,campaignRevision,commandId,mode,providers,publication,requestHash,runId,scheduledAt,schemaVersion';
const fail = (code = 'FAKE_EXECUTION_POLICY_INVALID'): never => {
  throw new CampaignError(code);
};
function requestHash(request: Record<string, unknown>) {
  const { fakeExecutionPolicy: _policy, ...body } = request;
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
function safeShape(request: Record<string, unknown>) {
  if (Object.hasOwn(request, 'schedule')) dailySchedule(request.schedule);
  const production = request.videoProduction as
    Record<string, unknown> | undefined;
  if (
    request.mode !== 'LOCAL_VALIDATION' ||
    !request.localImage ||
    production?.mode !== 'LOCAL_IMAGES' ||
    Object.keys(production).join(',') !== 'mode' ||
    [
      'publication',
      'catalogSelection',
      'selectionMode',
      'legacyRecovery',
      'sceneMediaAssetIds',
      'voiceTrackId',
      'scriptId',
      'audioMode',
      'audio',
      'alignment',
      'composition',
    ].some((key) => Object.hasOwn(request, key))
  )
    fail('FAKE_EXECUTION_INPUT_FORBIDDEN');
}
export function createFakeExecutionPolicy(
  request: Record<string, unknown>,
  commandId: string,
  actorId: string,
): FakeExecutionPolicy {
  safeShape(request);
  identifier(commandId);
  identifier(actorId);
  identifier(request.campaignId);
  identifier(request.runId);
  if (
    !String(request.runId).startsWith(CONTROLLED_FAKE_RUN_PREFIX) ||
    !Number.isSafeInteger(request.campaignRevision) ||
    Number(request.campaignRevision) < 1
  )
    return fail();
  return Object.freeze({
    schemaVersion: 'campaign-fake-policy/1.0.0',
    mode: 'FAKE',
    commandId,
    actorId,
    campaignId: String(request.campaignId),
    campaignRevision: Number(request.campaignRevision),
    runId: String(request.runId),
    scheduledAt: instant(request.scheduledAt),
    requestHash: requestHash(request),
    providers: 'LOCAL_ONLY',
    publication: 'DISABLED',
  });
}
export function assertFakeExecutionPolicy(
  request: Record<string, unknown>,
  execution?: Pick<
    CampaignExecution,
    'campaign_id' | 'campaign_revision' | 'run_id' | 'scheduled_at'
  >,
): FakeExecutionPolicy | null {
  if (!Object.hasOwn(request, 'fakeExecutionPolicy')) {
    if (
      String(request.runId).startsWith(CONTROLLED_FAKE_RUN_PREFIX) ||
      String(execution?.run_id ?? '').startsWith(CONTROLLED_FAKE_RUN_PREFIX)
    )
      return fail('FAKE_EXECUTION_POLICY_REQUIRED');
    return null;
  }
  const value = request.fakeExecutionPolicy;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== fields
  )
    return fail();
  const p = value as FakeExecutionPolicy;
  if (
    p.schemaVersion !== 'campaign-fake-policy/1.0.0' ||
    p.mode !== 'FAKE' ||
    p.providers !== 'LOCAL_ONLY' ||
    p.publication !== 'DISABLED'
  )
    return fail();
  const expected = createFakeExecutionPolicy(request, p.commandId, p.actorId);
  if (canonicalJson(expected) !== canonicalJson(p)) return fail();
  if (
    execution &&
    (p.campaignId !== execution.campaign_id ||
      p.campaignRevision !== execution.campaign_revision ||
      p.runId !== execution.run_id ||
      p.scheduledAt !== execution.scheduled_at)
  )
    return fail('FAKE_EXECUTION_IDENTITY_MISMATCH');
  return expected;
}
