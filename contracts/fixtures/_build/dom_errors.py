"""
Error envelopes and scripted realtime sequences.

Errors matter as much as happy paths: `contracts/README.md` says clients branch on
`error.code` and never on `error.message`, which only holds if every app has a real
envelope to branch against.
"""

from __future__ import annotations

from content import MINUTE, ts
from synth import ulid_for, uuid_for

# (scenario suffix, http status, ErrorCode, message, details, note)
ERRORS = [
    (
        "validation_failed",
        422,
        "VALIDATION_FAILED",
        "Some fields could not be accepted.",
        [
            {"field": "delivery_instructions[0]", "code": "enum", "message": "CALL_ON_ARRIVAL is not a valid delivery instruction."},
            {"field": "tip_cents", "code": "minimum", "message": "Tip cannot be negative."},
        ],
        "Per-field detail lives in `error.details` as `FieldError[]` (contradiction log #2). "
        "Note the enum message: `CALL_ON_ARRIVAL` was dropped in favour of the platform's "
        "five values (contradiction log #6).",
    ),
    (
        "unknown_field",
        422,
        "UNKNOWN_FIELD",
        "The request contained a field that does not exist on this endpoint.",
        [{"field": "is_accepting", "code": "unknown_field", "message": "Did you mean is_accepting_orders?"}],
        "The decoder runs with `DisallowUnknownFields`. `is_accepting` against "
        "`is_accepting_orders` is a 422 at the boundary, not a cheerful 200 over an "
        "unchanged row — the exact bug this contract exists to kill.",
    ),
    (
        "quote_stale",
        409,
        "QUOTE_STALE",
        "Prices changed while you were checking out. Review the updated total.",
        None,
        "**Was `quote_stale` before the normalisation.** The server re-executes `Quote()` on "
        "`createOrder` and returns this with the new quote embedded in `details`; nothing "
        "server-signed is ever echoed back by the client (contradiction log #17).",
    ),
    (
        "quote_expired",
        409,
        "QUOTE_EXPIRED",
        "This quote has expired. Fetch a new one to continue.",
        None,
        "Was `quote_expired`. Pairs with the `quote_expired` fixture.",
    ),
    (
        "cart_has_unavailable_items",
        409,
        "CART_HAS_UNAVAILABLE_ITEMS",
        "Some items in your cart are no longer available.",
        [{"field": "lines[1]", "code": "OUT_OF_STOCK", "message": "Beef Nihari sold out at 18:20."}],
        "Was `cart_has_unavailable_items`. Pairs with the `cart_has_unavailable_items` fixture.",
    ),
    (
        "offer_already_taken",
        409,
        "OFFER_ALREADY_TAKEN",
        "Another rider took this order.",
        None,
        "Already SCREAMING_SNAKE before the normalisation — the rider spec's spelling.",
    ),
    (
        "offer_expired",
        409,
        "OFFER_EXPIRED",
        "This offer expired.",
        None,
        "**A collision case**: `offer_expired` (platform) and `OFFER_EXPIRED` (rider) were "
        "two members of one enum. They are now one.",
    ),
    (
        "otp_incorrect",
        401,
        "OTP_INCORRECT",
        "That code is not right. 4 attempts remaining.",
        None,
        "**A collision case**: the auth `otp_incorrect` and the proof-of-delivery "
        "`OTP_INCORRECT` collapsed into one member. Since superseded: proof of delivery now "
        "answers `DELIVERY_CODE_INCORRECT` (`error_delivery_code_incorrect`), so this is "
        "sign-in only.",
    ),
    (
        "province_not_served",
        422,
        "PROVINCE_NOT_SERVED",
        "We do not deliver in that province yet.",
        None,
        "**A collision case**: `province_not_served` (pricing) and `PROVINCE_NOT_SERVED` "
        "(address) merged. Gated by `getPublicConfig.served_provinces` (O-05).",
    ),
    (
        "active_order_exists",
        409,
        "ACTIVE_ORDER_EXISTS",
        "You already have an order in progress.",
        None,
        "One active order per customer (contradiction log #24). `getActiveOrder` returns "
        "zero or one — see `order_no_active`.",
    ),
    (
        "idempotency_key_reuse",
        409,
        "IDEMPOTENCY_KEY_REUSE",
        "This idempotency key was already used with a different request body.",
        None,
        "Never a silent replay of the wrong result. Was `idempotency_key_reuse`.",
    ),
    (
        "rate_limited",
        429,
        "RATE_LIMITED",
        "Too many requests. Try again in 45 seconds.",
        None,
        "Was `rate_limited`. Also the code on the realtime `error` control frame at the "
        "20 frames/second soft limit.",
    ),
    (
        "not_found",
        404,
        "NOT_FOUND",
        "Not found.",
        None,
        "A principal with **no relationship** to a subject gets 404 — existence is never "
        "leaked. 403 means 'you can see this but may not do that'.",
    ),
    (
        "forbidden",
        403,
        "FORBIDDEN",
        "You do not have permission to perform this action.",
        None,
        "Was `forbidden`. Note the English word 'forbidden' in prose was **not** rewritten "
        "by the normalisation — only code tokens were.",
    ),
    (
        "authentication_required",
        401,
        "AUTHENTICATION_REQUIRED",
        "Sign in to continue.",
        None,
        "Was `authentication_required`. Triggers the client's refresh-then-retry-once path.",
    ),
    (
        "restaurant_closed",
        409,
        "RESTAURANT_CLOSED",
        "Karachi Kitchen is closed right now.",
        None,
        "Was `restaurant_closed`. Pairs with `restaurant_availability_closed_hours`.",
    ),
    (
        "below_minimum_order",
        422,
        "BELOW_MINIMUM_ORDER",
        "This kitchen has a $15.00 minimum. Add $4.05 more to continue.",
        None,
        "Pairs with `cart_single_line`. The amount is server-computed — the client renders "
        "the sentence, it does not do the subtraction.",
    ),
    (
        "pod_method_mismatch",
        422,
        "POD_METHOD_MISMATCH",
        "This delivery needs a code from the customer, not a photo.",
        {"required_pod_method": "OTP"},
        "`MEET_AT_DOOR`/`MEET_IN_LOBBY` map to OTP proof of delivery; the rest map to photo "
        "(contradiction log #6). A photo, or a photo with a statement, never replaces the "
        "customer's code, before or after it locks. Pairs with `assignment_otp_pod_required`.",
    ),
    (
        "documents_incomplete",
        422,
        "INCOMPLETE_DOCUMENT_PACK",
        "Three documents are still outstanding.",
        [
            {"field": "documents", "code": "missing", "message": "OWNER_ID has not been attached."},
            {"field": "documents", "code": "missing", "message": "LIABILITY_INSURANCE has not been attached."},
        ],
        "Was `incomplete_document_pack`. Pairs with `restaurant_document_pack_incomplete`.",
    ),
    (
        "capture_failed",
        409,
        "CAPTURE_FAILED",
        "Your card was declined when we tried to charge it.",
        None,
        "Was `capture_failed`. The order is cancelled; nothing is owed. Pairs with "
        "`payment_failed`.",
    ),
    (
        "internal_error",
        500,
        "INTERNAL_ERROR",
        "Something went wrong on our side.",
        None,
        "Was `internal_error`. The only correct client behaviour is retry-with-backoff and "
        "show `request_id` in the support sheet.",
    ),
    (
        "review_window_closed",
        409,
        "REVIEW_WINDOW_CLOSED",
        "This order cannot be rated (not yet delivered, no rider assigned, or the 14-day window has closed).",
        None,
        "C-38 rule 4 (scoped): `submitOrderRating` on an order that is not DELIVERED/COMPLETED, "
        "has no rider assigned for the rider half, or is more than 14 days past `delivered_at`.",
    ),
    (
        "review_edit_window_closed",
        409,
        "REVIEW_EDIT_WINDOW_CLOSED",
        "This rating was submitted more than 24 hours ago and can no longer be edited.",
        None,
        "C-38 rule 2: a rating is editable for 24 h from its own `created_at`, then frozen — "
        "replacing it past that window is rejected rather than silently overwritten.",
    ),
]

