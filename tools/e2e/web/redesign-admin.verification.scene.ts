import { expect, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';
import { at, failing, fixture, never, type Json } from './redesign-admin.rider-onboarding.scene';

/**
 * The scenes the Restaurant Verification specs draw (redesign-admin.verification-*.spec.ts): the
 * applications queue, one application, one halal certificate and the calls around them, answered
 * with `page.route`, which is the only way to give the stateless mock a claim held by the signed-in
 * reviewer, a record in a given state, or a call that fails on cue.
 *
 * Every board of the area is drawn at one clock (28 September 2026, 2:06 pm in Toronto), with the
 * claim on Karahi House ending at 2:48 pm, and every time on a scene is placed against it. The
 * records are built from the mock's own contract fixtures and changed only where the board's state
 * is about the changed field. What the boards draw as sample data (Karahi House, Noor Grill,
 * Zaytoun Grill) is used where a fixture can carry it; what it cannot (the fixtures' own ids,
 * the mock's dates) is listed in the pull request, with the issue that tracks it
 * (https://github.com/shaiknoorullah/hg-mono/issues/961).
 */

/** The clock every board of the area is drawn at. */
export const NOW = '2026-09-28T14:06:00-04:00';

/** A Toronto time on the boards' day (or another), as the API sends it. */
export const sep = (day: number, hh: number, mm = 0) =>
  at(`2026-09-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);

export const oct = (day: number, hh: number, mm = 0) =>
  at(`2026-10-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);

/** The end of the claim every board of the area draws. */
export const CLAIM_ENDS = sep(28, 14, 48);

/** The reviewer who holds the other claims. */
export const OTHER_REVIEWER = '5b1f6c2e-8a41-4c0d-9d3a-2f7e8c1b4a60';

// ── the fixtures the builders start from ─────────────────────────────────────

export interface Base {
  /** `restaurant_application_claimed_by_other`: an application in review, with its profile and documents. */
  app: Json;
  /** `halal_certificate_pending_transcribed_unchecked`: a transcribed certificate, nothing recorded. */
  cert: Json;
  /** `halal_certificate_pending_untranscribed`: a certificate with nothing typed in yet. */
  untranscribed: Json;
  /** `halal_certificate_support_projection`: what a support agent is sent. */
  support: Json;
  /** `halal_issuing_bodies_every_status`: the registry, in every status. */
  bodies: Json[];
}

async function loadBase(page: Page): Promise<Base> {
  const [app, cert, untranscribed, support, bodies] = await Promise.all([
    fixture(page, 'restaurant_application_claimed_by_other'),
    fixture(page, 'halal_certificate_pending_transcribed_unchecked'),
    fixture(page, 'halal_certificate_pending_untranscribed'),
    fixture(page, 'halal_certificate_support_projection'),
    fixture(page, 'halal_issuing_bodies_every_status'),
  ]);
  return { app, cert, untranscribed, support, bodies: bodies as unknown as Json[] };
}

/** What a scene's function is given when the page asks: the reviewer's account id, the id asked for, the fixtures. */
export interface Ctx {
  me: string;
  id: string;
  base: Base;
}

export type Answer<T> = T | ((c: Ctx) => T);
export type Failure = 'error' | 'never' | 'forbidden' | 'notfound' | 'session';

export interface Scene {
  role?: StaffRole;
  /** The clock; the board's by default. */
  now?: string;
  /** The queue's first page, or how the call fails. */
  list?: Answer<Json[]> | Failure;
  /** Rows by the query (`state`, `sla_breached`), for a scene whose rows depend on the filter. */
  listFor?: (query: URLSearchParams, c: Ctx) => Json[];
  /** The queue's next page, or how that call goes. */
  more?: Json[] | 'error' | 'never';
  hasMore?: boolean;
  /** Take next: the claimed application, `null` for nothing to take, or how the call goes wrong. */
  take?: Answer<Json | null> | 'error' | 'never';
  /** The application at `/restaurants/:id`, or how the call fails. */
  app?: Answer<Json> | Failure;
  /** The certificate at `/certificates/:id`, or how the call fails. */
  cert?: Answer<Json> | Failure;
  /** The issuing body registry: served from the fixture, or how the call fails. */
  bodies?: 'ok' | 'error' | 'never';
  /** Proposing an issuing body. */
  propose?: (route: Route, c: Ctx) => Promise<void>;
  /** The application decision (approve, reject, request changes). */
  decide?: (route: Route, c: Ctx) => Promise<void>;
  /** A restaurant document's review. */
  review?: (route: Route, c: Ctx) => Promise<void>;
  /** Recording checks. */
  record?: (route: Route, c: Ctx) => Promise<void>;
  /** The halal certificate ruling (approve, reject, revoke). */
  ruling?: (route: Route, c: Ctx) => Promise<void>;
  /** The private link for a scan. */
  link?: 'ok' | 'expired' | 'error' | 'never';
}

const resolve = <T>(a: Answer<T>, c: Ctx): T => (typeof a === 'function' ? (a as (c: Ctx) => T)(c) : a);

export const refuse = (route: Route, status: number, code: string, message: string, details?: unknown) =>
  route.fulfill({ status, json: { error: { code, message, request_id: 'req_e2e', ...(details === undefined ? {} : { details }) } } });

// A plain light scan: the board draws a placeholder page, the app shows the image it is given.
const SCAN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Routes the scene's calls, signs in as the scene's role and returns the reviewer's account id.
 * Nothing is opened: `openAt` does that.
 */
export async function arrive(page: Page, scene: Scene = {}): Promise<{ id: string }> {
  const me = { id: '' };
  const now = scene.now ?? NOW;
  const base = await loadBase(page);
  const ctx = (id = ''): Ctx => ({ me: me.id, id, base });
  await page.clock.setFixedTime(new Date(now));
  await routeLogin(page, scene.role ?? 'ADMIN');
  page.on('response', async (res) => {
    if (res.url().endsWith('/v1/auth/login') && res.request().method() === 'POST') {
      try {
        me.id = (await res.json()).data.principal.account_id;
      } catch {
        /* the sign-in failed; the test says so */
      }
    }
  });

  const failure = (kind: Failure, route: Route) => {
    if (kind === 'error') return failing(route);
    if (kind === 'never') return never();
    if (kind === 'forbidden') return refuse(route, 403, 'FORBIDDEN', 'No access.');
    if (kind === 'session') return refuse(route, 401, 'SESSION_EXPIRED', 'This session has expired. Please sign in again.');
    return refuse(route, 404, 'NOT_FOUND', 'Not found.');
  };

  await page.route(/\/v1\/admin\/restaurant-applications/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path.endsWith('/take-next')) {
      const t = scene.take;
      if (t === 'error') return failing(route);
      if (t === 'never') return never();
      if (t === undefined) return route.fulfill({ json: { data: null } });
      return route.fulfill({ json: { data: resolve(t, ctx()) } });
    }
    if (path.endsWith('/decision')) {
      if (scene.decide) return scene.decide(route, ctx(path.split('/').at(-2)));
      return route.fallback();
    }
    if (/\/restaurant-applications$/.test(path)) {
      if (url.searchParams.get('cursor')) {
        if (scene.more === 'error') return failing(route);
        if (scene.more === 'never') return never();
        return route.fulfill({ json: { data: scene.more ?? [], meta: { next_cursor: null, has_more: false } } });
      }
      const l = scene.list;
      if (typeof l === 'string') return failure(l, route);
      if (scene.listFor) return route.fulfill({ json: { data: scene.listFor(url.searchParams, ctx()), meta: { next_cursor: null, has_more: false } } });
      const rows = l === undefined ? [] : resolve(l, ctx());
      const more = scene.hasMore ?? false;
      return route.fulfill({ json: { data: rows, meta: { next_cursor: more ? 'next' : null, has_more: more } } });
    }
    const a = scene.app;
    if (a === undefined) return route.fallback();
    if (typeof a === 'string') return failure(a, route);
    const id = path.split('/').at(-1) ?? '';
    return route.fulfill({ json: { data: resolve(a, ctx(id)) } });
  });

  await page.route('**/v1/admin/restaurant-documents/*/review', (route) => (scene.review ? scene.review(route, ctx()) : route.fallback()));

  await page.route(/\/v1\/admin\/halal-certificates\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith('/checks')) return scene.record ? scene.record(route, ctx(path.split('/').at(-2))) : route.fallback();
    if (path.endsWith('/decision')) return scene.ruling ? scene.ruling(route, ctx(path.split('/').at(-2))) : route.fallback();
    const c = scene.cert;
    if (c === undefined) return route.fallback();
    if (typeof c === 'string') return failure(c, route);
    return route.fulfill({ json: { data: resolve(c, ctx(path.split('/').at(-1))) } });
  });

  await page.route(/\/v1\/admin\/halal-issuing-bodies/, async (route) => {
    if (route.request().method() === 'POST') return scene.propose ? scene.propose(route, ctx()) : route.fallback();
    const how = scene.bodies ?? 'ok';
    if (how === 'error') return failing(route);
    if (how === 'never') return never();
    return route.fulfill({ json: { data: base.bodies, meta: { next_cursor: null, has_more: false } } });
  });

  await page.route('**/v1/documents/*/download-url', async (route) => {
    const mode = scene.link ?? 'ok';
    if (mode === 'error') return failing(route);
    if (mode === 'never') return never();
    const when = mode === 'expired' ? new Date(new Date(now).getTime() - 1000) : new Date(new Date(now).getTime() + 2 * 60_000);
    return route.fulfill({ json: { data: { url: 'https://scans.e2e.test/scan.png', expires_at: when.toISOString() } } });
  });
  await page.route('https://scans.e2e.test/**', (route) => route.fulfill({ body: SCAN, contentType: 'image/png' }));
  return me;
}

