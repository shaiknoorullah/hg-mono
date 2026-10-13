import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/api.ts` — the session store and the dead-token handler. A 401 on an authenticated
 * request clears the session and sends the operator to `/login` (deny by default, AGENTS.md
 * invariant #2); a 401 with no session (a wrong password on the login form) is left to the
 * form. A corrupt stored session must read as "signed out", never crash the app at boot.
 */

const STORAGE_KEY = 'hg_restaurant_session_v1';

const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Session expired.', request_id: 'req-1' } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

/** Replaces `window.location` (jsdom's own cannot be spied on) with one whose `assign` records. */
function stubLocation(pathname: string) {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, pathname, assign });
  return assign;
}

/** Fresh module graph: `api.ts` reads storage, and binds `fetch`, once at module load. */
async function loadApi() {
  vi.resetModules();
  return import('../src/lib/api');
}

describe('restaurant api — session and 401 handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('boots signed out from a corrupt stored session, and restores a good one', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect((await loadApi()).getSession()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: 'tok-1', restaurantId: 'r-1' }));
    const { getSession, setSession } = await loadApi();
    expect(getSession()).toEqual({ accessToken: 'tok-1', restaurantId: 'r-1' });

    setSession(null);
    expect(getSession()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears a dead session and redirects to /login on a 401', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchSpy);
    const assign = stubLocation('/orders');
    const { api, getSession, setSession } = await loadApi();
    setSession({ accessToken: 'dead-token' });

    const { response } = await api.GET('/v1/restaurant/orders', {});

    expect(response.status).toBe(401);
    expect(getSession()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
    // The handler reports "not recovered": the request is not retried with the dead token.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = (fetchSpy.mock.calls[0] as unknown as [Request])[0];
    expect(sent.headers.get('Authorization')).toBe('Bearer dead-token');
  });

  it('leaves a 401 alone when there is no session, and does not redirect while already on /login', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()));

    // A 401 with no session (e.g. a wrong password): nothing to clear, no navigation — even
    // off the login page, so it is the missing session, not the path, that holds it back.
    let assign = stubLocation('/orders');
    let mod = await loadApi();
    await mod.api.POST('/v1/auth/login', {
      params: { header: { 'X-HG-Client': 'restaurant-web' } },
      body: { email: 'owner@example.ca', password: 'wrong' },
    });
    expect(assign).not.toHaveBeenCalled();

    // A session that dies on the login page itself is cleared without a redirect loop.
    assign = stubLocation('/login/reset');
    mod = await loadApi();
    mod.setSession({ accessToken: 'dead-token' });
    await mod.api.GET('/v1/restaurant/orders', {});
    expect(mod.getSession()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