# The error states of the operations the owner moved into launch on 2026-10-01
# (docs/decisions/README.md, "Settled — redesign decisions, round 2", "Launch scope and
# contract"). Same tuple as ERRORS plus the operations each one is registered for, so the
# mock lists them under the operation that returns them. Codes and messages match what
# services/hg returns today.
LAUNCH_ERRORS = [
    (
        "reset_token_not_valid",
        400,
        "TOKEN_CONSUMED",
        "This reset link is not valid.",
        None,
        "`resetPassword` with a token that expired (30 minutes), was already used, or never "
        "existed. One body for all three, so a link cannot be probed. The app offers "
        "\"Send a new link\" (`requestPasswordReset`).",
        ["resetPassword"],
    ),
    (
        "breached_password",
        422,
        "BREACHED_PASSWORD",
        "This password has appeared in a data breach. Choose another.",
        None,
        "The new password is on the breached-password list. Same body on reset and change.",
        ["resetPassword", "changePassword"],
    ),
    (
        "current_password_incorrect",
        422,
        "INVALID_CREDENTIALS",
        "The current password is incorrect.",
        None,
        "`changePassword` with the wrong current password. Nothing changed and no session "
        "was revoked. A 422, not a 401: the session is fine, and the client treats every 401 "
        "as an expired session to refresh and retry.",
        ["changePassword"],
    ),
    (
        "totp_code_incorrect",
        422,
        "INVALID_CREDENTIALS",
        "The TOTP code is incorrect.",
        None,
        "`verifyTotpEnrolment` with a code that does not match the authenticator. Enrolment "
        "stays open: the person types the next code, they do not start again.",
        ["verifyTotpEnrolment"],
    ),
    (
        "staff_email_in_use",
        409,
        "EMAIL_IN_USE",
        "This email already belongs to an account.",
        None,
        "`createStaffUser` for an email that already has a live account. No invite is sent.",
        ["createStaffUser"],
    ),
    (
        "price_out_of_range",
        422,
        "PRICE_OUT_OF_RANGE",
        "Price must be between $0.50 and $500.00.",
        [{"field": "price_cents", "code": "range", "message": "Must be between 50 and 50000 cents."}],
        "The catalogue price band. The restaurant sets its own price; it is still never a "
        "price a client sends for an order.",
        ["createMenuItem", "updateMenuItem", "createMenuItemOnBehalf", "updateMenuItemOnBehalf"],
    ),
    (
        "prohibited_ingredient",
        422,
        "PROHIBITED_INGREDIENT",
        "HalalGoes does not list items that contain alcohol or pork.",
        [{"field": "ingredients_text", "code": "prohibited", "message": "Mentions rum."}],
        "Rejected outright, before review. The same check runs for restaurants and for "
        "admins editing on their behalf.",
        ["createMenuItem", "updateMenuItem", "createMenuItemOnBehalf", "updateMenuItemOnBehalf"],
    ),
    (
        "halal_tag_not_writable",
        403,
        "FIELD_NOT_WRITABLE",
        "Halal certified is set by HalalGoes from your approved certificate.",
        [{"field": "dietary_tags[0]", "code": "not_writable", "message": "HALAL_CERTIFIED cannot be set by hand."}],
        "Nobody types the halal claim onto a dish, not even an admin: it comes from the "
        "restaurant's approved certificate. A missing claim shows no badge, never an "
        "optimistic one.",
        ["createMenuItem", "updateMenuItem", "createMenuItemOnBehalf", "updateMenuItemOnBehalf"],
    ),
    (
        "category_name_taken",
        409,
        "CATEGORY_NAME_TAKEN",
        "You already have a category called Desserts.",
        None,
        "Category names are unique per restaurant, ignoring case, on create and on rename.",
        ["createMenuCategory", "updateMenuCategory", "createMenuCategoryOnBehalf"],
    ),
    (
        "item_blocked_by_admin",
        403,
        "ITEM_BLOCKED_BY_ADMIN",
        "HalalGoes has blocked this item. Reason: the photo shows a different dish.",
        None,
        "`setMenuItemAvailability` on a `BLOCKED` item. The kitchen cannot un-block it; the "
        "message carries the admin's reason.",
        ["setMenuItemAvailability"],
    ),
    (
        "menu_version_pending",
        409,
        "MENU_VERSION_PENDING",
        "The restaurant has an edit to this item waiting for review. Decide it first.",
        None,
        "`updateMenuItemOnBehalf` with a claim-bearing field while the restaurant's own edit "
        "is in the review queue. A restaurant's edit is never silently discarded.",
        ["updateMenuItemOnBehalf"],
    ),
    (
        "menu_version_already_decided",
        409,
        "ALREADY_DECIDED",
        "Another reviewer already decided this version.",
        None,
        "Two reviewers on one version: the second decision is refused, never applied twice.",
        ["decideMenuVersion"],
    ),
    (
        "menu_version_item_deleted",
        409,
        "ITEM_DELETED",
        "This item was removed from the menu.",
        None,
        "The item was removed (`deleteMenuItemOnBehalf`) while its version waited for review.",
        ["decideMenuVersion"],
    ),
]


