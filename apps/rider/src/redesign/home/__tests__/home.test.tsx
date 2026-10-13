/**
 * WP2 Home (R15) and the resume strip (R16), against the contract's fixtures, light and dark.
 *
 * Pins the WP2 DONE list: every RiderAvailabilityState × TrackingHealth state renders; the mode
 * never flips before the availability PUT answers; each of the nine blocking reasons renders its
 * copy and fix; positions are reported while online and paused offline; no request carries a
 * price.
 */
import * as React from 'react';
import { Linking, Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

jest.mock('../../../location', () => {
  const actual = jest.requireActual('../../../location');
  return { ...actual, getFreshFix: jest.fn(), useLocationReporting: jest.fn() };
});

jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => undefined), unregisterForPush: jest.fn() }));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
}));

import * as Notifications from 'expo-notifications';
import { getFreshFix, useLocationReporting, type LocationOutcome } from '../../../location';
import { registerForPush } from '../../../push';
import { resetConnectivity } from '../../data/connectivity';
import { formatTime } from '../../format/time';
import { Navigator, useNav } from '../../nav/Navigator';
import { mockApi, payload, type MockApi } from '../../test/mockApi';
import { renderRedesign, SCHEMES } from '../../test/render';
import { BLOCKING_REASON_COPY, WAITING_BODY } from '../copy';
import { DashboardPoller, getHomeState, resetHomeState } from '../dashboard';
import { HomeScreen } from '../HomeScreen';
import { ResumeStrip } from '../ResumeStrip';
import { ThemeProvider } from '../../ds';
import { render } from '@testing-library/react-native';

const mockedFix = getFreshFix as jest.MockedFunction<typeof getFreshFix>;
const mockedReporting = useLocationReporting as jest.MockedFunction<typeof useLocationReporting>;
const mockedNotifications = Notifications.getPermissionsAsync as jest.Mock;

const FIX: LocationOutcome = {
  ok: true,
  fix: { latitude: 43.6532, longitude: -79.3832, accuracy_m: 8, recorded_at: '2026-10-09T21:42:00.000Z' },
};

/** A dashboard derived from the real `rider_dashboard_active` fixture: no delivery, no offer. */
function dashboard(over: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: { data: { ...payload('rider_dashboard_active'), active_assignment: null, current_offer: null, ...over } },
  };
}

/** An error envelope derived from the real `error_forbidden` fixture. */
function apiError(status: number, code: string, details?: unknown) {
  const p = payload('error_forbidden');
  p.error.code = code;
  p.error.message = code;
  if (details !== undefined) p.error.details = details;
  return { status, body: p };
}

const ALL_REASONS = Object.keys(BLOCKING_REASON_COPY);
const PRICE_KEYS = /price|_cents|total|amount/i;

function FlowProbe() {
  const nav = useNav();
  const f = nav.flow?.[0];
  return <Text testID="probe">{`tab=${nav.tab} flow=${f ? `${f.name}:${JSON.stringify(f.params)}` : 'none'}`}</Text>;
}

let api: MockApi;
let openSettings: jest.SpyInstance;
let openURL: jest.SpyInstance;

beforeEach(() => {
  mockedFix.mockReset().mockResolvedValue(FIX);
  mockedReporting.mockReset();
  mockedNotifications.mockReset().mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  api?.restore();
  openSettings.mockRestore();
  openURL.mockRestore();
  resetHomeState();
  resetConnectivity();
});

function renderHome(scheme: (typeof SCHEMES)[number], choices: Parameters<typeof mockApi>[0]) {
  api = mockApi({ getConnectStatus: 'connect_status_complete', ...choices });
  return renderRedesign(
    <>
      <DashboardPoller />
      <HomeScreen />
      <FlowProbe />
    </>,
    { scheme, nav: true },
  );
}

/** Every availability PUT body: never a price, only the contract's input fields. */
function expectNoPriceSent() {
  for (const c of api.calls) {
    if (c.body && typeof c.body === 'object') {
      for (const k of Object.keys(c.body as object)) expect(k).not.toMatch(PRICE_KEYS);
    }
  }
}

