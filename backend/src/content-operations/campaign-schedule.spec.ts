import {
  dailyOccurrence,
  dailySchedule,
  initialOccurrence,
} from './domain/campaign-schedule.js';

test('explicit civil time uses its timezone and is due only at the configured instant', () => {
  const schedule = dailySchedule({ time: '09:30', timeZone: 'Asia/Tokyo' });
  expect(initialOccurrence('2026-11-07T23:00:00Z', schedule)).toBe(
    '2026-11-08T00:30:00.000Z',
  );
  expect(
    dailyOccurrence('2026-11-07T00:30:00Z', '2026-11-08T00:29:59Z', schedule),
  ).toBeNull();
  expect(
    dailyOccurrence('2026-11-07T00:30:00Z', '2026-11-08T00:30:00Z', schedule),
  ).toBe('2026-11-08T00:30:00.000Z');
});

test('legacy schedule preserves the original Sao Paulo clock including milliseconds and never backfills', () => {
  expect(
    dailyOccurrence('2026-11-07T12:15:30.123Z', '2026-12-01T15:00:00Z'),
  ).toBe('2026-12-01T12:15:30.123Z');
  expect(
    dailyOccurrence('2026-11-07T12:15:30.123Z', '2026-11-07T15:00:00Z'),
  ).toBeNull();
});

test('DST skips nonexistent civil times and picks the first occurrence of an ambiguous time', () => {
  const gap = dailySchedule({ time: '02:30', timeZone: 'America/New_York' });
  expect(
    dailyOccurrence('2026-03-07T07:30:00Z', '2026-03-08T12:00:00Z', gap),
  ).toBeNull();
  expect(
    dailyOccurrence('2026-03-07T07:30:00Z', '2026-03-09T12:00:00Z', gap),
  ).toBe('2026-03-09T06:30:00.000Z');
  const fold = dailySchedule({ time: '01:30', timeZone: 'America/New_York' });
  expect(
    dailyOccurrence('2026-10-31T05:30:00Z', '2026-11-01T07:00:00Z', fold),
  ).toBe('2026-11-01T05:30:00.000Z');
});

test.each([
  { time: '24:00', timeZone: 'UTC' },
  { time: '9:00', timeZone: 'UTC' },
  { time: '09:60', timeZone: 'UTC' },
  { time: '09:00', timeZone: 'Invalid/Zone' },
  { time: '09:00' },
  { time: '09:00', timeZone: 'UTC', extra: true },
])('rejects invalid daily configuration %j', (input) => {
  expect(() => dailySchedule(input)).toThrow('INVALID_CAMPAIGN_SCHEDULE');
});