# The handover codes' error states (round-2 decisions, "Orders and delivery":
# https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#orders-and-delivery,
# #178 and #180). The kitchen reads a 4-digit pickup code to the rider, who types it in on
# createAssignmentTransition; the customer reads a 4-digit delivery code to the rider, who
# types it in on submitProofOfDelivery. The codes are proof of presence, so the rider has no
# way past them: five wrong codes per order hand the order to support, and only support or
# an admin can confirm the handover without its code (overrideHandoverCode). No error body
# ever carries a code (security review on #183:
# https://github.com/shaiknoorullah/hg-mono/issues/183).
HANDOVER_ERRORS = [
    (
        "pickup_code_required",
        422,
        "PICKUP_CODE_REQUIRED",
        "Ask the kitchen for the 4-digit pickup code.",
        None,
        "`PICKED_UP` sent without `pickup_code`. The code is a required field of "
        "`PickupTransitionInput`, the only shape that can confirm a pickup, so this is never "
        "accepted. Nothing is counted; the rider app asks for the code the kitchen reads out.",
        ["createAssignmentTransition"],
    ),
    (
        "pickup_code_incorrect",
        422,
        "PICKUP_CODE_INCORRECT",
        "That pickup code is not right. 3 attempts remaining.",
        {"attempts_remaining": 3},
        "**Wrong code.** The attempt is counted and committed in Postgres per order; the "
        "assignment's state does not change. `details.attempts_remaining` drives the counter "
        "on the rider's screen. Neither the code sent nor the expected code is in the body.",
        ["createAssignmentTransition"],
    ),
    (
        "pickup_code_locked",
        423,
        "PICKUP_CODE_LOCKED",
        "Too many wrong codes. HalalGoes support is taking over this pickup; please wait at the counter.",
        None,
        "**Limit reached.** The fifth wrong pickup code locks it for this order, so a "
        "reassignment does not reset the count, and hands the order to support "
        "(`HANDOVER_CODE_LOCKED` on `admin:ops`). Every later `PICKED_UP` gets this answer, "
        "with or without a code. The rider has no override: support or an admin confirms "
        "the pickup with `overrideHandoverCode` (see `handover_override_pickup_locked`).",
        ["createAssignmentTransition"],
    ),
    (
        "delivery_code_incorrect",
        422,
        "DELIVERY_CODE_INCORRECT",
        "That delivery code is not right. 2 attempts remaining.",
        {"attempts_remaining": 2},
        "**Wrong code** at a met handover. The attempt is counted and committed in Postgres "
        "per order; no proof is recorded. Neither the code sent nor the expected code is in "
        "the body.",
        ["submitProofOfDelivery"],
    ),
    (
        "delivery_code_locked",
        423,
        "DELIVERY_CODE_LOCKED",
        "Too many wrong codes. HalalGoes support is taking over this delivery; please stay with the order.",
        None,
        "**Limit reached.** The fifth wrong delivery code locks it for this order and hands "
        "the order to support (`HANDOVER_CODE_LOCKED` on `admin:ops`). There is no photo "
        "fallback: support or an admin confirms the delivery with `overrideHandoverCode` "
        "(see `handover_override_delivery`).",
        ["submitProofOfDelivery"],
    ),
    (
        "handover_override_not_pending",
        409,
        "ILLEGAL_TRANSITION",
        "This order is not waiting on that handover.",
        {"from": "DELIVERED", "to": "DELIVERED", "allowed": ["COMPLETED", "DISPUTED"]},
        "`overrideHandoverCode` for a handover that already happened (here a `DELIVERY` "
        "override on a delivered order). Nothing is written and no audit record is created.",
        ["overrideHandoverCode"],
    ),
]


