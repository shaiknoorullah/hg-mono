/**
 * WP3 Offer (R17) against the contract's fixtures, light and dark.
 *
 * Pins the WP3 DONE list: the countdown is `expires_at − server_time` (a skewed device clock does
 * not matter); duplicate offer ids are ignored; an offer past `expires_at` renders nothing; an
 * accept retry reuses the same Idempotency-Key; Back is ignored while the offer is live; Accept,
 * Decline and the reasons are 72 tall; sound and haptics fire at 25% and 10%. And: before accept,
 * the drop-off is the area only (circle only when `radius_m` is sent); money only from
 * `earnings.*_cents`; no request carries a price.
 */
import * as React from 'react';
import { AccessibilityInfo, AppState, BackHandler, Dimensions, StyleSheet, Text, Vibration } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

jest.mock('../../../location', () => {
  const actual = jest.requireActual('../../../location');
  return { ...actual, useLocationReporting: jest.fn(), useLiveFix: jest.fn(() => ({ status: 'waiting' })) };
});

jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => undefined), unregisterForPush: jest.fn() }));

jest.mock('../sound', () => ({ playOfferSound: jest.fn() }));

import { MapView } from '../../ds';
import { reportReachable, reportTransportFailure, resetConnectivity } from '../../data/connectivity';
import { DashboardPoller } from '../../home/dashboard';
import { useNav } from '../../nav/Navigator';
import { mockApi, type MockApi, type ScenarioChoice } from '../../test/mockApi';
import { renderRedesign, SCHEMES, type Scheme } from '../../test/render';
import { FREQUENT_REASONS, MORE_REASONS } from '../copy';
import { OfferLayer } from '../OfferLayer';
import { playOfferSound } from '../sound';
import { conflict, current, dashboard, offerPending, offerWithoutRadius } from './offers';

const sound = playOfferSound as jest.Mock;
const PRICE_KEYS = /price|_cents|total|amount/i;
const OFFER_ID = offerPending().offer_id;
/** `target.critical` (72) at the test window's font scale, capped like the DS Button (1.6). */
const CRITICAL = Math.round(72 * Math.min(Math.max(Dimensions.get('window').fontScale || 1, 1), 1.6));
const appState = AppState as unknown as { currentState: unknown };
const jestAppState = appState.currentState;

function FlowProbe() {
  const nav = useNav();
  const f = nav.flow?.[0];
  return <Text testID="probe">{`tab=${nav.tab} flow=${f ? `${f.name}:${JSON.stringify(f.params)}` : 'none'}`}</Text>;
}

let api: MockApi;
let vibrate: jest.SpyInstance;
let announce: jest.SpyInstance;
let backHandlers: Array<() => boolean | null | undefined>;

beforeEach(() => {
  jest.useFakeTimers();
  // RN's jest mock leaves `currentState` a function, which pauses every poll: the app is in front.
  appState.currentState = 'active';
  resetConnectivity();
  sound.mockClear();
  vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  jest.spyOn(Vibration, 'cancel').mockImplementation(() => undefined);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
    backHandlers.push(fn);
    return { remove: () => void backHandlers.splice(backHandlers.indexOf(fn), 1) };
  });
});

