"""
Orders, dispatch, tracking, payments and refunds.

The 14 `OrderState` values and the 10 `DispatchState` values each get a **complete order
object**, not a stub — the state table below drives which timestamps are set, whether a
rider exists, whether cancellation is still free, and what the deadline countdown shows.
"""

from __future__ import annotations

from typing import Any

from content import DAY, HOUR, MINUTE, ts
from dom_catalogue import KARACHI, standard_quote_lines
from money import (
    internal_money,
    order_lines_from_quote,
    order_money,
    price_quote,
    restaurant_money,
)
from synth import uuid_for
from world import address, halal_badge, order_restaurant_ref, rider_public_profile

ORDER_CODE = "HG-4K2M-9T"

# state -> (dispatch_state, has_rider, can_cancel, describes)
ORDER_STATES: dict[str, tuple[str | None, bool, bool, str]] = {
    "CREATED": (
        None,
        False,
        True,
        "Order exists, payment not yet authorised. 3-D Secure lives here — the order stays "
        "CREATED under its 15-minute deadline while `payment.action_required` is outstanding.",
    ),
    "AUTHORIZED": (
        None,
        False,
        True,
        "Card authorised, not captured. The restaurant has not been asked yet. Cancellation "
        "is still free.",
    ),
    "RESTAURANT_PENDING": (
        "PENDING",
        False,
        True,
        "The 180-second acceptance window is running (decision R-04). `deadline_at` is the "
        "only source of the countdown — never a local constant.",
    ),
    "PREPARING": (
        "SEARCHING",
        False,
        False,
        "Accepted and captured; the kitchen is cooking and dispatch is searching for a "
        "rider. Cancellation is no longer free.",
    ),
    "READY_FOR_PICKUP": (
        "ASSIGNED",
        True,
        False,
        "Food is on the pass, a rider is assigned and en route to the restaurant.",
    ),
    "PICKED_UP": (
        "CARRYING",
        True,
        False,
        "Rider has the bag. This is when `rider.location` starts publishing to the customer "
        "and the map goes live.",
    ),
    "ARRIVED": (
        "AT_CUSTOMER",
        True,
        False,
        "Rider is at the drop-off, proof of delivery not yet recorded.",
    ),
    "DELIVERED": (
        "COMPLETED",
        True,
        False,
        "Proof of delivery recorded. Not yet financially settled.",
    ),
    "COMPLETED": (
        "COMPLETED",
        True,
        False,
        "Terminal, happy. Receipt available, rating prompt allowed, refund window open.",
    ),
    "CANCELLED": (
        "UNASSIGNED",
        False,
        False,
        "Terminal. Cancelled by the customer before acceptance, so the authorisation was "
        "voided rather than captured and refunded.",
    ),
    "REJECTED": (
        "UNASSIGNED",
        False,
        False,
        "Terminal. The restaurant rejected it — `reject_reason: ITEM_UNAVAILABLE`. The "
        "authorisation is voided; no money ever moved.",
    ),
    "FAILED": (
        "NO_RIDER_FOUND",
        False,
        False,
        "Terminal. Dispatch exhausted every wave and found no rider "
        "(`cancel_reason: NO_RIDER_FOUND`). Fully refunded.",
    ),
    "DISPUTED": (
        "COMPLETED",
        True,
        False,
        "Delivered, then disputed by the customer. Support owns it; a refund is in flight.",
    ),
    "RESOLVED": (
        "COMPLETED",
        True,
        False,
        "Terminal. The dispute was settled with a partial refund and the case closed.",
    ),
}

TERMINAL = {"COMPLETED", "CANCELLED", "REJECTED", "FAILED", "RESOLVED"}


def _timestamps(state: str) -> dict[str, Any]:
    order = list(ORDER_STATES)
    reached = order.index(state) if state in order else 0

    def at(name: str, offset: int, needed_index: int) -> str | None:
        return ts(offset) if reached >= needed_index else None

    base = {
        "placed_at": ts(-32 * MINUTE),
        "accepted_at": at("accepted_at", -29 * MINUTE, 3),
        "ready_at": at("ready_at", -14 * MINUTE, 4),
        "picked_up_at": at("picked_up_at", -11 * MINUTE, 5),
        "delivered_at": at("delivered_at", -2 * MINUTE, 7),
        "completed_at": at("completed_at", -1 * MINUTE, 8),
    }
    if state in ("CANCELLED", "REJECTED", "FAILED"):
        base.update(
            {
                "accepted_at": None if state != "FAILED" else ts(-29 * MINUTE),
                "ready_at": None if state != "FAILED" else ts(-14 * MINUTE),
                "picked_up_at": None,
                "delivered_at": None,
                "completed_at": None,
            }
        )
    if state in ("DISPUTED", "RESOLVED"):
        base.update(
            {
                "accepted_at": ts(-29 * MINUTE),
                "ready_at": ts(-14 * MINUTE),
                "picked_up_at": ts(-11 * MINUTE),
                "delivered_at": ts(-2 * MINUTE),
                "completed_at": ts(-1 * MINUTE) if state == "RESOLVED" else None,
            }
        )
    if state == "CREATED":
        base["placed_at"] = ts(-90)
    return base


def _deadline(state: str) -> str | None:
    """`deadline_at` is non-null on every non-terminal state (websocket.md §4.2)."""
    if state in TERMINAL:
        return None
    return {
        "CREATED": ts(13 * MINUTE + 30),  # 15-minute payment deadline
        "AUTHORIZED": ts(13 * MINUTE),
        "RESTAURANT_PENDING": ts(2 * MINUTE + 20),  # 180 s window, 100 s elapsed
        "PREPARING": ts(9 * MINUTE),
        "READY_FOR_PICKUP": ts(6 * MINUTE),
        "PICKED_UP": ts(13 * MINUTE),
        "ARRIVED": ts(4 * MINUTE),
        "DELIVERED": ts(30 * MINUTE),
        "DISPUTED": ts(2 * DAY),
    }.get(state)


def _eta(state: str) -> str | None:
    if state in TERMINAL or state in ("CREATED", "AUTHORIZED"):
        return None
    return ts(13 * MINUTE)