def build(reg, synth) -> None:
    _errors(reg)
    _realtime(reg)


def _errors(reg) -> None:
    entries = [(*entry, []) for entry in ERRORS] + LAUNCH_ERRORS + HANDOVER_ERRORS
    for suffix, status, code, message, details, note, operations in entries:
        envelope = {
            "error": {
                "code": code,
                "message": message,
                "request_id": ulid_for(f"request:{suffix}"),
            }
        }
        if details is not None:
            envelope["error"]["details"] = details
        reg.add(
            f"error_{suffix}",
            "errors",
            "ErrorEnvelope",
            f"`{status}` · `{code}`. {note}",
            envelope,
            operations=operations,
            status=status,
            tags=["error-envelope"],
        )


# --------------------------------------------------------------------------- #
# Scripted realtime sequences
# --------------------------------------------------------------------------- #


def _event(seq: int, channel: str, etype: str, offset_ms: int, data: dict) -> dict:
    return {
        "id": ulid_for(f"event:{channel}:{seq}"),
        "seq": seq,
        "channel": channel,
        "type": etype,
        "v": 1,
        "ts": ts(offset_ms / 1000.0),
        "data": data,
        # Not part of the envelope — the mock server reads it to pace the script.
        "_delay_ms": offset_ms,
    }


