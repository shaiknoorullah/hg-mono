/**
 * WP4 the pickup leg, against the contract's fixtures (and #290's), light and dark.
 *
 * Pins the WP4 DONE list: PICKED_UP sends `pickup_code`; 422 shows the tries left; 423 removes
 * the field and shows support; offline PICKED_UP queues and replays; a replay answered 422 opens
 * PickupCodeRejectedLater; GEOFENCE 422 never strands the rider. Plus: a "Try again" is the same
 * request (same Idempotency-Key and body), no step carries a price, no halal badge or seal.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  GEOFENCE_REQUIRED,
  ID,
  INVALID_TRANSITION,
  PICKUP_CODE_INCORRECT,
  PICKUP_CODE_LOCKED,
  SUPPORT_OFF,
  assignment,
  keys,
  renderTrip,
  transitions,
} from './harness';
import { outbox } from '../../data/outbox';
import { formatTime } from '../../format/time';
import { payload } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const PREPARING = (waited = 6) =>
  assignment('assignment_arrived_at_pickup', { arrived_pickup_at: minutesAgo(waited) }, { order_state: 'PREPARING' });
const FORBIDDEN_WORDS = /halal|seal|scan/i;

describe.each(SCHEMES)('trip shell (%s)', (scheme) => {
  it('cold start: "Picking up where you left off" while the delivery loads', () => {
    renderTrip(scheme, { getAssignment: 'pending' });
    expect(screen.getByText('Picking up where you left off')).toBeTruthy();
    expect(screen.getByText("We're loading your delivery. This takes a moment.")).toBeTruthy();
  });

  it('load failed: TripLoadFailed with Try again, support with its number and hours', async () => {
    const { api } = renderTrip(scheme, { getAssignment: 'error_internal_error' });
    await screen.findByText("We couldn't load this delivery");
    expect(screen.getByText('Something went wrong on our side. Your delivery is still yours. Try again, or call support.')).toBeTruthy();
    expect(await screen.findByText('1 800 555 0199 · Support Hours')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(api.callsTo('getAssignment')).toHaveLength(2));
  });

  it('no id from the gate: getRiderMe names the delivery, then it routes by state', async () => {
    const { api } = renderTrip(
      scheme,
      { getRiderMe: { status: 200, body: { data: { ...payload('rider_me'), active_assignment_id: ID } } }, getAssignment: 'assignment_en_route_to_pickup' },
      null,
    );
    await screen.findByText('Go to Karachi Kitchen');
    expect(api.callsTo('getAssignment')[0]!.path).toContain(ID);
  });

  it('no id and no delivery on the server: says so, Back to Home', async () => {
    renderTrip(scheme, { getRiderMe: { status: 200, body: { data: { ...payload('rider_me'), active_assignment_id: null } } } }, null);
    await screen.findByText("You don't have a delivery right now");
    expect(screen.getByText('Back to Home')).toBeTruthy();
  });

  it('routes PICKED_UP and later to tripDropoff, an ended delivery to tripEnded', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_picked_up' });
    expect((await screen.findByTestId('route-probe')).props.children).toBe(`tripDropoff:${ID}`);
  });

  it('a cancelled delivery goes to tripEnded', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_cancelled_by_platform' });
    expect((await screen.findByTestId('route-probe')).props.children).toMatch(/^tripEnded:/);
  });
});

describe.each(SCHEMES)('step 1, go to the restaurant (%s)', (scheme) => {
  it('populated: the restaurant, the full drop-off, the food, the order code, the estimate', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_en_route_to_pickup' });
    await screen.findByText('Go to Karachi Kitchen');
    expect(screen.getByText('Step 1 of 4 · Go to the restaurant')).toBeTruthy();
    expect(screen.getAllByText('1245 Danforth Avenue, Toronto, ON M4J 1M4').length).toBeGreaterThan(0);
    expect(screen.getByText('Harbour Street, Harbourfront')).toBeTruthy();
    expect(screen.getByText('Ready for pickup')).toBeTruthy();
    expect(screen.getByText('HG-PIUP-9X')).toBeTruthy();
    expect(screen.getByText(/11\.49/)).toBeTruthy(); // earnings.estimated_total_cents 1149, through Price
    expect(screen.getByText('Call restaurant')).toBeTruthy();
    expect(screen.getByText("I'm at the restaurant")).toBeTruthy();
    expect(screen.queryByText(FORBIDDEN_WORDS)).toBeNull();
  });

  it('Navigate opens the maps app; Call restaurant dials the proxy number', async () => {
    const { openURL } = renderTrip(scheme, { getAssignment: 'assignment_en_route_to_pickup' });
    fireEvent.press(await screen.findByText('Navigate'));
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('destination=43.6817,-79.3403'));
    fireEvent.press(screen.getByText('Call restaurant'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550188');
  });

  it('no phone alias: no Call restaurant button', async () => {
    renderTrip(scheme, { getAssignment: assignment('assignment_en_route_to_pickup', {}, { phone_alias: null }) });
    await screen.findByText('Go to Karachi Kitchen');
    expect(screen.queryByText('Call restaurant')).toBeNull();
  });

  it("I'm at the restaurant posts ARRIVED_AT_PICKUP with a position; food ready lands on the items", async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_en_route_to_pickup',
      createAssignmentTransition: 'assignment_arrived_at_pickup',
    });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText('Check the bag has 3 items');
    const [body] = transitions(api);
    expect(body).toEqual({
      to_state: 'ARRIVED_AT_PICKUP',
      latitude: 43.6817,
      longitude: -79.3403,
      accuracy_m: 6,
      occurred_at: expect.any(String),
    });
    expect(keys(api)[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ASSIGNED: EN_ROUTE_TO_PICKUP is posted once, by itself; 5xx keeps the trip and Try again now resends the same request', async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_assigned',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_en_route_to_pickup'),
    });
    await screen.findByText("We couldn't start the trip");
    expect(screen.getByText(/You accepted the offer; it's yours\./)).toBeTruthy();
    expect(screen.getByText(/^On my way · /)).toBeTruthy();
    fireEvent.press(screen.getByText('Try again now'));
    await waitFor(() => expect(transitions(api)).toHaveLength(2));
    expect(transitions(api)[0]!.to_state).toBe('EN_ROUTE_TO_PICKUP');
    expect(transitions(api)[1]).toEqual(transitions(api)[0]);
    expect(keys(api)[1]).toBe(keys(api)[0]);
    await waitFor(() => expect(screen.queryByText("We couldn't start the trip")).toBeNull());
  });

  it('arrival 5xx: "We couldn\'t record that you\'re here"; Try again reuses the Idempotency-Key', async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_en_route_to_pickup',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : PREPARING()),
    });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText("We couldn't record that you're here");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Wait for the food');
    expect(keys(api)[1]).toBe(keys(api)[0]);
    expect(transitions(api)[1]).toEqual(transitions(api)[0]);
  });

  it('422 GEOFENCE_REQUIRED never strands the rider: the reason sheet sends override_reason with a new key', async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_en_route_to_pickup',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? GEOFENCE_REQUIRED() : PREPARING()),
    });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText("We can't place you at the restaurant");
    expect(screen.getByText(/Your location doesn't show you at Karachi Kitchen\./)).toBeTruthy();
    const go = screen.getByTestId('trip-geofence-continue');
    expect(go.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('trip-geofence-reason-field'), 'GPS is off by a block');
    fireEvent.press(screen.getByText("Continue: I'm at the restaurant"));
    await screen.findByText('Wait for the food');
    expect(transitions(api)[1]).toMatchObject({ to_state: 'ARRIVED_AT_PICKUP', override_reason: 'GPS is off by a block' });
    expect(keys(api)[1]).not.toBe(keys(api)[0]);
  });

  it("geofence: I'm not there yet closes the sheet and sends nothing", async () => {
    const { api } = renderTrip(scheme, { getAssignment: 'assignment_en_route_to_pickup', createAssignmentTransition: GEOFENCE_REQUIRED() });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    fireEvent.press(await screen.findByText("I'm not there yet"));
    await waitFor(() => expect(screen.queryByText("We can't place you at the restaurant")).toBeNull());
    expect(transitions(api)).toHaveLength(1);
  });

  it('offline: the arrival is saved, the rider moves on with "Not sent yet"', async () => {
    renderTrip(scheme, { getAssignment: PREPARING_AS('EN_ROUTE_TO_PICKUP'), createAssignmentTransition: 'offline' });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText('Wait for the food');
    expect(screen.getByText(/^I'm at the restaurant · \d/)).toBeTruthy();
    expect(screen.getAllByText('Not sent yet').length).toBeGreaterThan(0);
    expect(screen.getByText('No internet connection')).toBeTruthy();
    expect(outbox.pendingFor(ID)).toHaveLength(1);
  });

  it('409 INVALID_TRANSITION: re-reads the delivery and says it had moved on', async () => {
    renderTrip(scheme, {
      getAssignment: (_c, nth) => (nth === 0 ? 'assignment_en_route_to_pickup' : PREPARING()),
      createAssignmentTransition: INVALID_TRANSITION('ARRIVED_AT_PICKUP'),
    });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText('This delivery had already moved on');
    expect(screen.getByText("We have it as at the restaurant, so we've moved you to this step. Nothing was lost.")).toBeTruthy();
    expect(screen.getByText('Wait for the food')).toBeTruthy();
  });

  it('tracking LOST and DEGRADED: slate banners; the delivery stays the rider\'s', async () => {
    renderTrip(scheme, { getAssignment: assignment('assignment_en_route_to_pickup', { tracking_health: 'LOST' }) });
    await screen.findByText("The customer can't see you on the map");
    expect(screen.getByText('Open location settings')).toBeTruthy();
  });

  it('tracking DEGRADED', async () => {
    renderTrip(scheme, { getAssignment: assignment('assignment_en_route_to_pickup', { tracking_health: 'DEGRADED' }) });
    await screen.findByText('Your location is patchy');
  });

  it("Something's wrong: 911, support with hours, the restaurant; no support row when support is off", async () => {
    renderTrip(scheme, { getAssignment: 'assignment_en_route_to_pickup', getPublicConfig: SUPPORT_OFF });
    fireEvent.press(await screen.findByText("Something's wrong"));
    await screen.findByText("What's wrong?");
    expect(screen.getByText('In danger or hurt? Call 911 first.')).toBeTruthy();
    expect(screen.getByText('Call 911')).toBeTruthy();
    expect(screen.getByText('Call Karachi Kitchen')).toBeTruthy();
    expect(screen.queryByText('Call HalalGoes support')).toBeNull();
    fireEvent.press(screen.getByText('Back to the delivery'));
    await waitFor(() => expect(screen.queryByText("What's wrong?")).toBeNull());
  });
});

describe.each(SCHEMES)('step 2, at the restaurant (%s)', (scheme) => {
  it('waiting: Preparing, the wait, the items; Check the items stays off until the food is ready', async () => {
    renderTrip(scheme, { getAssignment: PREPARING() });
    await screen.findByText('Wait for the food');
    expect(screen.getByText('Step 2 of 4 · At the restaurant')).toBeTruthy();
    expect(screen.getByText('Preparing')).toBeTruthy();
    expect(screen.getByText("You've waited · 6 min")).toBeTruthy();
    expect(screen.getByText('3 items to collect')).toBeTruthy();
    expect(screen.getByText('1 × Beef Nihari')).toBeTruthy();
    expect(screen.getByText('Note: Extra gravy on the side')).toBeTruthy();
    expect(screen.getByTestId('trip-check-items').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('Turns on when the restaurant marks the food ready.')).toBeTruthy();
    expect(screen.queryByText(/Still waiting\?/)).toBeNull();
  });

  it('the restaurant marks it ready on the next poll: Check the items turns on', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      renderTrip(scheme, { getAssignment: (_c, nth) => (nth === 0 ? PREPARING() : 'assignment_arrived_at_pickup') });
      await screen.findByText('Preparing');
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      await screen.findByText('Ready for pickup');
      fireEvent.press(screen.getByText('Check the items'));
      await screen.findByText('Check the bag has 3 items');
    } finally {
      jest.useRealTimers();
    }
  });

  it('long wait at 20 minutes: slate banner with a direct call', async () => {
    const { openURL } = renderTrip(scheme, { getAssignment: PREPARING(21) });
    await screen.findByText('Still waiting? Call the restaurant');
    expect(screen.getByText('Ask how long the food will be.')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Call Karachi Kitchen')[0]!);
    expect(openURL).toHaveBeenCalledWith('tel:+16475550188');
  });

  it('handed over but not marked ready: the sheet records nothing', async () => {
    const { api } = renderTrip(scheme, { getAssignment: PREPARING() });
    fireEvent.press(await screen.findByText("They've handed it over, but it isn't marked ready"));
    await screen.findByText("The restaurant hasn't marked it ready");
    expect(screen.getByText('Ask Karachi Kitchen to mark the order ready in their app. Check the items turns on as soon as they do.')).toBeTruthy();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
    fireEvent.press(screen.getByText('Keep waiting'));
    expect(transitions(api)).toHaveLength(0);
  });

  it('items: the code turns the button on at 4 digits; PICKED_UP carries pickup_code', async () => {
    const { api } = renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup', createAssignmentTransition: 'assignment_picked_up' });
    await screen.findByText('Check the bag has 3 items');
    expect(screen.getByText('Ask the kitchen for the pickup code')).toBeTruthy();
    expect(screen.getByText("Prepaid. Don't collect any money.")).toBeTruthy();
    expect(screen.getByText('Turns on when the code has 4 digits.')).toBeTruthy();
    const field = screen.getByTestId('trip-pickup-code-field');
    fireEvent.changeText(field, '731');
    expect(screen.getByTestId('trip-got-food').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(field, '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    expect((await screen.findByTestId('route-probe')).props.children).toBe(`tripDropoff:${ID}`);
    expect(transitions(api)).toEqual([
      { to_state: 'PICKED_UP', pickup_code: '7314', latitude: 43.6817, longitude: -79.3403, accuracy_m: 6, occurred_at: expect.any(String) },
    ]);
    for (const body of transitions(api)) for (const k of Object.keys(body)) expect(k).not.toMatch(/price|_cents|amount|total/i);
  });

  it('nothing is sent with fewer than 4 digits', async () => {
    const { api } = renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup' });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '12');
    fireEvent.press(screen.getByText("I've got the food"));
    expect(transitions(api)).toHaveLength(0);
  });

  it('422 PICKUP_CODE_INCORRECT: the code stays, the board line and the tries left', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup', createAssignmentTransition: PICKUP_CODE_INCORRECT });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText(
      "That isn't the pickup code for this order. Ask the kitchen to read it again from order HG-PIUP-9X. 3 tries left.",
    );
    expect(screen.getByTestId('trip-pickup-code-field').props.value).toBe('7314');
  });

  it('423 PICKUP_CODE_LOCKED: the field is gone, support takes over, no photo', async () => {
    const { openURL } = renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup', createAssignmentTransition: PICKUP_CODE_LOCKED });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText('Too many wrong codes');
    expect(screen.getByText('Ask Karachi Kitchen to check the code on order HG-PIUP-9X, then call HalalGoes support to finish the pickup.')).toBeTruthy();
    expect(screen.queryByTestId('trip-pickup-code-field')).toBeNull();
    expect(screen.queryByText(/photo/i)).toBeNull();
    fireEvent.press(screen.getByText('Call HalalGoes support'));
    expect(openURL).toHaveBeenCalledWith('tel:+18005550199');
  });

  it('5xx on the pickup: the answer is kept; Try again is the same request', async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_arrived_at_pickup',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_picked_up'),
    });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText("We couldn't record your pickup");
    expect(screen.getByText('Step 2 of 4 · Check the bag')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByTestId('route-probe');
    expect(keys(api)[1]).toBe(keys(api)[0]);
    expect(transitions(api)[1]).toEqual(transitions(api)[0]);
  });

  it('kitchen can\'t find the code: the help sheet, then Back to the code', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup' });
    fireEvent.press(await screen.findByText("The kitchen can't find the code"));
    await screen.findByText("It's on order HG-PIUP-9X on their HalalGoes screen, under Pickup code. If they still can't find it, call HalalGoes support.");
    fireEvent.press(screen.getByText('Back to the code'));
    await waitFor(() => expect(screen.queryByText(/under Pickup code/)).toBeNull());
  });
});

describe.each(SCHEMES)('offline pickup and the replay (%s)', (scheme) => {
  it('offline PICKED_UP is saved; the rider carries on to the customer', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_arrived_at_pickup', createAssignmentTransition: 'offline' });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText('Step 3 of 4 · Go to the customer');
    const saved = outbox.pendingFor(ID);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.input).toMatchObject({ to_state: 'PICKED_UP', pickup_code: '7314' });
    expect(screen.getByText(`Picked up · ${formatTime(saved[0]!.input.occurred_at)}`)).toBeTruthy();
    expect(screen.getByText('Go to Ayesha R.')).toBeTruthy();
    fireEvent.press(screen.getByText('Go to the customer'));
    expect((await screen.findByTestId('route-probe')).props.children).toBe(`tripDropoff:${ID}`);
  });

  it('a replay answered 422 opens PickupCodeRejectedLater; the new code goes first with the original time', async () => {
    const { api } = renderTrip(scheme, {
      getAssignment: 'assignment_arrived_at_pickup',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'offline' : nth === 1 ? PICKUP_CODE_INCORRECT : 'assignment_picked_up'),
    });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText('Step 3 of 4 · Go to the customer');
    const savedAt = outbox.pendingFor(ID)[0]!.input.occurred_at;
    await act(async () => {
      await outbox.drain();
    });
    await screen.findByText("The pickup code you saved wasn't accepted");
    expect(
      screen.getByText(
        `Your pickup at ${formatTime(savedAt)} isn't recorded yet. Call Karachi Kitchen and ask them to read the code for order HG-PIUP-9X again, then type it here.`,
      ),
    ).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('trip-rejected-code-input-field'), '7341');
    fireEvent.press(screen.getByText('Send the code'));
    await waitFor(() => expect(screen.queryByText("The pickup code you saved wasn't accepted")).toBeNull());
    const sent = transitions(api);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ to_state: 'PICKED_UP', pickup_code: '7341', occurred_at: savedAt });
    expect(keys(api)[2]).not.toBe(keys(api)[1]);
    expect(outbox.pendingFor(ID)).toHaveLength(0);
  });

  it('a replay answered 423 opens the locked handoff over any screen', async () => {
    renderTrip(scheme, {
      getAssignment: 'assignment_arrived_at_pickup',
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'offline' : PICKUP_CODE_LOCKED),
    });
    await screen.findByText('Check the bag has 3 items');
    fireEvent.changeText(screen.getByTestId('trip-pickup-code-field'), '7314');
    fireEvent.press(screen.getByText("I've got the food"));
    await screen.findByText('Step 3 of 4 · Go to the customer');
    await act(async () => {
      await outbox.drain();
    });
    await screen.findByText('Too many wrong codes');
    expect(screen.queryByTestId('trip-rejected-code-input-field')).toBeNull();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
  });

  it('another saved step refused on replay: QueuedRejected, Continue from here drops it', async () => {
    renderTrip(scheme, {
      getAssignment: (_c, nth) => (nth === 0 ? 'assignment_en_route_to_pickup' : 'assignment_picked_up'),
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'offline' : INVALID_TRANSITION('PICKED_UP')),
    });
    fireEvent.press(await screen.findByText("I'm at the restaurant"));
    await screen.findByText('Wait for the food', {}, { timeout: 3000 }).catch(() => screen.findByText('Check the bag has 3 items'));
    await act(async () => {
      await outbox.drain();
    });
    await screen.findByText("A step you saved offline wasn't accepted");
    expect(screen.getByText(/^You tapped "I'm at the restaurant" at .*, but by then the delivery was at a different step on our side\.$/)).toBeTruthy();
    expect(screen.getByText('Picked up')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue from here'));
    await waitFor(() => expect(outbox.snapshot()).toHaveLength(0));
  });
});

describe.each(SCHEMES)('contact (%s)', (scheme) => {
  it('before pickup: the restaurant only, and no messages yet', async () => {
    renderTrip(scheme, { getAssignment: 'assignment_en_route_to_pickup' });
    fireEvent.press(await screen.findByText('See all messages'));
    await screen.findByText('Before pickup · HG-PIUP-9X');
    expect(screen.getByText('Call Karachi Kitchen')).toBeTruthy();
    expect(screen.queryByText('Call Ayesha R.')).toBeNull();
    expect(screen.getByText("They don't see your real number.")).toBeTruthy();
    expect(screen.getByText('No messages yet')).toBeTruthy();
  });

  it('no numbers: calling is not available', async () => {
    renderTrip(scheme, { getAssignment: assignment('assignment_arrived_at_pickup', { arrived_pickup_at: minutesAgo(1) }, { phone_alias: null, order_state: 'PREPARING' }) });
    fireEvent.press(await screen.findByText('See all messages'));
    await screen.findByText("Calling isn't available for this order right now.");
  });
});

/** The arrived fixture, preparing, as seen while a queued arrival has not reached the server. */
function PREPARING_AS(state: string) {
  return assignment('assignment_arrived_at_pickup', { state, arrived_pickup_at: null }, { order_state: 'PREPARING' });
}

