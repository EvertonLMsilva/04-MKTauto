import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';
import {
  dailyOccurrence,
  dailySchedule,
} from '../content-operations/domain/campaign-schedule.js';
import {
  MULTI_PIECE_CALENDAR_VERSION,
  MULTI_PIECE_PROFILE,
} from './multi-piece-calendar.contract.js';

// The actual planner/contract run with every I/O module forbidden. No Nest app,
// provider, scheduler or database is composed by this pure entry point.
vi.mock('node:fs', () => {
  throw new Error('FILESYSTEM_FORBIDDEN');
});
vi.mock('node:fs/promises', () => {
  throw new Error('FILESYSTEM_FORBIDDEN');
});
vi.mock('node:sqlite', () => {
  throw new Error('DATABASE_FORBIDDEN');
});
vi.mock('node:http', () => {
  throw new Error('HTTP_FORBIDDEN');
});
vi.mock('node:https', () => {
  throw new Error('HTTP_FORBIDDEN');
});
vi.mock('node:child_process', () => {
  throw new Error('PROCESS_FORBIDDEN');
});

function request() {
  return {
    schemaVersion: MULTI_PIECE_CALENDAR_VERSION,
    profile: MULTI_PIECE_PROFILE,
    projectId: 'project_calendar',
    projectVersion: 1,
    timeZone: 'America/Sao_Paulo',
    startDate: '2026-03-01',
    durationWeeks: 4,
    weeklyGoals: { VIDEO: 1, IMAGE: 10 },
    campaigns: [1, 2, 3].map((index) => ({
      campaignId: `campaign_${index}`,
      campaignRevision: 1,
      destinations: ['shared_destination'],
      preferredTimes: {
        VIDEO: [`${17 + index}:00`],
        IMAGE: [`${String(8 + index).padStart(2, '0')}:00`, `${13 + index}:00`],
      },
    })),
  };
}
function freeze(value: unknown) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
test('JSON input → validated pure planner → stable 132-piece plan without I/O or activation', () => {
  const input = JSON.parse(JSON.stringify(request()));
  freeze(input);
  const before = JSON.stringify(input);
  const forbidden = () => {
    throw new Error('EFFECT_FORBIDDEN');
  };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden),
    vi.spyOn(globalThis, 'setInterval').mockImplementation(forbidden),
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(forbidden),
    vi.spyOn(Date, 'now').mockImplementation(forbidden),
  ];
  let plan: ReturnType<typeof planMultiPieceCalendar>;
  try {
    plan = planMultiPieceCalendar(input);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  const roundTrip = JSON.parse(JSON.stringify(plan!));
  expect(roundTrip).toEqual(planMultiPieceCalendar(JSON.parse(before)));
  expect(JSON.stringify(input)).toBe(before);
  expect(roundTrip).toMatchObject({
    status: 'PLANNED',
    endDate: '2026-03-28',
    totals: {
      campaigns: 3,
      VIDEO: 12,
      IMAGE: 120,
      pieces: 132,
      occurrences: 132,
      blockedOccurrences: 0,
    },
    executionAllowed: false,
    schedulerStarted: false,
    budgetReserved: false,
    publicationAuthorized: false,
  });
  expect(
    roundTrip.pieces.every(
      (piece: { localDate: string }) => piece.localDate < '2026-03-29',
    ),
  ).toBe(true);
});
test('legacy daily fold/gap policy remains independent of the offline weekly profile', () => {
  const fold = dailySchedule({ time: '01:30', timeZone: 'America/New_York' });
  const before = dailyOccurrence(
    '2026-10-31T05:30:00Z',
    '2026-11-01T07:00:00Z',
    fold,
  );
  const input = request();
  input.timeZone = fold.timeZone;
  input.startDate = '2026-11-01';
  input.campaigns[0].preferredTimes.VIDEO = ['01:30'];
  expect(
    planMultiPieceCalendar(input).pieces.find(
      (piece) =>
        piece.campaignId === 'campaign_1' &&
        piece.week === 1 &&
        piece.contentType === 'VIDEO',
    )?.blockers,
  ).toContain('AMBIGUOUS_LOCAL_TIME');
  expect(before).toBe('2026-11-01T05:30:00.000Z');
  expect(
    dailyOccurrence('2026-10-31T05:30:00Z', '2026-11-01T07:00:00Z', fold),
  ).toBe(before);
  expect(
    dailyOccurrence(
      '2026-03-07T07:30:00Z',
      '2026-03-08T12:00:00Z',
      dailySchedule({ time: '02:30', timeZone: 'America/New_York' }),
    ),
  ).toBeNull();
});