/** Signs in, then opens `hash` (`#/restaurants`, `#/restaurants/<id>` or `#/certificates/<id>`). */
export async function openAt(page: Page, hash: string): Promise<void> {
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

/** Waits for the screen to settle and captures it for its board. */
export async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: that state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

/** Picks `option` in the control labelled `label`: a native select or the design system's listbox. */
export async function choose(page: Page, label: string | RegExp, option: string): Promise<void> {
  const control = page.getByLabel(label).first();
  if ((await control.evaluate((el) => el.tagName)) === 'SELECT') {
    await control.selectOption({ label: option });
    return;
  }
  await control.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// ── the queue ────────────────────────────────────────────────────────────────

export const KARAHI = { id: 'a1b2c3d4-0001-4000-8000-000000000001', certId: 'a1b2c3d4-0002-4000-8000-000000000001' };
export const NOOR = { id: 'a1b2c3d4-0001-4000-8000-000000000002', certId: 'a1b2c3d4-0002-4000-8000-000000000002' };
export const ZAYTOUN = { id: 'a1b2c3d4-0001-4000-8000-000000000003', certId: 'a1b2c3d4-0002-4000-8000-000000000003' };

export const row = (id: string, name: string, city: string, state: string, attempt: number, submitted: string, due: string, over: Json = {}): Json => ({
  restaurant_id: id,
  display_name: name,
  city,
  province: 'ON',
  onboarding_state: state,
  submission_count: attempt,
  assigned_admin_id: null,
  review_lock_expires_at: null,
  submitted_at: submitted,
  sla_due_at: due,
  ...over,
});

/** The queue board's restaurants, with the same claims, states and times. */
export const BAIT = row('a1b2c3d4-0001-4000-8000-0000000000b1', 'Bait Al Mandi', 'Toronto', 'DOCUMENTS_REVIEW', 2, sep(23, 16, 40), sep(25, 16, 40), {
  assigned_admin_id: OTHER_REVIEWER,
  review_lock_expires_at: sep(28, 14, 32),
});
export const SUFRA = row('a1b2c3d4-0001-4000-8000-0000000000b2', 'Sufra Kitchen', 'Mississauga', 'DOCUMENTS_REVIEW', 1, sep(25, 9, 14), sep(29, 11, 14));
export const karahiRow = (over: Json = {}) => row(KARAHI.id, 'Karahi House', 'Toronto', 'DOCUMENTS_REVIEW', 1, sep(25, 11, 2), sep(29, 13, 2), over);
export const ZAYTOUN_ROW = row(ZAYTOUN.id, 'Zaytoun Grill', 'Brampton', 'DOCUMENTS_REVIEW', 1, sep(26, 10, 30), sep(30, 8, 30));
export const TANDOOR = row('a1b2c3d4-0001-4000-8000-0000000000b4', 'Tandoor Lane', 'Markham', 'DOCUMENTS_REJECTED', 3, sep(21, 10, 20), sep(24, 10, 20));
export const AL_NOOR = row('a1b2c3d4-0001-4000-8000-0000000000b5', 'Al Noor Shawarma', 'Ottawa', 'DOCUMENTS_REVIEW', 1, sep(22, 13, 5), sep(25, 13, 5));

// ── documents ────────────────────────────────────────────────────────────────

export const DOC_ID = {
  BUSINESS_LICENCE: 'd0c00000-0000-4000-8000-000000000001',
  HALAL_CERTIFICATE: 'd0c00000-0000-4000-8000-000000000002',
  FOOD_SAFETY: 'd0c00000-0000-4000-8000-000000000003',
  OWNER_ID: 'd0c00000-0000-4000-8000-000000000004',
  LIABILITY_INSURANCE: 'd0c00000-0000-4000-8000-000000000005',
} as const;

export function kdoc(type: keyof typeof DOC_ID, state: string, over: Json = {}): Json {
  return {
    id: DOC_ID[type],
    subject_type: 'RESTAURANT',
    subject_id: KARAHI.id,
    doc_type: type,
    state,
    issuer: null,
    certificate_number: null,
    issued_on: null,
    valid_until: '2027-03-02',
    version: 1,
    rejection_reason_code: null,
    review_note: null,
    reviewed_at: state === 'APPROVED' || state === 'REJECTED' ? sep(27, 10) : null,
    created_at: sep(25, 11, 2),
    ...over,
  };
}

/** The documents the application boards open with: food safety in review, the halal certificate pending. */
export const reviewDocs = (): Json[] => [
  kdoc('BUSINESS_LICENCE', 'APPROVED', { valid_until: null }),
  kdoc('HALAL_CERTIFICATE', 'IN_REVIEW', { valid_until: '2027-01-14', certificate_number: 'HMA-ON-2026-0417', issuer: 'Halal Monitoring Authority (HMA Canada)' }),
  kdoc('FOOD_SAFETY', 'IN_REVIEW', { valid_until: '2027-03-02', issuer: 'Toronto Public Health' }),
  kdoc('OWNER_ID', 'APPROVED', { valid_until: '2029-06-09' }),
  kdoc('LIABILITY_INSURANCE', 'SUBMITTED', { valid_until: '2027-04-30', version: 2 }),
];

/** Every document approved, as the "nothing stops approval" board draws them. */
export const approvedDocs = (): Json[] => reviewDocs().map((d) => ({ ...d, state: 'APPROVED', reviewed_at: sep(28, 13, 40) }));

export const BLOCKERS = ['Required document not approved: FOOD_SAFETY', 'No approved halal certificate'];

// ── certificates ─────────────────────────────────────────────────────────────

const ALL = ['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH', 'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED'] as const;
export type Key = (typeof ALL)[number];
type Result = 'PASS' | 'FAIL' | 'NOT_ASSESSED';
const FIVE: Key[] = ['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'];

/** What a check holds: its recorded result (`null` for none yet), what the server computed, and whether it can be overridden. */
interface CheckSpec {
  result?: Result | null;
  computed?: Result;
  note?: string | null;
}

/** The seven checks of a Karahi House certificate; `recorded` names the ones the reviewer has recorded as Pass. */
export function checksOf(recorded: readonly Key[], over: Partial<Record<Key, CheckSpec>> = {}): Json[] {
  const when = sep(28, 13, 58);
  const computedOf: Record<Key, Result> = {
    H1_LEGIBLE_COMPLETE: 'NOT_ASSESSED',
    H2_ISSUER_ACCEPTED: 'PASS',
    H3_NAME_MATCH: 'PASS',
    H4_ADDRESS_MATCH: 'FAIL',
    H5_DATES_VALID: 'PASS',
    H6_SCOPE_SUFFICIENT: 'PASS',
    H7_UNIQUE_NOT_REUSED: 'PASS',
  };
  return ALL.map((key) => {
    const spec: CheckSpec = over[key] ?? {};
    const isRecorded = recorded.includes(key) || (spec.result !== undefined && spec.result !== null && spec.result !== 'NOT_ASSESSED');
    const result: Result = spec.result ?? (recorded.includes(key) ? 'PASS' : 'NOT_ASSESSED');
    return {
      check_key: key,
      result,
      computed_result: spec.computed ?? computedOf[key],
      overridable: key !== 'H5_DATES_VALID' && key !== 'H7_UNIQUE_NOT_REUSED',
      note: spec.note ?? null,
      checked_at: isRecorded ? when : null,
    };
  });
}

export const FIVE_RECORDED = FIVE;
export const ALL_RECORDED: readonly Key[] = ALL;

/** Karahi House's halal certificate as the verification board opens it: transcribed, five of seven checks recorded. */
export function karahiCert(c: Ctx, over: Json = {}): Json {
  return {
    ...c.base.cert,
    id: KARAHI.certId,
    restaurant_id: KARAHI.id,
    document_id: DOC_ID.HALAL_CERTIFICATE,
    certificate_number: 'HMA-ON-2026-0417',
    certified_legal_name: 'Karahi House Restaurant Inc.',
    certified_address: '3025 Kennedy Road, Unit 4, Scarborough ON M1V 1S3',
    scope: 'WHOLE_ESTABLISHMENT',
    issued_on: '2026-01-15',
    expires_on: '2027-01-14',
    status: 'PENDING',
    checks: checksOf(FIVE),
    ...over,
  };
}

/** The certificate with nothing typed in yet. */
export function untranscribedCert(c: Ctx, over: Json = {}): Json {
  return { ...c.base.untranscribed, id: KARAHI.certId, restaurant_id: KARAHI.id, document_id: DOC_ID.HALAL_CERTIFICATE, ...over };
}

/** A certificate that has been approved. */
export function approvedCert(c: Ctx, over: Json = {}): Json {
  return karahiCert(c, {
    status: 'APPROVED',
    checks: checksOf(ALL, { H4_ADDRESS_MATCH: { result: 'PASS', computed: 'FAIL', note: 'Same premises: Scarborough is part of Toronto and Kennedy Road is written out in full. Unit and postal code match. Page 1.' } }),
    verified_by: OTHER_REVIEWER,
    verified_at: sep(28, 14, 2),
    ...over,
  });
}

/** The application a certificate belongs to. */
export function karahiApp(c: Ctx, over: Json = {}): Json {
  const b = c.base.app;
  return {
    ...b,
    restaurant_id: KARAHI.id,
    display_name: 'Karahi House',
    city: 'Toronto',
    province: 'ON',
    onboarding_state: 'DOCUMENTS_REVIEW',
    submission_count: 1,
    assigned_admin_id: c.me,
    review_lock_expires_at: CLAIM_ENDS,
    submitted_at: sep(25, 11, 2),
    sla_due_at: sep(29, 13, 2),
    profile: {
      ...b.profile,
      id: KARAHI.id,
      legal_name: 'Karahi House Restaurant Inc.',
      display_name: 'Karahi House',
      account_state: 'PENDING',
      onboarding_state: 'DOCUMENTS_REVIEW',
      address: { ...b.profile.address, line1: '3025 Kennedy Road', line2: 'Unit 4', city: 'Scarborough', province: 'ON', postal_code: 'M1V 1S3' },
      halal: { display_state: 'UNVERIFIED', certifying_body_name: null, expires_on: null },
    },
    documents: reviewDocs(),
    halal_certificate: karahiCert(c),
    blockers: BLOCKERS,
    address_pin_warning: null,
    ...over,
  };
}

/** The same application, the way the consoles open it from a certificate: with that certificate inside it. */
export function appWith(c: Ctx, cert: Json, over: Json = {}): Json {
  return karahiApp(c, { halal_certificate: cert, ...over });
}

/** Noor Grill, a live restaurant whose certificate was approved on 20 October 2025. */
export function noorApp(c: Ctx, cert: Json, over: Json = {}): Json {
  const app = karahiApp(c, { halal_certificate: cert, ...over });
  return {
    ...app,
    restaurant_id: NOOR.id,
    display_name: 'Noor Grill',
    onboarding_state: 'ACTIVE',
    assigned_admin_id: null,
    review_lock_expires_at: null,
    blockers: [],
    ...over,
    profile: {
      ...app.profile,
      id: NOOR.id,
      legal_name: 'Noor Grill Inc.',
      display_name: 'Noor Grill',
      account_state: 'LIVE',
      onboarding_state: 'ACTIVE',
      address: { ...app.profile.address, line1: '1880 Eglinton Avenue East', line2: null, city: 'Toronto', province: 'ON', postal_code: 'M1L 2L1' },
      halal: { display_state: 'CERTIFIED', certifying_body_name: 'Halal Monitoring Authority (HMA Canada)', expires_on: '2026-10-19' },
      ...(over.profile ?? {}),
    },
  };
}

export function noorCert(c: Ctx, over: Json = {}): Json {
  return approvedCert(c, {
    id: NOOR.certId,
    restaurant_id: NOOR.id,
    certificate_number: 'HMA-ON-2025-0981',
    certified_legal_name: 'Noor Grill Inc.',
    certified_address: '1880 Eglinton Avenue East, Toronto ON M1L 2L1',
    issued_on: '2025-10-20',
    expires_on: '2026-10-19',
    verified_at: at('2025-10-20T10:52:00-04:00'),
    checks: checksOf(ALL, { H4_ADDRESS_MATCH: { result: 'PASS', computed: 'PASS' } }),
    ...over,
  });
}
