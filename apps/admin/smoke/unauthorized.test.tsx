import { describe, expect, it, vi } from 'vitest';
import { getToken, setToken } from '../src/lib/token';

/** A 401 from any call clears the token, which is what sends the admin back to sign-in. */
describe('admin api 401', () => {
  it('clears the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in', request_id: 'r' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { api } = await import('../src/lib/api');
    setToken('stale-token');
    await api.GET('/v1/admin/restaurant-applications', {});
    expect(getToken()).toBeNull();
    vi.unstubAllGlobals();
  });
});
