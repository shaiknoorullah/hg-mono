import { formatDayTime, formatTime } from '../format/time';

const at = (h: number, m: number) => new Date(2026, 9, 10, h, m);

it.each([
  [at(0, 5), '12:05 am'],
  [at(9, 12), '9:12 am'],
  [at(12, 0), '12:00 pm'],
  [at(21, 12), '9:12 pm'],
  [at(23, 59), '11:59 pm'],
])('12-hour clock: %s → %s', (d, out) => {
  expect(formatTime(d)).toBe(out);
});

it('says today, yesterday, or the date', () => {
  const now = at(15, 0);
  expect(formatDayTime(at(9, 12), now)).toBe('9:12 am');
  expect(formatDayTime(new Date(2026, 9, 9, 21, 12), now)).toBe('Yesterday, 9:12 pm');
  expect(formatDayTime(new Date(2026, 9, 5, 21, 12), now)).toBe('Mon 5 Oct, 9:12 pm');
});

it('an unreadable time renders nothing rather than "NaN"', () => {
  expect(formatTime('not a date')).toBe('');
});
