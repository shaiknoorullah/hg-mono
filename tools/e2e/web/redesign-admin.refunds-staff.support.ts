import { expect, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

/**
 * What the Refunds and Staff capture specs (redesign-admin.refunds*.spec.ts,
 * redesign-admin.staff*.spec.ts) share: answering a call from the mock by scenario name, a call
 * that never answers, and the capture step. Mock mode only; nothing here talks to a real API.
 */

export const MOCK = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';

/** The clock the contract fixtures are written against (contracts/fixtures/index.json, `frozen_clock`). */
export const FROZEN_CLOCK = new Date('2026-08-10T18:42:11.412Z');

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- contract fixtures are JSON

export const envelope = (code: string, message: string) => ({ error: { code, message, request_id: 'req_e2e' } });
export const never = () => new Promise<void>(() => undefined);

/** Answers the request with the fixture `name`, as the mock server serves it (status included). */
export async function serve(route: Route, name: string): Promise<void> {
  const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': name } });
  await route.fulfill({ response });
}
export const fixture = (name: string) => (route: Route) => serve(route, name);

/** A refusal or failure the contract has no fixture for, in the contract's error envelope. */
export const refuse = (status: number, code: string, message: string) => (route: Route) =>
  route.fulfill({ status, json: envelope(code, message) });

export const failing = refuse(500, 'INTERNAL_ERROR', 'boom');

/** The id of the order a fixture describes, so the address names an order the list could hold. */
export async function orderIdOf(page: Page, scenario: string): Promise<string> {
  const response = await page.request.get(`${MOCK}/v1/admin/orders/any?scenario=${scenario}`);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/**
 * Takes the capture for `board`. `idle: false` is for a state with a request that is meant to stay
 * open, where the page never goes idle.
 */
export async function shoot(page: Page, board: BoardFor, { idle = true }: { idle?: boolean } = {}): Promise<void> {
  await page.waitForLoadState(idle ? 'networkidle' : 'load');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

/** Picks `option` in the select labelled `label`: a native select or the design system's listbox. */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  const control = page.getByLabel(label, { exact: true }).first();
  if ((await control.evaluate((el) => el.tagName)) === 'SELECT') {
    await control.selectOption({ label: option });
    return;
  }
  await control.click();
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`^${escaped}`) }).first().click();
}

type Handler = (route: Route) => Promise<void>;

/** What the admin pages call on the mock; each is answered by its handler, or by the plainest fixture. */
export interface AdminRoutes {
  /** `GET /v1/admin/orders`: the orders list, and the Refunds page's lookup by code. */
  list?: Handler;
  /** `GET /v1/admin/orders/{id}`. */
  order?: Handler;
  /** `GET /v1/admin/refunds`: the failed-refunds queue. */
  failed?: Handler;
  /** `POST /v1/admin/refunds`: issuing a refund. */
  issue?: Handler;
}

const LIST = /\/v1\/admin\/orders(\?.*)?$/;
const ORDER = /\/v1\/admin\/orders\/[^/?]+(\?.*)?$/;
const REFUNDS = /\/v1\/admin\/refunds(\?.*)?$/;

/** Signs in as `role` with the fixtures' clock, routes the calls and opens `hash`. */
export async function openAdmin(page: Page, hash: string, { role = 'ADMIN', ...routes }: AdminRoutes & { role?: StaffRole } = {}): Promise<void> {
  await routeLogin(page, role);
  await page.clock.install({ time: FROZEN_CLOCK });
  if (routes.list) await page.route(LIST, routes.list);
  if (routes.order) await page.route(ORDER, routes.order);
  const failed = routes.failed ?? fixture('admin_refund_queue_empty');
  const issue = routes.issue ?? fixture('refund_submitted');
  await page.route(REFUNDS, (route) => (route.request().method() === 'POST' ? issue(route) : failed(route)));
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

/** An empty page of a list, as the contract sends one. */
export const emptyPage = (route: Route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } });
