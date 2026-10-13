/**
 * Realtime types, hand-written from `contracts/websocket.md`.
 *
 * These are NOT generated: the realtime payload schemas live behind
 * `GET /v1/realtime/schema` (`RealtimeSchemaBundle`) and there is no committed JSON-Schema
 * snapshot in `contracts/` yet. When `contracts-gen-realtime` lands, this file is replaced
 * by generated output and deleted. Until then it is the single hand-maintained shim, and it
 * only declares the *envelope* and the *type names* — every `data` payload references a
 * generated `components['schemas']` type where the contract has one.
 */
import type { components } from './generated/openapi.js';

type S = components['schemas'];

/** §2. Every server → client message is exactly this object. */
export interface RealtimeEnvelope<T extends string = string, D = unknown> {
  /** ULID. Unique per event — **clients must deduplicate on this**; delivery is at-least-once. */
  id: string;
  /** Per-channel monotonic, gapless. `0` on control frames. */
  seq: number;
  /** `""` for control frames. */
  channel: string;
  type: T;
  /** Payload schema version. A client that does not understand `v` **ignores** the event. */
  v: number;
  /** RFC3339 ms, UTC. */
  ts: string;
  data: D;
}

/** §3.1. Channels are server-derived; `hello.allowed_channels` is the authority. */
export type ChannelKind = 'account' | 'order' | 'restaurant' | 'rider' | 'admin';

export const channel = {
  account: (accountId: string) => `account:${accountId}` as const,
  order: (orderId: string) => `order:${orderId}` as const,
  restaurant: (restaurantId: string) => `restaurant:${restaurantId}` as const,
  rider: (accountId: string) => `rider:${accountId}` as const,
  adminOps: () => 'admin:ops' as const,
};

/** §3.2. Five inbound frame types. **None of them carries identity.** */
export type InboundFrame =
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'resume'; channel: string; after_seq: number }
  | { type: 'reauth'; access_token: string }
  | { type: 'pong'; t: number };

/* ----------------------------- §4.1 control ------------------------------ */

export interface HelloData {
  account_id: string;
  roles: Array<{ r: S['Role']; s: string | null }>;
  session_id: string;
  allowed_channels: string[];
  server_time: string;
  heartbeat_s: number;
  protocol: number;
}
export interface SubscribedData {
  channel: string;
  cursor_seq: number;
}
export interface UnsubscribedData {
  channel: string;
  reason: 'client_request' | 'no_longer_authorized' | 'order_terminal';
}
export interface SubscribeErrorData {
  /**
   * NOTE: this is its own closed set, **not** `ErrorCode` — it stays lower case in
   * `websocket.md`. A `subscribe` for someone else's order returns `not_found`, never
   * `forbidden`: the socket obeys the same 404-vs-403 rule as HTTP.
   */
  channel: string;
  code: 'not_found' | 'forbidden' | 'subscription_limit' | 'invalid_channel';
  message: string;
}
export interface ResumeCompleteData {
  channel: string;
  from_seq: number;
  to_seq: number;
  replayed: number;
  /** `true` ⇒ refetch the resource over REST and reset the cursor. */
  truncated: boolean;
}
export interface PingPongData {
  t: number;
}
export interface ErrorData {
  code: S['ErrorCode'];
  message: string;
  retryable: boolean;
}
export interface ReauthRequiredData {
  deadline: string;
}

/* ------------------------------ §4.2 order ------------------------------- */

