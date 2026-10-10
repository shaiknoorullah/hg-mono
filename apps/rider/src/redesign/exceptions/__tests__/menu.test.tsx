/**
 * WP6 R30 Something's wrong and R31 Can't deliver, against the contract's fixtures, light and dark.
 *
 * Pins: every leg's sheet has 911 first, support only when it is on, the other party's private
 * number; "I can't deliver" only on the drop-off legs; Back to the delivery sends nothing and
 * returns to the step; "Return it to the restaurant" posts UNDELIVERABLE with a position (no
 * reason field: the contract has none) and RETURNING follows by itself; a retry is the same
 * request; offline both are saved, in order; a customer who asked for LEAVE_AT_DOOR gets the
 * photo-and-statement proof first. No halal badge, no seal.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  ID,
  RETURN_ANSWERS,
  SUPPORT_OFF,
  apiError,
  byState,
  goOffline,
  keys,
  renderExceptions,
  transitions,
  withDropoff,
} from './harness';
import { outbox } from '../../data/outbox';
import { SCHEMES } from '../../test/render';

const FORBIDDEN_WORDS = /\bhalal\b|seal|scan/i;
const EN_ROUTE = 'assignment_en_route_to_dropoff';
const AT_DOOR = 'assignment_arrived_at_dropoff';

/** Open the leg's sheet from the step on screen. */
async function openMenu(step: string) {
  await screen.findByText(step);
  fireEvent.press(screen.getByText("Something's wrong"));
  return screen.findByText("What's wrong?");
}

async function openCantDeliver(step: string) {
  await openMenu(step);
  fireEvent.press(screen.getByText("I can't deliver this order"));
  return screen.findByText("Can't deliver this order?");
}

