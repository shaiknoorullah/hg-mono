import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import type { RetryInfo } from '@hg/ui-web/live';

import { alertBanner } from '../banner';
import AlertsRoute from '../AlertsRoute';
import { applyAlertEvent, applyReplay, dismissAlertBanner, getAlerts, resetAlerts, setAlertsConnection, setAlertsFailure } from '../store';
import { mockApi, principalFor, renderRedesign, resetSession } from '../../testing';
import { highAlert, opsEvents } from './support';

// The connection's retry state and "reconnect now" are the provider's; these tests set them directly.
const controls = vi.hoisted(() => ({
  retry: { attempt: 0, nextAt: null, cause: null } as RetryInfo,
  reconnectNow: vi.fn(),
}));
vi.mock('@hg/ui-web/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hg/ui-web/live')>()),
  useRealtimeControls: () => ({ retry: () => controls.retry, reconnectNow: controls.reconnectNow }),
}));

// The suites run beside other packages' tests before a push; a cold first render can be slow.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  resetAlerts();
  controls.retry = { attempt: 0, nextAt: null, cause: null };
  controls.reconnectNow.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  resetSession();
  resetAlerts();
});

const renderAlerts = (route = '/alerts', role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') =>
  renderRedesign(<Route path="/alerts/:seq?" element={<AlertsRoute />} />, { route, principal: role });

function feed(replay = true) {
  act(() => {
    setAlertsConnection('open');
    for (const e of opsEvents()) applyAlertEvent(e);
    if (replay) applyReplay({ fromSeq: 1, truncated: false });
  });
}

describe('Live alerts: states', () => {
  it('is loading while connecting and while the replay runs, never empty', () => {
    renderAlerts();
    expect(screen.getByText('Opening the live connection.')).toBeTruthy();
    expect(screen.queryByText('No recent alerts')).toBeNull();
    act(() => setAlertsConnection('open'));
    expect(screen.getByText('Connected. Loading recent alerts.')).toBeTruthy();
  });

  it('is empty only after the replay finished with nothing', () => {
    renderAlerts();
    act(() => {
      setAlertsConnection('open');
      applyReplay({ fromSeq: 1, truncated: false });
    });
    expect(screen.getByText('No recent alerts')).toBeTruthy();
  });

  it('lists the replayed alerts newest first, each kind, and says "last 7 days" only for a whole replay', () => {
    renderAlerts();
    feed();
    const rows = within(screen.getByRole('grid')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByText('Reconciliation exception')).toBeTruthy();
    expect(screen.getByText("That's everything from the last 7 days.")).toBeTruthy();
  });

  it('says only "recent" when the replay did not start at the first event, and says older alerts are missing when cut', () => {
    renderAlerts();
    act(() => {
      setAlertsConnection('open');
      for (const e of opsEvents()) applyAlertEvent(e);
      applyReplay({ fromSeq: 501, truncated: true });
    });
    expect(screen.getByText("That's everything the live connection could replay.")).toBeTruthy();
    expect(screen.getByText("Older alerts from the last 7 days couldn't be replayed.")).toBeTruthy();
    expect(screen.queryByText(/last 7 days\.$/)).toBeNull();
  });

  it('says a filter matched nothing and offers all kinds, counting what else arrived', () => {
    renderAlerts('/alerts?kind=dispatch');
    act(() => {
      setAlertsConnection('open');
      applyAlertEvent(highAlert(1));
      applyReplay({ fromSeq: 1, truncated: false });
    });
    expect(screen.getByText('No recent dispatch failures')).toBeTruthy();
    expect(screen.getByText('1 alert of other kinds arrived. Show all kinds to see them.')).toBeTruthy();
  });

  it('after the connection is refused for good, says so and offers another try, not an empty list', () => {
    renderAlerts();
    act(() => setAlertsConnection('offline'));
    expect(screen.getByText("Live alerts can't connect")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
    expect(screen.queryByText('No recent alerts')).toBeNull();
  });

  it('after a reconnect that missed events, says some alerts from the gap are gone', () => {
    renderAlerts();
    feed();
    act(() => {
      setAlertsConnection('reconnecting');
      setAlertsConnection('open');
      applyReplay({ fromSeq: 200, truncated: true });
    });
    expect(getAlerts().gap).not.toBeNull();
    expect(screen.getAllByText(/couldn't be replayed/).length).toBeGreaterThan(0);
  });
});

describe('Live alerts: rows stay still under a hand', () => {
  it('holds new alerts while the pointer is in the list, and shows them only on request', () => {
    renderAlerts();
    feed();
    const list = screen.getByTestId('alerts-list');
    fireEvent.pointerEnter(list);
    act(() => applyAlertEvent(highAlert(7)));
    act(() => applyAlertEvent(highAlert(8)));
    expect(within(screen.getByRole('grid')).getAllByRole('row').slice(1)).toHaveLength(4);
    expect(screen.getByText(/2 new alerts\. They're held while your pointer or focus is in the list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 new alerts' }));
    expect(within(screen.getByRole('grid')).getAllByRole('row').slice(1)).toHaveLength(6);
    expect(screen.getByText('2 new alerts shown at the top.')).toBeTruthy();
  });
});

describe('Live alerts: who sees what', () => {
  it('shows a support agent no rider queue, and the review queues as view only', () => {
    renderAlerts('/alerts', 'SUPPORT_AGENT');
    feed();
    expect(screen.queryByRole('button', { name: /Rider applications/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Restaurant applications · view only/ })).toBeTruthy();
  });

  it('opens an alert beside the list with its words and the owner-approved steps, and no acknowledge action', () => {
    renderAlerts('/alerts/5');
    feed();
    const panel = screen.getByRole('region', { name: 'Reconciliation exception' });
    expect(within(panel).getByText(/Open the order and check its payment history/)).toBeTruthy();
    expect(within(panel).getByText('Expected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /acknowledge|assign/i })).toBeNull();
  });

  it('says plainly when the alert in the address is not in the list', () => {
    renderAlerts('/alerts/999');
    feed();
    expect(screen.getByText('This alert isn’t in the list')).toBeTruthy();
  });
});

describe('the high-severity banner', () => {
  it('shows the newest live alert once, counts several, gives a support agent the customer impact first, and dismisses all', () => {
    act(() => {
      applyAlertEvent(highAlert(1));
      applyReplay({ fromSeq: 1, truncated: false });
    });
    expect(alertBanner(getAlerts(), 'ADMIN')).toBeNull();
    act(() => applyAlertEvent(highAlert(2)));
    const one = alertBanner(getAlerts(), 'ADMIN')!;
    expect(one.title).toMatch(/^High-severity alert, /);
    expect(one.action?.to).toBe('/alerts/2');
    const support = alertBanner(getAlerts(), 'SUPPORT_AGENT')!;
    expect(support.title).toMatch(/^Payment problem, /);
    expect(support.description).toMatch(/don't promise a refund until the order updates\. Alert: Stripe webhook/);
    act(() => applyAlertEvent(highAlert(3)));
    expect(alertBanner(getAlerts(), 'ADMIN')!.title).toMatch(/^2 high-severity alerts, latest /);
    act(() => alertBanner(getAlerts(), 'ADMIN')!.onDismiss!());
    expect(alertBanner(getAlerts(), 'ADMIN')).toBeNull();
    act(() => dismissAlertBanner(99));
    act(() => applyAlertEvent(highAlert(4)));
    expect(alertBanner(getAlerts(), 'ADMIN')?.action?.to).toBe('/alerts/4');
  });
});

describe('Live alerts: why alerts are not arriving, one screen for each cause that needs one', () => {
  it('a ticket that could not be minted says live alerts did not start, and Try again asks for a new connection', () => {
    renderAlerts();
    controls.retry = { attempt: 5, nextAt: null, cause: 'ticket' };
    act(() => setAlertsConnection('reconnecting'));
    expect(screen.getByRole('heading', { name: 'Live alerts didn’t start' })).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    // The generic "refused 5 times" panel is for a socket that was refused, which this was not.
    expect(screen.queryByText("Live alerts can't connect")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(controls.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('a ticket that fails fewer than five times is still just reconnecting', () => {
    renderAlerts();
    controls.retry = { attempt: 2, nextAt: Date.now() + 4000, cause: 'ticket' };
    act(() => setAlertsConnection('reconnecting'));
    expect(screen.queryByRole('heading', { name: 'Live alerts didn’t start' })).toBeNull();
  });

  it('a subscribe refused as forbidden says the account cannot have alerts, and offers no retry that cannot work', () => {
    renderAlerts();
    act(() => {
      setAlertsConnection('open');
      setAlertsFailure({ kind: 'forbidden' });
    });
    expect(screen.getByRole('heading', { name: 'This account can’t receive live alerts' })).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again|Reload the page/ })).toBeNull();
    expect(screen.queryByText('No recent alerts')).toBeNull();
  });

  // The close codes contracts/websocket.md marks do not retry. The connection is 'offline' here
  // because it has stopped for good, and that is the same state the page reads to say "refused five
  // times, Try again" — so this pins that the reason wins over the count
  // (https://github.com/shaiknoorullah/hg-mono/issues/1010).
  for (const code of [4400, 4403]) {
    it(`a ${code} close offers no retry and shows the code for the platform team`, () => {
      renderAlerts();
      act(() => {
        setAlertsConnection('offline');
        setAlertsFailure({ kind: 'fatal', code, at: new Date('2026-08-10T19:05:00Z') });
      });
      expect(screen.getByRole('heading', { name: 'The server refused live alerts' })).toBeTruthy();
      expect(screen.getByText('Not connected')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Try again|Reload the page/ })).toBeNull();
      // Not the "refused 5 times in a row" screen, which would be untrue here and offers a retry.
      expect(screen.queryByRole('heading', { name: "Live alerts can't connect" })).toBeNull();
      expect(screen.queryByText('Reconnecting')).toBeNull();
      expect(controls.reconnectNow).not.toHaveBeenCalled();
    });
  }

  it('a subscribe refused as invalid_channel is a fault on our side: the only action is to reload the page', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    try {
      renderAlerts();
      act(() => {
        setAlertsConnection('open');
        setAlertsFailure({ kind: 'invalid-channel' });
      });
      expect(screen.getByRole('heading', { name: 'Live alerts couldn’t start' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Reload the page' }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(controls.reconnectNow).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a refusal ends when a replay shows the subscribe worked', () => {
    renderAlerts();
    act(() => {
      setAlertsConnection('open');
      setAlertsFailure({ kind: 'forbidden' });
    });
    act(() => applyReplay({ fromSeq: 1, truncated: false }));
    expect(getAlerts().failure).toBeNull();
    expect(screen.queryByRole('heading', { name: 'This account can’t receive live alerts' })).toBeNull();
  });

  it('a session that ended asks to sign in again, not to retry, and keeps the alerts already here underneath', () => {
    renderAlerts();
    feed();
    act(() => {
      setAlertsConnection('offline');
      setAlertsFailure({ kind: 'reauth', at: new Date('2026-08-10T19:05:00Z') });
    });
    expect(screen.getByRole('dialog', { name: 'Sign in again to keep receiving alerts' })).toBeTruthy();
    expect(screen.getByText('Signed out')).toBeTruthy();
    expect(screen.queryByText("Live alerts can't connect")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in and resume alerts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    // The list is still there.
    expect(within(screen.getByRole('grid')).getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('signing in again restarts the connection with a fresh ticket, and the dialog goes away', async () => {
    const api = mockApi();
    api.set({
      login: { status: 200, body: { data: { access_token: 'fresh-token', refresh_token: null, expires_in: 900, is_new_account: false, principal: principalFor('ADMIN') } } },
    });
    renderAlerts();
    feed();
    act(() => {
      setAlertsConnection('offline');
      setAlertsFailure({ kind: 'reauth', at: new Date('2026-08-10T19:05:00Z') });
    });
    const dialog = screen.getByRole('dialog', { name: 'Sign in again to keep receiving alerts' });
    fireEvent.change(within(dialog).getByLabelText(/Work email/), { target: { value: 'aminah@halalgoes.ca' } });
    fireEvent.change(within(dialog).getByLabelText(/Password/), { target: { value: 'correct horse battery' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in and resume alerts' }));
    await waitFor(() => expect(controls.reconnectNow).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getAlerts().failure).toBeNull();
  });
});
