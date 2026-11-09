import { CampaignError, instant, productionDate } from './campaign.js';

export interface DailySchedule {
  schemaVersion: 'campaign-daily-schedule/1.0.0';
  time: string;
  timeZone: string;
}

export function dailySchedule(value: unknown): DailySchedule {
  const v = value as Partial<DailySchedule> | null;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (key) => !['schemaVersion', 'time', 'timeZone'].includes(key),
    ) ||
    (v.schemaVersion !== undefined &&
      v.schemaVersion !== 'campaign-daily-schedule/1.0.0') ||
    typeof v.time !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time) ||
    typeof v.timeZone !== 'string' ||
    !v.timeZone ||
    v.timeZone.length > 100
  )
    throw new CampaignError('INVALID_CAMPAIGN_SCHEDULE');
  try {
    new Intl.DateTimeFormat('en', { timeZone: v.timeZone });
  } catch {
    throw new CampaignError('INVALID_CAMPAIGN_SCHEDULE');
  }
  return {
    schemaVersion: 'campaign-daily-schedule/1.0.0',
    time: v.time,
    timeZone: v.timeZone,
  };
}

function clock(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function civilInstant(
  day: string,
  time: string,
  timeZone: string,
): string | null {
  const target = Date.parse(`${day}T${time}Z`),
    formatter = clock(timeZone);
  const offsets = new Set<number>();
  // Sample both sides of zone transitions. A fold chooses its earliest instant;
  // a gap has no matching instant and is skipped, never shifted silently.
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = new Date(target + hours * 3600000).toISOString();
    offsets.add(
      Date.parse(
        `${productionDate(sample, timeZone)}T${formatter.format(new Date(sample))}.${sample.slice(20, 23)}Z`,
      ) - Date.parse(sample),
    );
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target - offset).toISOString())
    .filter(
      (at) =>
        productionDate(at, timeZone) === day &&
        `${formatter.format(new Date(at))}.${at.slice(20, 23)}` === time,
    )
    .sort();
  return candidates[0] ?? null;
}

export function initialOccurrence(
  requestedAt: string,
  schedule: DailySchedule,
): string {
  const at = civilInstant(
    productionDate(requestedAt, schedule.timeZone),
    `${schedule.time}:00.000`,
    schedule.timeZone,
  );
  if (!at) throw new CampaignError('CAMPAIGN_SCHEDULE_NONEXISTENT_TIME');
  return at;
}

// Only today's due occurrence; never backfill an unattended backlog.
export function dailyOccurrence(
  seed: string,
  now: string,
  value?: DailySchedule,
): string | null {
  const schedule = value ? dailySchedule(value) : undefined;
  const zone = schedule?.timeZone ?? 'America/Sao_Paulo';
  const day = productionDate(now, zone);
  if (day <= productionDate(seed, zone)) return null;
  const time = schedule
    ? `${schedule.time}:00.000`
    : `${clock(zone).format(new Date(instant(seed)))}.${instant(seed).slice(20, 23)}`;
  const at = civilInstant(day, time, zone);
  return at && at <= instant(now) ? at : null;
}
