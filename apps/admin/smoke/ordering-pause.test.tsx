import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { setToken } from '../src/lib/token';
import { apiError, installDomShims, json, scriptFetch } from './linkPageHarness';
import openFixture from '../../../contracts/fixtures/admin/ordering_pause_open.json';
import pausedFixture from '../../../contracts/fixtures/admin/ordering_pause_on.json';

/**
 * #389 — the platform-wide pause on new orders, on the System page. Pins the one thing that
 * matters: confirming the dialog with a reason sends `setOrderingPause` (`PUT
 * /v1/admin/ordering-pause` with `paused: true` and the reason), and the panel then shows
 * the paused state the API answered with.
 */
describe('admin ordering pause', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    setToken(null);
    window.location.hash = '';
  });

  it('pauses with a reason through setOrderingPause and shows the paused state', async () => {
    setToken('admin-token');
    window.location.hash = '#/system';
    const calls = scriptFetch({
      '/v1/admin/ordering-pause': [json(200, { data: openFixture.payload }), json(200, { data: pausedFixture.payload })],
      '/internal/deps': apiError(403, 'FORBIDDEN'),
      '/health/ready': apiError(503, 'UNAVAILABLE'),
    });

    const { Root } = await import('../src/App');
    render(<Root />);

    const pauseButton = await screen.findByRole('button', { name: 'Pause new orders' });
    expect(screen.getByTestId('ordering-pause-state').textContent).toContain('New orders are open');

    fireEvent.click(pauseButton);
    const dialog = await screen.findByTestId('ordering-pause-confirm');
    const reason = 'Stripe is refusing card authorisations; pausing new orders.';
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause new orders' }));

    await waitFor(() => {
      expect(screen.getByTestId('ordering-pause-state').textContent).toContain('New orders are paused');
    });
    const puts = calls.filter((c) => c.path === '/v1/admin/ordering-pause' && c.body);
    expect(puts.map((c) => c.body)).toEqual([{ paused: true, reason }]);
    expect(screen.getByRole('button', { name: 'Resume new orders' })).not.toBeNull();
  });
});
