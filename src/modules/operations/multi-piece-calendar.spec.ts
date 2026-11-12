import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';
import {
  MULTI_PIECE_CALENDAR_VERSION,
  MULTI_PIECE_PROFILE,
} from './multi-piece-calendar.contract.js';

const input = (count = 1) => ({
  schemaVersion: MULTI_PIECE_CALENDAR_VERSION,
  profile: MULTI_PIECE_PROFILE,
  projectId: 'project_008',
  projectVersion: 1,
  timeZone: 'America/Sao_Paulo',
  startDate: '2026-11-01',
  durationWeeks: 4,
  weeklyGoals: { VIDEO: 1, IMAGE: 10 },
  campaigns: Array.from({ length: count }, (_, index) => ({
    campaignId: `campaign_${index + 1}`,
    campaignRevision: 1,
    destinations: [`destination_${index + 1}`],
    preferredTimes: { VIDEO: ['18:00'], IMAGE: ['09:00', '15:00'] },
  })),
});
test.each([1, 3])(
  'plans exactly four weeks for %i campaigns, with weekly goals and multiple pieces per day',
  (count) => {
    const result = planMultiPieceCalendar(input(count));
    expect(result.status).toBe('PLANNED');
    expect(result.totals).toMatchObject({
      campaigns: count,
      VIDEO: 4 * count,
      IMAGE: 40 * count,
      pieces: 44 * count,
    });
    for (const campaign of input(count).campaigns)
      for (let week = 1; week <= 4; week++) {
        const pieces = result.pieces.filter(
          (p) => p.campaignId === campaign.campaignId && p.week === week,
        );
        expect(pieces.filter((p) => p.contentType === 'VIDEO')).toHaveLength(1);
        expect(pieces.filter((p) => p.contentType === 'IMAGE')).toHaveLength(
          10,
        );
      }
    expect(
      result.pieces.filter((p) => p.localDate === '2026-11-01'),
    ).toHaveLength(3 * count);
    expect(new Set(result.pieces.map((p) => p.pieceId)).size).toBe(44 * count);
    expect(
      new Set(
        result.pieces.flatMap((p) => p.occurrences.map((o) => o.occurrenceId)),
      ).size,
    ).toBe(44 * count);
    expect(result.pieces.every((p) => p.plannedAt?.endsWith('Z'))).toBe(true);
    expect(
      result.pieces.find((p) => p.contentType === 'IMAGE')?.plannedAt,
    ).toBe('2026-11-01T12:00:00.000Z');
  },
);
test('is deterministic, canonicalizes collection order and never mutates its input', () => {
  const request = input(3),
    before = JSON.stringify(request),
    first = planMultiPieceCalendar(request);
  expect(planMultiPieceCalendar(structuredClone(request))).toEqual(first);
  request.campaigns.reverse();
  request.campaigns[0].preferredTimes.IMAGE.reverse();
  expect(planMultiPieceCalendar(request)).toEqual(first);
  request.campaigns.reverse();
  request.campaigns[2].preferredTimes.IMAGE.reverse();
  expect(JSON.stringify(request)).toBe(before);
  expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
});
test.each([
  '2026-01-25',
  '2026-12-20',
  '2028-02-10',
  '2026-03-01',
  '9999-12-04',
  '0001-01-01',
])(
  'uses 28 local dates across month/year boundaries starting %s',
  (startDate) => {
    const result = planMultiPieceCalendar({ ...input(), startDate });
    expect(result.pieces).toHaveLength(44);
    expect(result.status).toBe('PLANNED');
    expect(result.endDate).toBe(
      new Date(Date.parse(startDate + 'T00:00:00Z') + 27 * 86400000)
        .toISOString()
        .slice(0, 10),
    );
    expect(
      result.pieces.every(
        (p) => p.localDate >= startDate && p.localDate <= result.endDate,
      ),
    ).toBe(true);
  },
);
test.each([
  ['2026-03-08', 'America/New_York', '02:30', 'NONEXISTENT_LOCAL_TIME'],
  ['2026-11-01', 'America/New_York', '01:30', 'AMBIGUOUS_LOCAL_TIME'],
  ['2026-10-04', 'Australia/Lord_Howe', '02:15', 'NONEXISTENT_LOCAL_TIME'],
  ['2011-12-30', 'Pacific/Apia', '09:00', 'NONEXISTENT_LOCAL_TIME'],
])(
  'blocks civil time %s %s %s without moving it',
  (startDate, timeZone, time, code) => {
    const request = input();
    request.startDate = startDate;
    request.timeZone = timeZone;
    request.campaigns[0].preferredTimes.VIDEO = [time];
    const plan = planMultiPieceCalendar(request);
    const piece = plan.pieces.find(
      (p) => p.week === 1 && p.contentType === 'VIDEO',
    )!;
    expect(piece.localDate).toBe(startDate);
    expect(piece.localTime).toBe(time);
    expect(piece.plannedAt).toBeNull();
    expect(piece.blockers).toContain(code);
    expect(plan.status).toBe('BLOCKED');
    expect(plan.pieces).toHaveLength(44);
    if (code === 'AMBIGUOUS_LOCAL_TIME')
      expect(piece.candidateInstants).toHaveLength(2);
  },
);
test('keeps local clock time across DST with the correct different UTC offsets', () => {
  const request = {
    ...input(),
    startDate: '2026-03-01',
    timeZone: 'America/New_York',
  };
  const videos = planMultiPieceCalendar(request).pieces.filter(
    (p) => p.contentType === 'VIDEO',
  );
  expect(videos.map((p) => p.plannedAt)).toEqual([
    '2026-03-01T23:00:00.000Z',
    '2026-03-08T22:00:00.000Z',
    '2026-03-15T22:00:00.000Z',
    '2026-03-22T22:00:00.000Z',
  ]);
});
test('reports all destination collisions without shifting either campaign', () => {
  const request = input(3);
  request.campaigns[1].destinations = ['destination_1'];
  const plan = planMultiPieceCalendar(request);
  expect(plan.status).toBe('BLOCKED');
  expect(plan.totals.pieces).toBe(132);
  expect(plan.totals.blockedOccurrences).toBe(88);
  expect(
    plan.pieces
      .filter((p) => p.campaignId === 'campaign_3')
      .every((p) => p.status === 'PLANNED'),
  ).toBe(true);
  expect(
    plan.pieces
      .filter((p) => p.campaignId !== 'campaign_3')
      .every((p) => p.blockers.includes('DESTINATION_CONFLICT')),
  ).toBe(true);
});
test('fan-out creates distinct destination occurrences without multiplying the piece goals', () => {
  const request = input();
  request.campaigns[0].destinations.push('destination_2');
  const result = planMultiPieceCalendar(request);
  expect(result.totals).toMatchObject({
    pieces: 44,
    VIDEO: 4,
    IMAGE: 40,
    occurrences: 88,
  });
  expect(
    new Set(
      result.pieces.flatMap((p) => p.occurrences.map((o) => o.occurrenceId)),
    ).size,
  ).toBe(88);
});
test('revisions change exact identities; a clock change changes occurrences while preserving piece identity', () => {
  const request = input(),
    original = planMultiPieceCalendar(request);
  const revision = structuredClone(request);
  revision.campaigns[0].campaignRevision++;
  const revised = planMultiPieceCalendar(revision);
  expect(
    revised.pieces.every(
      (p) => !original.pieces.some((o) => o.pieceId === p.pieceId),
    ),
  ).toBe(true);
  request.campaigns[0].preferredTimes.VIDEO = ['19:00'];
  const changed = planMultiPieceCalendar(request),
    before = original.pieces.find((p) => p.contentType === 'VIDEO')!,
    after = changed.pieces.find((p) => p.contentType === 'VIDEO')!;
  expect(before.pieceId).toBe(after.pieceId);
  expect(before.occurrences[0].occurrenceId).not.toBe(
    after.occurrences[0].occurrenceId,
  );
  expect(changed.planHash).not.toBe(original.planHash);
});
test('insufficient preferred slots blocks pieces instead of inventing a new time', () => {
  const request = input();
  request.campaigns[0].preferredTimes.IMAGE = ['09:00'];
  const result = planMultiPieceCalendar(request);
  expect(result.pieces).toHaveLength(44);
  expect(result.totals.blockedOccurrences).toBe(12);
  expect(
    result.pieces
      .filter((p) => p.localTime === null)
      .every((p) =>
        p.blockers.includes('PREFERRED_TIME_CAPACITY_INSUFFICIENT'),
      ),
  ).toBe(true);
});
test('same-campaign VIDEO and IMAGE at the same destination and instant remain distinct, blocked pieces', () => {
  const request = input();
  request.campaigns[0].preferredTimes.VIDEO = ['09:00'];
  const result = planMultiPieceCalendar(request);
  expect(result.totals.blockedOccurrences).toBe(8);
  expect(new Set(result.pieces.map((piece) => piece.pieceId)).size).toBe(44);
});
test('rejects a four-week horizon outside the supported four-digit date range', () => {
  expect(() =>
    planMultiPieceCalendar({ ...input(), startDate: '9999-12-05' }),
  ).toThrow('INVALID_MULTI_PIECE_CALENDAR');
});
test.each([
  'profile',
  'duration',
  'date',
  'zone',
  'destination',
  'campaign',
  'revision',
  'time',
  'goal',
  'unknown',
])('rejects invalid or duplicate %s atomically', (kind) => {
  const request = input();
  if (kind === 'profile') request.profile = 'DAILY' as never;
  if (kind === 'duration') request.durationWeeks = 5;
  if (kind === 'date') request.startDate = '2026-02-30';
  if (kind === 'zone') request.timeZone = 'Invalid/Zone';
  if (kind === 'destination')
    request.campaigns[0].destinations.push('destination_1');
  if (kind === 'campaign')
    request.campaigns.push({ ...request.campaigns[0], campaignRevision: 2 });
  if (kind === 'revision') request.projectVersion = 0;
  if (kind === 'time') request.campaigns[0].preferredTimes.VIDEO = ['24:00'];
  if (kind === 'goal') request.weeklyGoals.IMAGE = 11;
  expect(() =>
    planMultiPieceCalendar(
      kind === 'unknown' ? { ...request, enabled: true } : request,
    ),
  ).toThrow('INVALID_MULTI_PIECE_CALENDAR');
});
