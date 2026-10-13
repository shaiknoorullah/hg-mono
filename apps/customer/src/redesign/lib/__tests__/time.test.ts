import { formatDate, formatShortDate, formatTime, formatTimeWindow, spokenTimeWindow, timeAfter } from '../time';

// 2026-10-10 is EDT (UTC-4) in Toronto.
const at = (hhmm: string) => `2026-10-10T${hhmm}:00-04:00`;

describe('12-hour times (gate item 10)', () => {
  it.each([
    [at('19:05'), '7:05 pm'],
    [at('12:00'), '12:00 pm'],
    [at('00:00'), '12:00 am'],
    [at('09:30'), '9:30 am'],
  ])('%s → %s', (iso, text) => {
    expect(formatTime(iso)).toBe(text);
  });

  it('formats in Toronto time whatever the instant is written in', () => {
    expect(formatTime('2026-10-10T23:42:00Z')).toBe('7:42 pm');
  });

  it('shares the period inside one half of the day', () => {
    expect(formatTimeWindow(at('19:10'), at('19:20'))).toBe('7:10–7:20 pm');
    expect(spokenTimeWindow(at('19:10'), at('19:20'))).toBe('between 7:10 and 7:20 pm');
  });

  it('names both periods for a window across noon', () => {
    expect(formatTimeWindow(at('11:50'), at('12:10'))).toBe('11:50 am–12:10 pm');
  });

  it('writes dates out, and keeps a calendar date on its own day', () => {
    expect(formatDate('2026-09-28')).toBe('28 September 2026');
    expect(formatShortDate('2026-10-20')).toBe('20 Oct');
    expect(formatDate('2026-09-30T23:30:00-04:00')).toBe('30 September 2026');
  });

  it('adds server seconds to a server time', () => {
    expect(formatTime(timeAfter(at('18:47'), 60))).toBe('6:48 pm');
  });
});
