/**
 * The weekly hours rules as pure functions (approval packet P23; restaurant WP9 DONE list):
 * overlap including past midnight into the next day and Sunday into Monday, the 3-range and
 * 21-range limits, a Closed day emitting no interval, and the round trip with the contract's
 * `TradingInterval` shape (`restaurant_hours_standard`), overrides carried through the save.
 */

import { describe, expect, it } from 'vitest';

import {
  changedDays,
  checkWeeklyHours,
  emptyWeek,
  formatRange,
  toRestaurantHoursInput,
  weeklyHoursFromContract,
  weeklyHoursToContract,
  type TradingInterval,
  type WeeklyHours,
} from '../index';

const STANDARD: TradingInterval[] = [
  { day_of_week: 0, opens_at: '12:00', closes_at: '21:00', crosses_midnight: false },
  { day_of_week: 1, opens_at: '11:00', closes_at: '22:00', crosses_midnight: false },
  { day_of_week: 2, opens_at: '11:00', closes_at: '22:00', crosses_midnight: false },
  { day_of_week: 3, opens_at: '11:00', closes_at: '22:00', crosses_midnight: false },
  { day_of_week: 4, opens_at: '11:00', closes_at: '22:00', crosses_midnight: false },
  { day_of_week: 5, opens_at: '11:00', closes_at: '01:00', crosses_midnight: true },
  { day_of_week: 6, opens_at: '11:00', closes_at: '01:00', crosses_midnight: true },
];

const week = (patch: Partial<WeeklyHours>): WeeklyHours => ({ ...weeklyHoursFromContract(STANDARD), ...patch });
const open = (...ranges: Array<[string, string]>) => ({ closed: false, ranges: ranges.map(([o, c]) => ({ open: o, close: c })) });

describe('round trip with the contract shape', () => {
  it('reads restaurant_hours_standard and writes the same intervals back', () => {
    const w = weeklyHoursFromContract(STANDARD);
    expect(w.fri).toEqual(open(['11:00', '01:00']));
    expect(weeklyHoursToContract(w)).toEqual(STANDARD);
  });

  it('a day with no interval reads Closed; split days keep their ranges in time order', () => {
    const w = weeklyHoursFromContract([
      { day_of_week: 5, opens_at: '17:00', closes_at: '02:00', crosses_midnight: true },
      { day_of_week: 5, opens_at: '11:00', closes_at: '15:00', crosses_midnight: false },
    ]);
    expect(w.mon).toEqual({ closed: true, ranges: [] });
    expect(w.fri.ranges.map((r) => r.open)).toEqual(['11:00', '17:00']);
  });

  it('sets crosses_midnight when the range closes at or before it opens (24 hours included)', () => {
    const out = weeklyHoursToContract(week({ wed: open(['09:00', '09:00']), thu: open(['17:00', '02:00']) }));
    expect(out.find((i) => i.day_of_week === 3)).toEqual({ day_of_week: 3, opens_at: '09:00', closes_at: '09:00', crosses_midnight: true });
    expect(out.find((i) => i.day_of_week === 4)?.crosses_midnight).toBe(true);
  });

  it('the save body carries the special dates read, so saving the week never deletes them', () => {
    const overrides = [{ date: '2027-03-20', is_closed: true, opens_at: null, closes_at: null, reason: 'Closed for Eid al-Fitr' }];
    expect(toRestaurantHoursInput(weeklyHoursFromContract(STANDARD), overrides)).toEqual({ intervals: STANDARD, overrides });
  });
});

describe('a Closed day emits no intervals', () => {
  it('even while it still lists the ranges kept for Undo', () => {
    const w = week({ sat: { closed: true, ranges: [{ open: '12:00', close: '02:00' }] } });
    expect(weeklyHoursToContract(w).some((i) => i.day_of_week === 6)).toBe(false);
    expect(checkWeeklyHours(w)).toEqual([]);
  });

  it('an all-closed week sends an empty list', () => {
    expect(weeklyHoursToContract(emptyWeek())).toEqual([]);
  });
});

