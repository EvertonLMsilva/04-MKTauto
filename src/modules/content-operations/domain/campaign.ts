export const campaignStates = [
  'SCHEDULED',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_RECONCILIATION',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type CampaignStatus = (typeof campaignStates)[number];
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, sort(v)]),
      );
    return input;
  };
  return JSON.stringify(sort(value));
}
export class CampaignError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function instant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new CampaignError('INVALID_TIMESTAMP');
  return new Date(value).toISOString();
}
export function productionDate(
  value: string,
  timeZone = 'America/Sao_Paulo',
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant(value)));
}
export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{2,199}$/.test(value)
  )
    throw new CampaignError('INVALID_IDENTIFIER');
  return value;
}
export interface ScheduleIdentity {
  campaignId: string;
  campaignRevision: number;
  scheduledAt: string;
  runId: string;
}
export interface CampaignExecution {
  execution_id: string;
  campaign_id: string;
  campaign_revision: number;
  production_date: string;
  scheduled_at: string;
  run_id: string;
  status: CampaignStatus;
  version: number;
  claim_token: string | null;
  claim_expires_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface CampaignEvent {
  sequence: number;
  event_type: string;
  previous_status: CampaignStatus | null;
  next_status: CampaignStatus;
  occurred_at: string;
  evidence: Record<string, unknown>;
}