def _timeline(state: str) -> list[dict]:
    sequence = [
        ("CREATED", "CUSTOMER", -32 * MINUTE),
        ("AUTHORIZED", "SYSTEM", -32 * MINUTE + 4),
        ("RESTAURANT_PENDING", "SYSTEM", -31 * MINUTE),
        ("PREPARING", "RESTAURANT", -29 * MINUTE),
        ("READY_FOR_PICKUP", "RESTAURANT", -14 * MINUTE),
        ("PICKED_UP", "RIDER", -11 * MINUTE),
        ("ARRIVED", "RIDER", -3 * MINUTE),
        ("DELIVERED", "RIDER", -2 * MINUTE),
        ("COMPLETED", "SYSTEM", -1 * MINUTE),
    ]
    order = [s for s, _, _ in sequence]
    if state in order:
        cut = order.index(state) + 1
        chosen = sequence[:cut]
    elif state == "CANCELLED":
        chosen = sequence[:3] + [("CANCELLED", "CUSTOMER", -30 * MINUTE)]
    elif state == "REJECTED":
        chosen = sequence[:3] + [("REJECTED", "RESTAURANT", -30 * MINUTE)]
    elif state == "FAILED":
        chosen = sequence[:5] + [("FAILED", "SYSTEM", -6 * MINUTE)]
    elif state == "DISPUTED":
        chosen = sequence + [("DISPUTED", "CUSTOMER", -40)]
    else:  # RESOLVED
        chosen = sequence + [("DISPUTED", "CUSTOMER", -20 * MINUTE), ("RESOLVED", "SUPPORT", -40)]

    out = []
    previous = None
    for to_state, actor, offset in chosen:
        out.append(
            {
                "from_state": previous,
                "to_state": to_state,
                "actor_kind": actor,
                "reason": {
                    "CANCELLED": "Customer cancelled before the restaurant accepted",
                    "REJECTED": "Restaurant rejected: ITEM_UNAVAILABLE",
                    "FAILED": "No rider accepted after 3 dispatch waves",
                    "DISPUTED": "Customer reported a missing item",
                    "RESOLVED": "Partial refund issued and case closed",
                }.get(to_state),
                "at": ts(offset),
            }
        )
        previous = to_state
    return out


def customer_order(state: str, *, tip_cents: int = 700, label: str | None = None, **over: Any) -> dict:
    dispatch_state, has_rider, can_cancel, _ = ORDER_STATES[state]
    lines = standard_quote_lines()
    priced = price_quote(lines, tip_cents=tip_cents)
    stamps = _timestamps(state)
    out = {
        "id": uuid_for(f"order:{label or state.lower()}"),
        "code": ORDER_CODE if state == "PREPARING" else f"HG-{state[:2]}{state[-2:]}-{len(state)}X",
        "state": state,
        "state_since": ts(-90),
        "deadline_at": _deadline(state),
        "quote_id": uuid_for(f"quote:{state.lower()}"),
        "restaurant": order_restaurant_ref(0),
        "lines": order_lines_from_quote(lines),
        "money": order_money(priced),
        "delivery_address": address("home", 0),
        "delivery_instructions": ["LEAVE_AT_DOOR", "DO_NOT_RING_BELL"],
        "special_instructions": "Please leave it on the mat, not the shoe rack.",
        "rider": rider_public_profile() if has_rider else None,
        "dispatch_state": dispatch_state,
        "cancel_reason": {
            "CANCELLED": "CUSTOMER_CANCELLED",
            "FAILED": "NO_RIDER_FOUND",
        }.get(state),
        "reject_reason": "ITEM_UNAVAILABLE" if state == "REJECTED" else None,
        "eta_at": _eta(state),
        "delivery_code": None,
        "can_cancel": can_cancel,
        **stamps,
    }
    out.update(over)
    if "delivery_code" not in over:
        out["delivery_code"] = delivery_code(out["state"], out["delivery_instructions"])
    return out


# The 4-digit code the customer reads to the rider at a met handover (round-2 decisions,
# "Orders and delivery":
# https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#orders-and-delivery).
# Shown only while the order is out for delivery and the instruction asks the rider to meet
# the customer; an unattended drop is proved with a photo, so it shows no code.
DELIVERY_CODE = "4827"
MET_HANDOVER = {"MEET_AT_DOOR", "MEET_IN_LOBBY"}
OUT_FOR_DELIVERY = {"PICKED_UP", "ARRIVED"}


def delivery_code(state: str, instructions: list[str]) -> str | None:
    if state in OUT_FOR_DELIVERY and MET_HANDOVER.intersection(instructions):
        return DELIVERY_CODE
    return None


# The 4-digit code the kitchen reads to the rider at the counter (same decision). The
# restaurant sees it from acceptance until the rider has picked up; never before
# acceptance, never after pickup, and never on an order the customer collects.
PICKUP_CODE = "3051"


def _order_payment(order_state: str, priced: dict, **over: Any) -> dict:
    state = order_state
    payment_state = {
        "CREATED": "REQUIRES_ACTION",
        "AUTHORIZED": "REQUIRES_CAPTURE",
        "RESTAURANT_PENDING": "REQUIRES_CAPTURE",
        "CANCELLED": "CANCELED",
        "REJECTED": "CANCELED",
    }.get(state, "SUCCEEDED")
    captured = priced["total_cents"] if payment_state == "SUCCEEDED" else 0
    out = {
        "order_id": uuid_for(f"order:{state.lower()}"),
        "state": payment_state,
        "kind": "ORDER",
        "amount_authorized_cents": 0 if payment_state == "REQUIRES_ACTION" else priced["total_cents"],
        "amount_captured_cents": captured,
        "amount_refunded_cents": 0,
        "currency": "CAD",
        "card_brand": "visa",
        "card_last4": "4242",
        "wallet": None,
        "failure_code": None,
        "decline_code": None,
        "client_secret": "pi_3QkR7mE8xVn2LbQ1_secret_5cGvA9pQ" if payment_state == "REQUIRES_ACTION" else None,
        "authorized_at": None if payment_state == "REQUIRES_ACTION" else ts(-31 * MINUTE),
        "captured_at": ts(-29 * MINUTE) if payment_state == "SUCCEEDED" else None,
    }
    out.update(over)
    return out


