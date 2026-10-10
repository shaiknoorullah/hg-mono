/**
 * WP6 R32 the trip ended: cancelled before and after pickup, moved to another rider before and
 * after pickup, delivered from elsewhere; and this WP's loading and error states. Against the
 * contract's fixtures (and literals derived from them, filed), light and dark.
 *
 * Pins: cancelled before pickup ends the trip and Back to Home closes the flow and forgets its
 * saved steps; the sentence follows the dashboard's mode; after pickup support is the primary
 * and the closing step sends nothing; a move to another rider claims no earnings; pay only from
 * a ledger line, never the offer estimate.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  CANCELLED_AFTER_PICKUP,
  ID,
  REASSIGNED_AFTER_PICKUP,
  SUPPORT_OFF,
  compensation,
  dashboardMode,
  renderExceptions,
  transitions,
} from './harness';
import { outbox } from '../../data/outbox';
import { registerScreen } from '../../nav/registry';
import { SCHEMES } from '../../test/render';

const CANCELLED = 'assignment_cancelled_by_platform';
const MOVED = 'assignment_reassigned';

describe.each(SCHEMES)('cancelled before pickup (%s)', (scheme) => {
  it("ends the trip: who cancelled, don't go to the restaurant, where it was going; no estimate", async () => {
    const { api } = renderExceptions(scheme, CANCELLED);
    await screen.findByText('HalalGoes cancelled this order');
    expect(screen.getByText('Order cancelled')).toBeTruthy();
    expect(screen.getByText('Order HG-PIUP-9X')).toBeTruthy();
    expect(screen.getByText("Don't go to Karachi Kitchen. You're back to waiting for offers.")).toBeTruthy();
    expect(screen.getByText('Was going to')).toBeTruthy();
    expect(screen.getByText('Harbour Street, Harbourfront')).toBeTruthy();
    expect(screen.queryByText('See messages about this order')).toBeNull();
    expect(screen.queryByText(/Call/)).toBeNull();
    expect(screen.queryByText(/11\.49/)).toBeNull();
    await waitFor(() => expect(api.callsTo('listRiderEarningEntries')).toHaveLength(1));
    expect(screen.queryByText('Paid for your time')).toBeNull();
    expect(transitions(api)).toHaveLength(0);
  });

  it('offline after it (go offline after this delivery): "You\'re offline now."', async () => {
    renderExceptions(scheme, CANCELLED);
    await screen.findByText('HalalGoes cancelled this order');
    dashboardMode('OFFLINE');
    expect(await screen.findByText("Don't go to Karachi Kitchen. You're offline now.")).toBeTruthy();
  });

  it('a ledger line for the time: "Paid for your time" with the amount as returned', async () => {
    renderExceptions(scheme, CANCELLED, { listRiderEarningEntries: compensation() });
    expect(await screen.findByText('Paid for your time')).toBeTruthy();
    expect(screen.getByText(/3\.50/)).toBeTruthy();
  });

  it('Back to Home closes the flow and forgets the saved steps', async () => {
    const { api } = renderExceptions(scheme, CANCELLED);
    const spy = jest.spyOn(outbox, 'clearAssignment');
    fireEvent.press(await screen.findByText('Back to Home'));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(spy).toHaveBeenCalledWith(ID);
    expect(transitions(api)).toHaveLength(0);
    spy.mockRestore();
  });
});

describe.each(SCHEMES)('cancelled after pickup (%s)', (scheme) => {
  it("don't deliver it; support is the primary with its hours; the restaurant is there too", async () => {
    const { openURL } = renderExceptions(scheme, CANCELLED_AFTER_PICKUP);
    await screen.findByText("Don't deliver it. You have the food with you.");
    expect(screen.getByText('HalalGoes cancelled this order')).toBeTruthy();
    expect(screen.getByText('The instruction for the food will appear here. Until then, call HalalGoes support and ask.')).toBeTruthy();
    expect(screen.getByText('You may get new offers once you leave this screen.')).toBeTruthy();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
    expect(screen.getByText("Done — I've dealt with the food")).toBeTruthy();
    expect(screen.getByText('Go offline')).toBeTruthy();
    expect(screen.queryByText('Back to Home')).toBeNull();
    expect(screen.queryByText('Paid for your time')).toBeNull();
    fireEvent.press(screen.getByText('Call Karachi Kitchen'));
    expect(openURL).toHaveBeenCalledWith('tel:+16475550188');
  });

  it('support off: calling the restaurant is the primary', async () => {
    renderExceptions(scheme, CANCELLED_AFTER_PICKUP, { getPublicConfig: SUPPORT_OFF });
    await screen.findByText("Don't deliver it. You have the food with you.");
    expect(screen.queryByText('Call HalalGoes support')).toBeNull();
    expect(screen.getByTestId('ex-call-restaurant')).toBeTruthy();
  });

  it('"Have you dealt with the food?" records nothing; "I\'ve dealt with the food" goes Home', async () => {
    const { api } = renderExceptions(scheme, CANCELLED_AFTER_PICKUP);
    fireEvent.press(await screen.findByText("Done — I've dealt with the food"));
    await screen.findByText('Have you dealt with the food?');
    expect(screen.getByText("What you did with the food isn't sent to HalalGoes. If you're not sure what to do with it, call support.")).toBeTruthy();
    fireEvent.press(screen.getByText("I've dealt with the food"));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(transitions(api)).toHaveLength(0);
    expect(api.callsTo('submitProofOfDelivery')).toHaveLength(0);
  });

  it('Go offline sets the rider offline (setRiderAvailability is_online false)', async () => {
    const { api } = renderExceptions(scheme, CANCELLED_AFTER_PICKUP, { setRiderAvailability: 'rider_availability_offline' });
    fireEvent.press(await screen.findByText('Go offline'));
    await waitFor(() => expect(api.callsTo('setRiderAvailability').map((c) => c.body)).toEqual([{ is_online: false }]));
  });
});

describe.each(SCHEMES)('moved to another rider (%s)', (scheme) => {
  it('before pickup: our team moved it; no earnings are claimed or asked for', async () => {
    const { api } = renderExceptions(scheme, MOVED);
    await screen.findByText('This delivery went to another rider');
    expect(screen.getByText('Delivery moved')).toBeTruthy();
    expect(screen.getByText("Our team moved it. You don't need to go to Karachi Kitchen. You're back to waiting for offers.")).toBeTruthy();
    expect(screen.queryByText(/11\.49/)).toBeNull();
    expect(screen.queryByText('Was going to')).toBeNull();
    expect(api.callsTo('listRiderEarningEntries')).toHaveLength(0);
    fireEvent.press(screen.getByText('Back to Home'));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
  });

  it('after pickup: keep the bag; support first; "Have you handed the bag over?" records nothing', async () => {
    const { api } = renderExceptions(scheme, REASSIGNED_AFTER_PICKUP);
    await screen.findByText("Keep the bag with you. Don't deliver it or leave it anywhere.");
    expect(screen.getByText('Where to hand the bag over will appear here. Until then, call HalalGoes support and ask.')).toBeTruthy();
    expect(screen.getByText('Call HalalGoes support')).toBeTruthy();
    expect(screen.getByText('Call Karachi Kitchen')).toBeTruthy();
    expect(screen.queryByText('Call Ayesha R.')).toBeNull();
    fireEvent.press(screen.getByText("Done — I've handed the bag over"));
    await screen.findByText('Have you handed the bag over?');
    expect(screen.getByText("Handing the bag over isn't sent to HalalGoes. If you're not sure who to give it to, call support.")).toBeTruthy();
    fireEvent.press(screen.getByText("I've handed it over"));
    expect((await screen.findByTestId('home-probe')).props.children).toBe('home:tabs');
    expect(transitions(api)).toHaveLength(0);
    expect(api.callsTo('listRiderEarningEntries')).toHaveLength(0);
  });
});

/** WP5's Delivered stands in as a probe: the test only needs to see the route and its params. */
function DeliveredProbe({ params }: { params: { method: string } }) {
  return <Text testID="delivered-probe">{params.method}</Text>;
}

describe.each(SCHEMES)('the trip ended elsewhere, and this screen loading (%s)', (scheme) => {
  it('DELIVERED (support confirmed it): WP5\'s Delivered screen, with the proof the order needed', async () => {
    registerScreen('tripDelivered', { component: DeliveredProbe as never, back: 'none' });
    renderExceptions(scheme, 'assignment_delivered');
    expect((await screen.findByTestId('delivered-probe')).props.children).toBe('PHOTO');
  });

  it('a failed read: "We couldn\'t load this delivery" and Try again', async () => {
    let n = 0;
    renderExceptions(scheme, () => (n++ === 0 ? 'error_internal_error' : CANCELLED));
    await screen.findByText("We couldn't load this delivery");
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('HalalGoes cancelled this order');
  });
});
