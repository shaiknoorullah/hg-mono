/**
 * What the order page says about the deadline and about cancelling, per state. The lines come from
 * `ORD/OrderDetail*`; they describe what the SERVER does at zero, so staff know when to leave an
 * order alone ("You don't need to cancel now"). The page never acts on a deadline itself.
 */
import type { Schema } from '@hg/api-client';

import type { OrderState } from '../labels';

type Order = Schema['OrderAdminView'];

export const NO_DEADLINE = 'None. This is a final state.';
export const HELD_BY_FAILED_REFUND =
  'Held while a refund has failed: each attempt re-arms and pages on-call until a new refund succeeds. The order is never left without a deadline.';

const DEADLINE_NOTE: Readonly<Partial<Record<OrderState, string>>> = {
  CREATED: 'If the customer doesn’t confirm the payment within 15 minutes, the payment is cancelled and so is the order. Nothing is charged.',
  AUTHORIZED:
    'The order is offered to the restaurant within 60 seconds, retried up to 3 times. If the restaurant is closed or an item is unavailable, the order is cancelled and the authorisation is voided.',
  RESTAURANT_PENDING:
    'If the restaurant doesn’t answer in 180 seconds, the order is cancelled (Restaurant didn’t answer) and the authorisation is voided. Nothing is charged.',
  PREPARING:
    'At the deadline, the customer gets a new estimate and ops are alerted; this repeats up to 3 times, 10 minutes each. After the third, the order is cancelled automatically and the customer refunded in full.',
  READY_FOR_PICKUP:
    'At the deadline, dispatch widens the search and ops are alerted; this repeats up to 3 times. After the third, the order is cancelled automatically: the customer is refunded in full and the restaurant is paid.',
  PICKED_UP:
    'At the deadline, the rider is pinged and ops are alerted; this repeats up to 3 times, 15 minutes each. After the third, the order moves to Disputed with an ops case. It is never marked delivered automatically.',
  ARRIVED:
    'At the deadline, the customer is notified and ops are alerted; this repeats up to 2 times, 10 minutes each. After that, the order moves to Disputed with an ops case.',
  DELIVERED:
    'Settles about 2 minutes after delivery, then moves to Completed. If settlement fails it retries with backoff and pages on-call; the order never sits without a deadline.',
  DISPUTED:
    "At this deadline it escalates to senior ops and gets another 24 hours, up to 3 times. After the third it resolves automatically in the customer's favour.",
};

/** True while a failed refund holds settlement of a delivered order. */
export function isHeldByFailedRefund(order: Pick<Order, 'state' | 'refunds'>): boolean {
  return order.state === 'DELIVERED' && order.refunds.some((r) => r.state === 'FAILED');
}

export function deadlineNote(order: Pick<Order, 'state' | 'deadline_at' | 'refunds'>): string {
  if (!order.deadline_at) return NO_DEADLINE;
  if (isHeldByFailedRefund(order)) return HELD_BY_FAILED_REFUND;
  return DEADLINE_NOTE[order.state] ?? '';
}

/** The reassurance under a deadline: states the system will end on its own. */
export function leaveItNote(state: OrderState): string | null {
  switch (state) {
    case 'CREATED':
    case 'AUTHORIZED':
    case 'RESTAURANT_PENDING':
      return 'You don’t need to cancel now: the system cancels it as soon as the server moves it.';
    case 'PREPARING':
      return 'If the kitchen can’t finish, this order cancels automatically at the third overrun and the customer is refunded in full. You don’t need to refund now.';
    case 'READY_FOR_PICKUP':
      return 'If no rider is found, this order cancels automatically at the third escalation and the customer is refunded in full. You don’t need to refund now.';
    case 'PICKED_UP':
      return 'Can’t be cancelled once picked up. To make it right for the customer, issue a refund after delivery.';
    default:
      return null;
  }
}

/** Whether the restaurant has already accepted (so a cancel refunds, and support cannot cancel). */
export function isAccepted(order: Pick<Order, 'accepted_at'>): boolean {
  return Boolean(order.accepted_at);
}

/** Who sets this reason by themselves; staff are never offered these. */
export const SYSTEM_ONLY_NOTE =
  'Reasons the system sets itself, like Restaurant didn’t answer, Capture failed, Payment expired and Preparation overdue, aren’t offered.';

/**
 * Where Cancel is offered. NOT `can_cancel`: on the admin view that flag is the customer's own
 * (it turns false once the restaurant accepts, when staff can still cancel). Staff cancel from
 * Created up to Ready for pickup; Picked up and later cannot be cancelled, the server answers 409.
 */
const STAFF_CANCELLABLE: readonly OrderState[] = ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP'];

export function staffCanCancel(state: OrderState): boolean {
  return STAFF_CANCELLABLE.includes(state);
}
