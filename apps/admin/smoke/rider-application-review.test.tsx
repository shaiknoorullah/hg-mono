import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { setToken } from '../src/lib/token';
import { apiError, installDomShims, json, scriptFetch } from './linkPageHarness';
import pendingFixture from '../../../contracts/fixtures/admin/rider_application_pending_review.json';
import approvedFixture from '../../../contracts/fixtures/admin/rider_application_approved.json';

/**
 * A-23 — reviewing one rider application (#545). Pins what an admin depends on: the
 * non-happy states, the under-18 and blocker banners, that an under-18 approval is refused
 * by the API and the screen stays in review, and that a decision sends
 * `decideRiderApplication` with exactly a decision, a reason code and a reason text — an
 * approval reason on approve (#163), never a decider — then shows the decided state.
 */
const ID = pendingFixture.payload.rider_account_id;
const GET_PATH = `/v1/admin/rider-applications/${ID}`;
const DECISION_PATH = `${GET_PATH}/decision`;

/** The pending fixture (computed age 5, two blockers), in the one state that offers a decision. */
const inReview = { ...pendingFixture.payload, onboarding_state: 'DOCUMENTS_REVIEW' };
const adultInReview = { ...approvedFixture.payload, rider_account_id: ID, onboarding_state: 'DOCUMENTS_REVIEW' };
const decided = { ...approvedFixture.payload, rider_account_id: ID };

async function openScreen(script: Parameters<typeof scriptFetch>[0]) {
  setToken('admin-token');
  window.location.hash = `#/riders/${ID}`;
  const calls = scriptFetch(script);
  const { Root } = await import('../src/App');
  render(<Root />);
  return calls;
}

describe('admin rider application review', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    setToken(null);
    window.location.hash = '';
  });

  it('shows loading, then an error with a retry that loads the application', async () => {
    await openScreen({ [GET_PATH]: [apiError(500, 'INTERNAL_ERROR'), json(200, { data: adultInReview })] });

    expect(screen.getByLabelText('Loading application')).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ayesha Rahman' })).not.toBeNull();
    expect(screen.queryByText('Under the minimum age')).toBeNull();
  });

  it('shows a not-found application as an error, not an empty review', async () => {
    await openScreen({ [GET_PATH]: apiError(404, 'NOT_FOUND') });

    expect(await screen.findByText('Not found')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('flags an under-18 rider and keeps them in review when the API refuses the approval', async () => {
    const calls = await openScreen({
      [GET_PATH]: json(200, { data: inReview }),
      [DECISION_PATH]: apiError(422, 'AGE_REQUIREMENT_NOT_MET'),
    });

    expect(await screen.findByText('Under the minimum age')).not.toBeNull();
    expect(screen.getByText('2 approval blockers')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approval failed')).not.toBeNull();
    // Still in review: no reload, the decision buttons are still offered.
    expect(calls.filter((c) => c.path === GET_PATH)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeNull();
    expect(calls.filter((c) => c.path === DECISION_PATH).map((c) => c.body)).toEqual([
      { decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED', reason_text: 'Approved on review.' },
    ]);
  });

  it('approves an adult rider with an approval reason, then shows the decided state', async () => {
    const calls = await openScreen({
      [GET_PATH]: [json(200, { data: adultInReview }), json(200, { data: decided })],
      [DECISION_PATH]: json(200, { data: decided }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/PAYOUT_PENDING/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(calls.filter((c) => c.path === DECISION_PATH).map((c) => c.body)).toEqual([
      { decision: 'APPROVE', reason_code: 'ALL_CHECKS_PASSED', reason_text: 'Approved on review.' },
    ]);
  });

  it('rejects only with a reason and a 10-character note, sending exactly those', async () => {
    const calls = await openScreen({
      [GET_PATH]: [json(200, { data: adultInReview }), json(200, { data: { ...adultInReview, onboarding_state: 'DOCUMENTS_REJECTED' } })],
      [DECISION_PATH]: json(200, { data: decided }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByTestId('confirm-dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject application' });

    fireEvent.click(confirm);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Choose a reason');

    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'NAME_MISMATCH' } });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Short' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('at least 10 characters'));
    expect(calls.filter((c) => c.path === DECISION_PATH)).toEqual([]);

    const note = 'The licence name does not match your profile.';
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: note } });
    fireEvent.click(confirm);

    expect(await screen.findByText(/DOCUMENTS_REJECTED/)).not.toBeNull();
    expect(calls.filter((c) => c.path === DECISION_PATH).map((c) => c.body)).toEqual([
      { decision: 'REJECT', reason_code: 'NAME_MISMATCH', reason_text: note },
    ]);
  });

  it('shows empty vehicle and document states rather than blank cards', async () => {
    await openScreen({
      [GET_PATH]: json(200, { data: { ...adultInReview, vehicle: null, documents: [] } }),
    });

    expect(await screen.findByText('No vehicle on file')).not.toBeNull();
    expect(screen.getByText('No documents uploaded')).not.toBeNull();
  });
});
