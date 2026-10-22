/**
 * Shared by the restaurant Onboarding capture specs (`redesign-restaurant.onboarding-captures.spec.ts`
 * and `redesign-restaurant.onboarding-unpairable.spec.ts`): how a state is served on the mock API
 * with `page.route`, and how the upload road is walked. Mock mode only.
 */
import type { Page } from '@playwright/test';

import { openSignedIn, scenarioPayload as fixture } from './redesign-restaurant.support';

export const never = () => new Promise<void>(() => undefined);
export const problem = (status: number, code: string, details?: unknown[]) => ({
  status,
  json: { error: { code, message: code, request_id: 'req_e2e', ...(details ? { details } : {}) } },
});

/** A fixture by name, a payload, or how the call goes wrong. */
export type Src = string | { payload: unknown } | { status: number } | 'never' | 'abort';

export async function answer(page: Page, glob: string | RegExp, src: Src, patch?: (payload: any) => any) {
  if (src === 'never') return page.route(glob, never);
  if (src === 'abort') return page.route(glob, (route) => route.abort());
  if (typeof src === 'object' && 'status' in src) {
    return page.route(glob, (route) => route.fulfill(problem(src.status, 'INTERNAL_ERROR')));
  }
  const payload = typeof src === 'string' ? await fixture(page, src) : src.payload;
  const data = patch ? patch(structuredClone(payload)) : payload;
  return page.route(glob, (route) => route.fulfill({ json: { data } }));
}

export const STATUS = {
  profile: 'restaurant_onboarding_profile_pending',
  documents: 'restaurant_onboarding_documents_pending',
  review: 'restaurant_onboarding_documents_review',
  approved: 'restaurant_onboarding_documents_approved',
  fix: 'restaurant_onboarding_documents_rejected',
  payout: 'restaurant_onboarding_payout_pending',
  menu: 'restaurant_onboarding_menu_pending',
  done: 'restaurant_onboarding_active',
} as const;

export interface Scene {
  status: Src;
  statusPatch?: (s: any) => any;
  profile?: Src;
  docs?: Src;
  connect?: Src;
  hours?: Src;
  menu?: Src;
  /** `getRestaurantAvailability`, read by the suspended page for the reason. */
  availability?: Src;
  availabilityPatch?: (a: any) => any;
}

export async function serve(page: Page, s: Scene) {
  await answer(page, '**/v1/restaurant/onboarding/status', s.status, s.statusPatch);
  await answer(page, '**/v1/restaurant/profile', s.profile ?? 'restaurant_profile_account_pending');
  await answer(page, '**/v1/restaurant/documents', s.docs ?? 'restaurant_document_pack_complete');
  if (s.connect) await answer(page, '**/v1/connect/status', s.connect);
  if (s.hours) await answer(page, '**/v1/restaurant/hours', s.hours);
  if (s.menu) await answer(page, '**/v1/restaurant/menu', s.menu);
  if (s.availability) await answer(page, '**/v1/restaurant/availability', s.availability, s.availabilityPatch);
}

export interface Road {
  pack: string;
  filter?: (docs: any[]) => any[];
  /** The PUT to the presigned address: finishes, never does, or finishes once and then never does. */
  put?: 'ok' | 'never' | 'first-ok';
  /** submitRestaurantDocuments: the review status, never an answer, or an error. */
  submit?: 'ok' | 'never' | { status: number; code: string; details?: unknown[] };
}

/** Serves the document list and the whole upload road; an attach saves the document as SUBMITTED. */
export async function road(page: Page, r: Road) {
  const presigned = await fixture(page, 'presigned_upload');
  const ready = await fixture(page, 'stored_object_ready');
  const review = await fixture(page, STATUS.review);
  let pack: any[] = (r.filter ?? ((d) => d))(await fixture(page, r.pack));
  let puts = 0;
  await page.route('**/v1/uploads', (route) => route.fulfill({ status: 201, json: { data: presigned } }));
  await page.route(presigned.url, (route) => {
    puts += 1;
    return r.put === 'never' || (r.put === 'first-ok' && puts > 1) ? never() : route.fulfill({ status: 200, body: '' });
  });
  await page.route('**/v1/uploads/*/confirm', (route) => route.fulfill({ json: { data: ready } }));
  await page.route('**/v1/restaurant/documents', (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { data: pack } });
    const sent = req.postDataJSON();
    const before = pack.filter((d) => d.doc_type === sent.doc_type).sort((a, b) => b.version - a.version)[0] ?? {
      subject_type: 'RESTAURANT',
      subject_id: '8a817ba1-35a1-4fa7-af04-5bcb3c6ffe41',
      doc_type: sent.doc_type,
      version: 0,
      issuer: null,
      certificate_number: null,
      issued_on: null,
      valid_until: null,
    };
    const next = {
      ...before,
      id: `00000000-0000-4000-8000-${String(pack.length + 100).padStart(12, '0')}`,
      state: 'SUBMITTED',
      version: before.version + 1,
      rejection_reason_code: null,
      review_note: null,
      reviewed_at: null,
      issuer: sent.issuer ?? before.issuer,
      certificate_number: sent.certificate_number ?? before.certificate_number,
      issued_on: sent.issued_on ?? before.issued_on,
      valid_until: sent.valid_until ?? before.valid_until,
      created_at: new Date().toISOString(),
    };
    pack = [...pack, next];
    return route.fulfill({ status: 201, json: { data: next } });
  });
  await page.route('**/v1/restaurant/documents/submit', (route) => {
    const s = r.submit ?? 'ok';
    if (s === 'never') return never();
    if (s === 'ok') return route.fulfill({ json: { data: review } });
    return route.fulfill(problem(s.status, s.code, s.details));
  });
}

export async function open(page: Page, path: string, scene: Scene, r?: Road) {
  await serve(page, scene);
  if (r) await road(page, r);
  await openSignedIn(page, path);
}

export const FILE = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a document') });
export const choose = (page: Page, name: string) => page.locator('input[type="file"]').setInputFiles(FILE(name));
export const details = (page: Page, lc: string) => page.getByRole('form', { name: `Details for ${lc}` });
export const save = (page: Page) => page.getByRole('button', { name: /^Save document/ });
export const without = (type: string) => (docs: any[]) => docs.filter((d) => d.doc_type !== type);
export const only = (...types: string[]) => (docs: any[]) => docs.filter((d) => types.includes(d.doc_type));
