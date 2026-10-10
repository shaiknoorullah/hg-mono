import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { api as redesignApi } from '../../data/api';
import { loadDraft, saveDraft } from '../../data/drafts';
import { getSession, markSessionEnded } from '../../data/session';
import { resetAuthMemory, wasSignedOutOnPurpose } from '../../auth/memory';
import { getToken, setToken } from '../../../lib/token';
import {
  getQueueDepth,
  applyQueueDepthFrame,
  queueCountsNote,
  resetQueueDepth,
  setQueueConnection,
} from '../../realtime/queueDepth';
import { environmentBanner } from '../../system/banners';
import { FakeRealtimeSocket, mockApi, principalFor, renderRedesign, resetSession, type MockApi } from '../../testing';
import { RedesignApp } from '../RedesignRoot';

// The public auth screens belong to another work stream; the shell only needs to know which one
// it shows.
vi.mock('../../auth/SignInScreen', () => ({ SignInScreen: () => <h1>Sign-in screen</h1> }));
vi.mock('../../auth/ResetPasswordScreen', () => ({ ResetPasswordScreen: () => <h1>Reset password screen</h1> }));
vi.mock('../../auth/AcceptInviteScreen', () => ({ AcceptInviteScreen: () => <h1>Accept invite screen</h1> }));

const nav = () => screen.getByRole('navigation', { name: 'Admin' });

function envelope(code: string, message = 'Refused.') {
  return { error: { code, message, request_id: '01JTESTREQUEST0000000000000' } };
}

function grantFor(principal: ReturnType<typeof principalFor>, token = 'fresh-token') {
  return { data: { access_token: token, refresh_token: null, expires_in: 900, is_new_account: false, principal } };
}

/**
 * The real server refuses a request carrying a dead bearer before any handler runs, public ones
 * included (stage-10 Authenticate, `services/hg/internal/httpx/middleware.go`).
 */
function strictLogin(grant: unknown) {
  return (req: { headers: Record<string, string> }) =>
    req.headers.authorization
      ? { status: 401, body: envelope('AUTHENTICATION_REQUIRED', 'The credential presented is malformed or has been revoked.') }
      : { status: 200, body: grant };
}

/** A viewport `width` CSS px wide: `(max-width: Npx)` queries answer for it. */
function setViewport(width: number) {
  act(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => {
        const max = /max-width:\s*([\d.]+)px/.exec(query);
        return {
          matches: max ? width <= Number(max[1]) : false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      },
    });
    window.dispatchEvent(new Event('resize'));
  });
}
const navLinkNames = () => within(nav()).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? a.textContent);

let api: MockApi;
let sockets: FakeRealtimeSocket[];
const createSocket = (url: string) => {
  const socket = new FakeRealtimeSocket(url);
  sockets.push(socket);
  return socket;
};

beforeEach(() => {
  sockets = [];
  resetQueueDepth();
  resetAuthMemory();
  sessionStorage.clear();
  api = mockApi();
});

afterEach(() => {
  cleanup();
  resetSession();
  resetQueueDepth();
  vi.unstubAllGlobals();
});

function renderApp(route: string, principal: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') {
  return renderRedesign(<RedesignApp pathname="/" createSocket={createSocket} />, { route, principal });
}