describe('overlap', () => {
  it('two ranges on one day: the message goes on the later range', () => {
    const issues = checkWeeklyHours(week({ fri: open(['11:00', '15:00'], ['14:00', '02:00']) }));
    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'overlap',
        day: 'fri',
        range: 1,
        message: 'Overlaps 11:00 am – 3:00 pm. Change one of them.',
        summary: 'Friday: two time ranges overlap',
      }),
    ]);
  });

  it('a range past midnight that runs into the next day’s first range (HoursOverlapNight)', () => {
    const issues = checkWeeklyHours(
      week({ fri: open(['11:00', '15:00'], ['17:00', '02:00']), sat: open(['01:00', '04:00'], ['12:00', '02:00']) }),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        day: 'sat',
        range: 0,
        message: 'Overlaps Friday 5:00 pm – 2:00 am, which runs to 2:00 am on Saturday. Change one of them.',
        summary: 'Friday and Saturday: Friday 5:00 pm – 2:00 am runs into Saturday 1:00 am – 4:00 am',
      }),
    ]);
  });

  it('Sunday into Monday, and Saturday into Sunday across the end of the week', () => {
    const sunMon = checkWeeklyHours(week({ sun: open(['20:00', '03:00']), mon: open(['02:00', '10:00'], ['11:00', '22:00']) }));
    expect(sunMon).toEqual([expect.objectContaining({ day: 'mon', range: 0, summary: expect.stringMatching(/^Sunday and Monday/) })]);
    const satSun = checkWeeklyHours(week({ sat: open(['22:00', '02:00']), sun: open(['01:00', '09:00']) }));
    expect(satSun).toEqual([expect.objectContaining({ day: 'sun', range: 0, summary: expect.stringMatching(/^Saturday and Sunday/) })]);
  });

  it('touching ranges and a range ending exactly when the next day opens do not overlap', () => {
    expect(checkWeeklyHours(week({ fri: open(['11:00', '15:00'], ['15:00', '02:00']), sat: open(['02:00', '04:00']) }))).toEqual([]);
  });

  it('a 24-hour day overlaps the next morning; the week as drawn on HoursView does not', () => {
    expect(checkWeeklyHours(week({ wed: open(['09:00', '09:00']), thu: open(['08:00', '22:00']) }))).toHaveLength(1);
    expect(checkWeeklyHours(weeklyHoursFromContract(STANDARD))).toEqual([]);
  });
});

describe('limits', () => {
  it('more than 3 ranges on a day is refused', () => {
    const issues = checkWeeklyHours(week({ mon: open(['06:00', '07:00'], ['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']) }));
    expect(issues).toEqual([expect.objectContaining({ kind: 'too-many-day', day: 'mon', summary: 'Monday: up to 3 time ranges a day' })]);
  });

  it('21 ranges in the week is allowed (HoursLimits); 22 is refused', () => {
    const three = open(['07:00', '11:00'], ['12:00', '15:00'], ['17:00', '23:00']);
    const full = week({ mon: three, tue: three, wed: three, thu: three, fri: three, sat: three, sun: three });
    expect(checkWeeklyHours(full)).toEqual([]);
    const issues = checkWeeklyHours(full, { maxTotal: 20 });
    expect(issues).toEqual([expect.objectContaining({ kind: 'too-many-week', day: null })]);
  });

  it('a time not typed yet stops the save on that field', () => {
    const issues = checkWeeklyHours(week({ tue: open(['11:00', '22:00'], ['', '']) }));
    expect(issues.map((i) => [i.kind, i.field, i.summary])).toEqual([
      ['missing-open', 'open', 'Tuesday, time range 2: enter an opening time'],
      ['missing-close', 'close', 'Tuesday, time range 2: enter a closing time'],
    ]);
  });
});

describe('display and dirty tracking', () => {
  it('formats ranges in 12-hour time, never 24-hour', () => {
    expect(formatRange({ open: '17:00', close: '02:00' })).toBe('5:00 pm – 2:00 am');
    expect(formatRange({ open: '00:30', close: '12:00' })).toBe('12:30 am – 12:00 pm');
    expect(formatRange({ open: '09:00', close: '09:00' })).toBe('Open 24 hours from 9:00 am');
  });

  it('counts the days whose saved hours change; reordering ranges or an Undo is no change', () => {
    const saved = week({ fri: open(['11:00', '15:00'], ['17:00', '02:00']) });
    expect(changedDays(saved, week({ fri: open(['17:00', '02:00'], ['11:00', '15:00']) }))).toEqual([]);
    expect(changedDays(saved, week({ fri: { closed: true, ranges: saved.fri.ranges }, mon: open(['11:00', '23:00']) }))).toEqual(['mon', 'fri']);
  });
});