export interface OrderCreatedData {
  order_id: string;
  code: string;
  state: S['OrderState'];
  restaurant: { id: string; name: string };
  total_cents: number;
  currency: S['Currency'];
  placed_at: string;
  deadline_at: string | null;
}
export interface OrderStateChangedData {
  order_id: string;
  from: S['OrderState'] | null;
  to: S['OrderState'];
  at: string;
  reason: string | null;
  actor_kind: S['OrderActorKind'];
  /** Non-null on every non-terminal state. Countdowns derive from this minus `server_time`. */
  deadline_at: string | null;
  eta_at: string | null;
}
export interface OrderEtaUpdatedData {
  order_id: string;
  pickup_eta_at: string | null;
  dropoff_eta_at: string | null;
  source: S['RouteSource'];
}
export interface OrderItemsAdjustedData {
  order_id: string;
  removed: Array<{ line_no: number; name: string; qty: number }>;
  new_total_cents: number;
  new_quote_id: string;
}
export interface OrderCancelledData {
  order_id: string;
  reason_code: S['OrderCancellationReasonCode'];
  by: S['OrderActorKind'];
  refund: { kind: S['RefundKind']; amount_cents: number; state: S['RefundState'] } | null;
}
export interface OrderCompletedData {
  order_id: string;
  delivered_at: string;
  receipt_url: string | null;
}
export interface OrderNoteAddedData {
  order_id: string;
  author_kind: S['OrderActorKind'];
  text: string;
  at: string;
}
/**
 * The arrival event, customer only, also sent as a push that says only "Your rider is here".
 * It never carries a handover code: the rider subscribes to `order:{id}` too, and a push shows
 * on the lock screen. On this event the customer app fetches `delivery_code` from its own
 * authenticated order view (`getOrder` / `getOrderTracking`). Security review on #183:
 * https://github.com/shaiknoorullah/hg-mono/issues/183
 */
export interface OrderRiderArrivedData {
  order_id: string;
  at: string;
}

/* ----------------------------- §4.3 payment ------------------------------ */

export interface PaymentAuthorizedData {
  order_id: string;
  amount_cents: number;
  currency: S['Currency'];
  card: { brand: string; last4: string };
}
export interface PaymentActionRequiredData {
  order_id: string;
  client_secret: string;
  expires_at: string;
}
export interface PaymentCapturedData {
  order_id: string;
  amount_cents: number;
  currency: S['Currency'];
  captured_at: string;
}
export interface PaymentFailedData {
  order_id: string;
  code: string;
  decline_code: string | null;
  message: string;
  retryable: boolean;
}
export interface RefundCreatedData {
  order_id: string;
  refund_id: string;
  amount_cents: number;
  currency: S['Currency'];
  reason_code: S['RefundReasonCode'];
  state: S['RefundState'];
}
export interface RefundSettledData {
  order_id: string;
  refund_id: string;
  amount_cents: number;
  currency: S['Currency'];
  settled_at: string;
}
export interface RefundFailedData {
  order_id: string;
  refund_id: string;
  /** Customer-facing copy reads "refund in progress", never "refunded". */
  message: string;
}

/* ---------------------------- §4.4 restaurant ---------------------------- */

export interface RestaurantOrderOfferedData {
  order_id: string;
  code: string;
  expires_at: string;
  deadline_at: string;
  /** Pre-acceptance projection: first name only, no phone, no street address. */
  customer_first_name: string;
  lines: Array<{
    name: string;
    variant: string | null;
    addons: string[];
    qty: number;
    note: string | null;
  }>;
  subtotal_cents: number;
  total_cents: number;
  currency: S['Currency'];
  prep_eta_suggestion_min: number;
  fulfilment: S['Fulfilment'];
}
export interface RestaurantOrderOfferExpiredData {
  order_id: string;
  reason: 'timeout';
}
export interface RestaurantOrderOfferWithdrawnData {
  order_id: string;
  reason: 'customer_cancelled' | 'payment_failed';
}
export interface RestaurantOrderAcceptedData {
  order_id: string;
  accepted_by: string;
  prep_eta_minutes: number;
  /**
   * The 4-digit code the kitchen reads to the rider at the counter; null when the customer
   * collects the order, and always null in the support and admin projection. Restaurant
   * channel only — the rider is never sent it.
   */
  pickup_code: string | null;
}
export interface RestaurantOrderRejectedData {
  order_id: string;
  rejected_by: string;
  reason_code: S['RestaurantRejectReasonCode'];
}
export interface RestaurantStatusChangedData {
  restaurant_id: string;
  is_accepting_orders: boolean;
  open_state: S['RestaurantOpenState'];
  reason: string | null;
  changed_by: string;
}
export interface RestaurantPayoutUpdatedData {
  payout_id: string;
  state: S['PayoutState'];
  amount_cents: number;
  currency: S['Currency'];
  period: { start: string; end: string };
}

