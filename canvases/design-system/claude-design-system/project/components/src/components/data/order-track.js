/* The ONE shared mapping from the contract's 14 order states to each audience's vocabulary
   (02-components.md §23: "the mapping table lives in one shared module"). Ported from
   packages/ui-native/src/feedback/order-track.ts — keep the two in lockstep. */

export const ORDER_STATES = [
  'CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP',
  'ARRIVED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'DISPUTED', 'RESOLVED',
];

export const ORDER_STATE_LABELS = {
  CREATED: 'Created', AUTHORIZED: 'Payment authorised', RESTAURANT_PENDING: 'Sent to restaurant',
  PREPARING: 'Preparing', READY_FOR_PICKUP: 'Ready for pickup', PICKED_UP: 'Picked up',
  ARRIVED: 'Rider arrived', DELIVERED: 'Delivered', COMPLETED: 'Settled', CANCELLED: 'Cancelled',
  REJECTED: 'Rejected by restaurant', FAILED: 'Failed', DISPUTED: 'Disputed', RESOLVED: 'Dispute resolved',
};

const FAILURE = ['CANCELLED', 'REJECTED', 'FAILED'];

export const ORDER_TRACKS = {
  customer: { completeAt: ['DELIVERED', 'COMPLETED', 'RESOLVED'], steps: [
    { key: 'placed', label: 'Placed', states: ['CREATED', 'AUTHORIZED'] },
    { key: 'confirmed', label: 'Confirmed', currentLabel: 'Confirming', states: ['RESTAURANT_PENDING'] },
    { key: 'preparing', label: 'Preparing', currentLabel: 'Preparing your food', states: ['PREPARING', 'READY_FOR_PICKUP'] },
    { key: 'on_the_way', label: 'On the way', states: ['PICKED_UP', 'ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
  ] },
  restaurant: { completeAt: ['COMPLETED', 'RESOLVED'], steps: [
    { key: 'received', label: 'Received', states: ['CREATED', 'AUTHORIZED'] },
    { key: 'accepted', label: 'Accepted', currentLabel: 'Awaiting your response', states: ['RESTAURANT_PENDING'] },
    { key: 'preparing', label: 'Preparing', states: ['PREPARING'] },
    { key: 'ready', label: 'Ready for pickup', states: ['READY_FOR_PICKUP'] },
    { key: 'collected', label: 'Collected by rider', states: ['PICKED_UP', 'ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
    { key: 'settled', label: 'Settled', states: ['COMPLETED'] },
  ] },
  rider: { completeAt: ['DELIVERED', 'COMPLETED', 'RESOLVED'], steps: [
    { key: 'accepted', label: 'Accepted', states: ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING'] },
    { key: 'preparing', label: 'Restaurant preparing', states: ['PREPARING'] },
    { key: 'ready', label: 'Ready for pickup', states: ['READY_FOR_PICKUP'] },
    { key: 'picked_up', label: 'Picked up', states: ['PICKED_UP'] },
    { key: 'arrived', label: 'At the customer', states: ['ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
  ] },
  admin: { completeAt: ['COMPLETED', 'RESOLVED'], steps:
    ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'COMPLETED']
      .map((s) => ({ key: s.toLowerCase(), label: ORDER_STATE_LABELS[s], states: [s] })) },
};

const idx = (track, state) => track.steps.findIndex((s) => s.states.indexOf(state) >= 0);

/**
 * { audience, state, transitions?, deadlineAt?, now? } ->
 * { steps: [{key,label,state,at?}], currentKey, failed, unknownState }
 * Step states: complete · current · stalled (deadline passed) · failed · upcoming · unreached.
 * An unknown state is data, not a crash: every step is `upcoming` and unknownState is set.
 */
export function resolveTimeline(input) {
  const track = ORDER_TRACKS[input.audience] || ORDER_TRACKS.customer;
  const state = input.state;
  if (ORDER_STATES.indexOf(state) < 0) {
    return { steps: track.steps.map((s) => ({ key: s.key, label: s.label, state: 'upcoming' })), currentKey: null, failed: false, unknownState: String(state) };
  }
  const entered = {};
  (input.transitions || []).forEach((t) => {
    const i = idx(track, t.to_state);
    if (i >= 0 && t.at && !entered[track.steps[i].key]) entered[track.steps[i].key] = t.at;
  });
  const failed = FAILURE.indexOf(state) >= 0;
  const finished = track.completeAt.indexOf(state) >= 0;
  let anchor;
  if (failed) {
    anchor = 0;
    const ts = input.transitions || [];
    for (let i = ts.length - 1; i >= 0; i -= 1) {
      const from = ts[i].to_state === state && ts[i].from_state ? idx(track, ts[i].from_state) : idx(track, ts[i].to_state);
      if (from >= 0) { anchor = from; break; }
    }
    if (!ts.length && state === 'REJECTED') anchor = Math.max(0, idx(track, 'RESTAURANT_PENDING'));
  } else if (state === 'DISPUTED' || state === 'RESOLVED') {
    const d = idx(track, 'DELIVERED'); anchor = d >= 0 ? d : track.steps.length - 1;
  } else {
    const i = idx(track, state); anchor = i >= 0 ? i : track.steps.length - 1;
  }
  const now = input.now != null ? input.now : Date.now();
  const stalled = !failed && !finished && input.deadlineAt && Date.parse(input.deadlineAt) < now;
  const steps = track.steps.map((def, i) => {
    let st;
    if (i < anchor) st = 'complete';
    else if (i === anchor) st = failed ? 'failed' : finished ? 'complete' : stalled ? 'stalled' : 'current';
    else st = failed ? 'unreached' : 'upcoming';
    const label = (st === 'current' || st === 'stalled') && def.currentLabel ? def.currentLabel : def.label;
    return { key: def.key, label, state: st, at: entered[def.key] };
  });
  return { steps, currentKey: failed || finished ? null : track.steps[anchor].key, failed, unknownState: null };
}