afterEach(() => {
  appState.currentState = jestAppState;
  api?.restore();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Mount the poller, the layer and a probe in the navigator, with one scenario per operation. */
async function mount(scheme: Scheme, choices: Record<string, ScenarioChoice>) {
  api = mockApi({ getRiderDashboard: dashboard(), getCurrentOffer: current(offerPending()), ...choices });
  renderRedesign(
    <>
      <DashboardPoller />
      <OfferLayer />
      <FlowProbe />
    </>,
    { scheme, nav: true },
  );
  await act(async () => {});
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function minHeight(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).minHeight;
}

/** Android Back, as the OS delivers it: the newest listener first, stop at the first `true`. */
function pressBack(): boolean {
  let handled = false;
  act(() => {
    for (const fn of [...backHandlers].reverse()) {
      if (fn()) {
        handled = true;
        break;
      }
    }
  });
  return handled;
}

describe.each(SCHEMES)('Offer layer (%s)', (scheme) => {
  it('SH/OfferLive: the full offer, area only, money from *_cents, 72 tall Accept and Decline', async () => {
    await mount(scheme, {});
    expect(await screen.findByText('Delivery offer')).toBeTruthy();
    expect(screen.getByText('0:28')).toBeTruthy();
    expect(screen.getByText('to answer')).toBeTruthy();
    expect(screen.getByText('Estimated earnings')).toBeTruthy();
    expect(screen.getByTestId('offer-total')).toHaveTextContent('$11.49');
    expect(screen.getByText('5.2 km')).toBeTruthy();
    expect(screen.getByText('about 13 min')).toBeTruthy();
    expect(screen.getAllByText('pickup to drop-off')).toHaveLength(2);
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByText('to carry')).toBeTruthy();
    expect(screen.getByText('Karachi Kitchen')).toBeTruthy();
    expect(screen.getByText('1245 Danforth Avenue, Toronto')).toBeTruthy();
    expect(screen.getByText('Drop-off area')).toBeTruthy();
    expect(screen.getByText('Harbourfront, Toronto')).toBeTruthy();
    expect(screen.getByText('You get the full address when you accept.')).toBeTruthy();
    // Breakdown: base and tip present; distance (0) and busy-time extra (0) hidden, never $0.00.
    expect(screen.getByTestId('offer-row-base')).toHaveTextContent('Base fare$4.49');
    expect(screen.getByTestId('offer-row-tip')).toHaveTextContent('Tip so far (can still change)$7.00');
    expect(screen.queryByText('Distance pay')).toBeNull();
    expect(screen.queryByText('Busy-time extra')).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
    // The map: pickup pin, the area with its circle, never a customer pin.
    const map = screen.UNSAFE_getByType(MapView);
    expect(map.props.customer).toBeUndefined();
    expect(map.props.restaurant).toEqual({ latitude: 43.6817, longitude: -79.3403 });
    expect(map.props.summary).toBe(
      'Pickup: Karachi Kitchen, 1245 Danforth Avenue, Toronto. Drop-off area: Harbourfront, Toronto, south-west of the pickup, within about 400 m.',
    );
    // The "from you to the pickup" row is Needs API (gap 12): not drawn.
    expect(screen.queryByText(/from you to the pickup/)).toBeNull();
    expect(minHeight('offer-accept')).toBe(CRITICAL);
    expect(minHeight('offer-decline')).toBe(CRITICAL);
    // Arrival: the repeating alert, once.
    expect(sound).toHaveBeenCalledWith('arrive');
    expect(vibrate).toHaveBeenCalledWith([0, 700, 500], true);
  });

  it('#312 without radius_m: the area name and direction, no circle', async () => {
    await mount(scheme, { getCurrentOffer: current(offerWithoutRadius()) });
    expect(await screen.findByText('Riverdale, Toronto')).toBeTruthy();
    const summary = screen.UNSAFE_getByType(MapView).props.summary as string;
    expect(summary).toBe('Pickup: Karachi Kitchen, 1245 Danforth Avenue, Toronto. Drop-off area: Riverdale, Toronto, south-west of the pickup.');
    expect(summary).not.toMatch(/within/);
  });

  it.each([
    ['ten minutes fast', 10 * 60_000],
    ['ten minutes slow', -10 * 60_000],
  ])('countdown ignores the device clock (%s): still 0:28 at arrival', async (_name, skew) => {
    jest.setSystemTime(Date.parse(offerPending().server_time) + skew);
    await mount(scheme, {});
    expect(await screen.findByText('0:28')).toBeTruthy();
    await advance(10_000);
    expect(screen.getByText('0:18')).toBeTruthy();
  });

  it('an offer already past expires_at renders nothing', async () => {
    const late = offerPending({ expires_at: '2026-08-10T18:42:10.412Z' });
    await mount(scheme, { getCurrentOffer: current(late), getRiderDashboard: dashboard({ current_offer: late }) });
    await advance(3_000);
    expect(screen.queryByText('Delivery offer')).toBeNull();
    expect(sound).not.toHaveBeenCalled();
  });

  it('empty and error: no offer, or a failed read, renders nothing and keeps polling', async () => {
    await mount(scheme, { getCurrentOffer: 'offer_none' });
    expect(screen.queryByText('Delivery offer')).toBeNull();
    api.set('getCurrentOffer', 'error_internal_error');
    await advance(3_000);
    expect(screen.queryByText('Delivery offer')).toBeNull();
    api.set('getCurrentOffer', current(offerPending()));
    await advance(3_000);
    expect(screen.getByText('Delivery offer')).toBeTruthy();
    expect(api.callsTo('getCurrentOffer').length).toBeGreaterThanOrEqual(3);
  });

  it.each(['offer_expired', 'offer_taken_by_another', 'offer_withdrawn', 'offer_rejected'])(
    '%s read cold (an offer that is already over): nothing renders, nothing is sent',
    async (scenario) => {
      await mount(scheme, { getCurrentOffer: scenario });
      await advance(6_000);
      expect(screen.queryByText('Delivery offer')).toBeNull();
      expect(screen.queryByTestId('offer-result-done')).toBeNull();
      expect(sound).not.toHaveBeenCalled();
      expect(api.callsTo('acceptOffer')).toHaveLength(0);
      expect(api.callsTo('rejectOffer')).toHaveLength(0);
    },
  );

  it('duplicate offer ids are ignored: the dashboard and the poll carry the same offer, once', async () => {
    await mount(scheme, { getRiderDashboard: dashboard({ current_offer: offerPending() }) });
    expect(await screen.findByText('Delivery offer')).toBeTruthy();
    await advance(6_000);
    expect(screen.getByText('0:22')).toBeTruthy(); // not restarted by later reads of the same id
    expect(sound.mock.calls.filter(([c]) => c === 'arrive')).toHaveLength(1);
    // Declined, then read again: stays gone.
    fireEvent.press(screen.getByTestId('offer-decline'));
    fireEvent.press(screen.getByText('Taking a break'));
    await act(async () => {});
    expect(screen.queryByText('Delivery offer')).toBeNull();
    await advance(6_000);
    expect(screen.queryByText('Delivery offer')).toBeNull();
  });

  it('SH/OfferUrgent and OfferCritical: tick at 25%, double tick + tone at 10%, spoken countdown', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    await advance(14_000); // 14 s left: 50%
    expect(announce).toHaveBeenCalledWith('14 seconds left to answer');
    expect(sound).not.toHaveBeenCalledWith('urgent');
    await advance(7_250); // under 25%
    expect(sound).toHaveBeenCalledWith('urgent');
    expect(vibrate).toHaveBeenCalledWith(80, false);
    expect(sound).not.toHaveBeenCalledWith('critical');
    await advance(4_000); // under 10%
    expect(sound).toHaveBeenCalledWith('critical');
    expect(vibrate).toHaveBeenCalledWith([0, 80, 120, 80], false);
    expect(screen.getByText('0:03')).toBeTruthy();
  });

  it('SH/OfferExpired: time runs out, the result stays until Back to waiting, the id is not shown again', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    await advance(28_500);
    expect(screen.getByText('This offer expired')).toBeTruthy();
    expect(screen.getByText("You're still online and can get the next one.")).toBeTruthy();
    expect(screen.getByText('If 3 offers in a row expire, we set you offline.')).toBeTruthy();
    expect(sound).toHaveBeenCalledWith('ended');
    await advance(30_000); // no auto-close
    expect(screen.getByText('This offer expired')).toBeTruthy();
    fireEvent.press(screen.getByText('Back to waiting'));
    expect(screen.queryByText('This offer expired')).toBeNull();
    await advance(6_000); // the poll still returns the same offer id
    expect(screen.queryByText('Delivery offer')).toBeNull();
    expect(api.callsTo('acceptOffer')).toHaveLength(0);
    expect(api.callsTo('rejectOffer')).toHaveLength(0);
  });

  it('SH/OfferReplacesResult: a new offer replaces a result at once', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    await advance(28_500);
    expect(screen.getByText('This offer expired')).toBeTruthy();
    api.set('getCurrentOffer', current(offerWithoutRadius()));
    await advance(3_000);
    expect(screen.queryByText('This offer expired')).toBeNull();
    expect(screen.getByText('Riverdale, Toronto')).toBeTruthy();
  });

  it('Back is ignored while the offer is live, and goes back to waiting on a result', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    expect(pressBack()).toBe(true);
    expect(screen.getByText('Delivery offer')).toBeTruthy();
    await advance(28_500);
    expect(pressBack()).toBe(true);
    expect(screen.queryByText('This offer expired')).toBeNull();
  });

  it('Accept: one request with an Idempotency-Key, no price; opens the trip and shows the full address', async () => {
    await mount(scheme, { acceptOffer: 'assignment_assigned' });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    const [call] = api.callsTo('acceptOffer');
    expect(call!.path).toBe(`/v1/riders/me/offers/${OFFER_ID}/accept`);
    expect(call!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(call!.body ?? {})).not.toMatch(PRICE_KEYS);
    expect(screen.getByText("You've got this delivery")).toBeTruthy();
    expect(screen.getByText('Go to Karachi Kitchen. Your route and the order code are on the next screen.')).toBeTruthy();
    expect(screen.getByTestId('offer-full-address')).toHaveTextContent(/Harbour Street, Harbourfront$/);
    expect(screen.getByTestId('probe')).toHaveTextContent(/flow=trip:\{"assignmentId":"c48e3032-9fbd-414c-a883-5136571a19c0"\}$/);
    expect(sound).toHaveBeenCalledWith('accepted');
    fireEvent.press(screen.getByText('Go to the restaurant'));
    expect(screen.queryByText("You've got this delivery")).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent(/flow=trip:/);
  });

  it('SH/OfferAcceptRetry: a failed accept retries with the same Idempotency-Key', async () => {
    await mount(scheme, { acceptOffer: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_assigned') });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    expect(screen.getByText("Your accept didn't reach us")).toBeTruthy();
    expect(screen.getByText('The offer is still open. Try again while the timer runs.')).toBeTruthy();
    // The poll now says ACCEPTED: maybe our own accept, whose answer was lost. Not "taken".
    api.set('getCurrentOffer', current(offerPending({ state: 'ACCEPTED' })));
    await advance(3_000);
    expect(screen.queryByText('Another rider took this order first')).toBeNull();
    fireEvent.press(screen.getByText('Try accepting again'));
    await act(async () => {});
    const [first, second] = api.callsTo('acceptOffer');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
    expect(screen.getByText("You've got this delivery")).toBeTruthy();
  });

  it('SH/OfferConnectionLost: banner while offline, Accept stays, and goes the moment the connection is back', async () => {
    await mount(scheme, { acceptOffer: (_c, nth) => (nth === 0 ? 'offline' : 'assignment_assigned') });
    await screen.findByText('Delivery offer');
    act(() => reportTransportFailure());
    expect(screen.getByText('No internet connection')).toBeTruthy();
    expect(screen.getByText("Accept may not reach us. We'll send it the moment you're back online, until the time runs out.")).toBeTruthy();
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    expect(screen.getByText("Your accept didn't reach us")).toBeTruthy();
    await act(async () => reportReachable());
    await act(async () => {});
    const calls = api.callsTo('acceptOffer');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(screen.getByText("You've got this delivery")).toBeTruthy();
  });

  it.each([
    ['error_offer_expired', 'This offer ended before your accept reached us', 'Back to waiting'],
    ['error_offer_already_taken', 'Another rider took this order first', 'Back to waiting'],
  ])('409 on accept (%s) shows its board', async (scenario, title, button) => {
    await mount(scheme, { acceptOffer: scenario });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(button)).toBeTruthy();
    expect(screen.getByTestId('probe')).toHaveTextContent(/flow=none$/);
  });

  it('409 ORDER_CANCELLED on accept: SH/OfferWithdrawn', async () => {
    await mount(scheme, { acceptOffer: conflict('ORDER_CANCELLED') });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    expect(screen.getByText('This order was cancelled')).toBeTruthy();
    expect(screen.getByText("It was cancelled before anyone accepted it, so the offer was withdrawn. There's nothing for you to do.")).toBeTruthy();
  });

  it('409 RIDER_NOT_AVAILABLE on accept: SH/OfferNotAvailable, Back to Home re-reads the dashboard', async () => {
    await mount(scheme, { acceptOffer: conflict('RIDER_NOT_AVAILABLE') });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-accept'));
    await act(async () => {});
    expect(screen.getByText("You can't take this offer")).toBeTruthy();
    expect(screen.getByText("Your status changed while the offer was open, so we couldn't give it to you. Home shows your status now.")).toBeTruthy();
    const before = api.callsTo('getRiderDashboard').length;
    fireEvent.press(screen.getByText('Back to Home'));
    await act(async () => {});
    expect(api.callsTo('getRiderDashboard').length).toBe(before + 1);
    expect(screen.queryByText("You can't take this offer")).toBeNull();
  });

  it.each([
    ['WITHDRAWN', 'This offer was withdrawn'],
    ['ACCEPTED', 'Another rider took this order first'],
  ])('the poll says %s for the offer on screen: it ends on its own', async (state, title) => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    api.set('getCurrentOffer', current(offerPending({ state: state as never })));
    await advance(3_000);
    expect(screen.getByText(title)).toBeTruthy();
    expect(sound).toHaveBeenCalledWith('ended');
  });

  it('SH/OfferDecline: one tap on a reason declines, with its reason_code and a key; no OTHER', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-decline'));
    expect(screen.getByText('Why are you declining?')).toBeTruthy();
    expect(screen.getByText('Keep the offer')).toBeTruthy();
    expect(screen.getByTestId('offer-decline-countdown')).toHaveTextContent(/0:28left/);
    for (const r of FREQUENT_REASONS) {
      expect(screen.getByText(r.label)).toBeTruthy();
      expect(minHeight(`offer-reason-${r.code}`)).toBe(CRITICAL);
    }
    expect(minHeight('offer-keep')).toBe(CRITICAL);
    for (const r of MORE_REASONS) expect(screen.queryByText(r.label)).toBeNull();
    fireEvent.press(screen.getByText('More reasons'));
    for (const r of MORE_REASONS) expect(screen.getByText(r.label)).toBeTruthy();
    expect(screen.queryByTestId('offer-reason-OTHER')).toBeNull();
    expect(screen.queryByText('More reasons')).toBeNull();
    fireEvent.press(screen.getByText('Pickup is too far'));
    await act(async () => {});
    const [call] = api.callsTo('rejectOffer');
    expect(call!.path).toBe(`/v1/riders/me/offers/${OFFER_ID}/reject`);
    expect(call!.body).toEqual({ reason_code: 'TOO_FAR_PICKUP' });
    expect(call!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByText('Delivery offer')).toBeNull();
    expect(api.callsTo('acceptOffer')).toHaveLength(0);
  });

  it('Keep the offer closes the reasons and sends nothing', async () => {
    await mount(scheme, {});
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-decline'));
    fireEvent.press(screen.getByText('Keep the offer'));
    expect(screen.queryByText('Why are you declining?')).toBeNull();
    expect(screen.getByText('Delivery offer')).toBeTruthy();
    expect(api.callsTo('rejectOffer')).toHaveLength(0);
  });

  it('SH/OfferDeclineFailed: the decline did not reach us; tapping the reason again reuses the key', async () => {
    await mount(scheme, { rejectOffer: (_c, nth) => (nth === 0 ? 'offline' : '') /* '' = the contract's 204, no body */ });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-decline'));
    fireEvent.press(screen.getByText('Earnings are too low'));
    await act(async () => {});
    expect(screen.getByText("Your decline didn't reach us")).toBeTruthy();
    expect(screen.getByText('The offer is still open. Tap your reason again, or keep the offer.')).toBeTruthy();
    fireEvent.press(screen.getByText('Earnings are too low'));
    await act(async () => {});
    const [first, second] = api.callsTo('rejectOffer');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
    expect(screen.queryByText('Delivery offer')).toBeNull();
  });

  it('409 OFFER_EXPIRED on decline is silent', async () => {
    await mount(scheme, { rejectOffer: 'error_offer_expired' });
    await screen.findByText('Delivery offer');
    fireEvent.press(screen.getByTestId('offer-decline'));
    fireEvent.press(screen.getByText('Ending my shift'));
    await act(async () => {});
    expect(screen.queryByText('Delivery offer')).toBeNull();
    expect(screen.queryByText('This offer expired')).toBeNull();
  });

  it('SH/OfferBreakdownPartial and OfferTipHidden: absent or zero rows are hidden, the total stays', async () => {
    const partial = offerPending({
      earnings: { estimated_total_cents: 944, currency: 'CAD', base_cents: 350, distance_cents: null, surge_cents: null, tip_so_far_cents: null } as never,
    });
    await mount(scheme, { getCurrentOffer: current(partial) });
    await screen.findByText('Delivery offer');
    expect(screen.getByTestId('offer-total')).toHaveTextContent('$9.44');
    expect(screen.getByText('Base fare')).toBeTruthy();
    for (const label of ['Distance pay', 'Busy-time extra', 'Tip so far (can still change)']) expect(screen.queryByText(label)).toBeNull();
  });

  it('offer_zero_tip_low_value: no tip row, no $0.00, the server total as returned', async () => {
    await mount(scheme, { getCurrentOffer: 'offer_zero_tip_low_value' });
    await screen.findByText('Delivery offer');
    expect(screen.getByTestId('offer-total')).toHaveTextContent('$4.49');
    expect(screen.getByText('12.1 km')).toBeTruthy();
    expect(screen.getByText('1 item')).toBeTruthy();
    expect(screen.queryByText('Tip so far (can still change)')).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('not waiting (on a delivery, or offline): no offer shown and getCurrentOffer is not polled', async () => {
    await mount(scheme, {
      getRiderDashboard: dashboard({ mode: 'ON_DELIVERY', active_assignment: { id: 'a1' }, current_offer: offerPending() }),
    });
    await advance(6_000);
    expect(screen.queryByText('Delivery offer')).toBeNull();
    expect(api.callsTo('getCurrentOffer')).toHaveLength(0);
    api.set('getRiderDashboard', dashboard({ mode: 'OFFLINE' }));
    await advance(6_000);
    expect(api.callsTo('getCurrentOffer')).toHaveLength(0);
  });
});
