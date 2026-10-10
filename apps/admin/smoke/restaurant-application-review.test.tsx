import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { setToken } from '../src/lib/token';
import { apiError, installDomShims, json, scriptFetch } from './linkPageHarness';
import pendingFixture from '../../../contracts/fixtures/admin/restaurant_application_pending_review.json';
import approvedFixture from '../../../contracts/fixtures/admin/restaurant_application_approved.json';

/**
 * A-13 / A-18 — reviewing one restaurant application (#544). Pins what an admin depends on:
 * the three non-happy states, the live blockers, the halal certificate panel and its link to
 * the seven-check instrument, and that a decision sends `decideRestaurantApplication` with
 * exactly a decision, a reason code and a reason text — no price, no decider — only once the
 * dialog's reason rules are met, then shows the state the API answered with.
 */
const ID = pendingFixture.payload.restaurant_id;
const GET_PATH = `/v1/admin/restaurant-applications/${ID}`;
const DECISION_PATH = `${GET_PATH}/decision`;

/** The pending fixture, put in the one state that offers a decision. */
const inReview = { ...pendingFixture.payload, onboarding_state: 'DOCUMENTS_REVIEW' };
const decided = { ...approvedFixture.payload, restaurant_id: ID };

/** The request the screen sent for `path` and `method`, headers included. */
function sentRequest(path: string, method: string): Request | undefined {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) => (input instanceof Request ? input : new Request(String(input))))
    .find((r) => new URL(r.url).pathname === path && r.method === method);
}

async function openScreen(script: Parameters<typeof scriptFetch>[0]) {
  setToken('admin-token');
  window.location.hash = `#/applications/${ID}`;
  const calls = scriptFetch(script);
  const { Root } = await import('../src/App');
  render(<Root />);
  return calls;
}

describe('admin restaurant application review', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    setToken(null);
    window.location.hash = '';
  });

  it('shows loading, then an error with a retry that loads the application', async () => {
    await openScreen({ [GET_PATH]: [apiError(500, 'INTERNAL_ERROR'), json(200, { data: inReview })] });

    expect(screen.getByLabelText('Loading application')).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Al-Noor Shawarma House Inc.' })).not.toBeNull();
  });

  it('shows a not-found application as an error, not an empty review', async () => {
    await openScreen({ [GET_PATH]: apiError(404, 'NOT_FOUND') });

    expect(await screen.findByText('Not found')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve application' })).toBeNull();
  });

  it('lays out the blockers and the halal certificate, and opens the seven checks', async () => {
    await openScreen({ [GET_PATH]: json(200, { data: inReview }) });

    expect(await screen.findByText('2 approval blockers')).not.toBeNull();
    expect(screen.getByText('HMA-ON-40603')).not.toBeNull();
    expect(screen.getByText('Halal Munchies Scarborough')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open halal verification (seven checks)' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/certificates/${inReview.halal_certificate.id}`));
  });

  it('renders no certificate summary and no seven-check link when none is on file', async () => {
    await openScreen({
      [GET_PATH]: json(200, { data: { ...inReview, halal_certificate: null, documents: [], blockers: [] } }),
    });

    expect(await screen.findByText('No halal certificate on file')).not.toBeNull();
    expect(screen.getByText('No documents uploaded')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Open halal verification (seven checks)' })).toBeNull();
    expect(screen.queryByText(/approval blocker/)).toBeNull();
  });

  it('approves only with a reason and a 10-character message, then shows the decided state', async () => {
    const calls = await openScreen({
      [GET_PATH]: [json(200, { data: inReview }), json(200, { data: decided })],
      [DECISION_PATH]: json(200, { data: decided }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Approve application' }));
    const dialog = await screen.findByTestId('confirm-dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Approve application' });

    // No reason: refused with an explanation, nothing sent.
    fireEvent.click(confirm);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Choose a reason');

    // A reason but a short message: still refused.
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'ALL_CHECKS_PASSED' } });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Too short' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('at least 10 characters'));
    expect(calls.filter((c) => c.path === DECISION_PATH)).toEqual([]);

    const message = 'Every document and the certificate check out.';
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: message } });
    fireEvent.click(confirm);

    // The decided state, from the reload: the decision buttons are gone.
    expect(await screen.findByText(/PAYOUT_PENDING/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve application' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject application' })).toBeNull();

    // Exactly the decision, the reason code and the reason text: no price, no decider.
    expect(calls.filter((c) => c.path === DECISION_PATH).map((c) => c.body)).toEqual([
      { decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED', reason_text: message },
    ]);
    expect(sentRequest(DECISION_PATH, 'POST')?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('rejects with the chosen reason, and keeps the dialog open when the API refuses', async () => {
    const calls = await openScreen({
      [GET_PATH]: json(200, { data: inReview }),
      [DECISION_PATH]: apiError(409, 'ALREADY_DECIDED'),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reject application' }));
    const dialog = await screen.findByTestId('confirm-dialog');
    const message = 'The certificate names a different legal entity.';
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'HALAL_CERTIFICATION_INVALID' } });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: message } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject application' }));

    // Refused: the dialog stays open with the error, and the screen did not move on.
    expect(await within(dialog).findByTestId('confirm-dialog-error')).not.toBeNull();
    expect((await screen.findAllByText('Decision failed')).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.path === GET_PATH)).toHaveLength(1);
    expect(calls.filter((c) => c.path === DECISION_PATH).map((c) => c.body)).toEqual([
      { decision: 'REJECT', reason_code: 'HALAL_CERTIFICATION_INVALID', reason_text: message },
    ]);
  });
});
