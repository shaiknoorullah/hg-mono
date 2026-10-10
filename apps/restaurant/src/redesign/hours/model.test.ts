/**
 * The checks the server does not make (spec wp9-hours §0, §4.3): overlap across midnight and
 * around the end of the week, 24 hours, and what `crosses_midnight` the save sends.
 */
import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from '../format/time';
import { emptyWeek, intervalsFromWeek, newKey, validateWeek, weekCovers, type Week } from './model';

function week(spec: Record<number, [string, string][]>): Week {
  const w = emptyWeek();
  for (const [d, ranges] of Object.entries(spec)) w[Number(d)] = ranges.map(([opens, closes]) => ({ key: newKey(), opens, closes }));
  return w;
}

describe('hours model', () => {
  it('a late Saturday running into Sunday, and Sunday into Monday, overlap; touching ranges do not', () => {
    expect(validateWeek(week({ 6: [['18:00', '03:00']], 0: [['02:00', '10:00']] })).map((i) => i.summary)).toEqual([
      'Saturday and Sunday: Saturday 6:00 pm – 3:00 am runs into Sunday 2:00 am – 10:00 am',
    ]);
    expect(validateWeek(week({ 0: [['20:00', '03:00']], 1: [['02:00', '10:00']] }))[0]!.target).toBe('mon');
    expect(validateWeek(week({ 5: [['17:00', '02:00']], 6: [['02:00', '10:00']] }))).toEqual([]);
  });

  it('the same opening and closing time is 24 hours: fine alone, an overlap with anything else that day', () => {
    expect(validateWeek(week({ 1: [['09:00', '09:00']] }))).toEqual([]);
    expect(validateWeek(week({ 1: [['09:00', '09:00'], ['12:00', '13:00']] }))[0]!.summary).toBe('Monday: two time ranges overlap');
    expect(weekCovers(week({ 1: [['09:00', '09:00']] }), 2, 8 * 60)).toBe(true);
    expect(weekCovers(week({ 1: [['09:00', '09:00']] }), 2, 9 * 60)).toBe(false);
  });

  it('sends crosses_midnight when closing is earlier than (or equal to) opening, Monday first', () => {
    const { intervals } = intervalsFromWeek(week({ 0: [['12:00', '21:00']], 5: [['17:00', '02:00']], 1: [['09:00', '09:00']] }));
    expect(intervals).toEqual([
      { day_of_week: 1, opens_at: '09:00', closes_at: '09:00', crosses_midnight: true },
      { day_of_week: 5, opens_at: '17:00', closes_at: '02:00', crosses_midnight: true },
      { day_of_week: 0, opens_at: '12:00', closes_at: '21:00', crosses_midnight: false },
    ]);
  });

  it('reads 12-hour entry and writes 12-hour labels', () => {
    expect(['12 am', '12:30 pm', '5pm', '5:05 p.m.', '17:30', '9'].map(parseClock)).toEqual(['00:00', '12:30', '17:00', '17:05', '17:30', '09:00']);
    expect(['13 pm', '5:75', 'noon', ''].map(parseClock)).toEqual([null, null, null, null]);
    expect(['00:00', '12:00', '23:59'].map(formatClock)).toEqual(['12:00 am', '12:00 pm', '11:59 pm']);
  });
});
