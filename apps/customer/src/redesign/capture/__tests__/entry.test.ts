/**
 * The capture entry (https://github.com/shaiknoorullah/hg-mono/issues/1141): what a capture link
 * asks for, what it changes, and that a build without the flag has no entry at all.
 */
import { getMockScenario, setMockScenario } from '../../../api/mockScenario';
import { getToken, setToken } from '../../../api/token';
import { routeForUrl } from '../../navigation/deepLinks';
import { clearForced, getForced, raiseForced } from '../../session/forced';
import { getSession, resetSessionForTests } from '../../session/session';
import { restoreClock } from '../clock';
import { openCapture, parseCaptureUrl } from '../entry';

// The app has no Node type declarations (it ships to phones); jest's few Node calls are typed by hand.
declare const __dirname: string;
declare const require: (id: string) => any;
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const FROZEN = '2026-08-10T18:42:11.412Z';
const link = (query: Record<string, string>) => `hgcustomer://__capture?${new URLSearchParams(query).toString()}`;

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  restoreClock();
  setToken(null);
  setMockScenario(undefined);
  clearForced();
  resetSessionForTests();
  jest.restoreAllMocks();
});

describe('parseCaptureUrl', () => {
  it('reads the route, its params, the scenario and the clock', () => {
    const parsed = parseCaptureUrl(
      link({
        board: 'track-after/Tracking-arrived',
        route: 'tracking',
        params: '{"orderId":"o1"}',
        scenario: 'getOrder=order_arrived,refreshSession=error_session_revoked',
        clock: FROZEN,
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      request: {
        board: 'track-after/Tracking-arrived',
        route: { name: 'tracking', orderId: 'o1' },
        scenario: 'getOrder=order_arrived,refreshSession=error_session_revoked',
        clock: FROZEN,
      },
    });
  });

  it('is not a capture link when it is any other link', () => {
    for (const url of [null, undefined, '', 'hgcustomer://order/o1', 'https://example.com/__capture?route=cart', 'hgrider://__capture?route=home']) {
      expect(parseCaptureUrl(url)).toBeNull();
    }
  });

  it('refuses, with the reason, a link that cannot be opened', () => {
    const why = (query: Record<string, string>) => {
      const parsed = parseCaptureUrl(link(query));
      return parsed && !parsed.ok ? parsed.why : null;
    };
    expect(why({ board: 'a/B' })).toMatch(/a\/B: no `route`/);
    expect(why({ route: 'nowhere' })).toMatch(/there is no route called "nowhere"/);
    expect(why({ route: 'toString' })).toMatch(/there is no route called "toString"/);
    expect(why({ route: 'restaurant' })).toMatch(/needs `restaurantId`/);
    expect(why({ route: 'tracking', params: '{"orderId":""}' })).toMatch(/needs `orderId`/);
    expect(why({ route: 'cart', params: '[1]' })).toMatch(/not a JSON object/);
    expect(why({ route: 'cart', params: '{oops' })).toMatch(/not a JSON object/);
    expect(why({ route: 'cart', clock: 'yesterday' })).toMatch(/`clock` is not a date/);
    expect(why({ route: 'code' })).toMatch(/step inside the sign-in flow/);
  });

  it('is never read as a deep link, so the normal link handler opens nothing for it', () => {
    expect(routeForUrl(link({ route: 'cart' }))).toBeNull();
  });
});

describe('openCapture', () => {
  it('signs in a fixture session, sets the scenario and the clock, and returns the named route', async () => {
    const route = await openCapture(
      link({ route: 'tracking', params: '{"orderId":"o1"}', scenario: 'getOrder=order_arrived', clock: FROZEN }),
    );
    expect(route).toEqual({ name: 'tracking', orderId: 'o1' });
    expect(getToken()).not.toBeNull();
    expect(getMockScenario()).toBe('getOrder=order_arrived');
    expect(getSession().phase).toBe('app');
    // The phone's clock now reads the fixtures' frozen instant, still ticking.
    const now = Date.now();
    expect(Math.abs(now - Date.parse(FROZEN))).toBeLessThan(5_000);
    expect(new Date().getUTCFullYear()).toBe(2026);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date('2027-01-01T00:00:00Z').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(new Date() instanceof Date).toBe(true);
  });

  it('clears a forced route and the previous scenario before it opens the next board', async () => {
    raiseForced({ kind: 'revoked' });
    setMockScenario('getOrder=order_cancelled');
    await openCapture(link({ route: 'cart', clock: FROZEN }));
    expect(getForced()).toBeNull();
    expect(getMockScenario()).toBeUndefined();
  });

  it('asks the mock for the frozen clock when the link names none', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ data: { frozen_clock: FROZEN } })));
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    await openCapture(link({ route: 'cart' }));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/__mock\/health$/);
    expect(Math.abs(Date.now() - Date.parse(FROZEN))).toBeLessThan(5_000);
  });

  it('keeps the phone\'s clock, and says so, when nothing gives it a time', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const before = Date.now();
    await expect(openCapture(link({ route: 'cart' }))).resolves.toEqual({ name: 'cart' });
    expect(Math.abs(Date.now() - before)).toBeLessThan(5_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the clock stays the phone'));
  });

  it('signs out for the signed-out screen and opens "Your details" through the session', async () => {
    setToken('someone');
    await expect(openCapture(link({ route: 'signIn', clock: FROZEN }))).resolves.toBeNull();
    expect(getToken()).toBeNull();
    await expect(openCapture(link({ route: 'yourDetails', clock: FROZEN }))).resolves.toBeNull();
    expect(getToken()).not.toBeNull();
    expect(getSession().phase).toBe('profile');
  });

  it('opens nothing for a route that does not exist, and logs why', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setMockScenario('keep=me');
    await expect(openCapture(link({ board: 'x/Y', route: 'nowhere', scenario: 'getOrder=order_arrived' }))).resolves.toBeNull();
    expect(getToken()).toBeNull();
    expect(getMockScenario()).toBe('keep=me');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/nothing opened\. x\/Y: there is no route called "nowhere"/));
  });
});

describe('with the flag off', () => {
  it('has no entry, and the guard is the literal build-time test the bundler removes', () => {
    // Jest runs without EXPO_PUBLIC_HG_CAPTURE, as every build but the capture one does.
    let entry: unknown = 'unset';
    jest.isolateModules(() => {
      entry = (jest.requireActual('../index') as { captureEntry: unknown }).captureEntry;
    });
    expect(entry).toBeNull();
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/process\.env\.EXPO_PUBLIC_HG_CAPTURE === '1' \? \(require\('\.\/entry'\)/);
  });
});
