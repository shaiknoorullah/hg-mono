/**
 * Certification dates are absolute and name the right day. A date (`expires_on`) is a calendar
 * day, read as written; a date-time (`verified_at`) is an instant, read as the day it was in
 * Ontario, not in UTC.
 */

import { describe, expect, it } from 'vitest';

import { formatAbsoluteDate, formatAbsoluteDateTime } from '../internal/dates';

describe('certification dates', () => {
  it('a date is the calendar day as written, on any device', () => {
    expect(formatAbsoluteDate('2027-03-14')).toBe('14 March 2027');
  });

  it('a date-time is the day it was in Toronto', () => {
    expect(formatAbsoluteDateTime('2026-10-10T02:30:00Z')).toBe('9 October 2026');
    expect(formatAbsoluteDateTime('2026-10-10T16:30:00Z')).toBe('10 October 2026');
  });

  it('missing or unreadable values render nothing', () => {
    expect(formatAbsoluteDate(null)).toBeNull();
    expect(formatAbsoluteDateTime('not a date')).toBeNull();
  });
});
