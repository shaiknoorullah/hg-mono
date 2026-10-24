/**
 * What both apps' capture entries share, `@hg/api-client/capture`: reading a link's query and
 * moving the phone's clock. It is tested here because the customer app is where a test of a shared
 * module of `@hg/api-client` runs (the package has no test runner of its own); the rider app's
 * entry tests cover only what is the rider's.
 */
import {
  adoptCaptureClock,
  captureRefusal,
  offsetClockTo,
  readCaptureQuery,
  restoreClock,
} from '@hg/api-client/capture';

const FROZEN = '2026-08-10T18:42:11.412Z';
const query = (entries: Record<string, string>) => new URLSearchParams(entries);

afterEach(() => {
  restoreClock();
  jest.restoreAllMocks();
});

describe('readCaptureQuery', () => {
  it('reads the board, params, scenario and clock', () => {
    expect(
      readCaptureQuery(query({ board: 'a/B', params: '{"id":"x"}', scenario: 'getOrder=order_arrived', clock: FROZEN })),
    ).toEqual({ ok: true, board: 'a/B', params: { id: 'x' }, scenario: 'getOrder=order_arrived', clock: FROZEN, hold: false });
  });

  it('reads a link with nothing but a route as empty values', () => {
    expect(readCaptureQuery(query({ route: 'home' }))).toEqual({
      ok: true,
      board: null,
      params: undefined,
      scenario: undefined,
      clock: undefined,
      hold: false,
    });
  });

  it('refuses params that are not a JSON object, and a clock that is not a date, naming the board', () => {
    for (const params of ['[1]', '"text"', 'null', '{oops']) {
      expect(readCaptureQuery(query({ board: 'a/B', params }))).toEqual({ ok: false, why: 'a/B: `params` is not a JSON object' });
    }
    expect(readCaptureQuery(query({ clock: 'yesterday' }))).toEqual({ ok: false, why: 'capture link: `clock` is not a date' });
    expect(readCaptureQuery(query({ hold: '1' }))).toEqual({ ok: false, why: 'capture link: `hold` needs a `clock` to hold at' });
    expect(captureRefusal(null, 'x')).toEqual({ ok: false, why: 'capture link: x' });
  });
});

describe('the phone\'s clock', () => {
  it('reads the frozen instant, still ticking, and every Date behaves as a Date', () => {
    offsetClockTo(Date.parse(FROZEN));
    expect(Math.abs(Date.now() - Date.parse(FROZEN))).toBeLessThan(5_000);
    expect(new Date().getUTCFullYear()).toBe(2026);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date('2027-01-01T00:00:00Z').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(new Date() instanceof Date).toBe(true);
    expect(typeof Date()).toBe('string');
    expect(Date.UTC(2026, 0, 1)).toBe(1767225600000);
  });

  it('is held still when the link says so, for a countdown that must read the board\'s second', async () => {
    expect(readCaptureQuery(query({ clock: FROZEN, hold: '1' }))).toMatchObject({ ok: true, clock: FROZEN, hold: true });
    await adoptCaptureClock('http://mock', FROZEN, true);
    expect(Date.now()).toBe(Date.parse(FROZEN));
    expect(new Date().toISOString()).toBe(FROZEN);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof Date).toBe(true);
  });

  it('goes back to the phone\'s own clock', () => {
    const before = Date.now();
    offsetClockTo(Date.parse(FROZEN));
    restoreClock();
    expect(Math.abs(Date.now() - before)).toBeLessThan(5_000);
  });

  it('is taken from the link, else from the mock\'s answer', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ data: { frozen_clock: FROZEN } })));
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    await adoptCaptureClock('http://mock', '2026-09-01T00:00:00Z');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(new Date().getUTCMonth()).toBe(8);
    await adoptCaptureClock('http://mock', undefined);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('http://mock/__mock/health');
    expect(Math.abs(Date.now() - Date.parse(FROZEN))).toBeLessThan(5_000);
  });

  it('stays the phone\'s, and says so, when the mock cannot be asked', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const before = Date.now();
    await adoptCaptureClock('http://mock', undefined);
    expect(Math.abs(Date.now() - before)).toBeLessThan(5_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the clock stays the phone'));
  });
});
