import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import RestaurantApplicationRoute from '../application/RestaurantApplicationRoute';
import { ADMIN_ID, OTHER_ADMIN_ID, applicationInReview, envelope, minutesFromNow, type Application } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

function renderWorkspace(app: Application, role: 'ADMIN' | 'SUPER_ADMIN' | 'SUPPORT_AGENT' = 'ADMIN', overrides: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({ getRestaurantApplication: { data: app }, ...overrides });
  renderRedesign(<Route path="/restaurants/:restaurantId" element={<RestaurantApplicationRoute />} />, {
    route: `/restaurants/${app.restaurant_id}`,
    principal: role,
  });
  return api;
}

describe('Application workspace: who may decide', () => {
  it('keeps Approve off while anything stops approval, and says why in its name', async () => {
    renderWorkspace(applicationInReview());
    const approve = await screen.findByRole('button', { name: 'Approve…, unavailable: 2 things stop approval' });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('The halal certificate isn’t approved yet.')).toBeTruthy();
    // Reject and Request changes are open to the person holding the claim.
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('turns every decision off when you are only inspecting, or another reviewer holds it', async () => {
    renderWorkspace(applicationInReview({ assigned_admin_id: null, review_lock_expires_at: null }));
    await screen.findByText('Not claimed · You are inspecting');
    for (const name of ['Reject…', 'Request changes…']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getByRole('button', { name: /^Approve…, unavailable: nobody has claimed/ })).toBeTruthy();
    cleanup();

    renderWorkspace(applicationInReview({ assigned_admin_id: OTHER_ADMIN_ID, review_lock_expires_at: minutesFromNow(20) }));
    expect(await screen.findByText(/Another reviewer holds this until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a support agent status only: no decisions, no halal strip, no viewer', async () => {
    renderWorkspace(applicationInReview(), 'SUPPORT_AGENT');
    await screen.findByText('Read-only for support');
    expect(screen.queryByRole('button', { name: /Approve|Reject|Request changes/ })).toBeNull();
    expect(screen.queryByText('Halal certificate', { selector: 'h3' })).toBeNull();
    expect(screen.queryByText('Open verification')).toBeNull();
    expect(screen.queryByText('Legal name')).toBeNull();
    expect(screen.queryByRole('button', { name: /Review Food safety/ })).toBeNull();
  });

  it('turns decisions off when the claim has ended, and says so', async () => {
    renderWorkspace(applicationInReview({ review_lock_expires_at: minutesFromNow(-5) }));
    expect(await screen.findByText(/Your claim ended at/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject…' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Application workspace: the halal certificate', () => {
  it('draws no halal badge and no verification route when there is no certificate record', async () => {
    const app = fixture<Application>('restaurant_application_no_certificate');
    renderWorkspace({ ...app, assigned_admin_id: ADMIN_ID, review_lock_expires_at: minutesFromNow(30), onboarding_state: 'DOCUMENTS_REVIEW' });
    expect(await screen.findByText('No halal certificate record')).toBeTruthy();
    expect(screen.queryByTestId('RestaurantHalalBadge')).toBeNull();
    expect(document.querySelector('[data-halal-render]')).toBeNull();
    expect(screen.queryByText('Open verification')).toBeNull();
    expect(screen.getByTestId('NoCertificateRow').textContent).toContain('No certificate record: nothing to verify');
  });

  it('draws no badge when the profile carries no halal object, however far along the certificate is', async () => {
    const app = applicationInReview();
    const { halal: _halal, ...profile } = app.profile;
    renderWorkspace({ ...app, profile });
    await screen.findByText('Restaurant now:');
    expect(document.querySelector('[data-halal-render]')).toBeNull();
  });

  it('draws the badge from profile.halal and nothing else', async () => {
    const app = applicationInReview();
    renderWorkspace({ ...app, profile: { ...app.profile, halal: { display_state: 'EXPIRED' } } });
    await screen.findByText('Restaurant now:');
    const badge = document.querySelector('[data-halal-render]');
    expect(badge?.getAttribute('data-halal-render')).toBe('expired');
  });

  it('never reviews the halal certificate as a document: its row only routes to the console', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app);
    fireEvent.click(await screen.findByRole('button', { name: /^Open Halal certificate, version 1/ }));
    expect(await screen.findByText('Verified in the halal console, not here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve document|Reject document/ })).toBeNull();
    expect(api.callsTo('reviewRestaurantDocument')).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Open verification' })[0]?.getAttribute('href')).toContain(`/certificates/${app.halal_certificate!.id}`);
  });
});

describe('Application workspace: deciding', () => {
  const ready = () => applicationInReview({ blockers: [] });

  it('sends nothing until the panel’s own button, then sends exactly one approval', async () => {
    const app = ready();
    const api = renderWorkspace(app, 'ADMIN', {
      decideRestaurantApplication: { data: { ...app, onboarding_state: 'PAYOUT_PENDING' } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }));
    const panel = await screen.findByRole('region', { name: 'Approve Karahi House?' });
    expect(api.callsTo('decideRestaurantApplication')).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain('Approve Karahi House?');
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve application' }));
    await waitFor(() => expect(api.callsTo('decideRestaurantApplication')).toHaveLength(1));
    const call = api.callsTo('decideRestaurantApplication')[0]!;
    expect(call.body).toMatchObject({ decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED' });
    expect(call.headers['idempotency-key']).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Approve Karahi House?' })).toBeNull());
  });

  it('refuses a rejection with no reason and a short message before anything is sent', async () => {
    const api = renderWorkspace(ready());
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    const panel = await screen.findByRole('region', { name: /^Reject Karahi House/ });
    fireEvent.change(within(panel).getByLabelText(/Message to the restaurant/), { target: { value: 'No' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject application' }));
    expect(await within(panel).findByText('The rejection wasn’t sent: 2 things to fix')).toBeTruthy();
    expect(api.callsTo('decideRestaurantApplication')).toHaveLength(0);
  });

  it('shows the server’s fresh blockers when it refuses an approval, and keeps the claim', async () => {
    const app = ready();
    renderWorkspace(app, 'ADMIN', {
      decideRestaurantApplication: {
        status: 409,
        body: envelope('PRECONDITION_NOT_MET', 'not approvable', { blockers: ['Required document not approved: FOOD_SAFETY', 'No approved halal certificate'] }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }));
    const panel = await screen.findByRole('region', { name: 'Approve Karahi House?' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve application' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not approved: 2 things stop approval');
    expect(alert.textContent).toContain('The food safety certificate isn’t approved yet.');
  });

  it('shows "already decided" and "your claim ended" as their own refusals', async () => {
    renderWorkspace(ready(), 'ADMIN', { decideRestaurantApplication: { status: 409, body: fixture('error_application_already_decided') } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    let panel = await screen.findByRole('region', { name: /^Reject Karahi House/ });
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'DOCUMENTS_INSUFFICIENT' } });
    fireEvent.change(within(panel).getByLabelText(/Message to the restaurant/), { target: { value: 'Your documents are not enough.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject application' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Already decided');
    cleanup();

    renderWorkspace(ready(), 'ADMIN', { decideRestaurantApplication: { status: 409, body: fixture('error_review_lock_lost') } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    panel = await screen.findByRole('region', { name: /^Reject Karahi House/ });
    fireEvent.change(within(panel).getByLabelText(/^Reason/), { target: { value: 'DOCUMENTS_INSUFFICIENT' } });
    fireEvent.change(within(panel).getByLabelText(/Message to the restaurant/), { target: { value: 'Your documents are not enough.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject application' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Your claim ended');
  });

  it('keeps what was typed and reuses the key when the connection drops', async () => {
    let attempt = 0;
    const app = ready();
    const api = renderWorkspace(app, 'ADMIN', {
      decideRestaurantApplication: () => {
        attempt += 1;
        return attempt === 1 ? { status: 502, body: fixture('error_internal_error') } : { data: { ...app, onboarding_state: 'DOCUMENTS_REJECTED' } };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve…' }));
    const panel = await screen.findByRole('region', { name: 'Approve Karahi House?' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve application' }));
    expect((await within(panel).findByRole('alert')).textContent).toContain('The approval wasn’t sent');
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve application' }));
    await waitFor(() => expect(api.callsTo('decideRestaurantApplication')).toHaveLength(2));
    const [a, b] = api.callsTo('decideRestaurantApplication');
    expect(b?.headers['idempotency-key']).toBe(a?.headers['idempotency-key']);
  });

  it('says the application does not exist on a 404', async () => {
    const api = mockApi({ getRestaurantApplication: { status: 404, body: fixture('error_not_found') } });
    renderRedesign(<Route path="/restaurants/:restaurantId" element={<RestaurantApplicationRoute />} />, {
      route: '/restaurants/a1111111-0000-4000-8000-000000000009',
    });
    expect(await screen.findByText('This application doesn’t exist')).toBeTruthy();
    expect(api.callsTo('getRestaurantApplication')).toHaveLength(1);
  });
});

describe('Application workspace: documents', () => {
  it('asks a food safety certificate’s four questions with nothing preselected, and needs all four Pass to approve', async () => {
    const app = applicationInReview();
    const api = renderWorkspace(app);
    fireEvent.click(await screen.findByRole('button', { name: /^Review Food safety certificate, version 1/ }));
    const review = await screen.findByRole('region', { name: /Review: food safety certificate/ });
    expect(document.activeElement?.textContent).toContain('Review: food safety certificate');
    expect(within(review).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    const approve = within(review).getByRole('button', { name: /^Approve document, unavailable: 4 checks are not recorded/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    for (const label of ['Issuing health unit present', 'Premises address matches', 'Expiry at least 14 days away', 'Holder name matches']) {
      fireEvent.click(within(within(review).getByRole('radiogroup', { name: label })).getByRole('radio', { name: 'Pass' }));
    }
    expect(within(review).getByRole('button', { name: 'Approve document' }).getAttribute('aria-disabled')).not.toBe('true');
    expect(api.callsTo('reviewRestaurantDocument')).toHaveLength(0);
  });
});
