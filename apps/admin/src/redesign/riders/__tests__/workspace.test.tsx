import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import RiderApplicationRoute from '../application/RiderApplicationRoute';
import { maskEmail } from '../application/ApplicationPane';
import { APPROVE_MESSAGE } from '../application/DecisionPanel';
import { ADMIN_ID, OTHER_ADMIN_ID, applicationInReview, applicationReady, envelope, minutesFromNow, withDocument, type Application } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

function renderWorkspace(app: Application, overrides: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ getRiderApplication: { data: app }, ...overrides });
  renderRedesign(<Route path="/riders/:riderAccountId" element={<RiderApplicationRoute />} />, {
    route: `/riders/${app.rider_account_id}`,
    principal: 'ADMIN',
  });
  return api;
}

const ticked = (el: HTMLElement) => (el as HTMLInputElement).checked ?? el.getAttribute('aria-checked') === 'true';

describe('Rider workspace: who may decide', () => {
  it('keeps Approve rider off until every document is approved, and says why in its name', async () => {
    renderWorkspace(applicationInReview());
    const approve = await screen.findByRole('button', { name: /^Approve rider…, unavailable:/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    // The server's own blocker line is shown word for word.
    expect(screen.getByText('No approved identity/vehicle document')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('turns every decision off when only reading, when another reviewer holds it, and when the claim ended', async () => {
    renderWorkspace(applicationInReview({ assigned_admin_id: null, review_lock_expires_at: null }));
    await screen.findByText(/You’re reading without a claim/);
    for (const name of ['Reject…', 'Request changes']) expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    renderWorkspace(applicationInReview({ assigned_admin_id: OTHER_ADMIN_ID, review_lock_expires_at: minutesFromNow(20) }));
    expect(await screen.findByText(/Claimed by another reviewer until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    renderWorkspace(applicationInReview({ review_lock_expires_at: minutesFromNow(-5) }));
    expect(await screen.findByText(/Your claim ended at/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('never approves a rider under 18, and shows the age the server computed', async () => {
    renderWorkspace(applicationReady({ computed_age_years: 17, blockers: ['Rider is under 18'] }));
    expect((await screen.findByText(/Age 17/)).closest('p')?.textContent).toContain('no one can override this');
    expect(screen.getByRole('button', { name: /^Approve rider…, unavailable:/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Rider is under 18')).toBeTruthy();
  });

  it('never shows the full email address', async () => {
    const app = applicationInReview();
    renderWorkspace(app);
    await screen.findByText('Rider');
    expect(document.body.textContent).not.toContain(app.profile.email!);
    expect(maskEmail('fatima.noor@gmail.com')).toBe('f•••••@g••••.com');
  });

  it('draws the bicycle set apart from the car set', async () => {
    renderWorkspace(fixture<Application>('rider_application_bicycle'));
    const list = await screen.findByTestId('DocumentsList');
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual(['Open Government ID', 'Open Work eligibility', 'Open Profile photo']);
  });
});

describe('Rider workspace: deciding', () => {
  it('sends nothing until the panel’s own button, then sends one approval whose code follows the message', async () => {
    const app = applicationReady();
    const api = renderWorkspace(app, { decideRiderApplication: { data: { ...app, onboarding_state: 'PAYOUT_PENDING' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve rider' }));
    const panel = await screen.findByRole('region', { name: 'Approve Fatima Noor as a rider' });
    expect(api.callsTo('decideRiderApplication')).toHaveLength(0);
    expect((within(panel).getByLabelText(/Message to the rider/) as HTMLTextAreaElement).value).toBe(APPROVE_MESSAGE);
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve rider' }));
    await waitFor(() => expect(api.callsTo('decideRiderApplication')).toHaveLength(1));
    const call = api.callsTo('decideRiderApplication')[0]!;
    expect(call.body).toMatchObject({ decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED', reason_text: APPROVE_MESSAGE });
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(await screen.findByText('Fatima Noor is approved and now Payout pending')).toBeTruthy();
  });

  it('sends "approved with notes" once the reviewer has edited the message', async () => {
    const app = applicationReady();
    const api = renderWorkspace(app, { decideRiderApplication: { data: app } });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve rider' }));
    const panel = await screen.findByRole('region', { name: 'Approve Fatima Noor as a rider' });
    fireEvent.change(within(panel).getByLabelText(/Message to the rider/), { target: { value: 'Approved. Please keep your insurance renewal date handy.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve rider' }));
    await waitFor(() => expect(api.callsTo('decideRiderApplication')).toHaveLength(1));
    expect(api.callsTo('decideRiderApplication')[0]!.body).toMatchObject({ decision: 'APPROVE', reason_code: 'APPROVED_WITH_NOTES' });
  });

  it('refuses a rejection with no reason and a short message before anything is sent', async () => {
    const api = renderWorkspace(applicationInReview());
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    const panel = await screen.findByRole('region', { name: /^Reject Fatima Noor/ });
    fireEvent.change(within(panel).getByLabelText(/Message to the rider/), { target: { value: 'No' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject application' }));
    expect(await within(panel).findByText('The rejection wasn’t sent: 2 things to fix')).toBeTruthy();
    expect(api.callsTo('decideRiderApplication')).toHaveLength(0);
  });

  it('sends the documents to redo with a request for changes, ticking the ones already rejected', async () => {
    const app = withDocument(applicationInReview(), 'VEHICLE_INSURANCE', {
      state: 'REJECTED',
      rejection_reason_code: 'INCOMPLETE_PAGES',
      review_note: 'Page 2 is missing. Upload every page of the policy.',
    });
    const api = renderWorkspace(app, { decideRiderApplication: { data: { ...app, onboarding_state: 'DOCUMENTS_REJECTED' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    const panel = await screen.findByRole('region', { name: 'Ask Fatima Noor to fix documents' });
    expect(ticked(within(panel).getByRole('checkbox', { name: /Vehicle insurance/ }))).toBe(true);
    expect(ticked(within(panel).getByRole('checkbox', { name: /Work eligibility/ }))).toBe(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(api.callsTo('decideRiderApplication')).toHaveLength(1));
    expect(api.callsTo('decideRiderApplication')[0]!.body).toMatchObject({
      decision: 'REQUEST_CHANGES',
      reason_code: 'INCOMPLETE_PAGES',
      documents_to_redo: ['VEHICLE_INSURANCE'],
      reason_text: 'Page 2 is missing. Upload every page of the policy.',
    });
  });

  it('answers each refusal in its own words: under 18, a changed page, an earlier decision and a lost claim', async () => {
    const cases: Array<[Parameters<typeof envelope>, number, string]> = [
      [['AGE_REQUIREMENT_NOT_MET', 'under 18'], 422, 'Not approved: this rider is under 18'],
      [['PRECONDITION_NOT_MET', 'not approvable', { blockers: ['No approved identity/vehicle document'] }], 422, 'Not approved: something changed after you opened this page'],
      [['ALREADY_DECIDED', 'decided'], 409, 'Already decided'],
      [['REVIEW_LOCK_LOST', 'lost'], 409, 'Your claim ended'],
    ];
    for (const [args, status, title] of cases) {
      renderWorkspace(applicationReady(), { decideRiderApplication: { status, body: envelope(...args) } });
      fireEvent.click(await screen.findByRole('button', { name: 'Approve rider' }));
      const panel = await screen.findByRole('region', { name: 'Approve Fatima Noor as a rider' });
      fireEvent.click(within(panel).getByRole('button', { name: 'Approve rider' }));
      expect((await screen.findByRole('alert')).textContent).toContain(title);
      cleanup();
    }
  });

  it('keeps what was typed and reuses the key when the connection drops', async () => {
    let attempt = 0;
    const app = applicationReady();
    const api = renderWorkspace(app, {
      decideRiderApplication: () => {
        attempt += 1;
        return attempt === 1 ? { status: 502, body: fixture('error_internal_error') } : { data: { ...app, onboarding_state: 'PAYOUT_PENDING' } };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve rider' }));
    const panel = await screen.findByRole('region', { name: 'Approve Fatima Noor as a rider' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve rider' }));
    expect((await within(panel).findByRole('alert')).textContent).toContain('Nothing was recorded');
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo('decideRiderApplication')).toHaveLength(2));
    const [a, b] = api.callsTo('decideRiderApplication');
    expect(b?.headers['idempotency-key']).toBe(a?.headers['idempotency-key']);
  });

  it('says the application does not exist on a 404, and that it could not load on an error', async () => {
    mockApi({ getRiderApplication: { status: 404, body: fixture('error_not_found') } });
    renderRedesign(<Route path="/riders/:riderAccountId" element={<RiderApplicationRoute />} />, { route: '/riders/b1111111-0000-4000-8000-000000000009' });
    expect(await screen.findByText('This application doesn’t exist')).toBeTruthy();
    cleanup();
    mockApi({ getRiderApplication: { status: 500, body: fixture('error_internal_error') } });
    renderRedesign(<Route path="/riders/:riderAccountId" element={<RiderApplicationRoute />} />, { route: '/riders/b1111111-0000-4000-8000-000000000009' });
    expect(await screen.findByText('The application didn’t load')).toBeTruthy();
  });
});

describe('Rider workspace: documents', () => {
  it('needs every question answered and none failing to approve, and a failing one to reject', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app);
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    expect(document.activeElement?.textContent).toContain('Vehicle insurance · version 1');
    expect(within(card).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(within(card).getByRole('button', { name: /^Approve document, unavailable: 5 checks aren’t answered/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(card).getByRole('button', { name: /^Reject document…, unavailable/ }).getAttribute('aria-disabled')).toBe('true');

    const groups = within(card).getAllByRole('radiogroup');
    expect(groups).toHaveLength(5);
    for (const group of groups) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    expect(within(card).getByRole('button', { name: 'Approve document' }).getAttribute('aria-disabled')).not.toBe('true');

    fireEvent.click(within(groups[3]!).getByRole('radio', { name: 'Fails' }));
    expect(within(card).getByRole('button', { name: /^Approve document, unavailable: a check failed/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reject document' }).getAttribute('aria-disabled')).not.toBe('true');
    expect(api.callsTo('reviewRiderDocument')).toHaveLength(0);
  });

  it('records the checks with the approval and moves on to the next document waiting', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app, { reviewRiderDocument: { data: { ...app.documents[2]!, state: 'APPROVED' } } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    for (const group of within(card).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Approve document' }));
    await waitFor(() => expect(api.callsTo('reviewRiderDocument')).toHaveLength(1));
    const call = api.callsTo('reviewRiderDocument')[0]!;
    expect(call.body).toMatchObject({ decision: 'APPROVE' });
    expect((call.body as { checks: unknown[] }).checks).toHaveLength(5);
    expect(call.headers['idempotency-key']).toBeTruthy();
  });

  it('rejects a document with the failing check recorded, and never offers a forgery reason', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app, { reviewRiderDocument: { data: { ...app.documents[2]!, state: 'REJECTED' } } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    const groups = within(card).getAllByRole('radiogroup');
    fireEvent.click(within(groups[0]!).getByRole('radio', { name: 'Fails' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Reject document' }));
    const panel = await screen.findByTestId('DocumentRejectPanel');
    const options = Array.from(panel.querySelectorAll('option')).map((o) => o.textContent);
    expect(options.join('|')).not.toMatch(/forgery|alteration/i);
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'INCOMPLETE_PAGES' } });
    fireEvent.change(within(panel).getByLabelText(/Note to the rider/), { target: { value: 'Page 2 is missing. Upload every page.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject document' }));
    await waitFor(() => expect(api.callsTo('reviewRiderDocument')).toHaveLength(1));
    expect(api.callsTo('reviewRiderDocument')[0]!.body).toMatchObject({
      decision: 'REJECT',
      rejection_reason_code: 'INCOMPLETE_PAGES',
      review_note: 'Page 2 is missing. Upload every page.',
      checks: [{ check_key: 'LEGIBLE_ALL_PAGES', result: 'FAIL' }],
    });
  });

  it('keeps the answers and says so when the document was replaced under the page (404)', async () => {
    const app = applicationInReview();
    renderWorkspace(app, { reviewRiderDocument: { status: 404, body: fixture('error_not_found') } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    for (const group of within(card).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Approve document' }));
    expect(await screen.findByText('This document was replaced or removed')).toBeTruthy();
    expect(within(screen.getByTestId('DocumentCard')).getAllByRole('radio', { checked: true })).toHaveLength(5);
  });

  it('still says the document was replaced once the reload moves the page to the new version', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app, { reviewRiderDocument: { status: 404, body: fixture('error_not_found') } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    for (const group of within(card).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    // The reload that follows the refusal answers with the insurance replaced by a newer upload.
    const old = app.documents.find((d) => d.doc_type === 'VEHICLE_INSURANCE')!;
    api.set({
      getRiderApplication: {
        data: { ...app, documents: app.documents.map((d) => (d.id === old.id ? { ...d, state: 'SUPERSEDED' as const } : d)).concat({ ...old, id: 'c0ffee00-0000-4000-8000-000000000002', version: old.version + 1, state: 'SUBMITTED' as const }) },
      },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve document' }));
    // Once the reload has moved the page off the removed version, its notice is still on screen.
    await waitFor(() => expect(screen.queryByRole('heading', { name: new RegExp(`Vehicle insurance · version ${old.version}$`) })).toBeNull());
    expect(screen.getByText('This document was replaced or removed')).toBeTruthy();
  });

  it('says the role changed when the server refuses a document approval (403)', async () => {
    renderWorkspace(applicationInReview(), { reviewRiderDocument: { status: 403, body: fixture('error_forbidden') } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    for (const group of within(card).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Approve document' }));
    expect((await screen.findByRole('alert')).textContent).toContain('You can no longer decide rider applications');
    expect(within(screen.getByTestId('DocumentCard')).getAllByRole('radio', { checked: true })).toHaveLength(5);
  });

  it('ends review when the claim ends under a document approval (409 review lock lost)', async () => {
    const app = applicationInReview();
    renderWorkspace(app, { reviewRiderDocument: { status: 409, body: fixture('error_review_lock_lost') } });
    fireEvent.click(await screen.findByRole('button', { name: /^Open Vehicle insurance, version 1/ }));
    const card = await screen.findByTestId('DocumentCard');
    for (const group of within(card).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: 'Passes' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Approve document' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Your claim ended');
  });
});
