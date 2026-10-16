import { expect, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';
import { application, arrive, doc, envelope, failing, FATIMA, motorisedDocs, never, openAt, sep, type Json, type Scene } from './redesign-admin.rider-onboarding.scene';

/** Steps the rider onboarding specs share (redesign-admin.rider-onboarding-*.spec.ts). */

export const LOCK = sep(28, 15, 14);
export const ONE = 'Vehicle insurance isn’t approved yet';
export const TWO = 'Work eligibility isn’t approved yet';

/** Fatima's application as the board opens it: claimed by you, insurance in review, work eligibility waiting. */
export function inReview(me: string, over: Json = {}, docs: Json[] = motorisedDocs(FATIMA.id)): Json {
  const history = [
    doc(FATIMA.id, { type: 'DRIVERS_LICENCE', state: 'SUPERSEDED', version: 1, valid: '2027-09-20' }),
    doc(FATIMA.id, { type: 'VEHICLE_INSURANCE', state: 'REJECTED', version: 1, valid: '2026-09-25', reason: 'EXPIRED' }),
  ];
  return application(FATIMA, { assigned_admin_id: me, review_lock_expires_at: LOCK, blockers: [ONE, TWO], documents: [...history, ...docs], ...over });
}

export async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: that state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

/** Opens the application at `id` and waits for the workspace. */
export async function openApp(page: Page, scene: Scene, id: string = FATIMA.id) {
  await arrive(page, scene);
  await openAt(page, `#/riders/${id}`);
  await expect(page.getByTestId('ApplicationWorkspace')).toBeVisible();
}

export const checks = (page: Page) => page.getByRole('group', { name: /checks$/ }).locator(':scope > div');

export type Answer = 'Passes' | 'Fails' | 'Doesn’t apply';

/** Answers every question of the open document's checklist; `by` changes some, `notes` adds internal notes. */
export async function answerAll(page: Page, value: Answer = 'Passes', by: Record<number, Answer> = {}, notes: Record<number, string> = {}) {
  const n = await checks(page).count();
  for (let i = 0; i < n; i += 1) {
    const wrap = checks(page).nth(i);
    if ((await wrap.getByRole('radio').count()) === 0) continue;
    await wrap.getByRole('radio', { name: by[i] ?? value }).check();
    const note = notes[i];
    if (note) await wrap.getByLabel(/Internal note/).fill(note);
  }
}

export const openDoc = (page: Page, name: RegExp) => page.getByRole('button', { name }).first().click();


const DOC_WORDS: Record<string, string> = {
  DRIVERS_LICENCE: 'Driver’s licence',
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  GOVERNMENT_ID: 'Government ID',
  WORK_ELIGIBILITY: 'Work eligibility',
  PROFILE_PHOTO: 'Profile photo',
};
const REQUIRED_MOTORISED = ['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'WORK_ELIGIBILITY', 'PROFILE_PHOTO'];

/** The server's own blocker lines for the documents an application holds now. */
export function blockersFor(app: Json, required: string[] = REQUIRED_MOTORISED): string[] {
  const docs = app.documents as Json[];
  return required.flatMap((type) => {
    const newest = docs.filter((d) => d.doc_type === type && d.state !== 'SUPERSEDED').sort((a, b) => b.version - a.version)[0];
    if (newest?.state === 'APPROVED') return [];
    return [`${DOC_WORDS[type]} ${newest?.state === 'REJECTED' ? 'is rejected' : 'isn’t approved yet'}`];
  });
}

/** The application the page keeps asking for, so a review that succeeds shows on the next load. */
export interface Live {
  app?: Json;
}

export type ReviewHow = 'ok' | 'never' | 'error' | 'abort' | { status: number; code: string; then?: (app: Json) => void };

/** Answers `reviewRiderDocument` as `how` says, and records an accepted review on the live application. */
export const reviewing =
  (live: Live, how: ReviewHow = 'ok') =>
  async (route: Route): Promise<void> => {
    if (how === 'never') return never();
    if (how === 'error') return failing(route);
    if (how === 'abort') return route.abort('internetdisconnected');
    if (typeof how === 'object') {
      how.then?.(live.app!);
      return route.fulfill({ status: how.status, json: envelope(how.code, 'Refused.') });
    }
    const id = /rider-documents\/([^/]+)\/review/.exec(route.request().url())?.[1];
    const body = route.request().postDataJSON() as Json;
    const found = (live.app!.documents as Json[]).find((d) => d.id === id)!;
    found.state = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    found.rejection_reason_code = body.rejection_reason_code ?? null;
    found.review_note = body.review_note ?? null;
    live.app!.blockers = blockersFor(live.app!);
    return route.fulfill({ json: { data: found } });
  };

/** Picks `option` in the select labelled `label`: a native select or the design system's listbox. */
export async function choose(page: Page, label: string | RegExp, option: string): Promise<void> {
  const control = page.getByLabel(label).first();
  if ((await control.evaluate((el) => el.tagName)) === 'SELECT') {
    await control.selectOption({ label: option });
    return;
  }
  await control.click();
  await page.getByRole('option', { name: option }).click();
}
