import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { alertBanner } from '../banner';
import AlertsRoute from '../AlertsRoute';
import { applyAlertEvent, applyReplay, dismissAlertBanner, getAlerts, resetAlerts, setAlertsConnection } from '../store';
import { renderRedesign, resetSession } from '../../testing';
import { highAlert, opsEvents } from './support';

// The suites run beside other packages' tests before a push; a cold first render can be slow.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => resetAlerts());
afterEach(() => {
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
    expect(screen.getByText('That’s everything from the last 7 days.')).toBeTruthy();
  });

  it('says only "recent" when the replay did not start at the first event, and says older alerts are missing when cut', () => {
    renderAlerts();
    act(() => {
      setAlertsConnection('open');
      for (const e of opsEvents()) applyAlertEvent(e);
      applyReplay({ fromSeq: 501, truncated: true });
    });
    expect(screen.getByText('That’s everything the live connection could replay.')).toBeTruthy();
    expect(screen.getByText('Older alerts from the last 7 days couldn’t be replayed.')).toBeTruthy();
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
    expect(screen.getByText('Live alerts can’t connect')).toBeTruthy();
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
    expect(screen.getAllByText(/couldn’t be replayed/).length).toBeGreaterThan(0);
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
    expect(screen.getByText(/2 new alerts\. They’re held while your pointer or focus is in the list/)).toBeTruthy();
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
    expect(support.description).toMatch(/don’t promise a refund until the order updates\. Alert: Stripe webhook/);
    act(() => applyAlertEvent(highAlert(3)));
    expect(alertBanner(getAlerts(), 'ADMIN')!.title).toMatch(/^2 high-severity alerts, latest /);
    act(() => alertBanner(getAlerts(), 'ADMIN')!.onDismiss!());
    expect(alertBanner(getAlerts(), 'ADMIN')).toBeNull();
    act(() => dismissAlertBanner(99));
    act(() => applyAlertEvent(highAlert(4)));
    expect(alertBanner(getAlerts(), 'ADMIN')?.action?.to).toBe('/alerts/4');
  });
});
