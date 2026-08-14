/**
 * The lifecycle vocabulary for the restaurant order-fulfilment flow.
 *
 * The transition endpoints the contract defines for the operator are `accept`, `reject`,
 * `ready` and `delay` (`contracts/openapi.yaml` §R-24/R-25/R-26). Which of them is *offered*
 * on a given order is a pure function of its `OrderState`, mirrored here so the detail screen
 * can render exactly the buttons the server would honour and nothing it would 409.
 *
 * The reject reason codes are the closed `RestaurantRejectReasonCode` enum; `OTHER` requires
 * a note of at least 20 characters, which is why it is surfaced through `ConfirmDialog`'s
 * `noteMinLength`.
 */
import type { OrderState, Schema } from '@hg/api-client';

export type RejectReasonCode = Schema['RestaurantRejectReasonCode'];

/**
 * The four operator transitions, keyed to their POST sub-path. `delay` is contract V1 and
 * kept out of the V0 action set below, but the label is here for completeness.
 */
export type OrderAction = 'accept' | 'reject' | 'ready';

/**
 * Which actions the server will accept for a given state. An offered order (`RESTAURANT_PENDING`)
 * can be accepted or rejected; a `PREPARING` order can be marked ready. Everything else is a
 * read-only terminal or in-flight state for this surface.
 */
export function availableActions(state: OrderState): readonly OrderAction[] {
  switch (state) {
    case 'RESTAURANT_PENDING':
      return ['accept', 'reject'];
    case 'PREPARING':
      return ['ready'];
    default:
      return [];
  }
}

export const REJECT_REASON_LABELS: Readonly<Record<RejectReasonCode, string>> = {
  ITEM_UNAVAILABLE: 'An item is unavailable',
  KITCHEN_AT_CAPACITY: 'Kitchen at capacity',
  CLOSING_SOON: 'Closing soon',
  EQUIPMENT_FAILURE: 'Equipment failure',
  ADDRESS_OUT_OF_RANGE: 'Delivery address out of range',
  SUSPECTED_FRAUD: 'Suspected fraud',
  OTHER: 'Other (explain below)',
};

/** `ConfirmReasonOption[]` for the reject dialog, in menu order. */
export const REJECT_REASON_OPTIONS = (
  Object.keys(REJECT_REASON_LABELS) as RejectReasonCode[]
).map((value) => ({ value, label: REJECT_REASON_LABELS[value] }));

/** The `OTHER` reason code requires a substantive note (contract: ≥ 20 chars). */
export const REJECT_OTHER_NOTE_MIN = 20;
