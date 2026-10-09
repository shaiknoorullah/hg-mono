/**
 * WP1 — shell, routing and platform plumbing (manifest §3 WP1 DONE list).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, errorBody, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { getSession } from '../../lib/api';
import { formatTime, formatCalendarDate, spokenDuration } from '../format/time';
import { HEARTBEAT_INTERVAL_MS } from '../data/heartbeat';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('console shell', () => {
  it('renders the six-item rail in the Live Orders order, with no Staff', async () => {
    installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    const rail = await screen.findByTestId('console-rail');
    const links = within(rail).getAllByRole('link');
    const visibleName = (el: HTMLElement) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return copy.textContent?.trim();
    };
    expect(links.map(visibleName)).toEqual(['Live orders', 'History', 'Menu', 'Hours', 'Payouts', 'Settings']);
    expect(within(rail).queryByText('Staff')).toBeNull();
    // History is current on /orders/history, not Live orders.
    expect(within(rail).getByRole('link', { name: /History/ }).getAttribute('aria-current')).toBe('page');
    expect(within(rail).getByRole('link', { name: /Live orders/ }).getAttribute('aria-current')).toBeNull();
  });

  it('shows the restaurant and the owner in the app bar and account menu', async () => {
    installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    const profile = fixture('restaurant_profile');
    await screen.findByText(new RegExp(profile.display_name));
    const owner = [profile.owner_first_name, profile.owner_last_name].filter(Boolean).join(' ');
    const trigger = screen.getByRole('button', { name: owner ? `Account: ${owner}, owner` : 'Account' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByRole('menuitem', { name: 'Sign out…' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: "What's new" })).toBeTruthy();
  });

  it('has the skip links, strip landmark and a service status region', async () => {
    installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    expect(screen.getByRole('link', { name: 'Skip to new orders' }).getAttribute('href')).toBe('#new-orders');
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('region', { name: 'Service status' })).toBeTruthy();
    expect(document.getElementById('new-orders')).not.toBeNull();
  });

  it('sends a restaurant whose onboarding is not DONE to onboarding', async () => {
    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_documents_pending' }));
    await renderRedesign('/orders/history');
    await waitFor(() => expect(screen.queryByTestId('console-rail')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('console-loading')).toBeNull());
  });

  it('shows a way out when the restaurant cannot be loaded', async () => {
    const api = installFakeApi(consoleRoutes({ 'GET /v1/restaurant/onboarding/status': { status: 500, body: errorBody('INTERNAL_ERROR') } }));
    await renderRedesign('/orders/history');
    expect(await screen.findByText('We couldn’t load your restaurant')).toBeTruthy();
    api.set('GET /v1/restaurant/onboarding/status', 'restaurant_onboarding_active');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('console-rail')).toBeTruthy();
  });

  it('sends a visit with no session to sign-in', async () => {
    installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history', { signedIn: false });
    expect(screen.queryByTestId('console-rail')).toBeNull();
  });
});

describe('session expiry', () => {
  it('refreshes an expired access token silently and never shows the signed-out alert', async () => {
    let profileCalls = 0;
    const api = installFakeApi(
      consoleRoutes({
        'GET /v1/restaurant/profile': (req) => {
          profileCalls += 1;
          // The first call carries the expired token; the replay carries the new one.
          return req.headers.get('Authorization') === 'Bearer fresh-token'
            ? { body: fixture('restaurant_profile') }
            : { status: 401, body: errorBody('UNAUTHENTICATED') };
        },
        'POST /v1/auth/refresh': { body: { ...fixture('session_grant_password_changed'), access_token: 'fresh-token' } },
      }),
    );
    await renderRedesign('/orders/history');
    await screen.findByText(new RegExp(fixture('restaurant_profile').display_name));
    expect(api.callsTo('POST /v1/auth/refresh')).toHaveLength(1);
    expect(profileCalls).toBe(2);
    expect(getSession()?.accessToken).toBe('fresh-token');
    expect(screen.queryByTestId('signed-out-alert')).toBeNull();
  });

  it('raises the blocking alert when refresh fails, and keeps the console on screen', async () => {
    const api = installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    await screen.findByText(new RegExp(fixture('restaurant_profile').display_name));
    api.set('GET /v1/restaurant/availability', { status: 401, body: errorBody('UNAUTHENTICATED') });
    api.set('POST /v1/auth/refresh', { status: 401, body: errorBody('REFRESH_TOKEN_INVALID') });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText('Sign in again to keep answering orders')).toBeTruthy();
    expect(within(alert).getByRole('button', { name: 'Sign in again' })).toBeTruthy();
    // Nothing on screen is cleared: the rail and the restaurant name are still there.
    expect(screen.getByTestId('console-rail')).toBeTruthy();
    expect(screen.getByText(new RegExp(fixture('restaurant_profile').display_name))).toBeTruthy();
    // Escape does not dismiss it.
    fireEvent.keyDown(alert, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('says the screen was signed out elsewhere when refresh detects reuse', async () => {
    const api = installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    api.set('GET /v1/restaurant/availability', { status: 401, body: errorBody('UNAUTHENTICATED') });
    api.set('POST /v1/auth/refresh', { status: 401, body: errorBody('REFRESH_REUSE_DETECTED') });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('This screen was signed out from another device')).toBeTruthy();
  });

  it('shares one refresh between a burst of 401s', async () => {
    let fresh = false;
    const api = installFakeApi(
      consoleRoutes({
        'GET /v1/restaurant/profile': (req) =>
          req.headers.get('Authorization') === 'Bearer fresh-token' ? { body: fixture('restaurant_profile') } : { status: 401, body: errorBody('UNAUTHENTICATED') },
        'GET /v1/config/public': (req) =>
          req.headers.get('Authorization') === 'Bearer fresh-token' ? { body: fixture('public_config') } : { status: 401, body: errorBody('UNAUTHENTICATED') },
        'POST /v1/auth/refresh': async () => {
          await new Promise((r) => setTimeout(r, 20));
          fresh = true;
          return { body: { ...fixture('session_grant_password_changed'), access_token: 'fresh-token' } };
        },
      }),
    );
    await renderRedesign('/orders/history');
    await screen.findByText(new RegExp(fixture('restaurant_profile').display_name));
    expect(fresh).toBe(true);
    expect(api.callsTo('POST /v1/auth/refresh')).toHaveLength(1);
  });
});

describe('sign out', () => {
  it('asks to stop orders first while accepting, and Stay signed in keeps the session', async () => {
    installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Account/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out…' }));
    const confirm = await screen.findByRole('group', { name: 'Stop orders before you sign out?' });
    const stay = within(confirm).getByRole('button', { name: 'Stay signed in' });
    expect(document.activeElement).toBe(stay);
    expect(within(confirm).getByRole('button', { name: 'Stop accepting and sign out' })).toBeTruthy();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Stop orders before you sign out?' })).toBeNull();
    expect(getSession()).not.toBeNull();
  });

  it('stops accepting, then signs out', async () => {
    const api = installFakeApi(
      consoleRoutes({
        'PATCH /v1/restaurant/availability': { body: { ...fixture('restaurant_availability_open'), is_accepting_orders: false } },
        'POST /v1/auth/logout': { status: 204 },
      }),
    );
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop accepting and sign out' }));
    await waitFor(() => expect(api.callsTo('POST /v1/auth/logout')).toHaveLength(1));
    const patch = api.callsTo('PATCH /v1/restaurant/availability')[0]!;
    expect(await patch.json()).toEqual({ is_accepting_orders: false });
    expect(getSession()).toBeNull();
  });

  it('does not sign out when turning orders off fails', async () => {
    const api = installFakeApi(
      consoleRoutes({
        'PATCH /v1/restaurant/availability': { status: 500, body: errorBody('INTERNAL_ERROR') },
        'POST /v1/auth/logout': { status: 204 },
      }),
    );
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop accepting and sign out' }));
    await waitFor(() => expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(1));
    expect(api.callsTo('POST /v1/auth/logout')).toHaveLength(0);
    expect(getSession()).not.toBeNull();
  });

  it('offers a plain sign out when orders are already off', async () => {
    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/availability': { body: { ...fixture('restaurant_availability_open'), is_accepting_orders: false } } }));
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out…' }));
    expect(await screen.findByRole('group', { name: 'Sign out of this screen?' })).toBeTruthy();
  });
});

describe('heartbeat', () => {
  it('beats on load and every 30 seconds while the console is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi(consoleRoutes());
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    await waitFor(() => expect(api.callsTo('POST /v1/restaurant/heartbeat')).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(api.callsTo('POST /v1/restaurant/heartbeat')).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    });
    expect(api.callsTo('POST /v1/restaurant/heartbeat')).toHaveLength(4);
  });

  it('does not beat during onboarding', async () => {
    const api = installFakeApi(consoleRoutes({ 'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_documents_pending' }));
    await renderRedesign('/orders/history');
    await waitFor(() => expect(api.callsTo('GET /v1/restaurant/onboarding/status').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.callsTo('POST /v1/restaurant/heartbeat')).toHaveLength(0);
  });
});

describe('formatters', () => {
  it('formats 12-hour times in the restaurant timezone', () => {
    expect(formatTime('2026-10-09T23:42:00Z', 'America/Toronto')).toBe('7:42 pm');
    expect(formatTime('2026-10-10T04:05:00Z', 'America/Toronto')).toBe('12:05 am');
    expect(formatTime('2026-10-09T16:00:00Z', 'America/Toronto')).toBe('12:00 pm');
  });
  it('formats calendar dates without a timezone shift', () => {
    expect(formatCalendarDate('2026-10-14')).toBe('14 October 2026');
    expect(formatCalendarDate('2026-10-14', 'short')).toBe('14 Oct');
  });
  it('speaks durations in words', () => {
    expect(spokenDuration(132_000)).toBe('2 minutes 12 seconds');
    expect(spokenDuration(60_000)).toBe('1 minute');
    expect(spokenDuration(18_000)).toBe('18 seconds');
  });
});
