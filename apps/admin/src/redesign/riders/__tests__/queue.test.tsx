import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import RiderQueueRoute from '../queue/RiderQueueRoute';
import { ADMIN_ID, minutesFromNow, summaryRow } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

function renderQueue() {
  return renderRedesign(<Route path="/riders" element={<RiderQueueRoute />} />, { route: '/riders', principal: 'ADMIN' });
}

const page = (data: unknown[]) => ({ data, meta: { next_cursor: null, has_more: false } });
const rows = [
  summaryRow({ rider_account_id: 'b1111111-0000-4000-8000-000000000001', display_name: 'Musa Ibrahim', vehicle_type: 'SCOOTER', sla_due_at: minutesFromNow(-90), assigned_admin_id: 'other', review_lock_expires_at: minutesFromNow(10) }),
  summaryRow({ rider_account_id: 'b1111111-0000-4000-8000-000000000002', display_name: 'Fatima Noor', vehicle_type: 'CAR', attempt_number: 2 }),
];

describe('Rider applications queue', () => {
  it('lists the server order untouched, asks for Documents review only, and flags a missed target', async () => {
    const api = mockApi({ listRiderApplications: page(rows) });
    renderQueue();
    const grid = await screen.findByRole('grid');
    const names = within(grid).getAllByRole('row').slice(1).map((r) => r.querySelector('a')?.getAttribute('aria-label'));
    expect(names).toEqual(['rider application Musa Ibrahim', 'rider application Fatima Noor']);
    expect(api.callsTo('listRiderApplications')[0]?.query).toMatchObject({ state: 'DOCUMENTS_REVIEW' });
    expect(within(grid).getByText('Target missed')).toBeTruthy();
    expect(within(grid).getByText('Claimed by another reviewer')).toBeTruthy();
    expect(within(grid).getByText('Scooter')).toBeTruthy();
  });

  it('says "Not submitted yet" for a rider who has not submitted, whatever date the row carries', async () => {
    mockApi({ listRiderApplications: page([summaryRow({ display_name: 'Adam Tahir', onboarding_state: 'REGISTERED' })]) });
    renderQueue();
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('Not submitted yet')).toBeTruthy();
    expect(within(grid).getByText('Not in review')).toBeTruthy();
  });

  it('leads with Continue review while you hold a claim, and Take next becomes secondary', async () => {
    mockApi({ listRiderApplications: page([{ ...rows[1]!, assigned_admin_id: ADMIN_ID, review_lock_expires_at: minutesFromNow(42) }]) });
    renderQueue();
    expect(await screen.findByRole('link', { name: /Continue review/ })).toBeTruthy();
    expect(screen.getByText(/You have Fatima Noor claimed/)).toBeTruthy();
  });

  it('tells you your claim ended, and that the rider is back in the queue', async () => {
    mockApi({ listRiderApplications: page([{ ...rows[1]!, assigned_admin_id: ADMIN_ID, review_lock_expires_at: minutesFromNow(-2) }]) });
    renderQueue();
    expect((await screen.findByRole('alert')).textContent).toContain('Your claim on Fatima Noor ended at');
  });

  it('says so, without taking focus, when nothing was free to take', async () => {
    const api = mockApi({ listRiderApplications: page(rows), takeNextRiderApplication: 'rider_application_none_to_take' });
    renderQueue();
    await screen.findByRole('grid');
    const button = screen.getByRole('button', { name: 'Take next' });
    button.focus();
    fireEvent.click(button);
    const note = await screen.findByText('Nothing to take: no applications are waiting');
    expect(note.closest('[role="status"]')).toBeTruthy();
    expect(document.activeElement).toBe(button);
    expect(api.callsTo('takeNextRiderApplication')[0]?.headers['idempotency-key']).toBeTruthy();
  });

  it('reuses the same Idempotency-Key when Take next is retried after no answer', async () => {
    let attempt = 0;
    const api = mockApi({
      listRiderApplications: page(rows),
      takeNextRiderApplication: () => {
        attempt += 1;
        return attempt === 1 ? { status: 503, body: fixture('error_internal_error') } : 'rider_application_none_to_take';
      },
    });
    renderQueue();
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: 'Take next' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Take next didn’t work');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo('takeNextRiderApplication')).toHaveLength(2));
    const [first, second] = api.callsTo('takeNextRiderApplication');
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
  });

  it('draws the states apart: loading, drained, filtered to nothing, the error and a refusal', async () => {
    const api = mockApi({ listRiderApplications: page([]) });
    renderQueue();
    expect(screen.getByText('Loading rider applications')).toBeTruthy();
    expect(await screen.findByText('Nothing waiting for review')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Take next' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Nothing waiting to take')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all states' }));
    await waitFor(() => expect(api.callsTo('listRiderApplications').length).toBeGreaterThan(1));
    expect(String(api.callsTo('listRiderApplications').at(-1)?.query.state).split(',')).toHaveLength(10);
    cleanup();

    mockApi({ listRiderApplications: { status: 500, body: fixture('error_internal_error') } });
    renderQueue();
    expect(await screen.findByText('Rider applications didn’t load')).toBeTruthy();
    cleanup();

    mockApi({ listRiderApplications: { status: 403, body: fixture('error_forbidden') } });
    renderQueue();
    expect(await screen.findByText('You don’t have access to rider applications')).toBeTruthy();
  });
});
