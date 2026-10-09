/**
 * The customer session over the wire. Every request carries the signed-in customer's bearer and
 * goes to the configured API, never a hard-coded host. When the access token expires (401) the
 * app exchanges the refresh token exactly once — even for parallel requests, since the token
 * rotates — and retries the request once. A failed exchange signs the customer out and surfaces
 * the 401; it never loops.
 */
import { API_BASE_URL } from '../config';
import { getRefreshToken, getToken, setToken } from '../token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const unauthorized = () => json(401, { error: { code: 'unauthenticated', message: 'expired' } });
const cart = () => json(200, { data: { lines: [] } });

const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input));
const isRefresh = (input: RequestInfo | URL) => urlOf(input).endsWith('/v1/auth/refresh');
const bearerOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.headers.get('Authorization') : null;

// The api client reads `globalThis.fetch` once, when client.ts is first imported, so the spy is
// installed before that require and kept for the whole file (see LoginGate.test.tsx).
const fetchSpy = jest.spyOn(globalThis, 'fetch');
const { api } = require('../client') as typeof import('../client');

afterEach(() => {
  fetchSpy.mockReset();
  setToken(null);
});

afterAll(() => fetchSpy.mockRestore());

test('requests carry the stored bearer and go to the configured API', async () => {
  setToken('access-1', 'hgrt_1');
  fetchSpy.mockImplementation(async () => cart());

  await api.GET('/v1/cart');

  const req = fetchSpy.mock.calls[0][0] as Request;
  expect(req.url).toBe(`${API_BASE_URL}/v1/cart`);
  expect(req.headers.get('Authorization')).toBe('Bearer access-1');
  expect(req.headers.get('X-HG-Client')).toBe('customer-app');
  // No env set under test: the local mock, never a production host baked into the bundle.
  expect(API_BASE_URL).toBe('http://localhost:4010');
});

test('parallel 401s share one refresh, then each request is retried once with the new token', async () => {
  setToken('stale', 'hgrt_old');
  fetchSpy.mockImplementation(async (input) => {
    if (isRefresh(input)) return json(200, { data: { access_token: 'fresh', refresh_token: 'hgrt_new' } });
    return bearerOf(input) === 'Bearer fresh' ? cart() : unauthorized();
  });

  const [a, b] = await Promise.all([api.GET('/v1/cart'), api.GET('/v1/cart')]);

  expect(a.response.status).toBe(200);
  expect(b.response.status).toBe(200);
  const refreshes = fetchSpy.mock.calls.filter(([input]) => isRefresh(input));
  expect(refreshes).toHaveLength(1);
  const [url, init] = refreshes[0] as [string, RequestInit];
  expect(url).toBe(`${API_BASE_URL}/v1/auth/refresh`);
  expect(JSON.parse(init.body as string)).toEqual({ refresh_token: 'hgrt_old' });
  // Two originals, one refresh, two retries.
  expect(fetchSpy).toHaveBeenCalledTimes(5);
  expect(getToken()).toBe('fresh');
  expect(getRefreshToken()).toBe('hgrt_new');
});

test('a grant without a new refresh token keeps the current one', async () => {
  setToken('stale', 'hgrt_keep');
  fetchSpy.mockImplementation(async (input) => {
    if (isRefresh(input)) return json(200, { data: { access_token: 'fresh', refresh_token: null } });
    return bearerOf(input) === 'Bearer fresh' ? cart() : unauthorized();
  });

  await api.GET('/v1/cart');

  expect(getToken()).toBe('fresh');
  expect(getRefreshToken()).toBe('hgrt_keep');
});

test('a refused refresh signs the customer out and surfaces the 401 without looping', async () => {
  setToken('stale', 'hgrt_revoked');
  fetchSpy.mockImplementation(async (input) => (isRefresh(input) ? json(401, {}) : unauthorized()));

  const { response } = await api.GET('/v1/cart');

  expect(response.status).toBe(401);
  expect(fetchSpy).toHaveBeenCalledTimes(2); // the original and one refresh, no retry
  expect(getToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
});

test('a 401 with no refresh token signs out without calling refresh', async () => {
  setToken('stale');
  fetchSpy.mockImplementation(async () => unauthorized());

  const { response } = await api.GET('/v1/cart');

  expect(response.status).toBe(401);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(getToken()).toBeNull();
});
