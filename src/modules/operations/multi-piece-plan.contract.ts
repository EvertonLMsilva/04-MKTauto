import { createHash } from 'node:crypto';
import {
  canonicalJson,
  identifier,
  instant,
} from '../content-operations/domain/campaign.js';
import {
  multiPieceCalendarInput,
  type MultiPieceCalendarInput,
} from './multi-piece-calendar.contract.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';
import type { ProjectSnapshotReader } from '../project/application/ports/project-snapshot-reader.port.js';
import type { AffiliateService } from '../affiliate/application/affiliate.service.js';

export const MULTI_PIECE_RECEIPT_VERSION =
  'operations-multi-piece-plan-receipt/1.0.0' as const;
export type MultiPiecePlan = ReturnType<typeof planMultiPieceCalendar>;
export interface MultiPiecePlanIdentityReaders {
  projects: ProjectSnapshotReader;
  campaigns: Pick<AffiliateService, 'getCampaign'>;
}
export interface MultiPiecePlanRegistration {
  requestId: string;
  input: MultiPieceCalendarInput;
  plan: MultiPiecePlan;
}
export interface MultiPiecePlanReceipt {
  schemaVersion: typeof MULTI_PIECE_RECEIPT_VERSION;
  originalSchemaVersion: MultiPiecePlan['schemaVersion'];
  planHash: string;
  requestIdentity: { projectId: string; requestId: string };
  createdAt: string;
  planCreatedAt: string;
  plan: MultiPiecePlan;
  executionAllowed: false;
  schedulerStarted: false;
  budgetReserved: false;
  publicationAuthorized: false;
}
export interface StoredMultiPiecePlan {
  input: MultiPieceCalendarInput;
  plan: MultiPiecePlan;
  createdAt: string;
  receipts: MultiPiecePlanReceipt[];
}
export class MultiPiecePlanError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(code, cause === undefined ? undefined : { cause });
  }
}
export const planRecordHash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function multiPieceRegistration(
  raw: unknown,
): MultiPiecePlanRegistration {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'input,plan,requestId'
  )
    throw new MultiPiecePlanError('MULTI_PIECE_REQUEST_INVALID');
  const value = raw as Record<string, unknown>;
  let requestId: string, input: MultiPieceCalendarInput;
  try {
    requestId = identifier(value.requestId);
    input = multiPieceCalendarInput(value.input);
  } catch (error) {
    throw new MultiPiecePlanError('MULTI_PIECE_REQUEST_INVALID', error);
  }
  const plan = planMultiPieceCalendar(input);
  try {
    if (canonicalJson(plan) !== canonicalJson(value.plan))
      throw new Error('MISMATCH');
  } catch (error) {
    throw new MultiPiecePlanError('MULTI_PIECE_PLAN_MISMATCH', error);
  }
  return { requestId, input, plan };
}
export async function resolvePlanIdentities(
  input: MultiPieceCalendarInput,
  readers?: MultiPiecePlanIdentityReaders,
) {
  if (!readers?.projects?.get || !readers.campaigns?.getCampaign)
    throw new MultiPiecePlanError('MULTI_PIECE_IDENTITY_READER_REQUIRED');
  const project = await readers.projects.get(
    input.projectId,
    input.projectVersion,
  );
  if (
    !project ||
    project.project.id !== input.projectId ||
    project.project.version !== input.projectVersion
  )
    throw new MultiPiecePlanError('MULTI_PIECE_PROJECT_NOT_RESOLVED');
  for (const expected of input.campaigns) {
    const campaign = await readers.campaigns.getCampaign(
      expected.campaignId,
      expected.campaignRevision,
    );
    if (
      !campaign ||
      campaign.campaignId !== expected.campaignId ||
      campaign.revision !== expected.campaignRevision ||
      campaign.projectId !== input.projectId
    )
      throw new MultiPiecePlanError('MULTI_PIECE_CAMPAIGN_NOT_RESOLVED');
  }
}
export function planTimestamp(raw: unknown) {
  const result = instant(raw);
  if (result !== raw) throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CORRUPT');
  return result;
}
export function planReceipt(
  plan: MultiPiecePlan,
  requestId: string,
  createdAt: string,
  planCreatedAt: string,
): MultiPiecePlanReceipt {
  identifier(requestId);
  planTimestamp(createdAt);
  planTimestamp(planCreatedAt);
  return {
    schemaVersion: MULTI_PIECE_RECEIPT_VERSION,
    originalSchemaVersion: plan.schemaVersion,
    planHash: plan.planHash,
    requestIdentity: { projectId: plan.projectId, requestId },
    createdAt,
    planCreatedAt,
    plan,
    executionAllowed: false,
    schedulerStarted: false,
    budgetReserved: false,
    publicationAuthorized: false,
  };
}
export function planRow(
  input: MultiPieceCalendarInput,
  plan: MultiPiecePlan,
  createdAt: string,
) {
  return {
    plan_hash: plan.planHash,
    schema_version: plan.schemaVersion,
    project_id: plan.projectId,
    project_version: plan.projectVersion,
    time_zone: plan.timeZone,
    start_date: plan.startDate,
    end_date: plan.endDate,
    profile: plan.profile,
    status: plan.status,
    piece_count: plan.totals.pieces,
    occurrence_count: plan.totals.occurrences,
    input_json: canonicalJson(input),
    payload_json: canonicalJson(plan),
    created_at: createdAt,
  };
}
export function pieceRows(plan: MultiPiecePlan) {
  return plan.pieces.map((piece, ordinal) => {
    const { occurrences: _occurrences, ...payload } = piece;
    return {
      plan_hash: plan.planHash,
      piece_id: piece.pieceId,
      ordinal,
      campaign_id: piece.campaignId,
      campaign_revision: piece.campaignRevision,
      content_type: piece.contentType,
      local_date: piece.localDate,
      local_time: piece.localTime,
      planned_at: piece.plannedAt,
      status: piece.status,
      payload_json: canonicalJson(payload),
    };
  });
}
export function occurrenceRows(plan: MultiPiecePlan) {
  let ordinal = 0;
  return plan.pieces.flatMap((piece) =>
    piece.occurrences.map((occurrence) => ({
      plan_hash: plan.planHash,
      occurrence_id: occurrence.occurrenceId,
      piece_id: piece.pieceId,
      ordinal: ordinal++,
      destination_id: occurrence.destinationId,
      planned_at: occurrence.plannedAt,
      status: occurrence.status,
      payload_json: canonicalJson(occurrence),
    })),
  );
}
