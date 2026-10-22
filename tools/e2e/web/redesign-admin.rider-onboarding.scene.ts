import { expect, type Page, type Route } from '@playwright/test';

import { answerFailure, answerMorePage, answerTakeNext, routeLogin, signIn, trackAccountId, type Failure, type StaffRole } from './redesign-admin.support';

export type { Failure };

/**
 * The scenes the rider onboarding specs draw (redesign-admin.rider-onboarding*.spec.ts): a rider
 * application, a queue page, and the calls around them, answered with `page.route`.
 *
 * Every board of the area is drawn at one clock (28 September 2026, 2:32 pm in Toronto), and every
 * time on a scene is placed against it, so "42 min left" and "Due 30 Sep, 9:55 am" read as the board
 * reads them. The rider applications are built from the mock's own contract fixtures and changed
 * only where the board's state is about the changed field.
 */

const MOCK_API = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';

/** The clock every board of the area is drawn at. */
export const NOW = '2026-09-28T14:32:00-04:00';

/** A local Toronto time on the board's day (or another), as the API sends it. */
export const at = (iso: string): string => new Date(iso).toISOString();
export const sep = (day: number, hh: number, mm = 0) => at(`2026-09-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);
export const oct = (day: number, hh: number, mm = 0) => at(`2026-10-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- contract fixtures are JSON

export async function fixture(page: Page, name: string): Promise<Json> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

export const envelope = (code: string, message: string) => ({ error: { code, message, request_id: 'req_e2e' } });
export const failing = (route: Route) => route.fulfill({ status: 500, json: envelope('INTERNAL_ERROR', 'boom') });
export const never = () => new Promise<void>(() => undefined);

/** The signed-in reviewer's account id, read from the sign-in answer, for "claimed by you". */
export interface Me {
  id: string;
}

/** A rider's account id on the boards, and the reviewer who holds the other claims. */
export const OTHER_REVIEWER = '5b1f6c2e-8a41-4c0d-9d3a-2f7e8c1b4a60';

export interface DocSpec {
  type: 'DRIVERS_LICENCE' | 'VEHICLE_REGISTRATION' | 'VEHICLE_INSURANCE' | 'GOVERNMENT_ID' | 'WORK_ELIGIBILITY' | 'PROFILE_PHOTO';
  state: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  version?: number;
  /** The date the document stops being valid, `YYYY-MM-DD`; null for a document with no expiry. */
  valid: string | null;
  reason?: string;
  note?: string;
}

let docCounter = 0;
export function doc(rider: string, spec: DocSpec): Json {
  docCounter += 1;
  return {
    id: `d0c00000-0000-4000-8000-${String(docCounter).padStart(12, '0')}`,
    subject_type: 'RIDER',
    subject_id: rider,
    doc_type: spec.type,
    state: spec.state,
    issuer: null,
    certificate_number: null,
    issued_on: null,
    valid_until: spec.valid,
    version: spec.version ?? 1,
    rejection_reason_code: spec.reason ?? null,
    review_note: spec.note ?? null,
    reviewed_at: spec.state === 'APPROVED' || spec.state === 'REJECTED' ? sep(27, 10) : null,
    created_at: sep(26, 17, 40),
  };
}

export interface RiderSpec {
  id: string;
  first: string;
  last: string;
  email: string;
  dob: string | null;
  vehicle: null | { type: 'CAR' | 'SCOOTER' | 'MOTORCYCLE'; make: string; model: string; year: number; colour: string; plate: string };
  vehicleType: 'CAR' | 'SCOOTER' | 'MOTORCYCLE' | 'BICYCLE' | 'ON_FOOT' | null;
  attempt: number;
  age: number | null;
}

export const FATIMA: RiderSpec = {
  id: '0192f3a1-7c2e-7b10-9f4d-1a2b3c4d9c1a',
  first: 'Fatima',
  last: 'Noor',
  email: 'fatima.noor@gmail.com',
  dob: '1994-03-12',
  vehicle: { type: 'CAR', make: 'Toyota', model: 'Corolla', year: 2019, colour: 'Grey', plate: 'CKRT 482' },
  vehicleType: 'CAR',
  attempt: 2,
  age: 32,
};

/** The documents a motorised rider has when the board opens: insurance in review, work eligibility waiting. */
export const motorisedDocs = (rider: string): Json[] => [
  doc(rider, { type: 'DRIVERS_LICENCE', state: 'APPROVED', version: 2, valid: '2029-05-14' }),
  doc(rider, { type: 'VEHICLE_REGISTRATION', state: 'APPROVED', valid: '2027-02-02' }),
  doc(rider, { type: 'VEHICLE_INSURANCE', state: 'IN_REVIEW', version: 2, valid: '2027-08-31' }),
  doc(rider, { type: 'WORK_ELIGIBILITY', state: 'SUBMITTED', valid: '2028-07-15' }),
  doc(rider, { type: 'PROFILE_PHOTO', state: 'APPROVED', valid: null }),
];

export const withState = (docs: Json[], type: DocSpec['type'], over: Partial<Json>): Json[] => docs.map((d) => (d.doc_type === type ? { ...d, ...over } : d));
export const allApproved = (docs: Json[]): Json[] => docs.map((d) => (d.state === 'SUPERSEDED' ? d : { ...d, state: 'APPROVED' }));

/** A rider application as `getRiderApplication` answers, claimed by `holder` until `lock`. */
export function application(spec: RiderSpec, over: Json = {}): Json {
  return {
    rider_account_id: spec.id,
    display_name: `${spec.first} ${spec.last}`,
    vehicle_type: spec.vehicleType,
    onboarding_state: 'DOCUMENTS_REVIEW',
    attempt_number: spec.attempt,
    assigned_admin_id: null,
    review_lock_expires_at: null,
    submitted_at: sep(26, 17, 55),
    sla_due_at: sep(30, 9, 55),
    profile: {
      account_id: spec.id,
      first_name: spec.first,
      last_name: spec.last,
      email: spec.email,
      date_of_birth: spec.dob,
      timezone: 'America/Toronto',
    },
    vehicle: spec.vehicle
      ? { id: 'f357de8b-9b71-4406-a7ac-69d1612c5b63', vehicle_type: spec.vehicle.type, make: spec.vehicle.make, model: spec.vehicle.model, year: spec.vehicle.year, colour: spec.vehicle.colour, licence_plate: spec.vehicle.plate, is_active: true }
      : null,
    documents: [],
    computed_age_years: spec.age,
    blockers: [],
    ...over,
  };
}

export function summaryOf(app: Json, over: Json = {}): Json {
  return {
    rider_account_id: app.rider_account_id,
    display_name: app.display_name,
    vehicle_type: app.vehicle_type,
    onboarding_state: app.onboarding_state,
    attempt_number: app.attempt_number,
    assigned_admin_id: app.assigned_admin_id,
    review_lock_expires_at: app.review_lock_expires_at,
    submitted_at: app.submitted_at,
    sla_due_at: app.sla_due_at,
    ...over,
  };
}

/** What a scene's call answers: a body, the way it goes wrong, or a function of the reviewer's id. */
export type Answer<T> = T | ((me: string) => T);

export interface Scene {
  role?: StaffRole;
  /** The clock; the board's by default. */
  now?: string;
  /** The queue's first page, or how the call fails. */
  list?: Answer<Json[]> | Failure;
  /** Rows by the `state` filter, for a scene that filters. */
  listFor?: (states: string[], me: string) => Json[];
  /** The queue's next page (reached by its cursor). */
  more?: Json[] | 'error' | 'never';
  hasMore?: boolean;
  /** Take next: the claimed application, `null` for nothing to take, or how the call goes wrong. */
  take?: Answer<Json | null> | 'error' | 'never';
  /** The application at `/riders/:id`, or how the call fails. */
  detail?: Json | ((me: string, id: string) => Json) | Failure;
  /** The private link for a scan. */
  link?: 'ok' | 'expired' | 'error' | 'never' | 'forbidden' | 'loading';
  /** What the private link serves: a scan, or a file the browser cannot draw. */
  scan?: 'ok' | 'broken';
  /** The document review call. */
  review?: (route: Route, me: string) => Promise<void>;
  /** The decision call. */
  decision?: (route: Route, me: string) => Promise<void>;
}

const resolve = <T>(a: Answer<T>, me: string): T => (typeof a === 'function' ? (a as (m: string) => T)(me) : a);

// A plain light scan: the board draws a placeholder page, the app shows the image it is given.
const SCAN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Routes the scene's calls, signs in as the scene's role and returns the reviewer's account id.
 * Nothing is opened: `goto` does that.
 */
export async function arrive(page: Page, scene: Scene = {}): Promise<Me> {
  const me: Me = { id: '' };
  const now = scene.now ?? NOW;
  await page.clock.setFixedTime(new Date(now));
  await routeLogin(page, scene.role ?? 'ADMIN');
  trackAccountId(page, me);

  const failure = (kind: Failure, route: Route) => answerFailure(kind, route, { code: 'UNAUTHENTICATED', message: 'Session ended.' });

  await page.route(/\/v1\/admin\/rider-applications/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path.endsWith('/take-next')) {
      const t = scene.take;
      return answerTakeNext(route, t === 'error' || t === 'never' ? t : undefined, t === 'error' || t === 'never' || t === undefined ? null : resolve(t, me.id));
    }
    if (path.endsWith('/decision')) {
      if (scene.decision) return scene.decision(route, me.id);
      return route.fallback();
    }
    if (/\/rider-applications$/.test(path)) {
      if (url.searchParams.get('cursor')) return answerMorePage(route, scene.more);
      const l = scene.list;
      if (typeof l === 'string') return failure(l, route);
      if (scene.listFor) {
        const states = (url.searchParams.get('state') ?? '').split(',').filter(Boolean);
        return route.fulfill({ json: { data: scene.listFor(states, me.id), meta: { next_cursor: null, has_more: false } } });
      }
      const rows = l === undefined ? [] : resolve(l, me.id);
      const more = scene.hasMore ?? false;
      return route.fulfill({ json: { data: rows, meta: { next_cursor: more ? 'next' : null, has_more: more } } });
    }
    const d = scene.detail;
    if (d === undefined) return route.fallback();
    if (typeof d === 'string') return failure(d, route);
    const id = path.split('/').pop() ?? '';
    return route.fulfill({ json: { data: typeof d === 'function' ? d(me.id, id) : d } });
  });

  await page.route('**/v1/admin/rider-documents/*/review', (route) => (scene.review ? scene.review(route, me.id) : route.fallback()));

  await page.route('**/v1/documents/*/download-url', async (route) => {
    const mode = scene.link ?? 'ok';
    if (mode === 'error') return failing(route);
    if (mode === 'never' || mode === 'loading') return never();
    if (mode === 'forbidden') return route.fulfill({ status: 403, json: envelope('FORBIDDEN', 'No access.') });
    const at = mode === 'expired' ? new Date(new Date(now).getTime() - 1000) : new Date(new Date(now).getTime() + 2 * 60_000);
    return route.fulfill({ json: { data: { url: 'https://scans.e2e.test/scan.png', expires_at: at.toISOString() } } });
  });
  await page.route('https://scans.e2e.test/**', (route) =>
    route.fulfill({ body: scene.scan === 'broken' ? Buffer.from('not an image') : SCAN, contentType: 'image/png' }),
  );
  return me;
}

/** Signs in, then opens `hash` (`#/riders` or `#/riders/<id>`). */
export async function openAt(page: Page, hash: string): Promise<void> {
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}