/* ------------------------- §4.5 dispatch and rider ----------------------- */

export interface DispatchOfferData {
  order_id: string;
  offer_id: string;
  expires_at: string;
  /** Countdown = `expires_at - server_time`, corrected for device clock skew. */
  server_time: string;
  pickup: { restaurant_name: string; address_short: string; lat: number; lng: number };
  /** Never the unit number or phone alias — those exist only after acceptance. */
  dropoff: { area: string; lat: number; lng: number };
  distance_m: number;
  est_duration_s: number;
  earnings_cents: number;
  tip_cents_estimate: number;
  items_count: number;
}
export interface DispatchOfferWithdrawnData {
  order_id: string;
  offer_id: string;
  reason: 'taken' | 'expired' | 'cancelled';
}
export interface DispatchAssignedData {
  order_id: string;
  rider: {
    first_name: string;
    photo_url: string | null;
    vehicle_type: S['VehicleType'];
    rating_avg: number | null;
  };
  pickup_eta_at: string | null;
}
export interface DispatchUnassignedData {
  order_id: string;
  reason: string;
}
export interface DispatchStateChangedData {
  order_id: string;
  from: S['DispatchState'];
  to: S['DispatchState'];
  at: string;
}
export interface RiderLocationData {
  order_id: string;
  lat: number;
  lng: number;
  heading_deg: number | null;
  speed_mps: number | null;
  accuracy_m: number | null;
  recorded_at: string;
}
export interface RiderAvailabilityChangedData {
  account_id: string;
  is_online: boolean;
  availability_state: S['RiderAvailabilityState'];
  at: string;
}
export interface RiderEarningsUpdatedData {
  account_id: string;
  period: S['EarningsPeriod'];
  earnings_cents: number;
  currency: S['Currency'];
  deliveries: number;
}

/* -------------------- §4.6 account and onboarding ------------------------ */

export interface AccountSecurityEventData {
  kind: 'new_device_login' | 'password_changed' | 'session_revoked';
  at: string;
  /** Coarse location — never a raw IP. */
  ip_city: string | null;
}
export interface DocumentReviewStateChangedData {
  document_id: string;
  doc_type: S['RestaurantDocType'] | S['RiderDocType'];
  state: S['KycDocumentState'];
  reason: string | null;
  reviewed_at: string;
}
export interface OnboardingStateChangedData {
  subject_type: 'RESTAURANT' | 'RIDER';
  subject_id: string;
  from: S['RestaurantOnboardingState'] | S['RiderOnboardingState'] | null;
  to: S['RestaurantOnboardingState'] | S['RiderOnboardingState'];
  next_action: S['NextRoute'] | null;
}
export interface ConnectRequirementsChangedData {
  currently_due: string[];
  past_due: string[];
  payouts_enabled: boolean;
  deadline: string | null;
}
export interface NotificationCreatedData {
  notification_id: string;
  kind: string;
  title: string;
  body: string;
  deep_link: string | null;
  created_at: string;
}
export interface NotificationReadData {
  notification_id: string;
  read_at: string;
}

/* ------------------------------ §4.7 admin ------------------------------- */

export interface AdminAlertData {
  severity: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  message: string;
  at: string;
}
export interface AdminDispatchFailureData {
  order_id: string;
  waves: number;
  riders_offered: number;
  radius_m: number;
}
export interface AdminReconciliationExceptionData {
  kind: string;
  order_id: string;
  expected_cents: number;
  actual_cents: number;
}
export interface AdminQueueDepthData {
  pending_restaurant_reviews: number;
  pending_rider_reviews: number;
  open_disputes: number;
  failed_refunds: number;
}

/** The complete catalogue, `type` → `data`. */
export interface RealtimeEventMap {
  hello: HelloData;
  subscribed: SubscribedData;
  unsubscribed: UnsubscribedData;
  subscribe_error: SubscribeErrorData;
  resume_complete: ResumeCompleteData;
  ping: PingPongData;
  pong: PingPongData;
  error: ErrorData;
  reauth_required: ReauthRequiredData;

