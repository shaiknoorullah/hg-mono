/**
 * Shared steps for the restaurant redesign specs (`redesign-restaurant.*.spec.ts`), flag on.
 *
 * The API comes from `E2E_MODE` (`mode.ts`, shared by every web spec; real is the default):
 * - `mock`: the app on `pnpm mock`. A signed-in owner is seeded straight into the session
 *   store; operations whose restaurant fixture does not exist yet are answered here with
 *   `page.route` (each one names the fixture request it stands in for).
 * - `real`: the app on the real API, signed in as the live restaurant's owner (`LIVE_OWNER`).
 *
 * Journeys that drive devworld scenarios (`make dev-scenario`, `make dev-journey`) need a
 * devworld database, which the CI world is not: they run only with `E2E_DEVWORLD=1`.
 */
import type { Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUT } from '../lib/paths.mjs';
import { E2E_MODE, MOCK_API_URL } from './mode';

export const MODE = E2E_MODE;
export const MOCK_API = MOCK_API_URL;
/** The real API (`make run`, or the compose stack through Traefik), as `lib/api.mjs` reads it. */
export const REAL_API = process.env.E2E_REAL_API_URL ?? process.env.E2E_API_URL ?? 'http://localhost:8080';
/** A devworld database is behind the real API (laptop runs), so scenarios can be driven. */
export const DEVWORLD = process.env.E2E_DEVWORLD === '1';

/**
 * Who real mode signs in as. The e2e stack (tools/e2e/stack/up.sh + seed/seed.sh, what CI runs)
 * seeds its own world and writes its owner and this run's password to $E2E_OUT/world.json; a local
 * devworld (`make dev-reset`, or any run with E2E_DEVWORLD=1) uses its live restaurant persona
 * (services/hg/internal/devworld/personas.go). E2E_RESTAURANT_EMAIL / E2E_RESTAURANT_PASSWORD
 * override either.
 */
export const LIVE_OWNER = liveOwner();

function liveOwner(): { email: string; password: string } {
  const worldFile = path.join(OUT, 'world.json');
  const seeded =
    !DEVWORLD && existsSync(worldFile)
      ? (JSON.parse(readFileSync(worldFile, 'utf8')) as { restaurant: { ownerEmail: string }; password: string })
      : null;
  return {
    email: process.env.E2E_RESTAURANT_EMAIL ?? seeded?.restaurant.ownerEmail ?? 'bismillah-grill@seed.hg',
    password: process.env.E2E_RESTAURANT_PASSWORD ?? seeded?.password ?? 'Seed!2026',
  };
}

const SESSION_KEY = 'hg_restaurant_session_v1';

/**
 * Mock mode: a restaurant owner's principal. The contract has only `principal_customer`
 * (w0-request: a `principal_restaurant_owner` fixture), so this re-scopes it to the
 * restaurant of `restaurant_profile`.
 */
export async function restaurantPrincipal(page: Page) {
  const [principal, profile] = await Promise.all([
    page.request.get(`${MOCK_API}/__mock/scenarios/principal_customer`).then((r) => r.json()),
    page.request.get(`${MOCK_API}/__mock/scenarios/restaurant_profile`).then((r) => r.json()),
  ]);
  return {
    ...principal.data.payload,
    amr: 'pwd',
    roles: [{ role: 'RESTAURANT_OWNER', scope_type: 'RESTAURANT', scope_id: profile.data.payload.id }],
  };
}

type Grant = { access_token: string; principal: { account_id: string } };
let grantOnce: Promise<Grant> | null = null;

/**
 * One sign-in per test worker: the API rate-limits sign-in per account (10 a window), and
 * an access token outlives a spec file.
 */