describe.each(SCHEMES)('Home (%s)', (scheme) => {
  it('loading: the Home bar and a skeleton the shape of the screen', () => {
    renderHome(scheme, { getRiderDashboard: 'pending' });
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByTestId('home-loading')).toBeTruthy();
  });

  it('error: "We couldn\'t load Home"; Try again re-reads it; Go offline works without the dashboard', async () => {
    renderHome(scheme, { getRiderDashboard: 'error_internal_error', setRiderAvailability: 'rider_availability_offline' });
    await screen.findByText("We couldn't load Home");
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(api.callsTo('getRiderDashboard')).toHaveLength(2));
    fireEvent.press(screen.getByText('Go offline'));
    await waitFor(() => expect(api.callsTo('setRiderAvailability')).toHaveLength(1));
    expect(api.callsTo('setRiderAvailability')[0]!.body).toEqual({ is_online: false });
  });

  it('offline: today from the server through Price, Go online, no location reporting', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE' }) });
    await screen.findByText("You're offline");
    expect(screen.getByText("You won't get offers")).toBeTruthy();
    expect(screen.getByText(/11\.49/)).toBeTruthy(); // today.gross_cents 1149
    expect(screen.getByText('6 trips')).toBeTruthy();
    expect(screen.getByText('0 min online')).toBeTruthy();
    expect(screen.getByText('Go online')).toBeTruthy();
    expect(mockedReporting).toHaveBeenLastCalledWith(false, null, expect.any(Function));
    expect(registerForPush).toHaveBeenCalled();
  });

  it('going online: the mode never flips before the PUT answers', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE' }), setRiderAvailability: 'pending' });
    await screen.findByText('Go online');
    fireEvent.press(screen.getByText('Go online'));
    await screen.findByText('Checking you can go online');
    expect(screen.getByText('Going online…')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Waiting for offers')).toBeNull();
    await waitFor(() => expect(api.callsTo('setRiderAvailability')).toHaveLength(1));
    expect(api.callsTo('setRiderAvailability')[0]!.body).toEqual({
      is_online: true,
      latitude: 43.6532,
      longitude: -79.3832,
      accuracy_m: 8,
    });
    expectNoPriceSent();
  });

  it('online once the PUT answers: waiting for offers, positions reported', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'OFFLINE' }) : dashboard({ mode: 'ONLINE_IDLE' })),
      setRiderAvailability: 'rider_availability_online_idle',
    });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText(WAITING_BODY, {}, { timeout: 3000 });
    expect(screen.getAllByText('Waiting for offers').length).toBeGreaterThan(0);
    expect(screen.getByText(WAITING_BODY)).toBeTruthy();
    expect(screen.getByText('Go offline')).toBeTruthy();
    expect(mockedReporting).toHaveBeenLastCalledWith(true, null, expect.any(Function));
  });

  it('422 CANNOT_GO_ONLINE: one row per code, with its copy and fix, for all nine', async () => {
    renderHome(scheme, {
      getRiderDashboard: dashboard({ mode: 'OFFLINE' }),
      setRiderAvailability: apiError(422, 'CANNOT_GO_ONLINE', { blocking_reasons: ALL_REASONS }),
    });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText('Fix 9 things to go online');
    expect(screen.getByText("You can't go online yet")).toBeTruthy();
    for (const copy of Object.values(BLOCKING_REASON_COPY)) {
      expect(screen.getByText(copy.title)).toBeTruthy();
      expect(screen.getByText(copy.body)).toBeTruthy();
      if (copy.fix) expect(screen.getAllByText(copy.fix).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Go online')).toBeNull(); // returns only when no reason is left
    fireEvent.press(screen.getByText('Allow location'));
    expect(openSettings).toHaveBeenCalled();
    fireEvent.press(screen.getByText('See account status'));
    expect(screen.getByTestId('probe').props.children).toMatch(/^tab=account/);
  });

  it('Check again sends Go online again; Finish payout setup opens a fresh Stripe link', async () => {
    renderHome(scheme, {
      getRiderDashboard: dashboard({ mode: 'OFFLINE' }),
      setRiderAvailability: apiError(422, 'CANNOT_GO_ONLINE', { blocking_reasons: ['PAYOUT_ACCOUNT_INCOMPLETE', 'BACKGROUND_LOCATION_PERMISSION', 'DOCUMENT_EXPIRED'] }),
      createConnectOnboardingLink: { status: 201, body: { data: { url: 'https://connect.stripe.com/setup/s/abc', expires_at: '2026-10-09T22:00:00Z' } } },
    });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText('Fix 3 things to go online');
    fireEvent.press(screen.getByText('Finish payout setup'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://connect.stripe.com/setup/s/abc'));
    fireEvent.press(screen.getByText('Check again'));
    await waitFor(() => expect(api.callsTo('setRiderAvailability')).toHaveLength(2));
  });

  it('403 ONBOARDING_INCOMPLETE uses the same rows', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE' }), setRiderAvailability: apiError(403, 'ONBOARDING_INCOMPLETE') });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText('Fix 1 thing to go online');
    expect(screen.getByText('Finish getting set up')).toBeTruthy();
  });

  it('location refused by the phone: the row, and no request that could only fail', async () => {
    mockedFix.mockResolvedValue({ ok: false, reason: 'PERMISSION_DENIED', message: 'denied' });
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE' }) });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText('Location is off for HalalGoes');
    expect(api.callsTo('setRiderAvailability')).toHaveLength(0);
  });

  it.each([
    ['no connection', 'offline'],
    ['a 5xx', 'error_internal_error'],
  ])('going online fails on %s: still offline, drawn apart from a blocking reason', async (_label, choice) => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE' }), setRiderAvailability: choice });
    fireEvent.press(await screen.findByText('Go online'));
    await screen.findByText("We couldn't put you online");
    expect(screen.getByText('Try going online again')).toBeTruthy();
    expect(screen.queryByText(/things? to go online/)).toBeNull();
  });

  it('first shift: no deliveries yet, never $0.00', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE', today: { gross_cents: 0, currency: 'CAD', trips: 0, online_seconds: 19 } }) });
    await screen.findByText('No deliveries yet today');
    expect(screen.getByText('Your earnings and trips show here after your first delivery.')).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('ONLINE_STALE: online, but offers are paused, with the location fix', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_STALE' }) });
    await screen.findByText("You're online, but offers are paused");
    expect(screen.getByText('Not getting offers')).toBeTruthy();
    expect(screen.getByText("Your location isn't reaching us, so you won't get offers")).toBeTruthy();
    fireEvent.press(screen.getByText('Open location settings'));
    expect(openSettings).toHaveBeenCalled();
    expect(mockedReporting).toHaveBeenLastCalledWith(true, null, expect.any(Function));
  });

  it('tracking DEGRADED: still waiting, with the weak-signal alert', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE', tracking_health: 'DEGRADED' }) });
    await screen.findByText('Weak location signal');
    expect(screen.getByText('Turn on precise location')).toBeTruthy();
    expect(screen.getAllByText('Waiting for offers').length).toBeGreaterThan(0);
  });

  it('tracking LOST: offers paused until we see the location again', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE', tracking_health: 'LOST' }) });
    await screen.findByText("We've lost your location");
    expect(screen.getByText('They start again by themselves once we see your location.')).toBeTruthy();
  });

  it('location permission revoked mid-shift: a persistent alert, "Offers may stop"', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }) });
    await screen.findByText(WAITING_BODY);
    const onOutcome = mockedReporting.mock.calls.at(-1)![2]!;
    act(() => onOutcome({ ok: false, reason: 'PERMISSION_DENIED', message: 'denied' }));
    expect(screen.getByText('Offers may stop')).toBeTruthy();
    expect(screen.getByText('Location is off for HalalGoes')).toBeTruthy();
    fireEvent.press(screen.getByText('Open Settings'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('notifications off while online: "You may miss offers"', async () => {
    mockedNotifications.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }) });
    await screen.findByText('Notifications are off for HalalGoes');
    expect(screen.getByText('You may miss offers')).toBeTruthy();
  });

  it('payouts paused by Stripe: still online, slate alert, never raw requirement keys', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }), getConnectStatus: 'connect_status_requirements_due' });
    await screen.findByText('Payouts are paused');
    expect(screen.getByText('Update payout details')).toBeTruthy();
    expect(screen.queryByText(/Eventually Due/)).toBeNull();
    expect(screen.getByText('Go offline')).toBeTruthy();
  });

  it('payouts never started (404) is not a pause', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }), getConnectStatus: apiError(404, 'NOT_FOUND') });
    await screen.findByText(WAITING_BODY);
    await waitFor(() => expect(api.callsTo('getConnectStatus')).toHaveLength(1));
    expect(screen.queryByText('Payouts are paused')).toBeNull();
  });

  it('going offline: "Setting you offline" until the PUT answers', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }), setRiderAvailability: 'pending' });
    fireEvent.press(await screen.findByText('Go offline'));
    await screen.findByText('Setting you offline');
    expect(screen.getByText("You're still online until we confirm.")).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('going offline answered: offline, and positions stop', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'ONLINE_IDLE' }) : dashboard({ mode: 'OFFLINE' })),
      setRiderAvailability: 'rider_availability_offline',
    });
    fireEvent.press(await screen.findByText('Go offline'));
    await screen.findByText("You're offline");
    expect(screen.queryByText('HalalGoes set you offline')).toBeNull(); // the rider asked
    expect(mockedReporting).toHaveBeenLastCalledWith(false, null, expect.any(Function));
  });

  it('going offline fails: still online, Try going offline again', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }), setRiderAvailability: 'error_internal_error' });
    fireEvent.press(await screen.findByText('Go offline'));
    await screen.findByText("We couldn't set you offline");
    expect(screen.getByText('Try going offline again')).toBeTruthy();
  });

  it('409 ACTIVE_DELIVERY_IN_PROGRESS: offers to go offline after this delivery', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'ONLINE_IDLE' }) : 'rider_dashboard_active'),
      setRiderAvailability: (call) =>
        (call.body as { is_online: boolean }).is_online ? 'rider_availability_on_delivery' : apiError(409, 'ACTIVE_DELIVERY_IN_PROGRESS'),
    });
    fireEvent.press(await screen.findByText('Go offline'));
    await screen.findByText("You can't go offline in the middle of a delivery");
    fireEvent.press(screen.getByText('Go offline after this delivery'));
    await waitFor(() => expect(api.callsTo('setRiderAvailability')).toHaveLength(2));
    expect(api.callsTo('setRiderAvailability')[1]!.body).toEqual({ is_online: true, go_offline_after_delivery: true });
  });

  it('server set the rider offline with no reason: "HalalGoes set you offline"', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'ONLINE_IDLE' }) : dashboard({ mode: 'OFFLINE' })),
    });
    await screen.findByText(WAITING_BODY);
    await act(async () => {
      await getHomeState().query.refetch();
    });
    await screen.findByText('HalalGoes set you offline');
    expect(screen.getByText('Set offline by HalalGoes')).toBeTruthy();
    expect(screen.getByText('Go online')).toBeTruthy();
  });

  it('12-hour cap: time for a rest, no Go online', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE', blocking_reasons: ['CONTINUOUS_ONLINE_CAP'] }) });
    await screen.findByText('Time for a rest');
    expect(screen.getByText('You can go online again after an 8-hour rest.')).toBeTruthy();
    expect(screen.queryByText('Go online')).toBeNull();
  });

  it('document expired: upload a new one from Account', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE', blocking_reasons: ['DOCUMENT_EXPIRED'] }) });
    await screen.findByText('A document has expired');
    fireEvent.press(screen.getByText('Upload a new document'));
    expect(screen.getByTestId('probe').props.children).toMatch(/^tab=account/);
  });

  it('account not active mid-shift: facts, account status and support', async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'OFFLINE', blocking_reasons: ['ACCOUNT_NOT_ACTIVE'] }), getPublicConfig: 'public_config' });
    await screen.findByText('Your account is not active');
    expect(screen.getByText('Account not active')).toBeTruthy();
    expect(screen.getByText('See account status')).toBeTruthy();
    await screen.findByText('Call HalalGoes support');
    expect(screen.getByText('+18005550199 · Support Hours')).toBeTruthy();
  });

  it('no internet connection: the last known status and when it was saved', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'ONLINE_IDLE' }) : 'offline'),
    });
    await screen.findByText(WAITING_BODY);
    const saved = formatTime(getHomeState().query.updatedAt);
    await act(async () => {
      await getHomeState().query.refetch();
    });
    await screen.findByText('No internet connection');
    expect(screen.getByText('Last known status: online')).toBeTruthy();
    expect(screen.getByText(`Last known: online · ${saved}`)).toBeTruthy();
    expect(screen.getByText(`Saved at ${saved}`)).toBeTruthy();
    fireEvent.press(screen.getByText('Try to reconnect'));
    await waitFor(() => expect(api.callsTo('getRiderDashboard')).toHaveLength(3));
  });

  it('on a delivery (real fixture): the current step, Resume, and the trip opens once', async () => {
    renderHome(scheme, {
      getRiderDashboard: 'rider_dashboard_active',
      setRiderAvailability: { status: 200, body: { data: { ...payload('rider_availability_on_delivery'), go_offline_after_delivery: true } } },
    });
    await screen.findByText('Go to Tariq S.');
    expect(screen.getByText('On a delivery')).toBeTruthy();
    expect(screen.getByText('No new offers until you finish')).toBeTruthy();
    expect(screen.getByText('890 Markham Road, Scarborough, ON · Unit 12')).toBeTruthy();
    expect(screen.getByText('HG-4K2M-9T')).toBeTruthy();
    const id = payload('rider_dashboard_active').active_assignment.id;
    expect(screen.getByTestId('probe').props.children).toBe(`tab=home flow=trip:{"assignmentId":"${id}"}`);
    expect(mockedReporting).toHaveBeenLastCalledWith(true, expect.objectContaining({ id }), expect.any(Function));

    fireEvent.press(screen.getByText('Go offline after this delivery'));
    await screen.findByText('Going offline after this one');
    expect(screen.getByText("You'll go offline after this delivery")).toBeTruthy();
    expect(screen.getByText('Stay online after this delivery')).toBeTruthy();
    expect(api.callsTo('setRiderAvailability')[0]!.body).toEqual({ is_online: true, go_offline_after_delivery: true });
    expectNoPriceSent();
  });
});

