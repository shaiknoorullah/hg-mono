/**
 * Shared steps for the restaurant redesign specs (`redesign-restaurant.*.spec.ts`), flag on.
 *
 * The API comes from `E2E_MODE` (`mode.ts`, shared by every web spec; real is the default):
 * - `mock`: the app on `pnpm mock`. A signed-in owner is seeded straight into the session
 *   store; operations whose restaurant fixture does not exist yet are answered here with
 *   `page.route` (each one names the fixture request it stands in for).
 * - `real`: the app on the real API. The owner is the seeded world's (`world.json` from
 *   tools/e2e/seed/seed.sh, as CI runs it) or, on a laptop running `make dev-reset`, the
 *   devworld `bismillah-grill` persona.
 *
 * Journeys that drive devworld scenarios (`make dev-scenario`, `make dev-journey`) need a
 * devworld database, which the CI world is not: they run only with `E2E_DEVWORLD=1`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { OUT } from '../lib/paths.mjs';
import { E2E_MODE, MOCK_API_URL } from './mode';

export const MODE = E2E_MODE;
export const MOCK_API = MOCK_API_URL;
/** The real API, as `tools/e2e/lib/api.mjs` reads it (the compose stack, or `make run`). */
export const REAL_API = process.env.E2E_API_URL ?? 'http://localhost:8080';
/** A devworld database is behind the real API (laptop runs), so scenarios can be driven. */
export const DEVWORLD = process.env.E2E_DEVWORLD === '1';

/** The live restaurant's owner on the real API: an override, the seeded world, else devworld. */
function liveOwner(): { email: string; password: string } {
  if (process.env.E2E_RESTAURANT_EMAIL && process.env.E2E_RESTAURANT_PASSWORD) {
    return { email: process.env.E2E_RESTAURANT_EMAIL, password: process.env.E2E_RESTAURANT_PASSWORD };
  }
  const worldFile = path.join(OUT, 'world.json');
  if (!DEVWORLD && existsSync(worldFile)) {
    const w = JSON.parse(readFileSync(worldFile, 'utf8')) as { password: string; restaurant: { ownerEmail: string } };
    return { email: w.restaurant.ownerEmail, password: w.password };
  }
  // services/hg/internal/devworld/personas.go
  return { email: 'bismillah-grill@seed.hg', password: 'Seed!2026' };
}

export const LIVE_OWNER = liveOwner();

const SESSION_KEY = 'hg_restaurant_session_v1';

/**
 * Mock mode: a restaurant owner's principal. The contract has only `principal_customer`
 * (w0-request: a `principal_restaurant_owner` fixture), so this re-scopes it to the
 * restaurant of `restaurant_profile`.
 */
async function restaurantPrincipal(page: Page) {
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