def _realtime(reg) -> None:
    order_id = uuid_for("order:preparing")
    order_channel = f"order:{order_id}"
    rider_channel = f"rider:{uuid_for('account:rider:bilal')}"
    restaurant_channel = f"restaurant:{uuid_for('restaurant:karachi-kitchen')}"

    def state_changed(seq, frm, to, offset, actor, deadline=None, eta=None, reason=None):
        return _event(
            seq,
            order_channel,
            "order.state_changed",
            offset,
            {
                "order_id": order_id,
                "from": frm,
                "to": to,
                "at": ts(offset / 1000.0),
                "reason": reason,
                "actor_kind": actor,
                "deadline_at": deadline,
                "eta_at": eta,
            },
        )

    happy = [
        _event(1, order_channel, "order.created", 0, {
            "order_id": order_id, "code": "HG-4K2M-9T", "state": "CREATED",
            "restaurant": {"id": uuid_for("restaurant:karachi-kitchen"), "name": "Karachi Kitchen"},
            "total_cents": 6706, "currency": "CAD", "placed_at": ts(0), "deadline_at": ts(15 * MINUTE),
        }),
        _event(2, order_channel, "payment.authorized", 1500, {
            "order_id": order_id, "amount_cents": 6706, "currency": "CAD",
            "card": {"brand": "visa", "last4": "4242"},
        }),
        state_changed(3, "CREATED", "AUTHORIZED", 1600, "SYSTEM", deadline=ts(15 * MINUTE)),
        state_changed(4, "AUTHORIZED", "RESTAURANT_PENDING", 2000, "SYSTEM", deadline=ts(182)),
        _event(5, restaurant_channel, "restaurant.order_offered", 2100, {
            "order_id": order_id, "code": "HG-4K2M-9T", "expires_at": ts(182), "deadline_at": ts(182),
            "customer_first_name": "Ayesha",
            "lines": [
                {"name": "Chicken Biryani", "variant": None, "addons": [], "qty": 1, "note": None},
                {"name": "Beef Nihari", "variant": "Full", "addons": [], "qty": 1, "note": "Extra gravy on the side"},
                {"name": "Chicken Karahi (Half)", "variant": None, "addons": ["Garlic naan"], "qty": 1, "note": None},
            ],
            "subtotal_cents": 4634, "total_cents": 6706, "currency": "CAD",
            "prep_eta_suggestion_min": 20, "fulfilment": "DELIVERY",
        }),
        _event(6, restaurant_channel, "restaurant.order_accepted", 12000, {
            "order_id": order_id, "accepted_by": "Hamza K.", "prep_eta_minutes": 20,
            # Restaurant channel only: the kitchen reads it to the rider at the counter.
            "pickup_code": "3051",
        }),
        state_changed(7, "RESTAURANT_PENDING", "PREPARING", 12100, "RESTAURANT", deadline=ts(20 * MINUTE), eta=ts(32 * MINUTE)),
        _event(8, order_channel, "payment.captured", 12500, {
            "order_id": order_id, "amount_cents": 6706, "currency": "CAD", "captured_at": ts(12.5),
        }),
        _event(9, order_channel, "dispatch.state_changed", 13000, {
            "order_id": order_id, "from": "PENDING", "to": "SEARCHING", "at": ts(13),
        }),
        _event(10, rider_channel, "dispatch.offer", 14000, {
            "order_id": order_id, "offer_id": uuid_for("offer:script"), "expires_at": ts(44),
            "server_time": ts(14),
            "pickup": {"restaurant_name": "Karachi Kitchen", "address_short": "1245 Danforth Avenue, Toronto", "lat": 43.6817, "lng": -79.3403},
            "dropoff": {"area": "Harbourfront, Toronto", "lat": 43.6412, "lng": -79.3810},
            "distance_m": 5240, "est_duration_s": 780, "earnings_cents": 1149,
            "tip_cents_estimate": 700, "items_count": 3,
        }),
        _event(11, order_channel, "dispatch.assigned", 20000, {
            "order_id": order_id,
            "rider": {"first_name": "Bilal", "photo_url": None, "vehicle_type": "SCOOTER", "rating_avg": 4.9},
            "pickup_eta_at": ts(8 * MINUTE),
        }),
        _event(12, order_channel, "dispatch.state_changed", 20100, {
            "order_id": order_id, "from": "SEARCHING", "to": "ASSIGNED", "at": ts(20.1),
        }),
        state_changed(13, "PREPARING", "READY_FOR_PICKUP", 26000, "RESTAURANT", deadline=ts(10 * MINUTE), eta=ts(30 * MINUTE)),
        _event(14, order_channel, "dispatch.state_changed", 28000, {
            "order_id": order_id, "from": "ASSIGNED", "to": "AT_RESTAURANT", "at": ts(28),
        }),
        state_changed(15, "READY_FOR_PICKUP", "PICKED_UP", 32000, "RIDER", deadline=ts(14 * MINUTE), eta=ts(30 * MINUTE)),
        _event(16, order_channel, "rider.location", 34000, {
            "order_id": order_id, "lat": 43.6740, "lng": -79.3540, "heading_deg": 214.0,
            "speed_mps": 8.1, "accuracy_m": 9.0, "recorded_at": ts(34),
        }),
        _event(17, order_channel, "rider.location", 39000, {
            "order_id": order_id, "lat": 43.6598, "lng": -79.3652, "heading_deg": 218.0,
            "speed_mps": 7.4, "accuracy_m": 12.0, "recorded_at": ts(39),
        }),
        _event(18, order_channel, "order.eta_updated", 40000, {
            "order_id": order_id, "pickup_eta_at": None, "dropoff_eta_at": ts(29 * MINUTE), "source": "ROUTED",
        }),
        _event(19, order_channel, "rider.location", 44000, {
            "order_id": order_id, "lat": 43.6460, "lng": -79.3770, "heading_deg": 226.0,
            "speed_mps": 5.2, "accuracy_m": 8.0, "recorded_at": ts(44),
        }),
        state_changed(20, "PICKED_UP", "ARRIVED", 48000, "RIDER", deadline=ts(5 * MINUTE), eta=ts(2 * MINUTE)),
        # The arrival event, customer only and also a push ("Your rider is here"). It never
        # carries a code: the rider subscribes to this channel too (security review on #183,
        # https://github.com/shaiknoorullah/hg-mono/issues/183).
        _event(21, order_channel, "order.rider_arrived", 48000, {
            "order_id": order_id, "at": ts(48),
        }),
        state_changed(22, "ARRIVED", "DELIVERED", 54000, "RIDER", deadline=ts(30 * MINUTE)),
        _event(23, order_channel, "dispatch.state_changed", 54100, {
            "order_id": order_id, "from": "AT_CUSTOMER", "to": "COMPLETED", "at": ts(54.1),
        }),
        state_changed(24, "DELIVERED", "COMPLETED", 58000, "SYSTEM"),
        _event(25, order_channel, "order.completed", 58100, {
            "order_id": order_id, "delivered_at": ts(54),
            "receipt_url": "https://halalgoes.ca/receipts/HG-2026-000148213.pdf",
        }),
    ]

    reg.add(
        "realtime_order_happy_path",
        "realtime",
        "RealtimeEvent[]",
        "**The whole order lifecycle in 58 seconds of wall clock**, 25 events across the "
        "order, restaurant and rider channels: created → authorized → restaurant offered → "
        "accepted (with the kitchen's pickup code) → captured → dispatch searching → offered "
        "→ assigned → ready → picked up → three location pings → arrived (with "
        "`order.rider_arrived`, which never carries a code) → delivered → completed. The "
        "pickup code appears only on the restaurant channel. Drive a tracking screen end to "
        "end with `?scenario=realtime_order_happy_path`.",
        happy,
        tags=["realtime", "script"],
    )

    met_id = uuid_for("order:meet-in-lobby")
    met_channel = f"order:{met_id}"

    def met_state(seq, frm, to, offset, actor, deadline=None, eta=None):
        return _event(seq, met_channel, "order.state_changed", offset, {
            "order_id": met_id, "from": frm, "to": to, "at": ts(offset / 1000.0),
            "reason": None, "actor_kind": actor, "deadline_at": deadline, "eta_at": eta,
        })

    met_arrival = [
        met_state(1, "READY_FOR_PICKUP", "PICKED_UP", 0, "RIDER", deadline=ts(14 * MINUTE), eta=ts(12 * MINUTE)),
        _event(2, met_channel, "rider.location", 5000, {
            "order_id": met_id, "lat": 43.6460, "lng": -79.3770, "heading_deg": 226.0,
            "speed_mps": 5.2, "accuracy_m": 8.0, "recorded_at": ts(5),
        }),
        met_state(3, "PICKED_UP", "ARRIVED", 9000, "RIDER", deadline=ts(5 * MINUTE), eta=ts(1 * MINUTE)),
        # No code here: the customer app fetches it from getOrder / getOrderTracking.
        _event(4, met_channel, "order.rider_arrived", 9000, {
            "order_id": met_id, "at": ts(9),
        }),
    ]

    reg.add(
        "realtime_order_met_handover",
        "realtime",
        "RealtimeEvent[]",
        "A **met handover** (`MEET_IN_LOBBY`) from pickup to delivery. On arrival the "
        "customer receives `order.rider_arrived` and a push that say only \"Your rider is "
        "here\"; neither carries the code. The app then fetches `delivery_code` from the "
        "customer's own order view (`order_arrived_meet_in_lobby`, "
        "`tracking_arrived_delivery_code`), and the customer reads it to the rider, who "
        "records it as proof of delivery. No event on this channel ever carries a code, "
        "because the rider subscribes to it too.",
        [
            *met_arrival,
            met_state(5, "ARRIVED", "DELIVERED", 15000, "RIDER", deadline=ts(30 * MINUTE)),
        ],
        tags=["realtime", "script", "delivery-code"],
    )

    reg.add(
        "realtime_order_delivery_code_locked",
        "realtime",
        "RealtimeEvent[]",
        "A met handover where **five wrong delivery codes** hand the order to support. The "
        "rider's fifth wrong code (`error_delivery_code_locked`) raises "
        "`HANDOVER_CODE_LOCKED` on `admin:ops`, which names the order and the handover, "
        "never the code. Support checks with the customer and confirms the delivery with "
        "`overrideHandoverCode` (`handover_override_delivery`): the order moves to "
        "`DELIVERED` with `actor_kind: SUPPORT` and the reason. The rider never had a "
        "fallback of their own.",
        [
            *met_arrival,
            _event(1, "admin:ops", "admin.alert", 14000, {
                "severity": "WARNING",
                "kind": "HANDOVER_CODE_LOCKED",
                "subject_type": "ORDER",
                "subject_id": met_id,
                "message": "Five wrong delivery codes at a met handover. The delivery is with support.",
                "at": ts(14),
            }),
            _event(5, met_channel, "order.state_changed", 95000, {
                "order_id": met_id, "from": "ARRIVED", "to": "DELIVERED", "at": ts(95),
                "reason": "Delivery confirmed by support: called the customer, who has the order.",
                "actor_kind": "SUPPORT", "deadline_at": ts(30 * MINUTE), "eta_at": None,
            }),
        ],
        tags=["realtime", "script", "delivery-code", "admin", "error-path"],
    )

    reg.add(
        "realtime_order_restaurant_rejects",
        "realtime",
        "RealtimeEvent[]",
        "The restaurant rejects at 14 s. The authorisation is **voided**, not captured and "
        "refunded — no money ever moved.",
        [
            happy[0],
            happy[1],
            state_changed(3, "CREATED", "AUTHORIZED", 1600, "SYSTEM", deadline=ts(15 * MINUTE)),
            state_changed(4, "AUTHORIZED", "RESTAURANT_PENDING", 2000, "SYSTEM", deadline=ts(182)),
            happy[4],
            _event(6, restaurant_channel, "restaurant.order_rejected", 14000, {
                "order_id": order_id, "rejected_by": "Hamza K.", "reason_code": "ITEM_UNAVAILABLE",
            }),
            state_changed(7, "RESTAURANT_PENDING", "REJECTED", 14100, "RESTAURANT", reason="ITEM_UNAVAILABLE"),
            _event(8, order_channel, "order.cancelled", 14200, {
                "order_id": order_id, "reason_code": "ITEM_UNAVAILABLE", "by": "RESTAURANT", "refund": None,
            }),
        ],
        tags=["realtime", "script", "error-path"],
    )

    reg.add(
        "realtime_order_timeout_no_rider",
        "realtime",
        "RealtimeEvent[]",
        "Three dispatch waves, nobody accepts, the order fails and is fully refunded. Ends "
        "with `admin.dispatch_failure` on `admin:ops`.",
        [
            happy[0], happy[1], happy[2], happy[3], happy[4], happy[5], happy[6], happy[7],
            _event(9, order_channel, "dispatch.state_changed", 13000, {"order_id": order_id, "from": "PENDING", "to": "SEARCHING", "at": ts(13)}),
            _event(10, rider_channel, "dispatch.offer_withdrawn", 34000, {
                "order_id": order_id, "offer_id": uuid_for("offer:script"), "reason": "expired",
            }),
            _event(11, order_channel, "dispatch.state_changed", 60000, {"order_id": order_id, "from": "SEARCHING", "to": "NO_RIDER_FOUND", "at": ts(60)}),
            state_changed(12, "PREPARING", "FAILED", 60100, "SYSTEM", reason="NO_RIDER_FOUND"),
            _event(13, order_channel, "order.cancelled", 60200, {
                "order_id": order_id, "reason_code": "NO_RIDER_FOUND", "by": "SYSTEM",
                "refund": {"kind": "FULL", "amount_cents": 6706, "state": "AUTHORISED"},
            }),
            _event(14, order_channel, "refund.created", 60300, {
                "order_id": order_id, "refund_id": uuid_for("refund:script"), "amount_cents": 6706,
                "currency": "CAD", "reason_code": "NO_RIDER_FOUND", "state": "AUTHORISED",
            }),
            _event(15, order_channel, "refund.settled", 90000, {
                "order_id": order_id, "refund_id": uuid_for("refund:script"), "amount_cents": 6706,
                "currency": "CAD", "settled_at": ts(90),
            }),
            _event(16, "admin:ops", "admin.dispatch_failure", 60400, {
                "order_id": order_id, "waves": 3, "riders_offered": 8, "radius_m": 10000,
            }),
        ],
        tags=["realtime", "script", "error-path"],
    )

    reg.add(
        "realtime_payment_action_required",
        "realtime",
        "RealtimeEvent[]",
        "3-D Secure is a **normal** path: `payment.action_required` fires, the order stays "
        "`CREATED` under its 15-minute deadline, then authorises and proceeds.",
        [
            happy[0],
            _event(2, order_channel, "payment.action_required", 800, {
                "order_id": order_id,
                "client_secret": "pi_3QkR7mE8xVn2LbQ1_secret_5cGvA9pQ",
                "expires_at": ts(15 * MINUTE),
            }),
            _event(3, order_channel, "payment.authorized", 9000, {
                "order_id": order_id, "amount_cents": 6706, "currency": "CAD",
                "card": {"brand": "visa", "last4": "3184"},
            }),
            state_changed(4, "CREATED", "AUTHORIZED", 9100, "SYSTEM", deadline=ts(15 * MINUTE)),
            state_changed(5, "AUTHORIZED", "RESTAURANT_PENDING", 9500, "SYSTEM", deadline=ts(189)),
        ],
        tags=["realtime", "script"],
    )

    reg.add(
        "realtime_payment_failed",
        "realtime",
        "RealtimeEvent[]",
        "The card is declined at capture. The order cancels and the customer owes nothing.",
        [
            happy[0], happy[1],
            state_changed(3, "CREATED", "AUTHORIZED", 1600, "SYSTEM", deadline=ts(15 * MINUTE)),
            state_changed(4, "AUTHORIZED", "RESTAURANT_PENDING", 2000, "SYSTEM", deadline=ts(182)),
            happy[4],
            _event(6, restaurant_channel, "restaurant.order_accepted", 12000, {
                "order_id": order_id, "accepted_by": "Hamza K.", "prep_eta_minutes": 20,
                "pickup_code": "3051",
            }),
            _event(7, order_channel, "payment.failed", 12400, {
                "order_id": order_id, "code": "CAPTURE_FAILED", "decline_code": "insufficient_funds",
                "message": "Your card was declined when we tried to charge it.", "retryable": False,
            }),
            state_changed(8, "RESTAURANT_PENDING", "CANCELLED", 12500, "SYSTEM", reason="CAPTURE_FAILED"),
            _event(9, restaurant_channel, "restaurant.order_offer_withdrawn", 12600, {
                "order_id": order_id, "reason": "payment_failed",
            }),
        ],
        tags=["realtime", "script", "error-path"],
    )

    reg.add(
        "realtime_rider_reassigned",
        "realtime",
        "RealtimeEvent[]",
        "The assigned rider drops out mid-delivery. The customer sees `dispatch.unassigned` "
        "then a second `dispatch.assigned`; the old rider is force-unsubscribed from the "
        "order channel within 2 seconds.",
        [
            _event(1, order_channel, "dispatch.assigned", 0, {
                "order_id": order_id,
                "rider": {"first_name": "Bilal", "photo_url": None, "vehicle_type": "SCOOTER", "rating_avg": 4.9},
                "pickup_eta_at": ts(8 * MINUTE),
            }),
            _event(2, order_channel, "dispatch.unassigned", 12000, {
                "order_id": order_id, "reason": "rider_unresponsive",
            }),
            _event(3, order_channel, "dispatch.state_changed", 12100, {
                "order_id": order_id, "from": "ASSIGNED", "to": "UNASSIGNED", "at": ts(12.1),
            }),
            _event(4, order_channel, "dispatch.state_changed", 13000, {
                "order_id": order_id, "from": "UNASSIGNED", "to": "SEARCHING", "at": ts(13),
            }),
            _event(5, order_channel, "dispatch.assigned", 22000, {
                "order_id": order_id,
                "rider": {"first_name": "Omar", "photo_url": None, "vehicle_type": "CAR", "rating_avg": 4.7},
                "pickup_eta_at": ts(11 * MINUTE),
            }),
        ],
        tags=["realtime", "script", "error-path"],
    )

    reg.add(
        "realtime_gap_and_resume",
        "realtime",
        "RealtimeEvent[]",
        "A deliberate **seq gap** (3 → 7). A conforming client detects `seq > last_seq + 1`, "
        "sends `resume {channel, after_seq: 3}`, and receives the missing events followed by "
        "`resume_complete`. Use this to prove the gap-detection path before shipping.",
        [
            state_changed(1, None, "CREATED", 0, "CUSTOMER", deadline=ts(15 * MINUTE)),
            state_changed(2, "CREATED", "AUTHORIZED", 1000, "SYSTEM", deadline=ts(15 * MINUTE)),
            state_changed(3, "AUTHORIZED", "RESTAURANT_PENDING", 2000, "SYSTEM", deadline=ts(182)),
            state_changed(7, "PREPARING", "READY_FOR_PICKUP", 8000, "RESTAURANT", deadline=ts(10 * MINUTE)),
        ],
        tags=["realtime", "script", "edge"],
    )

    reg.add(
        "realtime_control_frames",
        "realtime",
        "RealtimeEvent[]",
        "Every control frame, `seq: 0` and no channel: `hello`, `subscribed`, `ping`, "
        "`subscribe_error` (`not_found` for someone else's order — never `forbidden`), "
        "`unsubscribed`, `resume_complete` with `truncated: true`, `reauth_required` and an "
        "`error`.",
        [
            _event(0, "", "hello", 0, {
                "account_id": uuid_for("account:customer:ayesha"),
                "roles": [{"r": "CUSTOMER", "s": None}],
                "session_id": uuid_for("session:ayesha"),
                "allowed_channels": [f"account:{uuid_for('account:customer:ayesha')}", order_channel],
                "server_time": ts(0), "heartbeat_s": 25, "protocol": 1,
            }),
            _event(0, "", "subscribed", 200, {"channel": order_channel, "cursor_seq": 1487}),
            _event(0, "", "ping", 25000, {"t": 1786000000123}),
            _event(0, "", "subscribe_error", 400, {
                "channel": "order:00000000-0000-4000-a000-000000000000",
                "code": "not_found",
                "message": "No such order.",
            }),
            _event(0, "", "unsubscribed", 600, {"channel": order_channel, "reason": "order_terminal"}),
            _event(0, "", "resume_complete", 800, {
                "channel": order_channel, "from_seq": 3, "to_seq": 1487, "replayed": 1000, "truncated": True,
            }),
            _event(0, "", "reauth_required", 1000, {"deadline": ts(5 * MINUTE)}),
            _event(0, "", "error", 1200, {
                "code": "RATE_LIMITED", "message": "Slow down — 20 frames per second.", "retryable": True,
            }),
        ],
        tags=["realtime", "script", "control"],
    )