def build(reg, synth) -> None:
    _customer_orders(reg)
    _order_lists(reg)
    _restaurant_orders(reg, synth)
    _admin_orders(reg, synth)
    _tracking(reg, synth)
    _receipts(reg)
    _payments(reg, synth)
    _refunds(reg, synth)
    _ratings(reg, synth)


def _customer_orders(reg) -> None:
    for state, (dispatch_state, _, _, describes) in ORDER_STATES.items():
        reg.add(
            f"order_{state.lower()}",
            "orders",
            "OrderCustomerView",
            describes,
            customer_order(state),
            operations=["getOrder", "getActiveOrder", "cancelOrder"],
            tags=["order-state-matrix"],
        )

    reg.add(
        "order_zero_tip",
        "orders",
        "OrderCustomerView",
        "A delivered order with **no tip**. The tip row still renders at $0.00, and the "
        "rider's earnings for this delivery are the delivery fee alone.",
        customer_order("COMPLETED", tip_cents=0, label="zero-tip"),
        operations=["getOrder"],
        tags=["edge", "money", "boundary"],
    )

    reg.add(
        "order_large_tip",
        "orders",
        "OrderCustomerView",
        "A CAD 100.00 tip — larger than the food. Catches percentage displays and "
        "fixed-width currency columns.",
        customer_order("COMPLETED", tip_cents=10000, label="large-tip"),
        operations=["getOrder"],
        tags=["edge", "money", "boundary"],
    )

    reg.add(
        "order_pickup_no_address",
        "orders",
        "OrderCustomerView",
        "A PICKUP order: `delivery_address` is null, `rider` is null, `dispatch_state` is "
        "null, delivery fee is 0. Every delivery-shaped affordance must disappear.",
        customer_order(
            "READY_FOR_PICKUP",
            label="pickup",
            delivery_address=None,
            delivery_instructions=[],
            rider=None,
            dispatch_state=None,
            money=order_money(price_quote(standard_quote_lines(), tip_cents=300, fulfilment="PICKUP")),
        ),
        operations=["getOrder"],
        tags=["edge", "state-matrix"],
    )

    reg.add(
        "order_single_line",
        "orders",
        "OrderCustomerView",
        "One line, quantity 1, no variant, no add-ons, no special instructions, no "
        "delivery notes — the sparsest legal order.",
        customer_order(
            "PREPARING",
            label="single-line",
            lines=order_lines_from_quote(standard_quote_lines()[:1]),
            money=order_money(price_quote(standard_quote_lines()[:1], tip_cents=200)),
            special_instructions=None,
            delivery_instructions=[],
        ),
        operations=["getOrder"],
        tags=["edge"],
    )

    # The delivery code across its states (round-2 decisions, "Orders and delivery":
    # https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#orders-and-delivery).
    # The state-matrix fixtures above are unattended drops, so they carry no code.
    met = dict(
        delivery_instructions=["MEET_AT_DOOR"],
        special_instructions="Buzz 1204 and I will come down.",
    )
    reg.add(
        "order_picked_up_meet_at_door",
        "orders",
        "OrderCustomerView",
        "Out for delivery to a **met handover** (`MEET_AT_DOOR`): `delivery_code` is set. The "
        "customer reads these 4 digits to the rider at the door; the rider is never shown them.",
        customer_order("PICKED_UP", label="meet-at-door-picked-up", **met),
        operations=["getOrder", "getActiveOrder"],
        tags=["delivery-code", "edge"],
    )
    reg.add(
        "order_arrived_meet_in_lobby",
        "orders",
        "OrderCustomerView",
        "The rider is in the lobby (`MEET_IN_LOBBY`) and `delivery_code` is set: the screen "
        "leads with the code. The same moment sends `order.rider_arrived` and a push.",
        customer_order(
            "ARRIVED",
            label="meet-in-lobby",
            delivery_instructions=["MEET_IN_LOBBY"],
            special_instructions="Lobby of the east tower; I will be at the front desk.",
        ),
        operations=["getOrder", "getActiveOrder"],
        tags=["delivery-code", "edge"],
    )
    reg.add(
        "order_arrived_delivery_code_locked",
        "orders",
        "OrderCustomerView",
        "A met handover where five wrong codes have **locked** the delivery code: "
        "`delivery_code` is null, so the screen stops asking the customer to read it out. "
        "The rider falls back to a photo with a statement.",
        customer_order("ARRIVED", label="delivery-code-locked", delivery_code=None, **met),
        operations=["getOrder", "getActiveOrder"],
        tags=["delivery-code", "edge", "error-path"],
    )
    reg.add(
        "order_delivered_meet_at_door",
        "orders",
        "OrderCustomerView",
        "The met handover is done: `delivery_code` is null again once the order is "
        "`DELIVERED`, so an old code is never left on screen.",
        customer_order("DELIVERED", label="meet-at-door-delivered", **met),
        operations=["getOrder"],
        tags=["delivery-code", "edge"],
    )

    reg.add(
        "order_no_active",
        "orders",
        "OrderCustomerView|null",
        "`getActiveOrder` with nothing in flight. The contract returns **null data**, not "
        "404 and not an empty array — one active order per customer (contradiction log #24).",
        None,
        operations=["getActiveOrder"],
        tags=["edge", "empty"],
    )


