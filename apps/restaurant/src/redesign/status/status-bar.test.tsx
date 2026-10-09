/**
 * WP4 — the status bar and page banners on a console page (wp4 spec §3, §7): the Orders
 * switch moves only when the server confirms, turning off and resuming confirm in the page,
 * Pause offers 15/30/60 minutes only (no "until closing" before #312), the open-state reason
 * is the server's verbatim, and the halal rules (no badge when missing / unverified, slate
 * expired, the absence reported).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { setHalalClientErrorReporter } from '@hg/ui-web/certification';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setHalalClientErrorReporter(null);
});

const REASON = 'Taking orders until 11:00 pm';
const open = (patch: Record<string, unknown> = {}) => ({ ...fixture('restaurant_open_state_open'), reason: REASON, pause_until: null, missed_order_count: 0, ...patch });

function profileWith(halal: unknown) {
  const p = fixture('restaurant_profile');
  if (halal === undefined) delete p.halal;
  else p.halal = halal;
  return { body: p };
}

async function bar(routes: Record<string, Handler> = {}) {
  const api = installFakeApi(consoleRoutes({ 'GET /v1/restaurant/availability': { body: open() }, ...routes }));
  await renderRedesign('/orders');
  const region = await screen.findByRole('region', { name: 'Service status' });
  await waitFor(() => expect(within(region).getByTestId('open-state-badge').textContent).not.toBe('Checking…'));
  return { api, region };
}

describe('open state, switch and pause', () => {
  it('shows the server’s reason verbatim and the stored toggle', async () => {
    const { region } = await bar();
    expect(within(region).getByTestId('open-state-badge').textContent).toBe('Open');
    expect(within(region).getByTestId('open-state-reason').textContent).toBe(REASON);
    const sw = within(region).getByRole('switch', { name: /^Orders/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(within(region).getByText('Accepting orders')).toBeTruthy();
  });

  it('turning off confirms in the page; the switch moves only when the server confirms', async () => {
    let release: () => void = () => {};
    const { api, region } = await bar({
      'PATCH /v1/restaurant/availability': () =>
        new Promise((resolve) => {
          release = () => resolve({ body: open({ open_state: 'CLOSED_TOGGLE', is_accepting_orders: false, reason: 'You turned off accepting orders.' }) });
        }),
    });
    fireEvent.click(within(region).getByRole('switch', { name: /^Orders/ }));
    const confirm = await screen.findByRole('group', { name: 'Stop accepting new orders?' });
    expect(within(confirm).getByText('Orders already waiting still need an answer. Customers can’t order until you turn this back on.')).toBeTruthy();
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep accepting' }));
    expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop accepting' }));
    await waitFor(() => expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(1));
    expect(await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json()).toEqual({ is_accepting_orders: false });
    // In flight: still on, and busy.
    const sw = within(region).getByRole('switch', { name: /^Orders/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-busy')).toBe('true');
    release();
    await waitFor(() => expect(within(region).getByRole('switch', { name: /^Orders/ }).getAttribute('aria-checked')).toBe('false'));
    expect(within(region).getByTestId('open-state-reason').textContent).toBe('You turned off accepting orders.');
  });

  it('Keep accepting changes nothing; Escape is the same', async () => {
    const { api, region } = await bar();
    fireEvent.click(within(region).getByRole('switch', { name: /^Orders/ }));
    const confirm = await screen.findByRole('group', { name: 'Stop accepting new orders?' });
    fireEvent.keyDown(confirm, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Stop accepting new orders?' })).toBeNull());
    expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(0);
  });

  it('turning on needs no confirm; a failure keeps it off and says so', async () => {
    const { api, region } = await bar({
      'GET /v1/restaurant/availability': { body: open({ open_state: 'CLOSED_TOGGLE', is_accepting_orders: false, reason: 'You turned off accepting orders.' }) },
      'PATCH /v1/restaurant/availability': { status: 503, body: errorBody('SERVICE_UNAVAILABLE') },
    });
    fireEvent.click(within(region).getByRole('switch', { name: /^Orders/ }));
    expect(await screen.findByText('Couldn’t turn on orders')).toBeTruthy();
    expect(screen.getByText('You’re still not accepting orders. Check the connection and try again.')).toBeTruthy();
    expect(await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json()).toEqual({ is_accepting_orders: true });
    expect(within(region).getByRole('switch', { name: /^Orders/ }).getAttribute('aria-checked')).toBe('false');
    // CLOSED_TOGGLE: Pause is off.
    expect(within(region).getByRole('button', { name: 'Pause' }).hasAttribute('disabled')).toBe(true);
  });

  it('Pause offers 15, 30 and 60 minutes (no “until closing” before #312) and sends pause_until', async () => {
    const { api, region } = await bar({ 'PATCH /v1/restaurant/availability': { body: open({ open_state: 'PAUSED', reason: 'Until 7:10 pm' }) } });
    fireEvent.click(within(region).getByRole('button', { name: 'Pause' }));
    const menu = screen.getByRole('menu', { name: 'Pause new orders' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Pause for 15 minutes', 'Pause for 30 minutes', 'Pause for 1 hour']);
    const before = Date.now();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pause for 15 minutes' }));
    await waitFor(() => expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(1));
    const body = await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json();
    expect(body.is_accepting_orders).toBe(true);
    expect(body).not.toHaveProperty('pause_until_closing');
    const minutes = (Date.parse(body.pause_until) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
    expect(await within(region).findByRole('button', { name: 'Resume now' })).toBeTruthy();
    expect(within(region).getByTestId('open-state-badge').textContent).toBe('Paused');
  });

  it('Resume now confirms first (Stay paused focused), then clears the pause', async () => {
    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    const { api, region } = await bar({
      'GET /v1/restaurant/availability': { body: open({ open_state: 'PAUSED', pause_until: until, reason: 'Until later' }) },
      'PATCH /v1/restaurant/availability': { body: open() },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Resume now' }));
    const confirm = await screen.findByRole('group', { name: 'Resume new orders now?' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Stay paused' }));
    expect(within(confirm).getByText(/^New orders start ringing on this screen straight away\. Your pause was set to end at \d{1,2}:\d{2} [ap]m\.$/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Resume now' }));
    await waitFor(() => expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(1));
    expect(await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json()).toEqual({ is_accepting_orders: true, pause_until: null });
    await waitFor(() => expect(within(region).getByTestId('open-state-badge').textContent).toBe('Open'));
  });

  it('auto-off and suspension raise their banners', async () => {
    installFakeApi(
      consoleRoutes({ 'GET /v1/restaurant/availability': { body: open({ open_state: 'CLOSED_TOGGLE', is_accepting_orders: false, missed_order_count: 2, reason: 'Turned off after 2 orders in a row timed out.' }) } }),
    );
    await renderRedesign('/orders');
    const auto = await screen.findByTestId('banner-auto-off');
    expect(auto.getAttribute('role')).toBe('alert');
    expect(within(auto).getByText('New orders stopped: 2 orders timed out in a row')).toBeTruthy();
    cleanup();

    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/availability': { body: open({ open_state: 'CLOSED_SUSPENDED', is_accepting_orders: false, reason: 'Repeated orders not handed to riders' }) } }));
    await renderRedesign('/orders');
    const sus = await screen.findByTestId('banner-suspended');
    expect(within(sus).getByText('Your account is suspended')).toBeTruthy();
    expect(within(sus).getByText(/^Reason from HalalGoes: Repeated orders not handed to riders\. Orders already in progress can still be finished\./)).toBeTruthy();
    expect(within(sus).getByRole('link', { name: 'Call support on +1 800 555 0199' })).toBeTruthy();
    const region = await screen.findByRole('region', { name: 'Service status' });
    expect(within(region).getByRole('switch', { name: /^Orders/ }).hasAttribute('disabled')).toBe(true);
  });

  it('first load of the open state failed: Unknown, nothing shown as if known', async () => {
    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/availability': { status: 500, body: errorBody('INTERNAL_ERROR') } }));
    await renderRedesign('/orders');
    const region = await screen.findByRole('region', { name: 'Service status' });
    await waitFor(() => expect(within(region).getByTestId('open-state-badge').textContent).toBe('Unknown'));
    expect(within(region).getByTestId('health-badge').textContent).toBe('Not connected');
    expect(within(region).getByRole('switch', { name: /^Orders/ }).hasAttribute('disabled')).toBe(true);
    expect(within(region).getByText('Available once orders load')).toBeTruthy();
  });
});

describe('screen health', () => {
  it('the health button opens the Screen health panel and Close returns focus to it', async () => {
    const { region } = await bar();
    const button = within(region).getByRole('button', { name: /^Screen health: Connecting…\. Show details$/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const panel = await screen.findByRole('complementary', { name: 'Screen health details' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Screen health' }));
    expect(within(region).getByRole('button', { name: /^Screen health/ }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close screen health' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Screen health details' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('button', { name: /^Screen health/ })));
  });

  it('failing heartbeats read as offline with a banner', async () => {
    await bar({ 'POST /v1/restaurant/heartbeat': { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } });
    const banner = await screen.findByTestId('banner-offline');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(within(banner).getByText('This screen is offline')).toBeTruthy();
    expect(screen.getByTestId('health-badge').textContent).toMatch(/^Offline/);
  });
});

describe('halal on the console', () => {
  it('certified: the HalalBadge, no banner', async () => {
    const { region } = await bar();
    expect(within(region).getByRole('img', { name: 'Halal certified' })).toBeTruthy();
    expect(screen.queryByTestId('banner-halal')).toBeNull();
  });

  it('missing: no badge, no divider, and the absence is reported', async () => {
    const reporter = vi.fn();
    setHalalClientErrorReporter(reporter);
    const { region } = await bar({ 'GET /v1/restaurant/profile': profileWith(undefined) });
    await waitFor(() => expect(reporter).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', expect.anything()));
    expect(within(region).queryByTestId('halal-slot')).toBeNull();
    expect(within(region).queryByTestId('HalalBadge')).toBeNull();
    expect(screen.queryByTestId('banner-halal')).toBeNull();
  });

  it('expiring: badge plus the expiring banner with the long date and Upload renewal', async () => {
    const { region } = await bar({ 'GET /v1/restaurant/profile': profileWith({ display_state: 'EXPIRING_SOON', certifying_body_name: 'HMA', expires_on: '2026-10-14' }) });
    expect(within(region).getByTestId('HalalBadge')).toBeTruthy();
    const banner = await screen.findByTestId('banner-halal');
    expect(banner.getAttribute('data-tone')).toBe('halal-expiring');
    expect(within(banner).getByText('Your halal certificate expires on 14 October 2026')).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Upload renewal' })).toBeTruthy();
  });

  it('expired: slate badge and slate banner, never a danger tone', async () => {
    const { region } = await bar({
      'GET /v1/restaurant/profile': profileWith({ display_state: 'EXPIRED', certifying_body_name: 'HMA', expires_on: '2026-09-20' }),
      'GET /v1/restaurant/availability': { body: open({ open_state: 'CLOSED_SUSPENDED', is_accepting_orders: false, reason: 'Suspended: halal certificate expired' }) },
    });
    expect(within(region).getByTestId('HalalBadge').getAttribute('data-halal-render')).toBe('expired');
    const banner = await screen.findByTestId('banner-halal');
    expect(banner.getAttribute('data-tone')).toBe('halal-expired');
    expect(within(banner).getByText('We can’t currently vouch for your halal certificate')).toBeTruthy();
    expect(banner.className).not.toMatch(/danger/);
    // The halal suspension explains itself in the switch; no generic suspended banner.
    expect(within(region).getByText('Customers can’t order until your certificate is approved')).toBeTruthy();
    expect(screen.queryByTestId('banner-suspended')).toBeNull();
  });

  it('unverified (being checked): no HalalBadge at all', async () => {
    const { region } = await bar({
      'GET /v1/restaurant/profile': profileWith({ display_state: 'UNVERIFIED', certifying_body_name: null, expires_on: null }),
      'GET /v1/restaurant/documents': { body: [{ ...fixture('document_in_review'), doc_type: 'HALAL_CERTIFICATE', state: 'IN_REVIEW' }] },
    });
    const banner = await screen.findByTestId('banner-halal');
    expect(within(banner).getByText('We’re checking your certificate')).toBeTruthy();
    expect(within(region).queryByTestId('HalalBadge')).toBeNull();
  });

  it('rejected: no HalalBadge; the alert quotes the review note verbatim', async () => {
    const note = 'the certificate number doesn’t match the certifying body’s register';
    const { region } = await bar({
      'GET /v1/restaurant/profile': profileWith({ display_state: 'UNVERIFIED', certifying_body_name: null, expires_on: null }),
      'GET /v1/restaurant/documents': { body: [{ ...fixture('document_rejected'), doc_type: 'HALAL_CERTIFICATE', state: 'REJECTED', review_note: note }] },
    });
    const banner = await screen.findByTestId('banner-halal');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(within(banner).getByText('Your certificate wasn’t accepted')).toBeTruthy();
    expect(within(banner).getByText(new RegExp(`^Reason from HalalGoes: ${note}\\.`))).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Upload a new certificate' })).toBeTruthy();
    expect(within(region).queryByTestId('HalalBadge')).toBeNull();
  });
});