describe('navigation per role (manifest §1.1)', () => {
  it('a super admin sees every launch item, verbatim, and no Profile changes', () => {
    renderApp('/account', 'SUPER_ADMIN');
    expect(navLinkNames()).toEqual([
      'Halal certificates',
      'Restaurant applications',
      'Rider applications',
      'Issuing bodies',
      'Menu reviews',
      'Orders',
      'Refunds & disputes',
      'Live alerts',
      'Staff',
      'Your account',
      'System status',
    ]);
    expect(screen.queryByText('Profile changes')).toBeNull();
    expect(within(nav()).getByText('Review')).toBeTruthy();
    expect(within(nav()).getByText('Super admin')).toBeTruthy();
  });

  it('an admin sees the same items as a super admin', () => {
    renderApp('/account', 'ADMIN');
    expect(navLinkNames()).toContain('Rider applications');
    expect(navLinkNames()).toContain('Menu reviews');
    expect(navLinkNames()).toContain('Staff');
    expect(within(nav()).getByText('Admin')).toBeTruthy();
  });

  it('support has no rider queue, no menu reviews and no staff page; Review is view only', () => {
    renderApp('/account', 'SUPPORT_AGENT');
    const names = navLinkNames();
    expect(names).not.toContain('Rider applications');
    expect(names).not.toContain('Menu reviews');
    expect(names).not.toContain('Staff');
    expect(names).toContain('Halal certificates');
    expect(names).toContain('Issuing bodies');
    expect(within(nav()).getByText('Review · view only')).toBeTruthy();
    expect(within(nav()).getByText('Support agent')).toBeTruthy();
  });

  it('marks the current item with aria-current=page and only that one', () => {
    renderApp('/issuing-bodies');
    const current = within(nav()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute('aria-label')).toBe('Issuing bodies');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Issuing bodies');
  });

  it('lands admins on Restaurant applications and support on Live alerts', () => {
    renderApp('/', 'SUPPORT_AGENT');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live alerts');
    cleanup();
    resetSession();
    renderApp('/', 'ADMIN');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Restaurant applications');
  });

  it('folds the nav to the rail on a detail workspace', async () => {
    renderApp('/riders/7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e09');
    expect(nav().getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand navigation' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the nav again on the way back to a list page', async () => {
    renderApp('/riders/7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e09');
    fireEvent.click(within(nav()).getByRole('link', { name: 'Issuing bodies' }));
    await waitFor(() => expect(nav().getAttribute('data-collapsed')).toBeNull());
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('queue counts (admin.queue_depth only)', () => {
  it('shows no number before the first frame, the counts after it, and stale counts when the connection drops', async () => {
    renderApp('/account', 'ADMIN');
    expect(navLinkNames()).toContain('Restaurant applications');
    expect(screen.getByTestId('queue-counts-note').textContent).toBe('Waiting for queue counts from the live connection.');

    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(api.callsTo('createRealtimeTicket')).toHaveLength(1);
    act(() => sockets[0]!.open());
    expect(sockets[0]!.sent).toContainEqual({ type: 'subscribe', channel: 'admin:ops' });
    expect(screen.getByTestId('queue-counts-note').textContent).toBe('Connected. Counts arrive with the next change.');
    expect(navLinkNames()).toContain('Restaurant applications');

    act(() =>
      sockets[0]!.push({
        id: '01J9ZQ0000000000000000000A',
        seq: 1,
        channel: 'admin:ops',
        type: 'admin.queue_depth',
        data: { pending_restaurant_reviews: 4, pending_rider_reviews: 2, failed_refunds: 2, open_disputes: 5 },
      }),
    );
    expect(navLinkNames()).toEqual(
      expect.arrayContaining([
        'Restaurant applications, 4 waiting',
        'Rider applications, 2 waiting',
        'Refunds & disputes, 2 failed refunds, 5 open disputes',
      ]),
    );
    expect(screen.queryByTestId('queue-counts-note')).toBeNull();

    act(() => sockets[0]!.drop());
    // 2026-10-05T12:00:00Z is 8:00 am in Toronto.
    expect(screen.getByTestId('queue-counts-note').textContent).toBe('Counts from 8:00 am. Not live while the connection is down.');
    expect(navLinkNames()).toContain('Restaurant applications, 4 waiting');
  });

  it('never keeps the rider count for support, and shows nothing for a zero', () => {
    applyQueueDepthFrame({ pending_restaurant_reviews: 0, pending_rider_reviews: 9, failed_refunds: 0, open_disputes: 3 }, '2026-10-05T13:44:00Z', 'SUPPORT_AGENT');
    expect(getQueueDepth().counts?.pending_rider_reviews).toBeNull();
    setQueueConnection('open');
    renderApp('/account', 'SUPPORT_AGENT');
    expect(navLinkNames()).toContain('Restaurant applications');
    expect(navLinkNames()).toContain('Refunds & disputes, 3 open disputes');
    setQueueConnection('reconnecting');
    expect(queueCountsNote(getQueueDepth())).toBe('Counts from 9:44 am. Not live while the connection is down.');
  });
});

describe('routes', () => {
  it('shows support "No permission" on the rider queue, with focus on the app bar heading and no alert', () => {
    renderApp('/riders', 'SUPPORT_AGENT');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('No permission');
    expect(document.activeElement).toBe(heading);
    expect(
      screen.getByText(
        'Your role, Support agent, doesn’t include the permission this page needs: rider review. Nothing was changed. If you need it, ask a super admin.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to live alerts' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['/riders/7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e09', 'rider review'],
    ['/menu-reviews', 'menu review'],
    ['/menu-reviews/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', 'menu review'],
    ['/restaurants/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/menu/items/1c2d3e4f-5061-4b7c-8d9e-0f1a2b3c4d5e', 'menu review'],
    ['/staff', 'staff accounts'],
    ['/staff/1c2d3e4f-5061-4b7c-8d9e-0f1a2b3c4d5e', 'staff accounts'],
  ])('support opening %s by its address gets "No permission" (%s)', (route, permission) => {
    renderApp(route, 'SUPPORT_AGENT');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('No permission');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(new RegExp(`the permission this page needs: ${permission}\\.`))).toBeTruthy();
    expect(document.querySelector('[data-legacy-screen]')).toBeNull();
  });

  it('draws "Back to …" outlined (tertiary), as RV/Shell-Forbidden does, and it goes to the landing page', async () => {
    renderApp('/staff', 'SUPPORT_AGENT');
    const back = screen.getByRole('button', { name: 'Back to live alerts' });
    expect(back.getAttribute('data-variant')).toBe('tertiary');
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live alerts'));
  });

  it('the not-found page draws "Back to …" outlined too', () => {
    renderApp('/nowhere', 'ADMIN');
    expect(screen.getByRole('button', { name: 'Back to restaurant applications' }).getAttribute('data-variant')).toBe('tertiary');
  });

  it('falls back to the legacy Orders screen inside the new shell', async () => {
    const { container } = renderApp('/orders');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Orders');
    await waitFor(() => expect(container.querySelector('[data-legacy-screen="orders"] #orders-heading')).not.toBeNull());
    expect(nav()).toBeTruthy();
  });

  it('names the work package on a route that is not built yet', () => {
    renderApp('/issuing-bodies');
    expect(screen.getByRole('status').textContent).toContain('Issuing bodies comes with WP-4');
  });

  it('explains where certificates are reached (Q7)', () => {
    renderApp('/certificates');
    expect(screen.getByRole('heading', { level: 2, name: 'Certificates are opened from a restaurant’s application' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open active restaurants/ }).getAttribute('href')).toBe('/restaurants?state=ACTIVE');
  });

  it('shows a not-found page for an unknown path', () => {
    renderApp('/nowhere');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
  });

  it('serves the public pages before the gate', () => {
    renderRedesign(<RedesignApp pathname="/reset-password" />, { signedIn: false });
    expect(screen.getByRole('heading', { name: 'Reset password screen' })).toBeTruthy();
  });
});

describe('shell chrome', () => {
  it('puts "Skip to main content" first in the tab order and moves focus to main', () => {
    renderApp('/account');
    const focusable = document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex="0"]');
    expect(focusable[0]!.textContent).toBe('Skip to main content');
    fireEvent.click(focusable[0]!);
    expect(document.activeElement?.id).toBe('main-content');
  });

  it('draws the staging strip copy for dev and local builds only', () => {
    expect(environmentBanner('dev')?.title).toBe('Staging: not the live platform.');
    expect(environmentBanner('local')?.title).toBe('Local: this computer only');
    expect(environmentBanner('')).toBeNull();
    expect(environmentBanner('prod')).toBeNull();
  });

  it('shows the offline banner while the browser is offline', () => {
    renderApp('/account');
    expect(screen.queryByText('You’re offline.')).toBeNull();
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('region', { name: "You're offline." })).toBeTruthy();
    expect(screen.getByText('Changes are off until the connection returns. Nothing you do now is saved for later.')).toBeTruthy();
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('region', { name: "You're offline." })).toBeNull();
  });

  it('Sign out calls logout and returns to the sign-in screen, recorded as on purpose', async () => {
    renderApp('/account');
    saveDraft('invite', { email: 'new.person@halalgoes.ca' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign-in screen' });
    expect(api.callsTo('logout')).toHaveLength(1);
    expect(api.callsTo('logout')[0]!.headers.authorization).toBe('Bearer test-access-token');
    expect(getSession().principal).toBeNull();
    expect(getToken()).toBeNull();
    expect(wasSignedOutOnPurpose()).toBe(true);
    // Nothing typed by this person stays in the tab.
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('hg-admin-draft:'))).toEqual([]);
  });

  it('Sign out on a session the server already ended: no dialog flashes, and it is still on purpose', async () => {
    api.set({ logout: { status: 401, body: envelope('SESSION_EXPIRED', 'Expired.') } });
    renderApp('/account');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign-in screen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(wasSignedOutOnPurpose()).toBe(true);
  });

  it('starts as the rail below 1280px (the 1024 boards) and open at 1280px; the person can still open it', () => {
    renderApp('/account');
    setViewport(1024);
    expect(nav().getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(nav().getAttribute('data-collapsed')).toBeNull();
    cleanup();
    renderApp('/account');
    setViewport(1280);
    expect(nav().getAttribute('data-collapsed')).toBeNull();
  });

  it('draws What’s new as the board does, unavailable until its panel exists, and an icon slot on every item', () => {
    renderApp('/account');
    const whatsNew = screen.getByRole('button', { name: 'What’s new' });
    expect(whatsNew.getAttribute('aria-disabled')).toBe('true');
    expect(whatsNew.getAttribute('aria-expanded')).toBe('false');
    const panelId = whatsNew.getAttribute('aria-controls')!;
    expect(document.getElementById(panelId)).toBeTruthy();
    expect(document.getElementById(whatsNew.getAttribute('aria-describedby')!)!.textContent).toBe(
      'What’s new comes in a later update.',
    );
    // Every nav item has a glyph or an empty slot of the same size, so the labels line up.
    for (const link of within(nav()).getAllByRole('link')) {
      expect(link.querySelector('[data-icon], [data-icon-slot]')).toBeTruthy();
    }
  });

  it('folds into a NavDrawer at exactly 720px (200% zoom of 1440), and not at 721px', () => {
    renderApp('/account');
    setViewport(721);
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
    expect(nav()).toBeTruthy();
    setViewport(720);
    const open = screen.getByRole('button', { name: 'Open navigation' });
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull();
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(open.getAttribute('aria-haspopup')).toBe('dialog');
    const controls = open.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer.id).toBe(controls);
  });

  it('picking a page in the drawer closes it and moves focus to the new page heading', async () => {
    renderApp('/account');
    setViewport(720);
    // A real click focuses the button, so the drawer hands focus back to it when it closes.
    const open = screen.getByRole('button', { name: 'Open navigation' });
    open.focus();
    fireEvent.click(open);
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    const link = within(drawer).getByRole('link', { name: 'Issuing bodies' });
    link.focus();
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Issuing bodies');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('Escape closes the drawer and returns focus to "Open navigation"', async () => {
    renderApp('/account');
    setViewport(720);
    const open = screen.getByRole('button', { name: 'Open navigation' });
    open.focus();
    fireEvent.click(open);
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    expect(document.activeElement).toBe(open);
  });

  it('rail labels are caption size and wrap inside the 80px rail instead of spilling out', () => {
    renderApp('/riders/7c1d4f2a-0b3e-4c5d-8e6f-1a2b3c4d5e09', 'ADMIN');
    const labels = [...nav().querySelectorAll<HTMLElement>('[data-rail-label]')];
    expect(labels.map((l) => l.textContent)).toEqual(expect.arrayContaining(['Certificates', 'Restaurant']));
    for (const label of labels) {
      expect(label.className).toContain('max-w-[72px]');
      expect(label.className).toContain('[overflow-wrap:anywhere]');
      expect(label.closest('a')!.className).toContain('text-caption');
    }
  });
});

describe('session ended dialog', () => {
  it('keeps the page underneath and signs in again in place, asking for a code only when the server does', async () => {
    const admin = principalFor('ADMIN');
    api.set({
      login: (req) => {
        const body = req.body as { totp_code?: string };
        if (!body.totp_code) {
          return { status: 401, body: { error: { code: 'MFA_REQUIRED', message: 'A code is needed.' } } };
        }
        return { data: { access_token: 'fresh-token', refresh_token: null, expires_in: 900, is_new_account: false, principal: admin } };
      },
    });
    renderApp('/issuing-bodies', 'ADMIN');
    act(() => markSessionEnded('expired'));

    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    expect(
      within(dialog).getByText(
        "Your session ended after 30 minutes without activity, or 12 hours after you signed in. Sign in again to carry on; you come back to this page. Anything you hadn't sent wasn't saved.",
      ),
    ).toBeTruthy();
    // The page is still there behind the dialog.
    expect(screen.getByText(/Issuing bodies comes with WP-4/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'aminah@halalgoes.ca' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'correct horse battery' } });
    expect(within(dialog).queryByLabelText(/Authentication code/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    const codeField = await within(dialog).findByLabelText(/Authentication code/);
    expect(api.callsTo('login')[0]!.body).toEqual({ email: 'aminah@halalgoes.ca', password: 'correct horse battery' });
    await waitFor(() => expect(document.activeElement).toBe(codeField));
    fireEvent.change(codeField, { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.callsTo('login')[1]!.body).toEqual({ email: 'aminah@halalgoes.ca', password: 'correct horse battery', totp_code: '123456' });
    expect(getToken()).toBe('fresh-token');
    expect(getSession().ended).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Issuing bodies');
    expect(screen.getByText(/Issuing bodies comes with WP-4/)).toBeTruthy();
  });

  it('uses the revoked copy when the session was ended elsewhere', async () => {
    renderApp('/account', 'ADMIN');
    act(() => markSessionEnded('revoked'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session was ended' });
    expect(within(dialog).getByRole('button', { name: 'Go to sign in' })).toBeTruthy();
  });

  it('drops the dead token when the session ends, so nothing is sent with it', () => {
    renderApp('/account', 'ADMIN');
    expect(getToken()).toBe('test-access-token');
    act(() => markSessionEnded('expired'));
    expect(getToken()).toBeNull();
    expect(getSession().principal).not.toBeNull();
  });

  it.each([
    ['SESSION_EXPIRED', 'Your session ended'],
    ['SESSION_REVOKED', 'Your session was ended'],
  ])('a 401 %s on a signed-in redesign call raises the dialog and keeps the page', async (code, title) => {
    api.set({ createRealtimeTicket: { status: 401, body: envelope(code) } });
    renderApp('/issuing-bodies', 'ADMIN');
    await screen.findByRole('dialog', { name: title });
    expect(screen.getByText(/Issuing bodies comes with WP-4/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Issuing bodies');
    expect(getSession().principal).not.toBeNull();
  });

  it('a 401 on a legacy fallback screen raises the same dialog, not a false "signed out"', async () => {
    renderApp('/issuing-bodies', 'ADMIN');
    // What `src/lib/api.ts` does on a 401.
    act(() => setToken(null));
    await screen.findByRole('dialog', { name: 'Your session ended' });
    expect(screen.queryByRole('heading', { name: 'Sign-in screen' })).toBeNull();
    expect(screen.getByText(/Issuing bodies comes with WP-4/)).toBeTruthy();
    expect(wasSignedOutOnPurpose()).toBe(false);
  });

  it('a 401 on login is an answer about credentials: the live session is untouched', async () => {
    api.set({ login: { status: 401, body: envelope('INVALID_CREDENTIALS') } });
    renderApp('/account', 'ADMIN');
    await act(async () => {
      await redesignApi.POST('/v1/auth/login', {
        params: { header: { 'X-HG-Client': 'admin-web' } },
        body: { email: 'x@halalgoes.ca', password: 'wrong' },
      });
    });
    expect(getSession().ended).toBeNull();
    expect(getToken()).toBe('test-access-token');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('signs in again for real: login goes out with no bearer, as the server requires', async () => {
    const admin = principalFor('ADMIN');
    api.set({ login: strictLogin(grantFor(admin)), createRealtimeTicket: { status: 401, body: envelope('SESSION_EXPIRED') } });
    renderApp('/issuing-bodies', 'ADMIN');
    saveDraft('decision-note', 'Certificate number matches the register.');
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    api.set({ createRealtimeTicket: undefined });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'aminah@halalgoes.ca' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'correct horse battery' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.callsTo('login')[0]!.headers.authorization).toBeUndefined();
    expect(getToken()).toBe('fresh-token');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Issuing bodies');
    // The same person is back: their unsent input is still there to restore.
    expect(loadDraft('decision-note')).toBe('Certificate number matches the register.');
  });

  it('checks the form before sending: empty fields are marked and nothing goes out', async () => {
    renderApp('/account', 'ADMIN');
    act(() => markSessionEnded('expired'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Enter your work email.')).toBeTruthy();
    expect(within(dialog).getByText('Enter your password.')).toBeTruthy();
    const email = within(dialog).getByLabelText(/Work email/, { selector: 'input' });
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(api.callsTo('login')).toHaveLength(0);
    expect(within(dialog).queryByText('Sign-in didn’t finish')).toBeNull();
  });

  it('an incomplete code is caught in the dialog, not sent', async () => {
    api.set({ login: { status: 403, body: envelope('MFA_REQUIRED') } });
    renderApp('/account', 'ADMIN');
    act(() => markSessionEnded('expired'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'aminah@halalgoes.ca' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'correct horse battery' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const code = await within(dialog).findByLabelText(/Authentication code/);
    fireEvent.change(code, { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(api.callsTo('login')).toHaveLength(1);
    expect(code.getAttribute('aria-invalid')).toBe('true');
  });

  it('a different account signing in goes to its own landing page and keeps nothing of the previous person', async () => {
    const support = principalFor('SUPPORT_AGENT');
    api.set({ login: strictLogin(grantFor(support)) });
    renderApp('/issuing-bodies', 'ADMIN');
    saveDraft('refund-note', 'Customer at 12 Elm St said the order was cold');
    applyQueueDepthFrame({ pending_restaurant_reviews: 4, pending_rider_reviews: 2, failed_refunds: 1, open_disputes: 0 }, null, 'ADMIN');
    act(() => markSessionEnded('expired'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'sam@halalgoes.ca' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'another password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Live alerts'));
    expect(getQueueDepth().counts).toBeNull();
    expect(loadDraft('refund-note')).toBeNull();
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('hg-admin-draft:'))).toEqual([]);
  });

  it('right credentials but no staff role: refused in the dialog, and that grant is revoked with its own bearer', async () => {
    const customer = { ...principalFor('ADMIN'), roles: [{ role: 'CUSTOMER' as const, scope_type: 'GLOBAL' as const, scope_id: null }] };
    api.set({ login: strictLogin(grantFor(customer, 'customer-token')) });
    renderApp('/account', 'ADMIN');
    act(() => markSessionEnded('expired'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'c@example.com' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'their password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('This account can’t use the admin console');
    await waitFor(() => expect(api.callsTo('logout')).toHaveLength(1));
    expect(api.callsTo('logout')[0]!.headers.authorization).toBe('Bearer customer-token');
    expect(getSession().ended).toBe('expired');
  });

  it('Sign out from the dialog is a deliberate sign-out', async () => {
    renderApp('/account', 'ADMIN');
    act(() => markSessionEnded('expired'));
    const dialog = await screen.findByRole('dialog', { name: 'Your session ended' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in again' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign-in screen' });
    expect(wasSignedOutOnPurpose()).toBe(true);
    expect(getSession().principal).toBeNull();
  });
});

describe('drafts', () => {
  it('belong to the account that typed them', () => {
    renderApp('/account', 'ADMIN');
    saveDraft('invite', { email: 'new.person@halalgoes.ca' });
    expect(loadDraft('invite')).toEqual({ email: 'new.person@halalgoes.ca' });
    cleanup();
    resetSession();
    renderApp('/account', 'SUPER_ADMIN');
    expect(loadDraft('invite')).toBeNull();
  });
});

describe('theme', () => {
  it('mounting the redesign pins the light theme on <html>, where the dark role map is keyed', async () => {
    document.documentElement.removeAttribute('data-theme');
    const { mountRedesign } = await import('../../main');
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountRedesign(container);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    document.documentElement.removeAttribute('data-theme');
    container.remove();
  });
});