function realGrant(page: Page): Promise<Grant> {
  grantOnce ??= (async () => {
    const res = await page.request.post(`${REAL_API}/v1/auth/login`, {
      headers: { 'X-HG-Client': 'restaurant-web', 'Content-Type': 'application/json' },
      data: { email: LIVE_OWNER.email, password: LIVE_OWNER.password },
    });
    if (!res.ok()) throw new Error(`sign-in as ${LIVE_OWNER.email} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()).data as Grant;
  })();
  return grantOnce;
}

/**
 * Real mode: the live owner's access token, for a spec that checks the server's state itself.
 * The app keeps its session in memory only (no token in `localStorage`), so a spec reads the
 * worker's own sign-in, the same session `openSignedIn` hands the page.
 */
export async function liveAccessToken(page: Page): Promise<string> {
  return (await realGrant(page)).access_token;
}

/** Opens `path` signed in as the live restaurant's owner. */
export async function openSignedIn(page: Page, path: string): Promise<void> {
  if (MODE === 'mock') {
    const principal = await restaurantPrincipal(page);
    await page.route('**/v1/auth/me', (route) => route.fulfill({ json: { data: principal } }));
    await page.addInitScript(
      ([key]) => window.localStorage.setItem(key!, JSON.stringify({ accessToken: 'mock-access-token' })),
      [SESSION_KEY],
    );
    await page.goto(path);
    return;
  }
  // Real mode signs in through the API (the sign-in screen has its own spec), then opens the
  // page with that session, exactly as a reload after signing in would.
  const grant = await realGrant(page);
  await page.addInitScript(
    ([key, token, account]) => window.localStorage.setItem(key!, JSON.stringify({ accessToken: token, accountId: account })),
    [SESSION_KEY, grant.access_token, grant.principal.account_id],
  );
  await page.goto(path);
}

/**
 * Opens a console page signed in and passes the go-live gate on /orders the way a person does
 * (one click: test chime, notifications, screen kept awake), so the board under it shows.
 */
export async function openLive(page: Page, path: string): Promise<void> {
  await page.context().grantPermissions(['notifications']);
  await openSignedIn(page, path);
  await page.getByRole('button', { name: 'Turn on sound and go live' }).click();
  await page.getByTestId('go-live-gate').waitFor({ state: 'detached' });
}

/** The page never scrolls: the document is exactly the viewport (manifest WP1 DONE). */
export async function documentScrolls(page: Page): Promise<{ scrollHeight: number; innerHeight: number; scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.scrollingElement!.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

/** A fixture's payload from the mock server (`GET /__mock/scenarios/<name>`). */
export async function scenarioPayload<T = any>(page: Page, name: string): Promise<T> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

/** The restaurant's calendar date ("YYYY-MM-DD", Toronto), `days` from today. */
export function torontoDateIn(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * A restaurant whose last check-in was just now, whatever the mock's availability fixture says (its
 * `last_heartbeat_at` is a fixed past date). The app bar's "checked in … ago" counts from it. Register
 * it before a spec's own availability route, which takes precedence.
 */
export async function freshCheckIn(page: Page): Promise<void> {
  await page.route('**/v1/restaurant/availability', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { data?: Record<string, unknown> };
    return route.fulfill({ response: res, json: { ...body, data: { ...body.data, last_heartbeat_at: new Date().toISOString() } } });
  });
}

/**
 * The board's app bar says "Live · checked in 12 s ago"; a live page says however long it has been
 * since its last check-in. Before a capture, move the page's clock (which then stands still) so the
 * time reads `seconds`, as the board's sample does. Does nothing when the badge is not the live one
 * (offline, connecting, or a page without the compact frame's badges).
 */
export async function pinCheckedIn(page: Page, seconds = 12): Promise<void> {
  const badge = page.getByTestId('health-badge').first();
  const shown = async (): Promise<number | null> => {
    const text = (await badge.textContent({ timeout: 1000 }).catch(() => null)) ?? '';
    const m = /^Live · checked in (\d+) (s|min|h) ago$/.exec(text.trim());
    return m ? Number(m[1]) * { s: 1, min: 60, h: 3600 }[m[2] as 's' | 'min' | 'h'] : null;
  };
  let n = await shown();
  if (n === null) return;
  let at = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    // The page's clock stands still once fixed, so what it shows is stable and each correction is exact.
    at += (seconds - n) * 1000;
    await page.clock.setFixedTime(new Date(at));
    await page.waitForTimeout(1200); // the badge reads the clock once a second
    n = await shown();
    if (n === null || n === seconds) return;
  }
}