  'order.created': OrderCreatedData;
  'order.state_changed': OrderStateChangedData;
  'order.eta_updated': OrderEtaUpdatedData;
  'order.items_adjusted': OrderItemsAdjustedData;
  'order.cancelled': OrderCancelledData;
  'order.completed': OrderCompletedData;
  'order.note_added': OrderNoteAddedData;
  'order.rider_arrived': OrderRiderArrivedData;

  'payment.authorized': PaymentAuthorizedData;
  'payment.action_required': PaymentActionRequiredData;
  'payment.captured': PaymentCapturedData;
  'payment.failed': PaymentFailedData;
  'refund.created': RefundCreatedData;
  'refund.settled': RefundSettledData;
  'refund.failed': RefundFailedData;

  'restaurant.order_offered': RestaurantOrderOfferedData;
  'restaurant.order_offer_expired': RestaurantOrderOfferExpiredData;
  'restaurant.order_offer_withdrawn': RestaurantOrderOfferWithdrawnData;
  'restaurant.order_accepted': RestaurantOrderAcceptedData;
  'restaurant.order_rejected': RestaurantOrderRejectedData;
  'restaurant.status_changed': RestaurantStatusChangedData;
  'restaurant.payout_updated': RestaurantPayoutUpdatedData;

  'dispatch.offer': DispatchOfferData;
  'dispatch.offer_withdrawn': DispatchOfferWithdrawnData;
  'dispatch.assigned': DispatchAssignedData;
  'dispatch.unassigned': DispatchUnassignedData;
  'dispatch.state_changed': DispatchStateChangedData;
  'rider.location': RiderLocationData;
  'rider.availability_changed': RiderAvailabilityChangedData;
  'rider.earnings_updated': RiderEarningsUpdatedData;

  'account.security_event': AccountSecurityEventData;
  'document.review_state_changed': DocumentReviewStateChangedData;
  'onboarding.state_changed': OnboardingStateChangedData;
  'connect.requirements_changed': ConnectRequirementsChangedData;
  'notification.created': NotificationCreatedData;
  'notification.read': NotificationReadData;

  'admin.alert': AdminAlertData;
  'admin.dispatch_failure': AdminDispatchFailureData;
  'admin.reconciliation_exception': AdminReconciliationExceptionData;
  'admin.queue_depth': AdminQueueDepthData;
}

export type RealtimeEventType = keyof RealtimeEventMap;

export type RealtimeEvent = {
  [K in RealtimeEventType]: RealtimeEnvelope<K, RealtimeEventMap[K]>;
}[RealtimeEventType];

/** §1.5 close codes. */
export const REALTIME_CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  /** `slow_consumer`, `at_capacity` or `connection_limit`: reconnect with backoff, then resume every channel. */
  TRY_AGAIN_LATER: 1013,
  MALFORMED_FRAME: 4400,
  UNAUTHENTICATED: 4401,
  ORIGIN_NOT_ALLOWED: 4403,
  FRAME_FLOOD: 4429,
} as const;

/** §1.5 reconnect backoff: 1 → 2 → 4 → 8 → 15 s cap, full jitter. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.floor(random() * capped);
}

/**
 * §6.3 gap detection. Returns `true` when the client must send
 * `resume {channel, after_seq: lastSeq}`.
 */
export function hasGap(lastSeq: number | undefined, incomingSeq: number): boolean {
  if (lastSeq === undefined) return false;
  return incomingSeq > lastSeq + 1;
}

/** §7.2 bounded dedup on `id`. */
export class SeenEventIds {
  #order: string[] = [];
  #set = new Set<string>();
  constructor(private readonly capacity = 512) {}
  /** `true` if this id has not been seen before (i.e. the event should be processed). */
  admit(id: string): boolean {
    if (this.#set.has(id)) return false;
    this.#set.add(id);
    this.#order.push(id);
    if (this.#order.length > this.capacity) {
      const evicted = this.#order.shift()!;
      this.#set.delete(evicted);
    }
    return true;
  }
}
