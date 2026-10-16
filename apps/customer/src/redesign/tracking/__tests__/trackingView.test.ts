/**
 * The words and rules of the tracking page, without rendering it: the arrival window, the
 * headline per state, where the rider card shows, and what counts as an open report.
 */
import type { Schema } from '@hg/api-client';

import {
  deliveryCodeOf,
  dispatchNoticeOf,
  etaOf,
  headlineOf,
  isLiveLayout,
  isWaitingLayout,
  meetOf,
  openReportOf,
  riderCardOf,
  riderNameOf,
  spokenCode,
} from '../trackingView';

const ETA = etaOf('2026-09-28T19:10:00-04:00', 10);
const YUSUF = riderNameOf({ first_name: 'Yusuf', last_initial: 'A' });

describe('layouts', () => {
  it('draws the waiting and live states and none of the rest', () => {
    for (const s of ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING']) expect(isWaitingLayout(s)).toBe(true);
    for (const s of ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']) expect(isLiveLayout(s)).toBe(true);
    for (const s of ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'DISPUTED', 'RESOLVED']) {
      expect(isWaitingLayout(s) || isLiveLayout(s)).toBe(false);
    }
  });
});

describe('arrival window', () => {
  it('is eta_at to eta_at plus the window, in Toronto time, 12-hour', () => {
    expect(ETA).toEqual({ text: '7:10–7:20 pm', spoken: 'between 7:10 and 7:20 pm' });
  });
  it('is one time when the server sent no window, and nothing when it sent no estimate', () => {
    expect(etaOf('2026-09-28T19:10:00-04:00', null)?.text).toBe('7:10 pm');
    expect(etaOf(null, 10)).toBeNull();
    expect(etaOf('not a time', 10)).toBeNull();
  });
});

describe('headline', () => {
  const base = { dispatchState: null, deadlineAt: null, stale: false, riderName: 'Yusuf', meet: 'door' as const };
  it('says the state and the window', () => {
    const h = headlineOf({ ...base, state: 'PICKED_UP', eta: ETA });
    expect(h.overline).toBe('On the way · Arriving');
    expect(h.display).toBe('7:10–7:20 pm');
    expect(h.spoken).toBe('On the way, arriving between 7:10 and 7:20 pm');
  });
  it('calls the estimate the last one when the page is showing old data', () => {
    const h = headlineOf({ ...base, state: 'PICKED_UP', eta: ETA, stale: true });
    expect(h.overline).toBe('On the way · Last estimate');
    expect(h.spoken).toContain('last estimate');
  });
  it('has no "calculating" state: no estimate means the state alone', () => {
    const h = headlineOf({ ...base, state: 'PREPARING', eta: null });
    expect(h).toEqual({ overline: null, display: 'Being prepared', spoken: 'Being prepared', secondary: null });
  });
  it('makes the state the headline while no rider is found, with the last estimate underneath', () => {
    const h = headlineOf({ ...base, state: 'READY_FOR_PICKUP', eta: ETA, dispatchState: 'NO_RIDER_FOUND', deadlineAt: '2026-09-28T19:24:00-04:00' });
    expect(h.display).toBe('Finding a rider · Update by 7:24 pm');
    expect(h.secondary).toBe('Last estimate 7:10–7:20 pm');
  });
  it('names the rider and where they are on arrival', () => {
    expect(headlineOf({ ...base, state: 'ARRIVED', eta: ETA }).display).toBe('Yusuf is at your door');
    expect(headlineOf({ ...base, state: 'ARRIVED', eta: ETA, meet: 'lobby' }).display).toBe('Yusuf is in the lobby');
    expect(headlineOf({ ...base, state: 'ARRIVED', eta: ETA, riderName: null }).display).toBe('Your rider is at your door');
  });
});

describe('handover', () => {
  it('reads where to meet from the delivery instructions, leaving it at the door by default', () => {
    expect(meetOf(['MEET_IN_LOBBY'])).toBe('lobby');
    expect(meetOf(['MEET_AT_DOOR', 'DO_NOT_CALL'])).toBe('door');
    expect(meetOf(['LEAVE_AT_DOOR'])).toBe('leave');
    expect(meetOf(undefined)).toBe('leave');
  });
  it('accepts only a four-digit code and speaks it digit by digit', () => {
    expect(deliveryCodeOf('4826')).toBe('4826');
    for (const bad of [null, undefined, '', '482', '48261', 'abcd']) expect(deliveryCodeOf(bad)).toBeNull();
    expect(spokenCode('4826')).toBe('Delivery code: 4, 8, 2, 6');
  });
});

describe('rider card', () => {
  const input = { restaurantName: 'Zaytoun Grill', rider: YUSUF };
  it('uses a first name and last initial only', () => {
    expect(YUSUF).toEqual({ first: 'Yusuf', full: 'Yusuf A.' });
    expect(riderNameOf({ first_name: '  ', last_initial: 'A' })).toBeNull();
  });
  it('is a search while preparing and no rider is assigned yet', () => {
    expect(riderCardOf({ ...input, state: 'PREPARING', dispatchState: 'SEARCHING' })?.kind).toBe('finding');
  });
  it('shows the assigned rider, and never a map pin promise before pickup', () => {
    const c = riderCardOf({ ...input, state: 'READY_FOR_PICKUP', dispatchState: 'AT_RESTAURANT' });
    expect(c?.title).toBe('Yusuf A. is at Zaytoun Grill');
    expect(c?.body).toContain('once your food is picked up');
  });
  it('names the rider on the way, and draws nothing on arrival (the headline names them)', () => {
    expect(riderCardOf({ ...input, state: 'PICKED_UP', dispatchState: 'CARRYING' })?.title).toBe('Yusuf A. is bringing your order');
    expect(riderCardOf({ ...input, state: 'ARRIVED', dispatchState: 'AT_CUSTOMER' })).toBeNull();
  });
});

describe('notices and reports', () => {
  it('words the escalation without blame', () => {
    expect(dispatchNoticeOf('READY_FOR_PICKUP', 'UNASSIGNED', null)?.title).toBe('Finding you another rider');
    const none = dispatchNoticeOf('READY_FOR_PICKUP', 'NO_RIDER_FOUND', '2026-09-28T19:24:00-04:00');
    expect(none?.description).toContain("We'll update you by 7:24 pm.");
    expect(none?.description).toContain('full refund');
    expect(dispatchNoticeOf('PREPARING', 'NO_RIDER_FOUND', null)).toBeNull();
  });
  it('shows a report only while a person has yet to decide it', () => {
    const refund = (state: Schema['RefundState'], reason: Schema['RefundReasonCode']) =>
      ({ state, reason_code: reason, requested_at: '2026-09-28T19:05:00-04:00' }) as Schema['Refund'];
    expect(openReportOf([refund('PENDING_APPROVAL', 'CUSTOMER_CHANGED_MIND')])).toEqual({ reason: 'I want to cancel', sentAt: '7:05 pm' });
    expect(openReportOf([refund('REQUESTED', 'WRONG_ADDRESS')])?.reason).toBe('Something else');
    expect(openReportOf([refund('SUCCEEDED', 'LATE_DELIVERY'), refund('DECLINED', 'OTHER')])).toBeNull();
  });
});
