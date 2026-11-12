import { createHash } from 'node:crypto';
import { canonicalJson } from '../content-operations/domain/campaign.js';
import {
  multiPieceCalendarInput,
  calendarDay,
  calendarCompare,
  type CalendarBlocker,
  type CalendarPiece,
  type CalendarOccurrence,
} from './multi-piece-calendar.contract.js';

const hash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
function civilResolver(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const civil = (epoch: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(epoch)).map((p) => [p.type, p.value]),
    );
    return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const cache = new Map<string, string[]>();
  return (date: string, time: string) => {
    const target = `${date}T${time}:00`,
      epoch = Date.parse(`${target}Z`);
    const cached = cache.get(target);
    if (cached) return [...cached];
    const offsets = new Set<number>();
    // Observe both sides of transitions, including half-hour shifts and skipped
    // local dates. A round-trip proves each candidate; folds and gaps are blocked.
    for (let hours = -48; hours <= 48; hours += 6) {
      const sample = epoch + hours * 3600000;
      const offset = Date.parse(`${civil(sample)}Z`) - sample;
      // A sample can cross the four-digit ISO year boundary; it is not a
      // candidate offset. Other samples still cover the requested valid date.
      if (Number.isFinite(offset)) offsets.add(offset);
    }
    const candidates = [
      ...new Set([...offsets].map((offset) => epoch - offset)),
    ]
      .filter((candidate) => civil(candidate) === target)
      .sort((a, b) => a - b)
      .map((candidate) => new Date(candidate).toISOString());
    cache.set(target, candidates);
    return [...candidates];
  };
}

/** Pure opt-in calculation. Each week is seven local dates from startDate.
 * VIDEO uses day 0. IMAGE i uses floor(i*7/10); its per-day slot selects the
 * chronologically sorted preferred time. Missing slots are blocked, never shifted.
 * Destinations fan out occurrences without increasing the number of content pieces.
 */
export function planMultiPieceCalendar(raw: unknown) {
  const input = multiPieceCalendarInput(raw),
    resolve = civilResolver(input.timeZone);
  const pieces: CalendarPiece[] = [];
  for (const campaign of input.campaigns)
    for (let week = 1; week <= 4; week++) {
      for (const contentType of ['VIDEO', 'IMAGE'] as const) {
        const perDay = new Map<number, number>(),
          goal = input.weeklyGoals[contentType];
        for (let index = 0; index < goal; index++) {
          const dayOffset = Math.floor((index * 7) / goal),
            slot = perDay.get(dayOffset) ?? 0;
          perDay.set(dayOffset, slot + 1);
          const localDate = calendarDay(
            input.startDate,
            (week - 1) * 7 + dayOffset,
          );
          const localTime = campaign.preferredTimes[contentType][slot] ?? null;
          const candidateInstants =
            localTime === null ? [] : resolve(localDate, localTime);
          const blockers: CalendarBlocker[] =
            localTime === null
              ? ['PREFERRED_TIME_CAPACITY_INSUFFICIENT']
              : candidateInstants.length === 0
                ? ['NONEXISTENT_LOCAL_TIME']
                : candidateInstants.length > 1
                  ? ['AMBIGUOUS_LOCAL_TIME']
                  : [];
          const plannedAt = blockers.length ? null : candidateInstants[0];
          const pieceId = `piece_${hash({
            schemaVersion: input.schemaVersion,
            profile: input.profile,
            projectId: input.projectId,
            projectVersion: input.projectVersion,
            campaignId: campaign.campaignId,
            campaignRevision: campaign.campaignRevision,
            startDate: input.startDate,
            contentType,
            week,
            ordinalInWeek: index + 1,
          })}`;
          const occurrences: CalendarOccurrence[] = campaign.destinations.map(
            (destinationId) => ({
              occurrenceId: `occ_${hash({ pieceId, destinationId, timeZone: input.timeZone, localDate, localTime, plannedAt, candidateInstants })}`,
              destinationId,
              plannedAt,
              status: blockers.length ? 'BLOCKED' : 'PLANNED',
              blockers: [...blockers],
            }),
          );
          pieces.push({
            projectId: input.projectId,
            projectVersion: input.projectVersion,
            campaignId: campaign.campaignId,
            campaignRevision: campaign.campaignRevision,
            pieceId,
            contentType,
            week,
            ordinalInWeek: index + 1,
            localDate,
            localTime,
            plannedAt,
            candidateInstants,
            status: blockers.length ? 'BLOCKED' : 'PLANNED',
            blockers: [...blockers],
            occurrences,
          });
        }
      }
    }
  const destinations = new Map<string, CalendarOccurrence[]>();
  for (const piece of pieces)
    for (const occurrence of piece.occurrences) {
      if (!occurrence.plannedAt) continue;
      const key = canonicalJson([
        occurrence.destinationId,
        occurrence.plannedAt,
      ]);
      const group = destinations.get(key) ?? [];
      group.push(occurrence);
      destinations.set(key, group);
    }
  for (const group of destinations.values())
    if (group.length > 1)
      for (const occurrence of group) {
        occurrence.status = 'BLOCKED';
        occurrence.blockers.push('DESTINATION_CONFLICT');
      }
  for (const piece of pieces) {
    piece.blockers = [
      ...new Set(piece.occurrences.flatMap((o) => o.blockers)),
    ].sort(calendarCompare);
    piece.status = piece.blockers.length ? 'BLOCKED' : 'PLANNED';
  }
  pieces.sort(
    (a, b) =>
      calendarCompare(a.localDate, b.localDate) ||
      calendarCompare(a.localTime ?? '', b.localTime ?? '') ||
      calendarCompare(a.campaignId, b.campaignId) ||
      calendarCompare(a.contentType, b.contentType) ||
      a.ordinalInWeek - b.ordinalInWeek,
  );
  const occurrences = pieces.flatMap((p) => p.occurrences);
  const blockers = (
    [
      'NONEXISTENT_LOCAL_TIME',
      'AMBIGUOUS_LOCAL_TIME',
      'PREFERRED_TIME_CAPACITY_INSUFFICIENT',
      'DESTINATION_CONFLICT',
    ] as const
  )
    .map((code) => ({
      code,
      occurrenceIds: occurrences
        .filter((o) => o.blockers.includes(code))
        .map((o) => o.occurrenceId),
    }))
    .filter((group) => group.occurrenceIds.length);
  const result = {
    schemaVersion: input.schemaVersion,
    profile: input.profile,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    timeZone: input.timeZone,
    startDate: input.startDate,
    endDate: calendarDay(input.startDate, 27),
    durationWeeks: input.durationWeeks,
    weeklyGoals: input.weeklyGoals,
    campaignGoals: { VIDEO: 4, IMAGE: 40 },
    distributionPolicy: 'EVEN_SEVEN_LOCAL_DAYS_V1',
    timeZonePolicy: 'REJECT_AMBIGUOUS_AND_NONEXISTENT',
    status: blockers.length ? ('BLOCKED' as const) : ('PLANNED' as const),
    pieces,
    blockers,
    totals: {
      campaigns: input.campaigns.length,
      VIDEO: pieces.filter((p) => p.contentType === 'VIDEO').length,
      IMAGE: pieces.filter((p) => p.contentType === 'IMAGE').length,
      pieces: pieces.length,
      occurrences: occurrences.length,
      blockedOccurrences: occurrences.filter((o) => o.status === 'BLOCKED')
        .length,
    },
    executionAllowed: false,
    schedulerStarted: false,
    budgetReserved: false,
    publicationAuthorized: false,
  };
  return { ...result, planHash: hash(result) };
}
