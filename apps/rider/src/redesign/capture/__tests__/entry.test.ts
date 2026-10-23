/**
 * The capture entry (https://github.com/shaiknoorullah/hg-mono/issues/1141): what a capture link
 * asks for, what it changes, and that a build without the flag has no entry at all.
 */
import { getMockScenario, setMockScenario } from '../../../mockScenario';
import { getToken, setToken } from '../../../token';
import { clearScreens, registerScreen } from '../../nav/registry';
import { restoreClock } from '@hg/api-client/capture';
import { openCapture, parseCaptureUrl } from '../entry';

// The app has no Node type declarations (it ships to phones); jest's few Node calls are typed by hand.
declare const __dirname: string;
declare const require: (id: string) => any;
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

declare module '../../nav/routes' {
  interface RedesignRoutes {
    captureProbe: { id: string };
  }
}

const FROZEN = '2026-08-10T18:42:11.412Z';
const link = (query: Record<string, string>) => `hgrider://__capture?${new URLSearchParams(query).toString()}`;

beforeEach(() => {
  clearScreens();
  registerScreen('captureProbe', { component: () => null });
  registerScreen('home', { component: () => null });
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  restoreClock();
  setToken(null);
  setMockScenario(undefined);
  jest.restoreAllMocks();
});

describe('parseCaptureUrl', () => {
  it('reads the route, its params, the scenario and the clock', () => {
    const parsed = parseCaptureUrl(
      link({
        board: 'shift-offers/Offer-arriving',
        route: 'captureProbe',
        params: '{"id":"a1"}',
        scenario: 'getCurrentOffer=offer_pending,refreshSession=error_session_revoked',
        clock: FROZEN,
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      request: {
        board: 'shift-offers/Offer-arriving',
        target: { name: 'captureProbe', params: { id: 'a1' } },
        scenario: 'getCurrentOffer=offer_pending,refreshSession=error_session_revoked',
        clock: FROZEN,
      },
    });
  });

  it('is not a capture link when it is any other link', () => {
    for (const url of [null, undefined, '', 'hgrider://offer/1', 'https://example.com/__capture?route=home', 'hgcustomer://__capture?route=home']) {
      expect(parseCaptureUrl(url)).toBeNull();
    }
  });

  it.each([
    [{ route: 'nowhere' }, /no screen is registered for the route "nowhere"/],
    [{ route: 'suspended' }, /shown by the session gate/],
    [{ board: 'a/B' }, /^a\/B: no `route`/],
  ])('refuses %j with the reason', (query, reason) => {
    const parsed = parseCaptureUrl(link(query));
    expect(parsed).toMatchObject({ ok: false });
    expect(parsed && !parsed.ok && parsed.why).toMatch(reason);
  });

  it('opens the sign-in screen without a registered route', () => {
    expect(parseCaptureUrl(link({ route: 'signIn' }))).toMatchObject({ ok: true, request: { target: null } });
  });
});

describe('openCapture', () => {
  it('signs in a fixture session, sets the scenario and the clock, and waits for the navigator', async () => {
    await expect(
      openCapture(link({ route: 'captureProbe', params: '{"id":"a1"}', scenario: 'getRiderMe=rider_me', clock: FROZEN })),
    ).resolves.toBe(true);
    expect(getToken()).not.toBeNull();
    expect(getMockScenario()).toBe('getRiderMe=rider_me');
    expect(Math.abs(Date.now() - Date.parse(FROZEN))).toBeLessThan(5_000);
  });

  it('signs out for the sign-in screen', async () => {
    setToken('someone', 'refresh');
    await expect(openCapture(link({ route: 'signIn', clock: FROZEN }))).resolves.toBe(true);
    expect(getToken()).toBeNull();
  });

  it('opens nothing for a route that has no screen, and logs why', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setMockScenario('keep=me');
    await expect(openCapture(link({ board: 'x/Y', route: 'nowhere', scenario: 'getRiderMe=rider_me' }))).resolves.toBe(false);
    expect(getToken()).toBeNull();
    expect(getMockScenario()).toBe('keep=me');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/nothing opened\. x\/Y: no screen is registered for the route "nowhere"/));
  });
});

describe('with the flag off', () => {
  it('has no entry module to open anything with', () => {
    // Jest runs without EXPO_PUBLIC_HG_CAPTURE, as every build but the capture one does.
    let found: unknown = 'unset';
    jest.isolateModules(() => {
      found = jest.requireActual('../index').captureEntry;
    });
    expect(found).toBeNull();
  });

  it('is guarded by the literal build-time test, so the bundler can remove the require', () => {
    const guard = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(guard).toContain("process.env.EXPO_PUBLIC_HG_CAPTURE === '1'");
    expect(guard).not.toMatch(/^import .*['"]\.\/entry['"]/m);
  });
});
