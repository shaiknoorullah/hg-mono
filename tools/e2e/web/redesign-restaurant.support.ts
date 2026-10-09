/**
 * Shared steps for the restaurant redesign specs (`redesign-restaurant.*.spec.ts`), flag on.
 *
 * Two modes, from `E2E_MODE` (MASTER-PLAN §5.1):
 * - `mock` (default): the app on `pnpm mock`. A signed-in owner is seeded straight into the
 *   session store; operations whose restaurant fixture does not exist yet are answered here
 *   with `page.route` (each one names the fixture request it stands in for).
 * - `real`: the app on `services/hg` with devworld personas (`make dev-reset`), signing in
 *   through the sign-in page.
 */
import type { Page } from '@playwright/test';

export const MODE = (process.env.E2E_MODE ?? 'mock') as 'mock' | 'real';
export const MOCK_API = process.env.E2E_API_URL ?? 'http://localhost:4010';

/** devworld's live restaurant persona (services/hg/internal/devworld/personas.go). */
export const LIVE_OWNER = { email: process.env.E2E_RESTAURANT_EMAIL ?? 'owner@bismillahgrill.test', password: 'Seed!2026' };

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
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(LIVE_OWNER.email);
  await page.getByLabel(/password/i).fill(LIVE_OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(orders|onboarding)/);
  if (!path.startsWith('/orders') || path !== '/orders') await page.goto(path);
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
