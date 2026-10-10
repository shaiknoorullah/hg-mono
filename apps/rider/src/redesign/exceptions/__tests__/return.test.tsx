/**
 * WP6 R31 the return leg and Returned, against the contract's fixtures, light and dark.
 *
 * Pins: RETURNING is posted once by itself on UNDELIVERABLE; "I've returned it" posts RETURNED
 * through the outbox with a position; a retry is the same request; 422 GEOFENCE_REQUIRED takes
 * an `override_reason` and never strands the rider; offline it is saved and Back to Home leaves it
 * to send; Returned makes no promise of pay and shows a ledger line only when one exists.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ID, RETURN_ANSWERS, apiError, byState, compensation, goOffline, keys, renderExceptions, transitions } from './harness';
import { outbox } from '../../data/outbox';
import { SCHEMES } from '../../test/render';

const RETURNING = 'assignment_returning';
const returnedSteps = (api: Parameters<typeof transitions>[0]) => transitions(api).filter((t) => t.to_state === 'RETURNED');

describe.each(SCHEMES)('the return leg (%s)', (scheme) => {
  it('populated: the restaurant, its address, the order code; Navigate and Call restaurant; no customer, nothing sent', async () => {
    const { api, openURL } = renderExceptions(scheme, RETURNING);
    await screen.findByText('Take the food back to Karachi Kitchen');
    expect(screen.getByText('Return the food')).toBeTruthy();
    expect(screen.getByText('Order HG-PIUP-9X')).toBeTruthy();
    expect(screen.getByText('1245 Danforth Avenue, Toronto, ON M4J 1M4')).toBeTruthy();
    expect(screen.getByText("The order couldn't be delivered. Hand the bag to the counter staff and say it's a return for this order code.")).toBeTruthy();
    expect(screen.getByText('HG-PIUP-9X')).toBeTruthy();
    expect(screen.queryByText(/Ayesha/)).toBeNull();
    fireEvent.press(screen.getByText('Navigate'));
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('destination=43.6817,-79.3403'));
    fireEvent.press(screen.getByText('Call restaurant'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550188');
    expect(transitions(api)).toHaveLength(0);
  });

  it('UNDELIVERABLE: RETURNING is posted once, by itself', async () => {
    const { api } = renderExceptions(scheme, 'assignment_undeliverable', { createAssignmentTransition: byState(RETURN_ANSWERS) });
    await screen.findByText('Take the food back to Karachi Kitchen');
    await waitFor(() => expect(transitions(api).map((t) => t.to_state)).toEqual(['RETURNING']));
  });

  it("I've returned it: RETURNED with a position, then Returned; no promise of pay, the street only", async () => {
    const { api } = renderExceptions(scheme, RETURNING, { createAssignmentTransition: byState(RETURN_ANSWERS) });
    fireEvent.press(await screen.findByText("I've returned it"));
    await screen.findByText('Returned to Karachi Kitchen');
    expect(screen.getByText('Food returned')).toBeTruthy();
    expect(screen.getByText('This delivery is closed.')).toBeTruthy();
    expect(screen.getByText('Was going to')).toBeTruthy();
    expect(screen.getByText('Harbour Street, Toronto')).toBeTruthy();
    expect(screen.queryByText(/88 Harbour/)).toBeNull();
    expect(screen.queryByText('Call restaurant')).toBeNull();
    expect(screen.queryByText('Paid for your time')).toBeNull();
    expect(screen.queryByText(/11\.49/)).toBeNull();
    const [step] = returnedSteps(api);
    expect(step).toMatchObject({ to_state: 'RETURNED', latitude: 43.6817, longitude: -79.3403, accuracy_m: 6 });
    expect(step!.override_reason).toBeUndefined();
  });

  it('returned with a ledger line: "Paid for your time", the amount as returned', async () => {
    renderExceptions(scheme, 'assignment_returned', { listRiderEarningEntries: compensation() });
    await screen.findByText('Returned to Karachi Kitchen');
    expect(await screen.findByText('Paid for your time')).toBeTruthy();
    expect(screen.getByText(/3\.50/)).toBeTruthy();
    expect(screen.queryByText(/11\.49/)).toBeNull();
  });

  it('Back to Home closes the trip and forgets its saved steps', async () => {
    renderExceptions(scheme, 'assignment_returned');
    const spy = jest.spyOn(outbox, 'clearAssignment');
    fireEvent.press(await screen.findByText('Back to Home'));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(spy).toHaveBeenCalledWith(ID);
    spy.mockRestore();
  });

  it('5xx: "We couldn\'t record the return"; Try again is the same request (same key, same body)', async () => {
    let n = 0;
    const answers = { ...RETURN_ANSWERS, RETURNED: () => (n++ === 0 ? 'error_internal_error' : 'assignment_returned') };
    const { api } = renderExceptions(scheme, RETURNING, { createAssignmentTransition: byState(answers) });
    fireEvent.press(await screen.findByText("I've returned it"));
    await screen.findByText("We couldn't record the return");
    expect(screen.getByText('Something went wrong on our side. Try again before you leave the restaurant.')).toBeTruthy();
    expect(screen.getByText('HG-PIUP-9X')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Returned to Karachi Kitchen');
    const [first, second] = returnedSteps(api);
    expect(second).toEqual(first);
    expect(keys(api)[1]).toBe(keys(api)[0]);
  });

  it("5xx, then Something's wrong and back: still the failed return; Try again is the same request", async () => {
    let n = 0;
    const answers = { ...RETURN_ANSWERS, RETURNED: () => (n++ === 0 ? 'error_internal_error' : 'assignment_returned') };
    const { api } = renderExceptions(scheme, RETURNING, { createAssignmentTransition: byState(answers) });
    await screen.findByText('Take the food back to Karachi Kitchen');
    fireEvent.press(screen.getByText("I've returned it"));
    await screen.findByText("We couldn't record the return");
    fireEvent.press(screen.getByText("Something's wrong"));
    fireEvent.press(await screen.findByText('Back to the return'));
    await screen.findByText("We couldn't record the return");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Returned to Karachi Kitchen');
    const [first, second] = returnedSteps(api);
    expect(second).toEqual(first);
    expect(keys(api)[1]).toBe(keys(api)[0]);
  });

  it('422 GEOFENCE_REQUIRED: say what happened (5 characters at least), then it goes with the reason', async () => {
    let n = 0;
    const answers = { ...RETURN_ANSWERS, RETURNED: () => (n++ === 0 ? apiError(422, 'GEOFENCE_REQUIRED') : 'assignment_returned') };
    const { api } = renderExceptions(scheme, RETURNING, { createAssignmentTransition: byState(answers) });
    fireEvent.press(await screen.findByText("I've returned it"));
    await screen.findByText('You look far from Karachi Kitchen');
    expect(screen.getByText("If you've handed the food back, say what happened. Otherwise go to the restaurant first.")).toBeTruthy();
    expect(screen.getByText('At least 5 characters. For example: handed it to staff at the back door.')).toBeTruthy();
    expect(screen.getByTestId('return-geofence-confirm').props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('return-geofence-reason-field'), 'Back door staff');
    fireEvent.press(screen.getByText("Confirm: I've returned it"));
    await screen.findByText('Returned to Karachi Kitchen');
    expect(returnedSteps(api)[1]).toMatchObject({ to_state: 'RETURNED', override_reason: 'Back door staff' });
  });

  it('422 GEOFENCE_REQUIRED, then "Keep going to the restaurant": nothing more is sent', async () => {
    const { api } = renderExceptions(scheme, RETURNING, { createAssignmentTransition: apiError(422, 'GEOFENCE_REQUIRED') });
    fireEvent.press(await screen.findByText("I've returned it"));
    fireEvent.press(await screen.findByText('Keep going to the restaurant'));
    await waitFor(() => expect(screen.queryByText('You look far from Karachi Kitchen')).toBeNull());
    expect(transitions(api)).toHaveLength(1);
    expect(screen.getByText('Take the food back to Karachi Kitchen')).toBeTruthy();
  });

  it('offline: "I\'ve returned it" is saved; the delivery closes once it sends; Back to Home keeps it', async () => {
    const { api } = renderExceptions(scheme, RETURNING);
    await screen.findByText('Take the food back to Karachi Kitchen');
    goOffline(api);
    api.set('createAssignmentTransition', 'offline');
    fireEvent.press(screen.getByText("I've returned it"));
    await screen.findByText(`No internet connection. "I've returned it" is saved on your phone with the time and sends by itself when you're back online. The delivery closes once it has sent.`);
    expect(screen.getByText(/^Returned · \d{1,2}:\d{2} [ap]m$/)).toBeTruthy();
    expect(screen.getByText('Return the food')).toBeTruthy();
    const spy = jest.spyOn(outbox, 'clearAssignment');
    fireEvent.press(screen.getByText('Back to Home'));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(spy).not.toHaveBeenCalled();
    expect(outbox.pendingFor(ID).map((e) => e.input.to_state)).toEqual(['RETURNED']);
    spy.mockRestore();
  });

  it("Something's wrong on the way back: 911, support, the restaurant; no customer; Back to the return", async () => {
    renderExceptions(scheme, RETURNING);
    // The host passes through the drop-off step on its way here: wait for the return leg itself.
    await screen.findByText('Take the food back to Karachi Kitchen');
    fireEvent.press(screen.getByText("Something's wrong"));
    await screen.findByText("What's wrong?");
    expect(screen.getByText('Call 911')).toBeTruthy();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
    expect(screen.getByText('Call Karachi Kitchen')).toBeTruthy();
    expect(screen.queryByText('Call Ayesha R.')).toBeNull();
    expect(screen.queryByText("I can't deliver this order")).toBeNull();
    fireEvent.press(screen.getByText('Back to the return'));
    await screen.findByText("I've returned it");
  });
});
