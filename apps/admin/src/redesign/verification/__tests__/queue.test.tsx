import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import RestaurantQueueRoute from '../queue/RestaurantQueueRoute';
import { ADMIN_ID, minutesFromNow, summaryRow } from './support';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

function renderQueue(role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') {
  return renderRedesign(<Route path="/restaurants" element={<RestaurantQueueRoute />} />, { route: '/restaurants', principal: role });
}

const rows = [
  summaryRow({ restaurant_id: 'a1111111-0000-4000-8000-000000000001', display_name: 'Bait Al Mandi' }),
  summaryRow({ restaurant_id: 'a1111111-0000-4000-8000-000000000002', display_name: 'Tandoor Lane', onboarding_state: 'DOCUMENTS_REJECTED', submission_count: 3 }),
];

describe('Restaurant applications queue', () => {
  it('lists the server order untouched and asks for review and fix states, comma-separated', async () => {
    const api = mockApi({ listRestaurantApplications: { data: rows, meta: { next_cursor: null, has_more: false } } });
    renderQueue();
    const grid = await screen.findByRole('grid');
    const names = within(grid).getAllByRole('row').slice(1).map((r) => r.querySelector('a')?.getAttribute('aria-label'));
    expect(names).toEqual(['Bait Al Mandi, Documents review', 'Tandoor Lane, Fix documents']);
    expect(api.callsTo('listRestaurantApplications')[0]?.query).toMatchObject({ state: 'DOCUMENTS_REVIEW,DOCUMENTS_REJECTED' });
    expect(within(grid).getByText('Waiting on the restaurant')).toBeTruthy();
    expect(within(grid).getByText('3rd')).toBeTruthy();
  });

  it('is read-only for a support agent: no Take next, no claim column', async () => {
    mockApi({ listRestaurantApplications: { data: rows, meta: { next_cursor: null, has_more: false } } });
    renderQueue('SUPPORT_AGENT');
    await screen.findByRole('grid');
    expect(screen.queryByRole('button', { name: 'Take next' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Claim' })).toBeNull();
    expect(screen.getByRole('region', { name: /read-only for support/ })).toBeTruthy();
  });

  it('leads with Continue review while you hold a claim, and Take next becomes secondary', async () => {
    mockApi({
      listRestaurantApplications: {
        data: [{ ...rows[0]!, assigned_admin_id: ADMIN_ID, review_lock_expires_at: minutesFromNow(42) }, rows[1]],
        meta: { next_cursor: null, has_more: false },
      },
    });
    renderQueue();
    expect(await screen.findByRole('link', { name: /Continue review/ })).toBeTruthy();
    expect(screen.getByText(/You’re reviewing Bait Al Mandi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take next' })).toBeTruthy();
  });

  it('says so, without taking focus, when nothing was free to take', async () => {
    const api = mockApi({
      listRestaurantApplications: { data: rows, meta: { next_cursor: null, has_more: false } },
      takeNextRestaurantApplication: 'restaurant_application_none_to_take',
    });
    renderQueue();
    await screen.findByRole('grid');
    const button = screen.getByRole('button', { name: 'Take next' });
    button.focus();
    fireEvent.click(button);
    const note = await screen.findByText('No application was free to take');
    expect(note.closest('[role="status"]')).toBeTruthy();
    expect(document.activeElement).toBe(button);
    expect(api.callsTo('takeNextRestaurantApplication')[0]?.headers['idempotency-key']).toBeTruthy();
  });

  it('reuses the same Idempotency-Key when Take next is retried after no answer', async () => {
    let attempt = 0;
    const api = mockApi({
      listRestaurantApplications: { data: rows, meta: { next_cursor: null, has_more: false } },
      takeNextRestaurantApplication: () => {
        attempt += 1;
        return attempt === 1 ? { status: 503, body: fixture('error_internal_error') } : 'restaurant_application_none_to_take';
      },
    });
    renderQueue();
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: 'Take next' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Take next didn’t work');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.callsTo('takeNextRestaurantApplication')).toHaveLength(2));
    const [first, second] = api.callsTo('takeNextRestaurantApplication');
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
  });

  it('draws the empty states apart: drained, filtered to nothing, nobody applied, and the error', async () => {
    const api = mockApi({ listRestaurantApplications: 'restaurant_application_queue_empty' });
    renderQueue();
    expect(await screen.findByText('Onboarding queue is clear')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Take next' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('switch', { name: /SLA breached only/ }));
    expect(await screen.findByText('No applications match these filters')).toBeTruthy();
    expect(api.callsTo('listRestaurantApplications').at(-1)?.query).toMatchObject({ sla_breached: 'true' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await screen.findByText('Onboarding queue is clear')).toBeTruthy();

    cleanup();
    mockApi({ listRestaurantApplications: { status: 500, body: fixture('error_internal_error') } });
    renderQueue();
    expect(await screen.findByText('The queue didn’t load')).toBeTruthy();
  });
});
