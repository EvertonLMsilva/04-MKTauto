import { identifier } from '../content-operations/domain/campaign.js';
import { dailySchedule } from '../content-operations/domain/campaign-schedule.js';

export const MULTI_PIECE_CALENDAR_VERSION =
  'operations-multi-piece-calendar/1.0.0' as const;
export const MULTI_PIECE_PROFILE = 'FOUR_WEEK_MULTI_PIECE' as const;
export type CalendarContentType = 'VIDEO' | 'IMAGE';
export interface MultiPieceCalendarInput {
  schemaVersion: typeof MULTI_PIECE_CALENDAR_VERSION;
  profile: typeof MULTI_PIECE_PROFILE;
  projectId: string;
  projectVersion: number;
  timeZone: string;
  startDate: string;
  durationWeeks: 4;
  weeklyGoals: { VIDEO: 1; IMAGE: 10 };
  campaigns: {
    campaignId: string;
    campaignRevision: number;
    destinations: string[];
    preferredTimes: Record<CalendarContentType, string[]>;
  }[];
}
export type CalendarBlocker =
  | 'NONEXISTENT_LOCAL_TIME'
  | 'AMBIGUOUS_LOCAL_TIME'
  | 'PREFERRED_TIME_CAPACITY_INSUFFICIENT'
  | 'DESTINATION_CONFLICT';
export interface CalendarOccurrence {
  occurrenceId: string;
  destinationId: string;
  plannedAt: string | null;
  status: 'PLANNED' | 'BLOCKED';
  blockers: CalendarBlocker[];
}
export interface CalendarPiece {
  projectId: string;
  projectVersion: number;
  campaignId: string;
  campaignRevision: number;
  pieceId: string;
  contentType: CalendarContentType;
  week: number;
  ordinalInWeek: number;
  localDate: string;
  localTime: string | null;
  plannedAt: string | null;
  candidateInstants: string[];
  status: 'PLANNED' | 'BLOCKED';
  blockers: CalendarBlocker[];
  occurrences: CalendarOccurrence[];
}
export const calendarCompare = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
export const calendarDay = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
function invalid(): never {
  throw new Error('INVALID_MULTI_PIECE_CALENDAR');
}
function exact(
  raw: unknown,
  keys: string[],
): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== [...keys].sort().join(',')
  )
    invalid();
}
function positive(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
}
export function multiPieceCalendarInput(raw: unknown): MultiPieceCalendarInput {
  try {
    exact(raw, [
      'schemaVersion',
      'profile',
      'projectId',
      'projectVersion',
      'timeZone',
      'startDate',
      'durationWeeks',
      'weeklyGoals',
      'campaigns',
    ]);
    if (
      raw.schemaVersion !== MULTI_PIECE_CALENDAR_VERSION ||
      raw.profile !== MULTI_PIECE_PROFILE ||
      raw.durationWeeks !== 4
    )
      invalid();
    const projectId = identifier(raw.projectId);
    positive(raw.projectVersion);
    exact(raw.weeklyGoals, ['VIDEO', 'IMAGE']);
    if (raw.weeklyGoals.VIDEO !== 1 || raw.weeklyGoals.IMAGE !== 10) invalid();
    if (
      typeof raw.startDate !== 'string' ||
      !/^[0-9]{4}-\d{2}-\d{2}$/.test(raw.startDate) ||
      raw.startDate.startsWith('0000') ||
      !Number.isFinite(Date.parse(`${raw.startDate}T00:00:00Z`)) ||
      calendarDay(raw.startDate, 0) !== raw.startDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(calendarDay(raw.startDate, 27))
    )
      invalid();
    const zone = dailySchedule({
      time: '00:00',
      timeZone: raw.timeZone,
    }).timeZone;
    const timeZone = new Intl.DateTimeFormat('en', {
      timeZone: zone,
    }).resolvedOptions().timeZone;
    if (
      !Array.isArray(raw.campaigns) ||
      !raw.campaigns.length ||
      raw.campaigns.length > 100
    )
      invalid();
    const seen = new Set<string>();
    const campaigns = raw.campaigns
      .map((value) => {
        exact(value, [
          'campaignId',
          'campaignRevision',
          'destinations',
          'preferredTimes',
        ]);
        const campaignId = identifier(value.campaignId);
        positive(value.campaignRevision);
        if (seen.has(campaignId)) invalid();
        seen.add(campaignId);
        if (
          !Array.isArray(value.destinations) ||
          !value.destinations.length ||
          value.destinations.length > 20
        )
          invalid();
        const destinations = value.destinations
          .map(identifier)
          .sort(calendarCompare);
        if (new Set(destinations).size !== destinations.length) invalid();
        exact(value.preferredTimes, ['VIDEO', 'IMAGE']);
        const times = (contentType: CalendarContentType) => {
          const list = (value.preferredTimes as Record<string, unknown>)[
            contentType
          ];
          if (!Array.isArray(list) || !list.length || list.length > 24)
            invalid();
          const result = list
            .map((time) => dailySchedule({ time, timeZone }).time)
            .sort(calendarCompare);
          if (new Set(result).size !== result.length) invalid();
          return result;
        };
        return {
          campaignId,
          campaignRevision: value.campaignRevision,
          destinations,
          preferredTimes: { VIDEO: times('VIDEO'), IMAGE: times('IMAGE') },
        };
      })
      .sort((a, b) => calendarCompare(a.campaignId, b.campaignId));
    return {
      schemaVersion: MULTI_PIECE_CALENDAR_VERSION,
      profile: MULTI_PIECE_PROFILE,
      projectId,
      projectVersion: raw.projectVersion,
      timeZone,
      startDate: raw.startDate,
      durationWeeks: 4,
      weeklyGoals: { VIDEO: 1, IMAGE: 10 },
      campaigns,
    };
  } catch {
    return invalid();
  }
}
