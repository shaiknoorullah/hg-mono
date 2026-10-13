import { formatTime } from '../../lib/time';
import { checkPhone, displayPhone, nationalDigits, waitUntil } from '../phone';

describe('checkPhone (ported from #635)', () => {
  it('takes the local fixed-code test numbers, whose exchange starts with 0', () => {
    expect(checkPhone('5550100101')).toEqual({ ok: true, e164: '+15550100101' });
  });

  it('refuses a short number or an area code starting with 0 or 1', () => {
    expect(checkPhone('41655501')).toEqual({ ok: false, reason: 'incomplete' });
    expect(checkPhone('1165550134')).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('refuses a pasted or autofilled non-Canadian number, with or without its +', () => {
    expect(checkPhone('+44 7700 900123')).toEqual({ ok: false, reason: 'unsupported' });
    // The DS tel field hands back digits only: +44 7700 900123 arrives as 447700900123.
    expect(checkPhone('447700900123')).toEqual({ ok: false, reason: 'unsupported' });
    expect(checkPhone('+1 416 555 0134')).toEqual({ ok: true, e164: '+14165550134' });
  });

  it('shows and refills a number the way the boards write it', () => {
    expect(displayPhone('+14165550134')).toBe('+1 416 555 0134');
    expect(nationalDigits('+14165550134')).toBe('4165550134');
  });
});

describe('waitUntil: a static time from the server, never early', () => {
  it('adds Retry-After to the server time and rounds up to the minute (6:48 pm on the board)', () => {
    const serverDate = Date.parse('2026-10-09T22:43:01Z');
    expect(formatTime(waitUntil(serverDate, 299))).toBe('6:48 pm');
    expect(formatTime(waitUntil(serverDate, 300))).toBe('6:49 pm');
  });
});