describe.each(SCHEMES)('Resume strip (%s)', (scheme) => {
  function renderTab(tab: 'home' | 'earnings' | 'account', choice: Parameters<typeof mockApi>[0]) {
    api = mockApi(choice);
    return render(
      <ThemeProvider theme="rider" scheme={scheme}>
        <Navigator initialTab={tab}>
          <DashboardPoller />
          <ResumeStrip />
          <FlowProbe />
        </Navigator>
      </ThemeProvider>,
    );
  }

  it('on Earnings while on a delivery: "On a delivery", the leg, and Resume opens the trip', async () => {
    renderTab('earnings', { getRiderDashboard: 'rider_dashboard_active' });
    await screen.findByText('Go to Tariq S. · 890 Markham Road');
    expect(screen.getByText('On a delivery')).toBeTruthy();
    fireEvent.press(screen.getByText('Resume'));
    expect(screen.getByTestId('probe').props.children).toMatch(/flow=trip/);
  });

  it('at the door on Account: "At <name>\'s door"', async () => {
    const d = payload('rider_dashboard_active');
    d.active_assignment.state = 'ARRIVED_AT_DROPOFF';
    renderTab('account', { getRiderDashboard: { status: 200, body: { data: d } } });
    await screen.findByText("At Tariq S.'s door");
  });

  it('not without a delivery', async () => {
    renderTab('earnings', { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }) });
    await waitFor(() => expect(getHomeState().query.status).toBe('success'));
    expect(screen.queryByTestId('resume-strip')).toBeNull();
  });

  it('never on Home (Home has its own Resume delivery)', async () => {
    renderTab('home', { getRiderDashboard: 'rider_dashboard_active' });
    await waitFor(() => expect(getHomeState().query.status).toBe('success'));
    expect(screen.queryByTestId('resume-strip')).toBeNull();
  });
});

