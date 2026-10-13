/**
 * WP5 steps 3 and 4 and the handover, against the contract's fixtures, light and dark.
 *
 * Pins: EN_ROUTE_TO_DROPOFF is posted by itself after the pickup; "I'm here" posts
 * ARRIVED_AT_DROPOFF with a position, through the outbox (offline it is saved and the bag stays
 * with the rider: proof needs a connection); 422 GEOFENCE_REQUIRED never strands the rider; a
 * "Try again" is the same request; the heading and rows come from `delivery_instructions`; the
 * handover lists only what the proof allows, nothing pre-selected. No halal badge, no seal.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  ID,
  apiError,
  goOffline,
  keys,
  renderDropoff,
  transitions,
  withDropoff,
} from './harness';
import { outbox } from '../../data/outbox';
import { SCHEMES } from '../../test/render';

const FORBIDDEN_WORDS = /halal|seal|scan/i;
const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled;

describe.each(SCHEMES)('step 3, go to the customer (%s)', (scheme) => {
  it('populated: the customer, the full address, unit and buzzer, what they asked, the proof needed', async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff');
    await screen.findByText('Go to Ayesha R.');
    expect(screen.getByText('Step 3 of 4 · Go to the customer')).toBeTruthy();
    expect(screen.getByText('88 Harbour Street, Toronto, ON M5J 0C3')).toBeTruthy();
    expect(screen.getByText('Unit 4211')).toBeTruthy();
    expect(screen.getByText('4211')).toBeTruthy();
    expect(screen.getByText('Customer asked')).toBeTruthy();
    expect(screen.getByText('Leave at the door')).toBeTruthy();
    expect(screen.getByText("Don't ring the bell")).toBeTruthy();
    expect(screen.getByText('"Please leave it on the mat, not the shoe rack."')).toBeTruthy();
    expect(screen.getByText('A photo at the door')).toBeTruthy();
    expect(screen.getByText('Call customer')).toBeTruthy();
    expect(screen.getByText("I'm here")).toBeTruthy();
    expect(screen.queryByText(FORBIDDEN_WORDS)).toBeNull();
    // Already on the way: nothing is posted until the rider taps.
    expect(transitions(api)).toHaveLength(0);
  });

  it('Navigate opens the maps app at the customer; Call customer dials the proxy number', async () => {
    const { openURL } = renderDropoff(scheme, 'assignment_en_route_to_dropoff');
    fireEvent.press(await screen.findByText('Navigate'));
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('destination=43.6412,-79.381'));
    fireEvent.press(screen.getByText('Call customer'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550233');
  });

  it('a house with no instructions: no unit, no buzzer, no "Customer asked"', async () => {
    renderDropoff(scheme, 'assignment_no_instructions_no_unit');
    await screen.findByText('Go to Omar F.');
    expect(screen.queryByText('Customer asked')).toBeNull();
    expect(screen.queryByText('Unit')).toBeNull();
    expect(screen.queryByText('Buzzer')).toBeNull();
  });

  it('meet in the lobby, do not call: the heading says so and Call is demoted under a line', async () => {
    const { openURL } = renderDropoff(
      scheme,
      withDropoff('assignment_en_route_to_dropoff', { required_pod_method: 'OTP' }, { delivery_instructions: ['MEET_IN_LOBBY', 'DO_NOT_CALL'] }),
    );
    await screen.findByText('Meet Ayesha R. in the lobby');
    expect(screen.getByText("Please don't call")).toBeTruthy();
    expect(screen.getByText("The customer's code")).toBeTruthy();
    expect(screen.getByText("They asked not to be called. Call only if you can't find them.")).toBeTruthy();
    expect(screen.queryByText('Call customer')).toBeNull();
    fireEvent.press(screen.getByText('Call Ayesha R.'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550233');
  });

  it('PICKED_UP: EN_ROUTE_TO_DROPOFF is posted once, by itself, with a position', async () => {
    const { api } = renderDropoff(scheme, 'assignment_picked_up', { createAssignmentTransition: 'assignment_en_route_to_dropoff' });
    await screen.findByText('Go to Ayesha R.');
    await waitFor(() => expect(transitions(api)).toHaveLength(1));
    expect(transitions(api)[0]).toEqual({
      to_state: 'EN_ROUTE_TO_DROPOFF',
      latitude: 43.6817,
      longitude: -79.3403,
      accuracy_m: 6,
      occurred_at: expect.any(String),
    });
  });

  it("I'm here posts ARRIVED_AT_DROPOFF and lands at the door", async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff', { createAssignmentTransition: 'assignment_arrived_at_dropoff' });
    fireEvent.press(await screen.findByText("I'm here"));
    await screen.findByText("Leave it at Ayesha R.'s door");
    expect(transitions(api)).toEqual([
      { to_state: 'ARRIVED_AT_DROPOFF', latitude: 43.6817, longitude: -79.3403, accuracy_m: 6, occurred_at: expect.any(String) },
    ]);
    expect(keys(api)[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Step 4 of 4 · Hand it over')).toBeTruthy();
    expect(screen.getByText('Put the bag down, take the photo, then mark it as delivered.')).toBeTruthy();
    expect(screen.getByText('Hand it over')).toBeTruthy();
  });

  it('arriving: "Recording that you\'re here" while the step is in flight', async () => {
    renderDropoff(scheme, 'assignment_en_route_to_dropoff', { createAssignmentTransition: 'pending' });
    fireEvent.press(await screen.findByText("I'm here"));
    expect(await screen.findByText("Recording that you're here")).toBeTruthy();
    expect(screen.getByText('Stay where you are until this finishes.')).toBeTruthy();
  });

  it('arrival 5xx: the banner, and Try again is the same request (key and body)', async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff', {
      createAssignmentTransition: (_c, nth) => (nth === 0 ? 'error_internal_error' : 'assignment_arrived_at_dropoff'),
    });
    fireEvent.press(await screen.findByText("I'm here"));
    await screen.findByText("We couldn't record that you're here");
    expect(screen.getByText('Something went wrong on our side. Try again. You can still call Ayesha R.')).toBeTruthy();
    fireEvent.press(screen.getByText("I'm here"));
    await screen.findByText("Leave it at Ayesha R.'s door");
    expect(keys(api)[1]).toBe(keys(api)[0]);
    expect(transitions(api)[1]).toEqual(transitions(api)[0]);
  });

  it('PICKED_UP and the automatic start failed: "I\'m here" resends it (same key) before the arrival', async () => {
    const { api } = renderDropoff(scheme, 'assignment_picked_up', {
      createAssignmentTransition: (c, nth) =>
        nth === 0 ? 'error_internal_error' : (c.body as { to_state: string }).to_state === 'EN_ROUTE_TO_DROPOFF' ? 'assignment_en_route_to_dropoff' : 'assignment_arrived_at_dropoff',
    });
    await waitFor(() => expect(transitions(api)).toHaveLength(1));
    fireEvent.press(await screen.findByText("I'm here"));
    await screen.findByText("Leave it at Ayesha R.'s door");
    expect(transitions(api).map((t) => t.to_state)).toEqual(['EN_ROUTE_TO_DROPOFF', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_AT_DROPOFF']);
    expect(keys(api)[1]).toBe(keys(api)[0]);
  });

  it('422 GEOFENCE_REQUIRED: the sheet, a reason of 5+ characters, then the arrival with override_reason', async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff', {
      createAssignmentTransition: (_c, nth) => (nth === 0 ? apiError(422, 'GEOFENCE_REQUIRED') : 'assignment_arrived_at_dropoff'),
    });
    fireEvent.press(await screen.findByText("I'm here"));
    await screen.findByText("We can't place you at the drop-off");
    expect(screen.getByText("Your location doesn't show you at 88 Harbour Street. If you're there, say why and carry on.")).toBeTruthy();
    expect(disabled('dropoff-geofence-continue')).toBe(true);
    fireEvent.changeText(screen.getByTestId('dropoff-geofence-reason-field'), 'Side door');
    expect(disabled('dropoff-geofence-continue')).toBe(false);
    fireEvent.press(screen.getByText("Continue: I'm here"));
    await screen.findByText("Leave it at Ayesha R.'s door");
    expect(transitions(api)[1]).toMatchObject({ to_state: 'ARRIVED_AT_DROPOFF', override_reason: 'Side door' });
  });

  it('"I\'m not there yet" closes the geofence sheet and sends nothing more', async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff', { createAssignmentTransition: apiError(422, 'GEOFENCE_REQUIRED') });
    fireEvent.press(await screen.findByText("I'm here"));
    fireEvent.press(await screen.findByText("I'm not there yet"));
    await waitFor(() => expect(screen.queryByText("We can't place you at the drop-off")).toBeNull());
    expect(transitions(api)).toHaveLength(1);
  });

  it("Something's wrong opens the drop-off leg's sheet (WP6)", async () => {
    renderDropoff(scheme, 'assignment_en_route_to_dropoff');
    fireEvent.press(await screen.findByText("Something's wrong"));
    expect((await screen.findByTestId('wp6-probe')).props.children).toBe(`tripException:${JSON.stringify({ assignmentId: ID, leg: 'dropoff' })}`);
  });

  it('RETURNING belongs to the return leg (WP6)', async () => {
    renderDropoff(scheme, 'assignment_returning');
    expect((await screen.findByTestId('wp6-probe')).props.children).toMatch(/^tripReturn:/);
  });
});

describe.each(SCHEMES)('step 4, at the door (%s)', (scheme) => {
  it('populated: the heading from the instructions, the rows under it, the address, the line for the proof', async () => {
    renderDropoff(scheme, 'assignment_arrived_at_dropoff');
    await screen.findByText("Leave it at Ayesha R.'s door");
    expect(screen.getByText('Leave at the door')).toBeTruthy();
    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('88 Harbour Street, Toronto, ON M5J 0C3')).toBeTruthy();
    expect(disabled('dropoff-hand-over')).toBeFalsy();
    expect(screen.queryByText(FORBIDDEN_WORDS)).toBeNull();
  });

  it('a met handover: "Hand over to …" and the code line', async () => {
    renderDropoff(scheme, 'assignment_otp_pod_required');
    await screen.findByText('Hand over to Ayesha R.');
    expect(screen.getByText('Ask Ayesha R. for their 4-digit code.')).toBeTruthy();
  });

  it("offline at the door: keep the bag, Hand it over waits for the connection (TripNoConnection)", async () => {
    const { api } = renderDropoff(scheme, (_c, nth) => (nth === 0 ? 'assignment_arrived_at_dropoff' : 'offline'));
    await screen.findByText("Keep the bag until you're back online");
    expect(screen.getByText('The proof needs a connection. Step outside or toward a window, then carry on. Call Ayesha R. to say you\'re here.')).toBeTruthy();
    expect(screen.getByText('No internet connection')).toBeTruthy();
    expect(screen.getByText('Turns on when your connection is back.')).toBeTruthy();
    expect(disabled('dropoff-hand-over')).toBe(true);
    expect(screen.getByText('Call Ayesha R.')).toBeTruthy();
    expect(api.callsTo('submitProofOfDelivery')).toHaveLength(0);
  });

  it('arrival saved offline: "Not sent yet" with the step and its time, the bag stays, nothing else is sent', async () => {
    const { api } = renderDropoff(scheme, 'assignment_en_route_to_dropoff', { createAssignmentTransition: 'offline' });
    fireEvent.press(await screen.findByText("I'm here"));
    goOffline(api);
    await screen.findByText("Keep the bag until you're back online");
    expect(screen.getAllByText('Not sent yet').length).toBeGreaterThan(0);
    expect(screen.getByText(/^I'm here · \d{1,2}:\d{2} (am|pm)$/)).toBeTruthy();
    expect(screen.getByText('The proof needs a connection. Step outside or toward a window.')).toBeTruthy();
    expect(disabled('dropoff-hand-over')).toBe(true);
    expect(outbox.snapshot().map((e) => e.input.to_state)).toEqual(['ARRIVED_AT_DROPOFF']);
    expect(api.callsTo('submitProofOfDelivery')).toHaveLength(0);
  });

  it('load failed with no answer yet: the trip load-failed board with Try again', async () => {
    renderDropoff(scheme, 'error_internal_error');
    expect(await screen.findByText("We couldn't load this delivery")).toBeTruthy();
  });
});

describe.each(SCHEMES)('hand it over (%s)', (scheme) => {
  it('photo proof: all four ways, nothing pre-selected, then "Next: take the photo"', async () => {
    renderDropoff(scheme, 'assignment_arrived_at_dropoff');
    fireEvent.press(await screen.findByText('Hand it over'));
    await screen.findByText('How will you hand it over?', { exact: true });
    for (const label of ['To the customer', 'Leave it at the door', 'Leave it with reception or concierge', 'To someone else at the address']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Step 4 of 4 · HG-PIUP-9X')).toBeTruthy();
    expect(screen.getByText('Proof needed next')).toBeTruthy();
    expect(screen.getByText('Choose how you will hand it over')).toBeTruthy();
    expect(disabled('dropoff-handover-next')).toBe(true);
    fireEvent.press(screen.getByText('Leave it at the door'));
    fireEvent.press(await screen.findByText('Next: take the photo'));
    expect(await screen.findByText('Take a photo of the bag at the door')).toBeTruthy();
  });

  it("the customer's code: met handovers only, then \"Next: enter the customer's code\"", async () => {
    renderDropoff(scheme, 'assignment_otp_pod_required');
    fireEvent.press(await screen.findByText('Hand it over'));
    await screen.findByText("This order needs the customer's code. Keep hold of the bag until their code is accepted.");
    expect(screen.getByText('The customer')).toBeTruthy();
    expect(screen.getByText('Someone else at the address')).toBeTruthy();
    expect(screen.queryByText('Leave it at the door')).toBeNull();
    expect(screen.getByText('Choose who you will hand it to')).toBeTruthy();
    fireEvent.press(screen.getByText('The customer'));
    fireEvent.press(await screen.findByText("Next: enter the customer's code"));
    expect(await screen.findByText('Ask the customer for their 4-digit code')).toBeTruthy();
  });

  it('photo and a statement: "Next: photo and a short statement"', async () => {
    renderDropoff(scheme, withDropoff('assignment_arrived_at_dropoff', { required_pod_method: 'PHOTO_WITH_ATTESTATION' }));
    fireEvent.press(await screen.findByText('Hand it over'));
    expect(await screen.findByText('A photo and a short statement')).toBeTruthy();
    fireEvent.press(screen.getByText('To the customer'));
    expect(await screen.findByText('Next: photo and a short statement')).toBeTruthy();
  });
});