describe.each(SCHEMES)("Something's wrong (%s)", (scheme) => {
  it('drop-off leg: 911 first, support with its hours, the customer, I can\'t deliver; Back sends nothing', async () => {
    const { api, openURL } = renderExceptions(scheme, EN_ROUTE);
    await openMenu('Go to Ayesha R.');
    expect(screen.getByText('Step 3 of 4 · Go to the customer')).toBeTruthy();
    expect(screen.getByText('In danger or hurt? Call 911 first.')).toBeTruthy();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
    expect(screen.getByText(/^1 \d{3} \d{3} \d{4}/)).toBeTruthy();
    expect(screen.getByText('Call Ayesha R.')).toBeTruthy();
    expect(screen.getByText("I can't deliver this order")).toBeTruthy();
    expect(screen.queryByText(FORBIDDEN_WORDS)).toBeNull();
    fireEvent.press(screen.getByText('Call 911'));
    expect(openURL).toHaveBeenCalledWith('tel:911');
    fireEvent.press(screen.getByText('Call Ayesha R.'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550233');
    fireEvent.press(screen.getByText('Back to the delivery'));
    await screen.findByText("I'm here");
    expect(screen.queryByText("What's wrong?")).toBeNull();
    expect(transitions(api)).toHaveLength(0);
  });

  it('support off: no support row at all; 911 and the customer stay', async () => {
    renderExceptions(scheme, EN_ROUTE, { getPublicConfig: SUPPORT_OFF });
    await openMenu('Go to Ayesha R.');
    expect(screen.queryByText('Call HalalGoes support')).toBeNull();
    expect(screen.getByText('Call 911')).toBeTruthy();
    expect(screen.getByText('Call Ayesha R.')).toBeTruthy();
  });

  it("pickup leg (WP4's step opens this menu): the restaurant and the release line, no I can't deliver", async () => {
    const { openURL } = renderExceptions(scheme, 'assignment_en_route_to_pickup');
    await openMenu('Go to Karachi Kitchen');
    expect(screen.getByText('Step 1 of 4 · Go to the restaurant')).toBeTruthy();
    expect(screen.getByText(/only HalalGoes can move the order to another rider/)).toBeTruthy();
    expect(screen.queryByText("I can't deliver this order")).toBeNull();
    expect(screen.queryByText('Call Ayesha R.')).toBeNull();
    fireEvent.press(screen.getByText('Call Karachi Kitchen'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550188');
    fireEvent.press(screen.getByText('Back to the delivery'));
    await screen.findByText("I'm at the restaurant");
  });

  it('the delivery is cancelled while the sheet is open: the ending takes over', async () => {
    let cancelled = false;
    renderExceptions(scheme, () => (cancelled ? 'assignment_cancelled_by_platform' : EN_ROUTE));
    await openMenu('Go to Ayesha R.');
    cancelled = true;
    await screen.findByText('HalalGoes cancelled this order', {}, { timeout: 8000 });
  }, 12000);
});

describe.each(SCHEMES)("Can't deliver (%s)", (scheme) => {
  it('on the way: the return only; Keep going goes back and sends nothing', async () => {
    const { api } = renderExceptions(scheme, EN_ROUTE);
    await openCantDeliver('Go to Ayesha R.');
    expect(screen.getByText("Can't get this order to Ayesha R.? You can take it back to the restaurant. If you reach the address, more options open there.")).toBeTruthy();
    expect(screen.queryByText('Leave it at the door with a photo and a statement')).toBeNull();
    fireEvent.press(screen.getByText('Keep going'));
    await screen.findByText("I'm here");
    expect(transitions(api)).toHaveLength(0);
  });

  it('Return it to the restaurant: UNDELIVERABLE with a position and no reason, then RETURNING by itself', async () => {
    const { api } = renderExceptions(scheme, EN_ROUTE, { createAssignmentTransition: byState(RETURN_ANSWERS) });
    await openCantDeliver('Go to Ayesha R.');
    fireEvent.press(screen.getByText('Return it to the restaurant'));
    await screen.findByText('Take the food back to Karachi Kitchen');
    await waitFor(() => expect(transitions(api).map((t) => t.to_state)).toEqual(['UNDELIVERABLE', 'RETURNING']));
    const [undeliverable] = transitions(api);
    expect(Object.keys(undeliverable!).sort()).toEqual(['accuracy_m', 'latitude', 'longitude', 'occurred_at', 'to_state']);
    expect(new Set(keys(api)).size).toBe(2);
    expect(screen.getByText('Return the food')).toBeTruthy();
  });

  it('at the door, the customer asked for LEAVE_AT_DOOR: leave it with a photo and a statement first', async () => {
    const { api } = renderExceptions(scheme, AT_DOOR);
    await openCantDeliver("Leave it at Ayesha R.'s door");
    expect(screen.getByText('Step 4 of 4 · Hand it over')).toBeTruthy();
    expect(screen.getByText('Tried to reach Ayesha R. and can\'t hand it over? Ayesha R. asked for it to be left at the door.')).toBeTruthy();
    expect(screen.getByText('Leaving it at the door, as Ayesha R. asked, has no wait.')).toBeTruthy();
    expect(screen.getByText('Return it to the restaurant')).toBeTruthy();
    expect(screen.getByText('Keep trying')).toBeTruthy();
    fireEvent.press(screen.getByText('Leave it at the door with a photo and a statement'));
    // WP5's proof screen, as a photo and a statement, nothing sent yet.
    await screen.findByText('Ayesha R. asked for it to be left at the door. Take a photo of the bag where you left it and say what happened.');
    expect(transitions(api)).toHaveLength(0);
    // Back lands on the Can't deliver sheet it came from.
    fireEvent.press(screen.getByLabelText("Back to Can't deliver"));
    await screen.findByText("Can't deliver this order?");
  });

  it('at the door without LEAVE_AT_DOOR (or a code to collect): the return is the primary', async () => {
    renderExceptions(scheme, withDropoff(AT_DOOR, {}, { delivery_instructions: [] }));
    await openCantDeliver('Hand over to Ayesha R.');
    expect(screen.getByText("Tried to reach Ayesha R. and can't hand it over? You can take it back to the restaurant.")).toBeTruthy();
    expect(screen.queryByText('Leave it at the door with a photo and a statement')).toBeNull();
  });

  it('5xx: "We couldn\'t record that"; Try again is the same request (same key, same body)', async () => {
    let n = 0;
    const answers = { ...RETURN_ANSWERS, UNDELIVERABLE: () => (n++ === 0 ? 'error_internal_error' : 'assignment_undeliverable') };
    const { api } = renderExceptions(scheme, EN_ROUTE, { createAssignmentTransition: byState(answers) });
    await openCantDeliver('Go to Ayesha R.');
    fireEvent.press(screen.getByText('Return it to the restaurant'));
    await screen.findByText("We couldn't record that");
    expect(screen.getByText('Something went wrong on our side. Keep the food with you and try again.')).toBeTruthy();
    expect(screen.getByText('Call Ayesha R.')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Take the food back to Karachi Kitchen');
    const [first, second] = transitions(api);
    expect(second).toEqual(first);
    expect(keys(api)[1]).toBe(keys(api)[0]);
  });

  it("5xx, then Something's wrong: back to the leg's sheet", async () => {
    renderExceptions(scheme, EN_ROUTE, { createAssignmentTransition: 'error_internal_error' });
    await openCantDeliver('Go to Ayesha R.');
    fireEvent.press(screen.getByText('Return it to the restaurant'));
    await screen.findByText("We couldn't record that");
    fireEvent.press(screen.getByText("Something's wrong"));
    await screen.findByText("What's wrong?");
  });

  it('offline: "Can\'t deliver" is saved with its time and the return leg opens; RETURNING queues behind it', async () => {
    const { api } = renderExceptions(scheme, EN_ROUTE);
    await openCantDeliver('Go to Ayesha R.');
    goOffline(api);
    api.set('createAssignmentTransition', 'offline');
    fireEvent.press(screen.getByText('Return it to the restaurant'));
    await screen.findByText('Take the food back to Karachi Kitchen');
    expect(screen.getByText(`No internet connection. "Can't deliver" is saved on your phone with the time and sends by itself when you're back online. You can carry on.`)).toBeTruthy();
    expect(screen.getByText(/^Can't deliver · \d{1,2}:\d{2} [ap]m$/)).toBeTruthy();
    expect(screen.getByText(`Keep going to Karachi Kitchen. "I've returned it" saves on your phone with the time and sends when you're back online.`)).toBeTruthy();
    await waitFor(() => expect(outbox.pendingFor(ID).map((e) => e.input.to_state)).toEqual(['UNDELIVERABLE', 'RETURNING']));
  });

  it('409: the delivery had moved on; back to the step, re-read', async () => {
    const { api } = renderExceptions(scheme, EN_ROUTE, { createAssignmentTransition: apiError(409, 'INVALID_TRANSITION', { current_state: 'EN_ROUTE_TO_DROPOFF' }) });
    await openCantDeliver('Go to Ayesha R.');
    fireEvent.press(screen.getByText('Return it to the restaurant'));
    await screen.findByText('This delivery had already moved on');
    expect(screen.getByText("I'm here")).toBeTruthy();
    expect(api.callsTo('getAssignment').length).toBeGreaterThan(1);
  });
});