describe.each(SCHEMES)('Home, review fixes (%s)', (scheme) => {
  it('a later read fails with a connection: HomeError with the last known status and its time', async () => {
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => (nth === 0 ? dashboard({ mode: 'ONLINE_IDLE' }) : 'error_internal_error'),
    });
    await screen.findByText(WAITING_BODY);
    const saved = formatTime(getHomeState().query.updatedAt);
    await act(async () => {
      await getHomeState().query.refetch();
    });
    await screen.findByText("We couldn't load Home");
    expect(screen.getByText(`Last known: online · ${saved}`)).toBeTruthy();
    expect(screen.getByText(`Last known: online, ${saved}`)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('first load failed: no Last known row; Go offline says when it fails and when it worked', async () => {
    renderHome(scheme, {
      getRiderDashboard: 'error_internal_error',
      setRiderAvailability: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'rider_availability_offline'),
    });
    await screen.findByText("We couldn't load Home");
    expect(screen.queryByTestId('home-last-known')).toBeNull();
    fireEvent.press(screen.getByText('Go offline'));
    await screen.findByText("We couldn't set you offline");
    fireEvent.press(screen.getByText('Go offline'));
    await screen.findByText("You're offline");
    expect(screen.queryByText("We couldn't set you offline")).toBeNull();
    expect(api.callsTo('setRiderAvailability').map((c) => c.body)).toEqual([{ is_online: false }, { is_online: false }]);
  });

  it("tracking DEGRADED uses the board's shorter waiting line", async () => {
    renderHome(scheme, { getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE', tracking_health: 'DEGRADED' }) });
    await screen.findByText('You can lock your phone. An offer fills the screen and plays a sound.');
    expect(screen.queryByText(WAITING_BODY)).toBeNull();
  });

  it('a 409 refusal clears once the server shows no delivery', async () => {
    renderHome(scheme, {
      getRiderDashboard: dashboard({ mode: 'ONLINE_IDLE' }),
      setRiderAvailability: apiError(409, 'ACTIVE_DELIVERY_IN_PROGRESS'),
    });
    fireEvent.press(await screen.findByText('Go offline'));
    // The read the 409 asks for shows no delivery: the refusal is moot, Home is waiting again.
    await waitFor(() => expect(api.callsTo('getRiderDashboard').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getHomeState().notice).toBeNull());
    expect(screen.getByText(WAITING_BODY)).toBeTruthy();
    expect(screen.queryByText("You can't go offline in the middle of a delivery")).toBeNull();
  });

  it('go offline after this delivery: the delivery ends, then the server sets offline; never "HalalGoes set you offline"', async () => {
    const reads = [
      'rider_dashboard_active',
      dashboard({ mode: 'ONLINE_IDLE' }), // the delivery has ended, not offline yet
      dashboard({ mode: 'OFFLINE' }),
    ];
    renderHome(scheme, {
      getRiderDashboard: (_c, nth) => reads[Math.min(nth, reads.length - 1)]!,
      setRiderAvailability: { status: 200, body: { data: { ...payload('rider_availability_on_delivery'), go_offline_after_delivery: true } } },
    });
    fireEvent.press(await screen.findByText('Go offline after this delivery'));
    await screen.findByText('Going offline after this one');
    while (api.callsTo('getRiderDashboard').length < reads.length) {
      await act(async () => {
        await getHomeState().query.refetch();
      });
    }
    await screen.findByText("You're offline");
    expect(screen.queryByText('HalalGoes set you offline')).toBeNull();
    expect(getHomeState().goOfflineAfter).toBe(false);
  });

  it('an applicant has no shift: the dashboard is not polled while the application flow is open', async () => {
    api = mockApi({ getRiderDashboard: dashboard({ mode: 'OFFLINE' }) });
    renderRedesign(<DashboardPoller />, { scheme, nav: { initialFlow: { name: 'application', params: { step: 'profile' } } } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.callsTo('getRiderDashboard')).toHaveLength(0);
  });
});