def _order_lists(reg) -> None:
    def summary(state: str, index: int) -> dict:
        order = customer_order(state)
        return {
            "id": order["id"],
            "code": order["code"],
            "state": state,
            "restaurant": order["restaurant"],
            "item_count": sum(l["quantity"] for l in order["lines"]),
            "first_item_names": [l["name"] for l in order["lines"][:2]],
            "total_cents": order["money"]["total_cents"],
            "currency": "CAD",
            "placed_at": order["placed_at"],
            "deadline_at": order["deadline_at"],
        }

    reg.add(
        "order_list_active",
        "orders",
        "array<OrderSummary>",
        "The one order a customer may have in flight (`status_group=ACTIVE`).",
        [summary("PREPARING", 0)],
        operations=["listOrders", "listOrdersAdmin"],
        meta={"next_cursor": None, "has_more": False, "total": 1},
    )

    reg.add(
        "order_list_past",
        "orders",
        "array<OrderSummary>",
        "Order history: completed, cancelled, rejected and resolved side by side, so the "
        "history row's state chip is exercised across colours.",
        [summary(s, i) for i, s in enumerate(["COMPLETED", "CANCELLED", "REJECTED", "RESOLVED", "FAILED"])],
        operations=["listOrders", "listOrdersAdmin"],
        meta={"next_cursor": "01K4S9ZC0F8V7Q2R3T5Y6M8N9P", "has_more": True, "total": 23},
    )

    reg.add(
        "order_list_empty",
        "orders",
        "array<OrderSummary>",
        "A customer who has never ordered. First-run empty state.",
        [],
        operations=["listOrders"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty"],
    )


def _restaurant_orders(reg, synth) -> None:
    def restaurant_order(state: str, **over: Any) -> dict:
        lines = standard_quote_lines()
        priced = price_quote(lines, tip_cents=700)
        base = customer_order(state)
        accepted = base["accepted_at"] is not None
        out = {
            "id": base["id"],
            "code": base["code"],
            "state": state,
            "deadline_at": base["deadline_at"],
            "promised_ready_at": ts(9 * MINUTE) if accepted else None,
            "customer": {"display_name": "Ayesha R.", "phone_masked": "+1 416 ••• 0142"},
            "delivery_area": "Greektown",
            # §5: the restaurant does NOT see the delivery address until ACCEPTED.
            "delivery_address": address("home", 0) if accepted else None,
            "delivery_instructions": ["LEAVE_AT_DOOR", "DO_NOT_RING_BELL"],
            "special_instructions": "Please leave it on the mat, not the shoe rack.",
            "lines": order_lines_from_quote(lines),
            "money": restaurant_money(priced),
            "rider": (
                {
                    "display_name": "Bilal S.",
                    "photo_url": base["rider"]["photo_url"],
                    "vehicle_type": "SCOOTER",
                    "eta_at": ts(6 * MINUTE),
                }
                if base["rider"]
                else None
            ),
            # From acceptance until the rider has picked up; the rider is never sent it.
            "pickup_code": PICKUP_CODE if state in ("PREPARING", "READY_FOR_PICKUP") else None,
            "elapsed_seconds": 100 if state == "RESTAURANT_PENDING" else 1920,
            "is_late": state == "PREPARING",
            "placed_at": base["placed_at"],
            "accepted_at": base["accepted_at"],
            "ready_at": base["ready_at"],
        }
        out.update(over)
        return out

    for state, note in [
        ("RESTAURANT_PENDING", "The incoming-order card with 80 s left on the 180 s window. "
                               "**No delivery address and no pickup code yet** — both are "
                               "withheld until acceptance."),
        ("PREPARING", "Accepted and overdue (`is_late: true`). The address is now present, and "
                      "so is the 4-digit `pickup_code` the kitchen will read to the rider."),
        ("READY_FOR_PICKUP", "On the pass, rider assigned with an ETA to the restaurant. The "
                             "screen shows `pickup_code` large, for the kitchen to read out."),
        ("PICKED_UP", "Collected: the rider typed the right pickup code, so `pickup_code` is "
                      "null again. The tablet's job is done."),
        ("REJECTED", "Rejected by the kitchen for ITEM_UNAVAILABLE. Never a pickup code."),
    ]:
        reg.add(
            f"restaurant_order_{state.lower()}",
            "orders",
            "OrderRestaurantView",
            note,
            restaurant_order(state),
            operations=[
                "getRestaurantOrder",
                "listRestaurantOrders",
                "acceptOrder",
                "rejectOrder",
                "markOrderReady",
                "delayOrder",
            ],
            tags=["restaurant", "order-state-matrix"],
        )

    reg.add(
        "restaurant_order_queue_empty",
        "orders",
        "array<OrderRestaurantView>",
        "A quiet kitchen — no orders in any state. The tablet's idle screen.",
        [],
        operations=["listRestaurantOrders"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty", "restaurant"],
    )

    reg.add(
        "restaurant_order_queue_busy",
        "orders",
        "array<OrderRestaurantView>",
        "Friday 19:00: two pending, three preparing, one late, one ready. Sorted with "
        "RESTAURANT_PENDING first by `deadline_at` ascending, per R-23.",
        [
            restaurant_order("RESTAURANT_PENDING", elapsed_seconds=150, deadline_at=ts(30)),
            restaurant_order("RESTAURANT_PENDING", elapsed_seconds=20, deadline_at=ts(160)),
            restaurant_order("PREPARING", is_late=True),
            restaurant_order("PREPARING", is_late=False),
            restaurant_order("PREPARING", is_late=False),
            restaurant_order("READY_FOR_PICKUP"),
        ],
        operations=["listRestaurantOrders"],
        meta={"next_cursor": None, "has_more": False, "total": 6},
        tags=["restaurant", "dense"],
    )


def _admin_orders(reg, synth) -> None:
    def admin_order(state: str, **over: Any) -> dict:
        lines = standard_quote_lines()
        priced = price_quote(lines, tip_cents=700)
        base = customer_order(state)
        ledger = [
            {
                **synth.make("LedgerEntry", f"ledger-{state}-{i}"),
                "account": acct,
                "component": comp,
                "amount_cents": amount,
                "currency": "CAD",
            }
            for i, (acct, comp, amount) in enumerate(
                [
                    ("CUSTOMER_CHARGES", "SUBTOTAL", -priced["total_cents"]),
                    ("RESTAURANT_PAYABLE", "SUBTOTAL", priced["subtotal_cents"]),
                    ("RIDER_PAYABLE", "TIP", priced["tip_cents"]),
                    ("PLATFORM_REVENUE", "SERVICE_FEE", priced["service_fee_cents"]),
                ]
            )
        ]
        # The support projection never carries the customer's delivery code.
        base.pop("delivery_code")
        out = {
            **base,
            "timeline": _timeline(state),
            "dispatch_history": [
                {"state": "PENDING", "wave": None, "radius_m": None, "rider_account_id": None, "offer_outcome": None, "at": ts(-29 * MINUTE)},
                {"state": "SEARCHING", "wave": 1, "radius_m": 3000, "rider_account_id": None, "offer_outcome": None, "at": ts(-28 * MINUTE)},
                {"state": "OFFERED", "wave": 1, "radius_m": 3000, "rider_account_id": uuid_for("account:rider:bilal"), "offer_outcome": "EXPIRED", "at": ts(-27 * MINUTE)},
                {"state": "OFFERED", "wave": 2, "radius_m": 6000, "rider_account_id": uuid_for("account:rider:omar"), "offer_outcome": "ACCEPTED", "at": ts(-16 * MINUTE)},
                {"state": "ASSIGNED", "wave": 2, "radius_m": 6000, "rider_account_id": uuid_for("account:rider:omar"), "offer_outcome": None, "at": ts(-16 * MINUTE)},
            ],
            "payment": _order_payment(state, priced),
            "refunds": [],
            "internal_money": internal_money(priced, ledger_entries=ledger),
            "pii_revealed": False,
        }
        out.update(over)
        return out

    reg.add(
        "order_admin_view_completed",
        "orders",
        "OrderAdminView",
        "The full admin projection: timeline, dispatch history across two waves, payment, "
        "the ledger decomposition and `pii_revealed: false` (unmasking needs a recorded "
        "justification).",
        admin_order("COMPLETED"),
        operations=["getOrderAdmin", "cancelOrderAdmin"],
        tags=["admin"],
    )

    disputed = admin_order("DISPUTED")
    disputed["refunds"] = [
        {
            "id": uuid_for("refund:disputed"),
            "order_id": disputed["id"],
            "kind": "PARTIAL_ITEMS",
            "scope": "PARTIAL_ITEMS",
            "reason_code": "ITEM_MISSING",
            "amount_cents": 1695,
            "tax_cents": 220,
            "currency": "CAD",
            "state": "PENDING_APPROVAL",
            "liability_split": {"platform_cents": 0, "restaurant_cents": 1695, "rider_cents": 0},
            "note": "Customer reports the biryani was missing from the bag.",
            "requested_at": ts(-18 * MINUTE),
            "settled_at": None,
            "failure_message": None,
        }
    ]
    reg.add(
        "order_admin_view_disputed",
        "orders",
        "OrderAdminView",
        "A delivered order in dispute with a partial refund awaiting approval and a "
        "liability split that puts the whole amount on the restaurant (O-04 is open; the "
        "split is computed at authorisation and stored).",
        disputed,
        operations=["getOrderAdmin"],
        tags=["admin", "error-path"],
    )

    reg.add(
        "order_admin_view_failed_no_rider",
        "orders",
        "OrderAdminView",
        "Three dispatch waves, eight riders offered, nobody accepted. The order failed and "
        "was fully refunded — the case `admin.dispatch_failure` fires on.",
        admin_order(
            "FAILED",
            dispatch_history=[
                {"state": "PENDING", "wave": None, "radius_m": None, "rider_account_id": None, "offer_outcome": None, "at": ts(-14 * MINUTE)},
                {"state": "SEARCHING", "wave": 1, "radius_m": 3000, "rider_account_id": None, "offer_outcome": None, "at": ts(-13 * MINUTE)},
                {"state": "SEARCHING", "wave": 2, "radius_m": 6000, "rider_account_id": None, "offer_outcome": None, "at": ts(-12 * MINUTE)},
                {"state": "SEARCHING", "wave": 3, "radius_m": 10000, "rider_account_id": None, "offer_outcome": None, "at": ts(-11 * MINUTE)},
                {"state": "NO_RIDER_FOUND", "wave": 3, "radius_m": 10000, "rider_account_id": None, "offer_outcome": None, "at": ts(-6 * MINUTE)},
            ],
        ),
        operations=["getOrderAdmin"],
        tags=["admin", "error-path"],
    )


def _tracking(reg, synth) -> None:
    for state, dispatch_state, note in [
        ("PREPARING", "SEARCHING", "Kitchen cooking, no rider yet — the map shows the restaurant only."),
        ("READY_FOR_PICKUP", "ASSIGNED", "Rider assigned and approaching the restaurant."),
        ("PICKED_UP", "CARRYING", "Live rider position, precise (the customer projection)."),
        ("ARRIVED", "AT_CUSTOMER", "Rider at the door; the countdown is to handover."),
        ("DELIVERED", "COMPLETED", "Handover done; the map freezes at the last position."),
    ]:
        has_rider = dispatch_state in ("ASSIGNED", "CARRYING", "AT_CUSTOMER", "COMPLETED")
        reg.add(
            f"tracking_{state.lower()}",
            "orders",
            "OrderTracking",
            note,
            {
                "order_id": uuid_for(f"order:{state.lower()}"),
                "state": state,
                "dispatch_state": dispatch_state,
                "eta_at": None if state == "DELIVERED" else ts(13 * MINUTE),
                "eta_window_minutes": None if state == "DELIVERED" else 10,
                "restaurant_location": {"latitude": 43.6817, "longitude": -79.3403},
                "destination_location": {"latitude": 43.6412, "longitude": -79.3810},
                "rider_location": (
                    {
                        "latitude": 43.6598,
                        "longitude": -79.3652,
                        "heading_deg": 214.0,
                        "speed_mps": 7.4,
                        "accuracy_m": 12.0,
                        "recorded_at": ts(-8),
                        "is_coarse": False,
                    }
                    if has_rider
                    else None
                ),
                "rider": rider_public_profile() if has_rider else None,
                # These are unattended drops; the met-handover fixtures below carry a code.
                "delivery_code": None,
                "timeline": _timeline(state),
            },
            operations=["getOrderTracking"],
            tags=["tracking", "order-state-matrix"],
        )

    for state, dispatch_state, note in [
        ("PICKED_UP", "CARRYING", "Out for delivery to a met handover: the tracking screen "
                                  "shows the 4-digit `delivery_code` under the map, ready "
                                  "for the door."),
        ("ARRIVED", "AT_CUSTOMER", "The rider is in the lobby for a met handover. The screen "
                                   "leads with `delivery_code`; the customer reads it out."),
    ]:
        reg.add(
            f"tracking_{state.lower()}_delivery_code",
            "orders",
            "OrderTracking",
            note,
            {
                # The same orders as `order_picked_up_meet_at_door` and
                # `order_arrived_meet_in_lobby`.
                "order_id": uuid_for(
                    "order:meet-at-door-picked-up" if state == "PICKED_UP" else "order:meet-in-lobby"
                ),
                "state": state,
                "dispatch_state": dispatch_state,
                "eta_at": ts(13 * MINUTE) if state == "PICKED_UP" else ts(1 * MINUTE),
                "eta_window_minutes": 10,
                "restaurant_location": {"latitude": 43.6817, "longitude": -79.3403},
                "destination_location": {"latitude": 43.6412, "longitude": -79.3810},
                "rider_location": {
                    "latitude": 43.6598 if state == "PICKED_UP" else 43.6413,
                    "longitude": -79.3652 if state == "PICKED_UP" else -79.3808,
                    "heading_deg": 214.0,
                    "speed_mps": 7.4 if state == "PICKED_UP" else 0.0,
                    "accuracy_m": 12.0,
                    "recorded_at": ts(-8),
                    "is_coarse": False,
                },
                "rider": rider_public_profile(),
                "delivery_code": DELIVERY_CODE,
                "timeline": _timeline(state),
            },
            operations=["getOrderTracking"],
            tags=["tracking", "delivery-code"],
        )

    reg.add(
        "tracking_degraded_gps",
        "orders",
        "OrderTracking",
        "The rider's phone has not reported for 90 seconds — `accuracy_m` is 180 m and the "
        "position is stale. The map must degrade honestly, not interpolate.",
        {
            "order_id": uuid_for("order:picked_up"),
            "state": "PICKED_UP",
            "dispatch_state": "CARRYING",
            "eta_at": ts(16 * MINUTE),
            "eta_window_minutes": 15,
            "restaurant_location": {"latitude": 43.6817, "longitude": -79.3403},
            "destination_location": {"latitude": 43.6412, "longitude": -79.3810},
            "rider_location": {
                "latitude": 43.6700,
                "longitude": -79.3500,
                "heading_deg": None,
                "speed_mps": None,
                "accuracy_m": 180.0,
                "recorded_at": ts(-92),
                "is_coarse": True,
            },
            "rider": rider_public_profile(),
            "delivery_code": None,
            "timeline": _timeline("PICKED_UP"),
        },
        operations=["getOrderTracking"],
        tags=["tracking", "edge", "degraded"],
    )


def _ratings(reg, synth) -> None:
    order_id = uuid_for("order:completed")
    restaurant_id = uuid_for("restaurant:karachi-kitchen")

    reg.add(
        "order_rating_unrated",
        "orders",
        "OrderRating",
        "The customer has not rated this order yet. Neither half is an error state — C-38: "
        "skipping the post-delivery prompt is a first-class outcome, not a defect.",
        {"order_id": order_id, "food": None, "rider": None},
        operations=["getOrderRating"],
        tags=["ratings"],
    )

    food_rated_at = ts(-2 * 60 * MINUTE)
    reg.add(
        "order_rating_food_and_rider",
        "orders",
        "OrderRating",
        "Both targets rated in one `submitOrderRating` call — a 4-star food review with tags "
        "and a 5-star rider rating with tags, both `PUBLISHED` (no PII/profanity trip).",
        {
            "order_id": order_id,
            "food": {
                "order_id": order_id,
                "restaurant_id": restaurant_id,
                "score": 4,
                "review": "Solid biryani, arrived hot.",
                "tags": ["Food quality", "Speed"],
                "status": "PUBLISHED",
                "created_at": food_rated_at,
                "updated_at": food_rated_at,
            },
            "rider": {
                "order_id": order_id,
                "score": 5,
                "comment": "On time and courteous.",
                "tags": ["On time", "Polite"],
                "status": "PUBLISHED",
                "created_at": food_rated_at,
                "updated_at": food_rated_at,
            },
        },
        operations=["getOrderRating", "submitOrderRating"],
        tags=["ratings"],
    )

    pending_at = ts(-30 * MINUTE)
    reg.add(
        "order_rating_food_pending_moderation",
        "orders",
        "OrderRating",
        "The food review's free text matched the auto-moderation rules (C-38 rule 6: contains "
        "an email/phone/URL, or the customer has had 2+ reviews removed in 90 days) — "
        "`PENDING_MODERATION` and excluded from `restaurants.rating_avg` until a moderator acts.",
        {
            "order_id": order_id,
            "food": {
                "order_id": order_id,
                "restaurant_id": restaurant_id,
                "score": 3,
                "review": "Contact me at test@example.com if you want photos.",
                "tags": [],
                "status": "PENDING_MODERATION",
                "created_at": pending_at,
                "updated_at": pending_at,
            },
            "rider": None,
        },
        operations=["getOrderRating"],
        tags=["ratings", "edge"],
    )


def _receipts(reg) -> None:
    lines = standard_quote_lines()
    priced = price_quote(lines, tip_cents=700)
    base = {
        "order_id": uuid_for("order:completed"),
        "order_code": "HG-COED-9X",
        "receipt_number": "HG-2026-000148213",
        "issued_at": ts(-1 * MINUTE),
        "platform_legal_name": "HalalGoes Technologies Inc.",
        # O-01 is open: both registration numbers exist so either answer is expressible.
        "platform_tax_registration_number": "701234567RT0001",
        "restaurant_legal_name": "Karachi Kitchen Inc.",
        "restaurant_tax_registration_number": "812345678RT0001",
        "delivery_address": address("home", 0),
        "lines": order_lines_from_quote(lines),
        "money": order_money(priced),
        "payment": {
            "card_brand": "visa",
            "card_last4": "4242",
            "wallet": None,
            "amount_charged_cents": priced["total_cents"],
            "currency": "CAD",
        },
        "refunds": [],
        "placed_at": ts(-32 * MINUTE),
        "delivered_at": ts(-2 * MINUTE),
    }
    # Receipt.delivery_address is a PublicAddress, not an Address.
    base["delivery_address"] = {
        "line1": "88 Harbour Street",
        "line2": "Unit 4211",
        "city": "Toronto",
        "province": "ON",
        "postal_code": "M5J 0C3",
        "latitude": 43.6412,
        "longitude": -79.3810,
    }
    reg.add(
        "receipt_standard",
        "orders",
        "Receipt",
        "A completed delivery's receipt. Carries **both** tax registration numbers so "
        "either answer to O-01 (who is the supplier of record) renders without a schema "
        "change.",
        base,
        operations=["getOrderReceipt"],
    )

    refunded = dict(base)
    refunded["refunds"] = [
        {
            "id": uuid_for("refund:receipt"),
            "order_id": base["order_id"],
            "kind": "PARTIAL_ITEMS",
            "scope": "PARTIAL_ITEMS",
            "reason_code": "MISSING_ITEMS",
            "amount_cents": 1695,
            "tax_cents": 220,
            "currency": "CAD",
            "state": "SETTLED",
            "liability_split": {"platform_cents": 0, "restaurant_cents": 1915, "rider_cents": 0},
            "note": None,
            "requested_at": ts(-40 * MINUTE),
            "settled_at": ts(-30 * MINUTE),
            "failure_message": None,
        }
    ]
    reg.add(
        "receipt_with_refund",
        "orders",
        "Receipt",
        "The same receipt after a settled partial refund. Both spellings of the reason code "
        "exist in the enum (`ITEM_MISSING` and `MISSING_ITEMS`) — contradiction log #8 is "
        "still OPEN and this fixture uses the customer-spec spelling.",
        refunded,
        operations=["getOrderReceipt"],
        tags=["money"],
    )

    reg.add(
        "receipt_pickup_zero_tip",
        "orders",
        "Receipt",
        "Pickup, no tip, no delivery address. Two whole money rows are absent rather than "
        "zeroed.",
        {
            **base,
            "delivery_address": None,
            "money": order_money(price_quote(lines, tip_cents=0, fulfilment="PICKUP")),
            "payment": {
                "card_brand": None,
                "card_last4": None,
                "wallet": "apple_pay",
                "amount_charged_cents": price_quote(lines, tip_cents=0, fulfilment="PICKUP")["total_cents"],
                "currency": "CAD",
            },
        },
        operations=["getOrderReceipt"],
        tags=["edge", "money"],
    )


def _payments(reg, synth) -> None:
    lines = standard_quote_lines()
    priced = price_quote(lines, tip_cents=700)

    payment_notes = {
        "REQUIRES_PAYMENT_METHOD": "No card attached yet. Checkout has not been attempted.",
        "REQUIRES_CONFIRMATION": "Card attached, waiting on `confirm`. A brief transient state.",
        "REQUIRES_ACTION": "**3-D Secure challenge outstanding.** This is a normal path, not "
        "an error: the order stays CREATED under its 15-minute deadline and "
        "`client_secret` is present for the Stripe SDK.",
        "PROCESSING": "Submitted to the PSP, outcome unknown. The UI must not claim success.",
        "REQUIRES_CAPTURE": "Authorised, not captured. Capture happens only when the "
        "restaurant accepts; a rejection or timeout voids it.",
        "SUCCEEDED": "Captured. The happy terminal state.",
        "CANCELED": "The authorisation was voided — restaurant rejected or the customer "
        "cancelled in time. **No money ever moved.**",
        "FAILED": "The card was declined at capture (`capture_failed` / `card_declined`). "
        "The order is cancelled and nothing is owed.",
    }
    for state, note in payment_notes.items():
        extra: dict[str, Any] = {}
        if state == "REQUIRES_ACTION":
            extra = {
                "amount_authorized_cents": 0,
                "amount_captured_cents": 0,
                "client_secret": "pi_3QkR7mE8xVn2LbQ1_secret_5cGvA9pQ",
                "authorized_at": None,
                "captured_at": None,
            }
        elif state == "FAILED":
            extra = {
                "amount_authorized_cents": priced["total_cents"],
                "amount_captured_cents": 0,
                "failure_code": "card_declined",
                "decline_code": "insufficient_funds",
                "captured_at": None,
            }
        elif state in ("REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "PROCESSING"):
            extra = {
                "amount_authorized_cents": 0,
                "amount_captured_cents": 0,
                "card_brand": None if state == "REQUIRES_PAYMENT_METHOD" else "visa",
                "card_last4": None if state == "REQUIRES_PAYMENT_METHOD" else "4242",
                "authorized_at": None,
                "captured_at": None,
            }
        elif state == "REQUIRES_CAPTURE":
            extra = {"amount_captured_cents": 0, "captured_at": None}
        elif state == "CANCELED":
            extra = {"amount_authorized_cents": 0, "amount_captured_cents": 0, "captured_at": None}

        reg.add(
            f"payment_{state.lower()}",
            "payments",
            "OrderPayment",
            note,
            _order_payment("PREPARING", priced, state=state, **extra),
            operations=["getOrderPayment"],
            tags=["payment-state-matrix"],
        )

    reg.add(
        "payment_methods_list",
        "payments",
        "array<PaymentMethod>",
        "Three saved cards, one default.",
        [
            {"id": uuid_for("pm:visa"), "brand": "visa", "last4": "4242", "exp_month": 11, "exp_year": 2029, "is_default": True},
            {"id": uuid_for("pm:mc"), "brand": "mastercard", "last4": "5454", "exp_month": 3, "exp_year": 2027, "is_default": False},
            {"id": uuid_for("pm:amex"), "brand": "amex", "last4": "0005", "exp_month": 8, "exp_year": 2026, "is_default": False},
        ],
        operations=["listPaymentMethods", "setDefaultPaymentMethod"],
        meta={"next_cursor": None, "has_more": False, "total": 3},
    )

    reg.add(
        "payment_methods_empty",
        "payments",
        "array<PaymentMethod>",
        "No card on file. Checkout must route to the add-card sheet rather than failing.",
        [],
        operations=["listPaymentMethods"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty"],
    )

    reg.add(
        "payment_methods_at_limit",
        "payments",
        "array<PaymentMethod>",
        "Ten saved cards — the cap. Adding an eleventh is `409 PAYMENT_METHOD_LIMIT`.",
        [
            {
                "id": uuid_for(f"pm:limit:{i}"),
                "brand": ["visa", "mastercard", "amex"][i % 3],
                "last4": f"{4000 + i:04d}",
                "exp_month": (i % 12) + 1,
                "exp_year": 2027 + (i % 3),
                "is_default": i == 0,
            }
            for i in range(10)
        ],
        operations=["listPaymentMethods"],
        meta={"next_cursor": None, "has_more": False, "total": 10},
        tags=["edge", "boundary"],
    )

    reg.add(
        "setup_intent",
        "payments",
        "SetupIntent",
        "The client secret for attaching a new card. The card never touches our servers.",
        {"client_secret": "seti_1QkR7mE8xVn2LbQ1_secret_TzP4nR8wKcJ2"},
        operations=["createPaymentMethodSetupIntent"],
    )


def _refunds(reg, synth) -> None:
    refund_notes = {
        "REQUESTED": "Customer asked; nothing has been decided or authorised.",
        "PENDING_APPROVAL": "Above the agent's cap, waiting on a second approver "
        "(`SELF_APPROVAL_FORBIDDEN` blocks the requester from approving their own).",
        "APPROVED": "Approved, not yet sent to the PSP.",
        "AUTHORISED": "Authorised against the captured payment; the ledger entry exists.",
        "SUBMITTED": "Sent to Stripe, awaiting acknowledgement.",
        "SUCCEEDED": "Stripe accepted it. **Customer copy still reads 'refund in progress'** "
        "until SETTLED — money has not reached the card yet.",
        "SETTLED": "Funds are back on the card. The only state that may say 'refunded'.",
        "FAILED": "The PSP rejected the refund. Carries `failure_message`; support must "
        "intervene, and the customer must never be told they were refunded.",
        "DECLINED": "A human declined the request, with a reason.",
        "CANCELLED": "Withdrawn before authorisation — no money moved.",
    }
    for state, note in refund_notes.items():
        settled = state == "SETTLED"
        reg.add(
            f"refund_{state.lower()}",
            "refunds",
            "Refund",
            note,
            {
                "id": uuid_for(f"refund:{state.lower()}"),
                "order_id": uuid_for("order:completed"),
                "kind": "PARTIAL_ITEMS",
                "scope": "PARTIAL_ITEMS",
                "reason_code": "ITEM_MISSING",
                "amount_cents": 1695,
                "tax_cents": 220,
                "currency": "CAD",
                "state": state,
                "liability_split": {"platform_cents": 0, "restaurant_cents": 1915, "rider_cents": 0},
                "note": "Biryani missing from a three-item bag.",
                "requested_at": ts(-40 * MINUTE),
                "settled_at": ts(-30 * MINUTE) if settled else None,
                "failure_message": (
                    "Stripe rejected the refund: the charge is older than 180 days."
                    if state == "FAILED"
                    else None
                ),
            },
            operations=["getRefund", "listRefunds", "createRefund", "issueRefund"],
            tags=["refund-state-matrix"],
        )

    reg.add(
        "refund_full_never_delivered",
        "refunds",
        "Refund",
        "A full refund for an order that never arrived. Note both spellings survive in the "
        "enum (`NEVER_DELIVERED` / `ORDER_NEVER_ARRIVED`) — contradiction log #8 is OPEN.",
        {
            "id": uuid_for("refund:full"),
            "order_id": uuid_for("order:failed"),
            "kind": "FULL",
            "scope": "FULL",
            "reason_code": "ORDER_NEVER_ARRIVED",
            "amount_cents": 6706,
            "tax_cents": 691,
            "currency": "CAD",
            "state": "SETTLED",
            "liability_split": {"platform_cents": 6706, "restaurant_cents": 0, "rider_cents": 0},
            "note": None,
            "requested_at": ts(-2 * HOUR),
            "settled_at": ts(-1 * HOUR),
            "failure_message": None,
        },
        operations=["getRefund"],
        tags=["money"],
    )

    reg.add(
        "refund_goodwill_admin",
        "refunds",
        "Refund",
        "Admin goodwill — the only refund carrying a client-supplied `amount_cents`, capped "
        "and dual-approved (one of exactly three money-in-request allowlist entries).",
        {
            "id": uuid_for("refund:goodwill"),
            "order_id": uuid_for("order:disputed"),
            "kind": "GOODWILL",
            "scope": "PARTIAL_AMOUNT",
            "reason_code": "GOODWILL",
            "amount_cents": 1000,
            "tax_cents": 0,
            "currency": "CAD",
            "state": "PENDING_APPROVAL",
            "liability_split": {"platform_cents": 1000, "restaurant_cents": 0, "rider_cents": 0},
            "note": "Third late delivery this month; retention call.",
            "requested_at": ts(-5 * MINUTE),
            "settled_at": None,
            "failure_message": None,
        },
        operations=["issueRefund"],
        tags=["admin", "money"],
    )

    reg.add(
        "refund_list_empty",
        "refunds",
        "array<Refund>",
        "No refunds on this account — the common case.",
        [],
        operations=["listRefunds"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty"],
    )

    reg.add(
        "refund_approval_request_pending",
        "refunds",
        "RefundApprovalRequest",
        "A refund over the agent's cap: `202 Accepted` with the approval request, not a "
        "`201` refund. The two-response shape of `issueRefund`.",
        {
            "id": uuid_for("approval:pending"),
            "order_id": uuid_for("order:disputed"),
            "proposed_amount_cents": 4500,
            "currency": "CAD",
            "required_role": "ADMIN",
            "case_id": uuid_for("case:disputed"),
            "status": "PENDING",
            "requested_at": ts(-5 * MINUTE),
        },
        operations=["issueRefund"],
        status=202,
        tags=["admin"],
    )
