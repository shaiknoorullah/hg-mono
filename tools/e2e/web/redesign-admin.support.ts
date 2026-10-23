import { expect, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';

/**
 * Shared steps for the redesigned admin console's specs (redesign-admin.*.spec.ts), on the mock
 * and on the real API alike.
 */

/** The console's sidebar. */
export const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });

/**
 * Sign out from the sidebar, then check the sign-in page shows the signed-out notice, the shell
 * is gone, and the work email is remembered for the next sign-in.
 */
export async function signOutAndExpectNotice(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('You’re signed out')).toBeVisible();
  await expect(page.getByText('You signed out of HalalGoes on this device. Sign in again to continue.')).toBeVisible();
  await expect(adminNav(page)).toHaveCount(0);
  await expect(page.getByLabel('Work email')).toHaveValue(email);
}

export type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT';

export const EMAIL = 'dev-admin@halalgoes.test';
export const PASSWORD = 'DevAdmin!2026-e2e';

/**
 * Serves `login` from the mock, rewriting the principal's roles to `role`. With `mfa`, the first
 * attempt without a `totp_code` is answered by the mock's `MFA_REQUIRED` fixture. With `accountId`,
 * the principal is that account, so a list holding the row with that id shows it as "You".
 */
export async function routeLogin(page: Page, role: StaffRole, opts: { mfa?: boolean; accountId?: string } = {}): Promise<string[]> {
  const sent: string[] = [];
  await page.route('**/v1/auth/login', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const body = request.postData() ?? '';
    sent.push(body);
    const hasCode = /"totp_code"/.test(body);
    if (opts.mfa && !hasCode) {
      const response = await route.fetch({
        headers: { ...request.headers(), 'x-mock-scenario': 'error_refund_mfa_required' },
      });
      return route.fulfill({ response });
    }
    const response = await route.fetch();
    const json = (await response.json()) as { data: { principal: { account_id: string; roles: { role: string }[] } } };
    json.data.principal.roles = [{ ...json.data.principal.roles[0], role, scope_type: 'GLOBAL' } as { role: string }];
    if (opts.accountId) json.data.principal.account_id = opts.accountId;
    return route.fulfill({ response, json });
  });
  return sent;
}

/**
 * The queue depths the boards draw beside the nav items: 4 restaurant applications and 2 rider
 * applications waiting, 2 failed refunds, 5 open disputes (`ASS/AdminSidebar`, counts "live").
 */
export const BOARD_QUEUE_DEPTH = { pending_restaurant_reviews: 4, pending_rider_reviews: 2, failed_refunds: 2, open_disputes: 5 } as const;

/**
 * Gives the console's live connection the first `admin.queue_depth` frame the boards' sidebar
 * counts come from. The mock server does not send one unless a realtime script is named, and its
 * scripts end on zeros; this passes the page's socket through to the mock and adds one frame right
 * after the page's subscription to `admin:ops` is granted (`contracts/websocket.md` §4).
 * E2E support only: no fixture is changed.
 */
export async function routeQueueDepth(page: Page, depth: Record<string, number> = BOARD_QUEUE_DEPTH): Promise<void> {
  await page.routeWebSocket(/\/v1\/ws/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      ws.send(message);
      try {
        const frame = JSON.parse(String(message)) as { type?: string; data?: { channel?: string } };
        if (frame.type === 'subscribed' && frame.data?.channel === 'admin:ops') {
          ws.send(
            JSON.stringify({
              id: '01J9ZQ0000000000000000QDEP',
              seq: 1,
              channel: 'admin:ops',
              type: 'admin.queue_depth',
              v: 1,
              ts: new Date().toISOString(),
              data: depth,
            }),
          );
        }
      } catch {
        /* not JSON: nothing to add */
      }
    });
  });
}

export async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}


/**
 * Waits for the screen to settle and captures it for its board. Shared because every
 * redesign-admin capture spec needs the same two steps, and the "Not built yet" guard is the
 * one that saves a confusing diff: a build older than the screen draws it, and that is the
 * build being stale rather than a state the board draws.
 */
export async function captureBoard(page: Page, boards: BoardFor): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, boards);
}

/** Signs in as `role`, then opens `hash` on the redesigned console. */
export async function signInAndOpen(page: Page, role: StaffRole, hash: string): Promise<void> {
  await routeLogin(page, role);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

// ── shared by the scenes that answer the queue, take-next and decision calls with `page.route` ──

const serverError = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });
const unanswered = () => new Promise<void>(() => undefined);

/** Records the signed-in reviewer's account id in `me.id` from the sign-in answer, for "claimed by you". */
export function trackAccountId(page: Page, me: { id: string }): void {
  page.on('response', async (res) => {
    if (res.url().endsWith('/v1/auth/login') && res.request().method() === 'POST') {
      try {
        me.id = (await res.json()).data.principal.account_id;
      } catch {
        /* the sign-in failed; the test says so */
      }
    }
  });
}

export type Failure = 'error' | 'never' | 'forbidden' | 'notfound' | 'session';

/** Answers a call the way `kind` says; `session` is the 401 the scene's console treats as an ended session. */
export function answerFailure(kind: Failure, route: Route, session: { code: string; message: string }): Promise<void> {
  const refuse = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message, request_id: 'req_e2e' } } });
  if (kind === 'error') return serverError(route);
  if (kind === 'never') return unanswered();
  if (kind === 'forbidden') return refuse(403, 'FORBIDDEN', 'No access.');
  if (kind === 'session') return refuse(401, session.code, session.message);
  return refuse(404, 'NOT_FOUND', 'Not found.');
}

/** Take next: the claimed application (`value`), nothing to take, or how the call goes wrong. */
export function answerTakeNext(route: Route, how: 'error' | 'never' | undefined, value: unknown): Promise<void> {
  if (how === 'error') return serverError(route);
  if (how === 'never') return unanswered();
  return route.fulfill({ json: { data: value ?? null } });
}

/** The queue's next page, reached by its cursor: its rows, or how the call goes wrong. */
export function answerMorePage(route: Route, more: unknown[] | 'error' | 'never' | undefined): Promise<void> {
  if (more === 'error') return serverError(route);
  if (more === 'never') return unanswered();
  return route.fulfill({ json: { data: more ?? [], meta: { next_cursor: null, has_more: false } } });
}
