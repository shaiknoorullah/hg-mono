/**
 * WP4 — the status bar's pure rules: the open-state map over all 7 `RestaurantOpenState`
 * values (manifest WP4 DONE), the halal console view (invariants 8–10), and the connection
 * state that drives the health badge and banners.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../test/fakeApi';
import { OPEN_STATE_PRECEDENCE, openStateView, type Availability } from './openState';
import { halalConsoleView } from './halal';
import { SERVER_OFFLINE_AFTER_MS, connectionView, pastServerCutoff } from '../data/connection';

describe('open state: one pure function, every value', () => {
  const REASON = 'Reason sent by the server.';
  // [open_state fixture, badge, variant, switch disabled, pause control]
  const table: [string, string, string, boolean, string][] = [
    ['open', 'Open', 'info', false, 'menu'],
    ['paused', 'Paused', 'warning', false, 'resume'],
    ['closed_toggle', 'Closed', 'neutral', false, 'menu-disabled'],
    ['closed_hours', 'Closed', 'neutral', false, 'menu'],
    ['closed_holiday', 'Closed', 'neutral', false, 'menu'],
    // Pause is "—" while offline: it would send is_accepting_orders: true behind the user's back.
    ['closed_offline', 'Unknown · this screen offline', 'neutral', false, 'menu-disabled'],
    ['closed_suspended', 'Closed', 'neutral', true, 'menu-disabled'],
  ];

  it('covers exactly the contract’s seven states, in server precedence', () => {
    expect(new Set(OPEN_STATE_PRECEDENCE)).toEqual(new Set(table.map(([f]) => f.toUpperCase())));
    expect(OPEN_STATE_PRECEDENCE[0]).toBe('CLOSED_SUSPENDED');
    expect(OPEN_STATE_PRECEDENCE[OPEN_STATE_PRECEDENCE.length - 1]).toBe('OPEN');
  });

  it.each(table)('%s', (name, badge, variant, disabled, pause) => {
    const a: Availability = { ...fixture(`restaurant_open_state_${name}`), reason: REASON, missed_order_count: 0 };
    const v = openStateView(a, { status: 'ready' });
    expect(v.state).toBe(a.open_state);
    expect(v.badge.label).toBe(badge);
    expect(v.badge.variant).toBe(variant);
    expect(v.orders.disabled).toBe(disabled);
    expect(v.pause).toBe(pause);
    // The switch shows the stored toggle, as the server read it back.
    expect(v.orders.checked).toBe(a.is_accepting_orders);
    // The reason is the server's, verbatim (offline is the shell's own copy).
    expect(v.reason).toBe(name === 'closed_offline' ? 'Can’t check while offline.' : REASON);
  });

  it('closed by hours or a date override says the switch is on but closed', () => {
    const hours = openStateView({ ...fixture('restaurant_open_state_closed_hours'), is_accepting_orders: true }, { status: 'ready' });
    expect(hours.orders.help).toBe('On, but closed by your hours');
    const holiday = openStateView({ ...fixture('restaurant_open_state_closed_holiday'), is_accepting_orders: true }, { status: 'ready' });
    expect(holiday.orders.help).toBe('On, but closed today by your date override');
  });

  it('auto-off after two orders timed out, and a halal suspension explains the switch', () => {
    expect(openStateView({ ...fixture('restaurant_open_state_closed_toggle'), missed_order_count: 2 }, { status: 'ready' }).autoOff).toBe(true);
    expect(openStateView({ ...fixture('restaurant_open_state_closed_toggle'), missed_order_count: 1 }, { status: 'ready' }).autoOff).toBe(false);
    const halal = openStateView(fixture('restaurant_open_state_closed_suspended'), { status: 'ready', halalBlocked: true });
    expect(halal.orders.help).toBe('Customers can’t order until your certificate is approved');
  });

  it('never shows an unknown state as if known', () => {
    const loading = openStateView(null, { status: 'loading' });
    expect(loading.badge.label).toBe('Checking…');
    expect(loading.orders).toMatchObject({ disabled: true, help: 'Available once orders load', stateLabel: { on: 'Checking…', off: 'Checking…' } });
    const failed = openStateView(null, { status: 'error' });
    expect(failed.badge.label).toBe('Unknown');
    expect(failed.pause).toBe('menu-disabled');
    const odd = openStateView({ ...fixture('restaurant_open_state_open'), open_state: 'SOMETHING_NEW' as never }, { status: 'ready' });
    expect(odd.badge.label).toBe('Unknown');
    expect(odd.orders.disabled).toBe(true);
  });
});

describe('halal on the console', () => {
  it('certified: badge, no banner', () => {
    expect(halalConsoleView(fixture('halal_badge_certified'), null)).toMatchObject({ badge: 'CERTIFIED', banner: null, missing: false });
  });

  it('expiring: badge plus the expiring-tone banner with the long date', () => {
    const v = halalConsoleView({ display_state: 'EXPIRING_SOON', certifying_body_name: 'HMA', expires_on: '2026-10-14' }, null);
    expect(v.badge).toBe('EXPIRING_SOON');
    expect(v.banner).toMatchObject({ tone: 'expiring', role: 'status', title: 'Your halal certificate expires on 14 October 2026', action: { label: 'Upload renewal' } });
  });

  it('expired: slate, never danger', () => {
    const v = halalConsoleView({ display_state: 'EXPIRED', certifying_body_name: 'HMA', expires_on: '2026-09-20' }, null);
    expect(v.badge).toBe('EXPIRED');
    expect(v.banner?.tone).toBe('expired');
    expect(v.banner?.title).toBe('We can’t currently vouch for your halal certificate');
    expect(v.banner?.body).toContain('It expired on 20 September 2026');
  });

  it('unverified (being checked) and rejected: no HalalBadge at all', () => {
    const checking = halalConsoleView(fixture('halal_badge_unverified'), fixture('document_in_review'));
    expect(checking.badge).toBeNull();
    expect(checking.banner).toMatchObject({ tone: 'unverified', role: 'status', title: 'We’re checking your certificate', action: null });

    const rejected = { ...fixture('document_rejected'), doc_type: 'HALAL_CERTIFICATE', state: 'REJECTED', review_note: 'the certificate number doesn’t match the certifying body’s register' };
    const v = halalConsoleView(fixture('halal_badge_unverified'), rejected);
    expect(v.badge).toBeNull();
    expect(v.banner).toMatchObject({ tone: 'unverified', role: 'alert', title: 'Your certificate wasn’t accepted', action: { label: 'Upload a new certificate' } });
    expect(v.banner?.body).toBe(
      'Reason from HalalGoes: the certificate number doesn’t match the certifying body’s register. Customers can’t find you until a valid certificate is approved. Orders already in progress can be finished.',
    );
  });

  it('missing: nothing at all, and flagged for the report', () => {
    expect(halalConsoleView(undefined, null)).toEqual({ badge: null, banner: null, missing: true, blocksOrdering: false });
    expect(halalConsoleView({ display_state: 'NOT_A_STATE' as never }, null).missing).toBe(true);
  });

  it('no halal state is ever drawn in a danger tone', () => {
    for (const s of ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const) {
      const tone = halalConsoleView({ display_state: s }, null).banner?.tone;
      expect(tone ?? 'none').not.toBe('danger');
    }
  });
});

describe('connection state', () => {
  const ok = { lastOkAt: 1_000, failingSince: null, failures: 0 };
  it('live, connecting, reconnecting, offline', () => {
    expect(connectionView({ realtime: 'open', everOpen: true, droppedAt: null, heartbeat: ok, browserOnline: true }).kind).toBe('live');
    expect(connectionView({ realtime: 'connecting', everOpen: false, droppedAt: null, heartbeat: ok, browserOnline: true }).kind).toBe('connecting');
    expect(connectionView({ realtime: 'reconnecting', everOpen: true, droppedAt: 5_000, heartbeat: ok, browserOnline: true })).toEqual({ kind: 'reconnecting', since: 5_000 });
    // Heartbeats failing beats a socket that looks fine: REST is the truth.
    // One failed beat is a blip, not offline.
    expect(connectionView({ realtime: 'open', everOpen: true, droppedAt: null, heartbeat: { lastOkAt: 1_000, failingSince: 9_000, failures: 1 }, browserOnline: true }).kind).toBe('live');
    expect(connectionView({ realtime: 'open', everOpen: true, droppedAt: null, heartbeat: { lastOkAt: 1_000, failingSince: 9_000, failures: 2 }, browserOnline: true })).toEqual({
      kind: 'offline',
      since: 1_000,
    });
    expect(connectionView({ realtime: 'open', everOpen: true, droppedAt: null, heartbeat: ok, browserOnline: false }).kind).toBe('offline');
  });

  it('orders have stopped only 5 minutes after the last check-in, or when the server says CLOSED_OFFLINE', () => {
    const offline = { kind: 'offline' as const, since: 1_000 };
    expect(pastServerCutoff(offline, 1_000 + SERVER_OFFLINE_AFTER_MS - 1)).toBe(false);
    expect(pastServerCutoff(offline, 1_000 + SERVER_OFFLINE_AFTER_MS)).toBe(true);
    expect(pastServerCutoff(offline, 2_000, true)).toBe(true);
    expect(pastServerCutoff({ kind: 'offline', since: null }, 10 * SERVER_OFFLINE_AFTER_MS)).toBe(false);
    expect(pastServerCutoff({ kind: 'live', since: null }, 10 * SERVER_OFFLINE_AFTER_MS, true)).toBe(false);
  });
});
