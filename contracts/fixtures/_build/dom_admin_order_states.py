"""Admin order states the order workspace draws and no fixture used to describe (issue #1006).

https://github.com/shaiknoorullah/hg-mono/issues/1006

Every state here is reachable on the order state machine
(https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/01-platform.md#p-14--order-lifecycle-states-and-transitions);
each fixture's description names the transition that gets an order there. The two rules that
decide most of them:

* `FAILED` is only ever a permanently failed payment, before the restaurant saw the order. A
  cancel reason never sits on a `FAILED` order.
* Dispatch never cancels an order. "No rider found" is a dispatch state on an order that is still
  `READY_FOR_PICKUP`; the system cancels it (`CANCELLED`) when the pickup deadline runs out its
  escalations.

Nothing here is a design board's copy: the boards draw one restaurant, one card and one set of
amounts each, while the fixtures share the contract's frozen clock and its one priced quote.
"""

from __future__ import annotations

from typing import Any

from content import DAY, HOUR, MINUTE, ts
from dom_catalogue import standard_quote_lines
from dom_orders import (
    ADMIN_STAFF,
    CUSTOMER,
    SUPPORT_AGENT,
    _money_event,
    customer_order,
    order_admin_view,
)
from money import internal_money, price_quote
from synth import uuid_for
from world import rider_public_profile

PRICED = price_quote(standard_quote_lines(), tip_cents=700)
TOTAL = PRICED["total_cents"]
RIDER_OMAR = uuid_for("account:rider:omar")
RIDER_BILAL = uuid_for("account:rider:bilal")


# ---------------------------------------------------------------- building blocks --


def _timeline(steps: list[tuple]) -> list[dict]:
    """`OrderTransition[]` from `(to_state, actor_kind, offset_seconds[, reason])`, oldest first."""
    out, previous = [], None
    for step in steps:
        to_state, actor, offset = step[:3]
        out.append(
            {
                "from_state": previous,
                "to_state": to_state,
                "actor_kind": actor,
                "reason": step[3] if len(step) > 3 else None,
                "at": ts(offset),
            }
        )
        previous = to_state
    return out


def _dispatch(*rows: tuple) -> list[dict]:
    """`(state, wave, radius_m, rider, outcome, offset_seconds)` rows of the dispatch history."""
    return [
        {
            "state": state,
            "wave": wave,
            "radius_m": radius,
            "rider_account_id": rider,
            "offer_outcome": outcome,
            "at": ts(offset),
        }
        for state, wave, radius, rider, outcome, offset in rows
    ]


def _payment(order_id: str, state: str, *, authorized: int, captured: int, refunded: int = 0,
             authorized_at: int | None = None, captured_at: int | None = None) -> dict:
    return {
        "order_id": order_id,
        "state": state,
        "kind": "ORDER",
        "amount_authorized_cents": authorized,
        "amount_captured_cents": captured,
        "amount_refunded_cents": refunded,
        "currency": "CAD",
        "card_brand": "visa",
        "card_last4": "4242",
        "wallet": None,
        "failure_code": None,
        "decline_code": None,
        "client_secret": None,
        "authorized_at": ts(authorized_at) if authorized_at is not None else None,
        "captured_at": ts(captured_at) if captured_at is not None else None,
    }


def _refund(order_id: str, key: str, kind: str, reason: str, amount: int, state: str, *,
            requested: int, settled: int | None = None, split: tuple[int, int, int] | None = None,
            note: str | None = None, failure: str | None = None, scope: str | None = None,
            tax: int = 0) -> dict:
    """A `Refund` as the order carries it. `split` is (platform, restaurant, rider): the server
    computes it when it authorises the refund, so a refund not yet authorised has none."""
    return {
        "id": uuid_for(f"refund:admin-states:{key}"),
        "order_id": order_id,
        "kind": kind,
        "scope": scope,
        "reason_code": reason,
        "amount_cents": amount,
        "tax_cents": tax,
        "currency": "CAD",
        "state": state,
        "liability_split": (
            {"platform_cents": split[0], "restaurant_cents": split[1], "rider_cents": split[2]} if split else None
        ),
        "note": note,
        "requested_at": ts(requested),
        "settled_at": ts(settled) if settled is not None else None,
        "failure_message": failure,
    }


def _ledger(synth, key: str, rows: list[tuple]) -> list[dict]:
    """`(batch_kind, account, component, amount_cents, offset_seconds)`; one batch per kind and time."""
    out = []
    for i, (kind, account, component, amount, offset) in enumerate(rows):
        entry = synth.make("LedgerEntry", f"ledger-admin-states-{key}-{i}")
        entry.update(
            {
                "batch_id": uuid_for(f"batch:admin-states:{key}:{kind}:{offset}"),
                "batch_kind": kind,
                "account": account,
                "component": component,
                "counterparty_type": None,
                "counterparty_id": None,
                "amount_cents": amount,
                "currency": "CAD",
                "memo": None,
                "posted_at": ts(offset),
            }
        )
        out.append(entry)
    assert sum(r[3] for r in rows) == 0, f"{key}: the ledger does not sum to zero"
    return out


def _capture(at: int, total: int = TOTAL) -> list[tuple]:
    return [("CAPTURE", "CUSTOMER_CHARGES", "SUBTOTAL", -total, at), ("CAPTURE", "PSP_CLEARING", "SUBTOTAL", total, at)]


def _reversal(at: int, amount: int) -> list[tuple]:
    return [("REFUND", "CUSTOMER_CHARGES", "REFUND", amount, at), ("REFUND", "PSP_CLEARING", "REFUND", -amount, at)]


def _settle(at: int) -> list[tuple]:
    """The delivery batch: clearing is released to the restaurant, the platform, the rider and tax."""
    return [
        ("SETTLE", "PSP_CLEARING", "SUBTOTAL", -TOTAL, at),
        ("SETTLE", "RESTAURANT_PAYABLE", "SUBTOTAL", PRICED["subtotal_cents"], at),
        ("SETTLE", "PLATFORM_REVENUE", "SERVICE_FEE", PRICED["service_fee_cents"], at),
        ("SETTLE", "RIDER_PAYABLE", "DELIVERY_FEE", PRICED["delivery_fee_cents"], at),
        ("SETTLE", "RIDER_PAYABLE", "TIP", PRICED["tip_cents"], at),
        ("SETTLE", "TAX_PAYABLE", "TAX", PRICED["tax_total_cents"], at),
    ]


def _money_timeline(payment: dict, extra: list[dict]) -> list[dict]:
    events = []
    if payment["authorized_at"]:
        events.append(_money_event("PAYMENT_AUTHORISED", payment["authorized_at"], payment["amount_authorized_cents"], "SYSTEM"))
    if payment["captured_at"]:
        events.append(_money_event("PAYMENT_CAPTURED", payment["captured_at"], payment["amount_captured_cents"], "SYSTEM"))
    return events + extra


def _refund_events(refund: dict, requester: str, requester_id: str | None) -> list[dict]:
    """The money-timeline steps a refund has reached, from the request to its present state."""
    state, rid = refund["state"], refund["id"]
    amount = refund["amount_cents"]
    out = [_money_event("REFUND_REQUESTED", refund["requested_at"], amount, requester, actor=requester_id, refund_id=rid,
                        reason=refund["note"])]
    if state in ("AUTHORISED", "SUBMITTED", "SUCCEEDED", "SETTLED", "FAILED"):
        out.append(_money_event("REFUND_SUBMITTED", refund["requested_at"], amount, "SYSTEM", refund_id=rid))
    if state in ("SUCCEEDED", "SETTLED"):
        out.append(_money_event("REFUND_SUCCEEDED", refund["settled_at"] or refund["requested_at"], amount, "WEBHOOK", refund_id=rid))
    if state == "FAILED":
        out.append(_money_event("REFUND_FAILED", refund["requested_at"], amount, "WEBHOOK", refund_id=rid, reason=refund["failure_message"]))
    return out


# -------------------------------------------------------------------- the fixtures --


def build(reg, synth) -> None:
    def make(name: str, state: str, base: dict, over: dict, describes: str, *, operations=None, tags=None) -> dict:
        """One `OrderAdminView` of `state`, id and code unique to `name`."""
        base = {"code": order_code(name), **base}
        view = order_admin_view(synth, state, base_over={"label": name, **base}, **over)
        view["quote_id"] = uuid_for(f"quote:admin-states:{name}")
        # The payment, ledger and money timeline belong to this order, not to the state's canonical one.
        view["payment"]["order_id"] = view["id"]
        for refund in view["refunds"]:
            refund["order_id"] = view["id"]
        reg.add(
            f"order_admin_view_{name}",
            "orders",
            "OrderAdminView",
            describes,
            view,
            operations=operations or ["getOrderAdmin"],
            tags=tags or ["admin", "order-state-matrix"],
        )
        return view

    def money(view_key: str, rows: list[tuple]) -> dict:
        entries = _ledger(synth, view_key, rows)
        return {"internal_money": {**internal_money(PRICED, ledger_entries=entries)}}

    # Offsets from the frozen clock, in seconds.
    PLACED, ACCEPTED, READY, PICKED_UP, ARRIVED, DELIVERED = -32 * MINUTE, -29 * MINUTE, -14 * MINUTE, -11 * MINUTE, -3 * MINUTE, -2 * MINUTE
    created = ("CREATED", "CUSTOMER", PLACED)
    authorised = ("AUTHORIZED", "SYSTEM", PLACED + 4)
    pending = ("RESTAURANT_PENDING", "SYSTEM", -31 * MINUTE)
    preparing = ("PREPARING", "RESTAURANT", ACCEPTED)
    ready = ("READY_FOR_PICKUP", "RESTAURANT", READY)
    picked_up = ("PICKED_UP", "RIDER", PICKED_UP)
    arrived = ("ARRIVED", "RIDER", ARRIVED)
    delivered = ("DELIVERED", "RIDER", DELIVERED)
    completed = ("COMPLETED", "SYSTEM", -1 * MINUTE)

    searched = _dispatch(
        ("PENDING", None, None, None, None, ACCEPTED),
        ("SEARCHING", 1, 3000, None, None, ACCEPTED + 20),
        ("OFFERED", 1, 3000, RIDER_BILAL, "EXPIRED", ACCEPTED + 30),
        ("OFFERED", 2, 6000, RIDER_OMAR, "ACCEPTED", ACCEPTED + 3 * MINUTE),
        ("ASSIGNED", 2, 6000, RIDER_OMAR, None, ACCEPTED + 3 * MINUTE),
    )

    # ---- cancel results: what `cancelOrderAdmin` answers with --------------------------------
    cancelled_now = -10
    for name, who, text in (
        ("cancel_result_void", "an admin",
         "An admin cancelled it before the restaurant accepted: the customer called to say they ordered to the wrong address."),
        ("cancel_result_void_support", "a support agent",
         "A support agent cancelled it before the restaurant accepted: the customer called to say they ordered to the wrong address."),
    ):
        order_id = uuid_for(f"order:{name}")
        payment = _payment(order_id, "CANCELED", authorized=TOTAL, captured=0, authorized_at=-31 * MINUTE)
        make(
            name, "CANCELLED",
            {"cancel_reason": "SUPPORT_CANCELLED", "dispatch_state": None, "rider": None, "eta_at": None,
             "state_since": ts(cancelled_now), "accepted_at": None, "placed_at": ts(-31 * MINUTE)},
            {"timeline": _timeline([("CREATED", "CUSTOMER", -31 * MINUTE), ("AUTHORIZED", "SYSTEM", -31 * MINUTE + 3),
                                    ("RESTAURANT_PENDING", "SYSTEM", -31 * MINUTE + 3),
                                    ("CANCELLED", "ADMIN", cancelled_now, "Customer called: ordered to the wrong address")]),
             "dispatch_history": [], "payment": payment, "refunds": [],
             "money_timeline": _money_timeline(payment, [
                 _money_event("PAYMENT_VOIDED", ts(cancelled_now), TOTAL, "ACCOUNT", actor=ADMIN_STAFF)]),
             **money(name, [])},
            f"`cancelOrderAdmin` answered for {who} cancelling an order that was waiting for the restaurant. "
            "The authorisation is voided and nothing was captured, so there is no refund and no ledger posting. "
            "The timeline records the actor as `ADMIN` either way: before acceptance the order machine records a "
            "staff cancel as an admin's, whichever role made it.",
            operations=["cancelOrderAdmin", "getOrderAdmin"], tags=["admin"],
        )

    name = "cancel_result_refund"
    order_id = uuid_for(f"order:{name}")
    refund = _refund(order_id, name, "FULL", "PLATFORM_INITIATED_CANCELLATION", TOTAL, "SUBMITTED", requested=cancelled_now,
                     split=(TOTAL, 0, 0), note="Kitchen confirmed by phone it can’t finish the order before 7:30 pm.", scope="FULL",
                     tax=PRICED["tax_total_cents"])
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=-31 * MINUTE, captured_at=ACCEPTED)
    make(
        name, "CANCELLED",
        {"cancel_reason": "SUPPORT_CANCELLED", "dispatch_state": None, "rider": None, "eta_at": None,
         "state_since": ts(cancelled_now), "accepted_at": ts(ACCEPTED), "placed_at": ts(PLACED)},
        {"timeline": _timeline([created, authorised, pending, preparing,
                                ("CANCELLED", "ADMIN", cancelled_now, "Cancelled by support: the kitchen can’t finish the order")]),
         "dispatch_history": searched, "payment": payment, "refunds": [refund],
         "money_timeline": _money_timeline(payment, _refund_events(refund, "ACCOUNT", ADMIN_STAFF)),
         **money(name, _capture(ACCEPTED) + _reversal(cancelled_now, TOTAL))},
        "`cancelOrderAdmin` answered for an admin cancelling an order after the restaurant accepted it, while it was "
        "still being prepared. Cancelling after acceptance always authorises a whole-order refund in the same "
        "transaction; here it has been sent to the provider and is waiting for it to confirm, so the payment still "
        "shows nothing refunded.",
        operations=["cancelOrderAdmin", "getOrderAdmin"], tags=["admin"],
    )

    # ---- cancelled by the system -------------------------------------------------------------
    name = "cancelled_no_rider"
    order_id = uuid_for(f"order:{name}")
    a, rdy, gone = -92 * MINUTE, -47 * MINUTE, -2 * MINUTE
    refund = _refund(order_id, name, "FULL", "NO_RIDER_FOUND", TOTAL, "SUBMITTED", requested=gone, split=(TOTAL, 0, 0), scope="FULL",
                     tax=PRICED["tax_total_cents"])
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=a - 4 * MINUTE, captured_at=a)
    net = PRICED["subtotal_cents"]
    make(
        name, "CANCELLED",
        {"cancel_reason": "NO_RIDER_FOUND", "dispatch_state": "NO_RIDER_FOUND", "rider": None, "eta_at": None,
         "state_since": ts(gone), "placed_at": ts(a - 4 * MINUTE), "accepted_at": ts(a), "ready_at": ts(rdy)},
        {"timeline": _timeline([("CREATED", "CUSTOMER", a - 4 * MINUTE), ("AUTHORIZED", "SYSTEM", a - 4 * MINUTE + 4),
                                ("RESTAURANT_PENDING", "SYSTEM", a - 3 * MINUTE), ("PREPARING", "RESTAURANT", a),
                                ("READY_FOR_PICKUP", "RESTAURANT", rdy),
                                ("CANCELLED", "SYSTEM", gone, "No rider picked it up after 3 escalations")]),
         "dispatch_history": _dispatch(
             ("PENDING", None, None, None, None, a),
             ("SEARCHING", 1, 3000, None, None, a + MINUTE),
             ("SEARCHING", 2, 6000, None, None, a + 2 * MINUTE),
             ("SEARCHING", 3, 10000, None, None, a + 3 * MINUTE),
             ("NO_RIDER_FOUND", 3, 10000, None, None, a + 8 * MINUTE)),
         "payment": payment, "refunds": [refund],
         "money_timeline": _money_timeline(payment, _refund_events(refund, "SYSTEM", None)),
         # The customer is refunded in full, the restaurant is paid its net in full, and the platform absorbs
         # the cost. No rider was assigned, so no rider line posts.
         **money(name, _capture(a) + _reversal(gone, TOTAL) + [
             ("SETTLE", "RESTAURANT_PAYABLE", "SUBTOTAL", net, gone), ("SETTLE", "PLATFORM_ABSORBED", "SUBTOTAL", -net, gone)])},
        "Dispatch searched three waves out to 10 km and nobody accepted, which ends the search but never cancels the "
        "order: it stayed `READY_FOR_PICKUP` until its pickup deadline ran out its escalations, then the system "
        "cancelled it with `cancel_reason: NO_RIDER_FOUND`. The customer is refunded in full, the restaurant is paid "
        "in full and the platform absorbs the cost. This replaces the fixture that called the same order `FAILED`, "
        "which no transition produces. It is the case `admin.dispatch_failure` fires on.",
    )

    name = "cancelled_payment_expired"
    order_id = uuid_for(f"order:{name}")
    payment = _payment(order_id, "CANCELED", authorized=0, captured=0)
    make(
        name, "CANCELLED",
        {"cancel_reason": "PAYMENT_EXPIRED", "dispatch_state": None, "rider": None, "eta_at": None,
         "state_since": ts(-2 * MINUTE), "placed_at": ts(-17 * MINUTE), "accepted_at": None},
        {"timeline": _timeline([("CREATED", "CUSTOMER", -17 * MINUTE),
                                ("CANCELLED", "SYSTEM", -2 * MINUTE, "The payment wasn’t confirmed within 15 minutes")]),
         "dispatch_history": [], "payment": payment, "refunds": [], "money_timeline": [], **money(name, [])},
        "The customer never confirmed the payment, so at the 15-minute payment deadline the system cancelled the "
        "payment and the order (`cancel_reason: PAYMENT_EXPIRED`). Nothing was authorised or charged and the "
        "restaurant never saw the order.",
    )

    name = "cancelled_restaurant_closed"
    order_id = uuid_for(f"order:{name}")
    payment = _payment(order_id, "CANCELED", authorized=TOTAL, captured=0, authorized_at=-3 * MINUTE)
    make(
        name, "CANCELLED",
        {"cancel_reason": "RESTAURANT_CLOSED", "dispatch_state": None, "rider": None, "eta_at": None,
         "state_since": ts(-2 * MINUTE), "placed_at": ts(-3 * MINUTE), "accepted_at": None},
        {"timeline": _timeline([("CREATED", "CUSTOMER", -3 * MINUTE), ("AUTHORIZED", "SYSTEM", -3 * MINUTE + 20),
                                ("CANCELLED", "SYSTEM", -2 * MINUTE, "The restaurant wasn’t taking orders when it was offered")]),
         "dispatch_history": [], "payment": payment, "refunds": [],
         "money_timeline": _money_timeline(payment, [_money_event("PAYMENT_VOIDED", ts(-2 * MINUTE), TOTAL, "SYSTEM")]),
         **money(name, [])},
        "The payment was authorised, but the restaurant was closed or not accepting when the order was offered, so the "
        "system cancelled it (`cancel_reason: RESTAURANT_CLOSED`) and voided the authorisation. The restaurant never "
        "saw it and nothing was charged.",
    )

    name = "cancelled_timeout"
    order_id = uuid_for(f"order:{name}")
    payment = _payment(order_id, "CANCELED", authorized=TOTAL, captured=0, authorized_at=-5 * MINUTE)
    make(
        name, "CANCELLED",
        {"cancel_reason": "RESTAURANT_TIMEOUT", "dispatch_state": None, "rider": None, "eta_at": None,
         "state_since": ts(-2 * MINUTE), "placed_at": ts(-5 * MINUTE), "accepted_at": None},
        {"timeline": _timeline([("CREATED", "CUSTOMER", -5 * MINUTE), ("AUTHORIZED", "SYSTEM", -5 * MINUTE + 4),
                                ("RESTAURANT_PENDING", "SYSTEM", -5 * MINUTE + 8),
                                ("CANCELLED", "SYSTEM", -2 * MINUTE, "The restaurant didn’t answer within 180 seconds")]),
         "dispatch_history": [], "payment": payment, "refunds": [],
         "money_timeline": _money_timeline(payment, [_money_event("PAYMENT_VOIDED", ts(-2 * MINUTE), TOTAL, "SYSTEM")]),
         **money(name, [])},
        "The restaurant did not answer within the 180-second acceptance window, so the system cancelled the order "
        "(`cancel_reason: RESTAURANT_TIMEOUT`) and voided the authorisation. Nothing was charged.",
    )

    name = "cancelled_after_acceptance"
    order_id = uuid_for(f"order:{name}")
    done = -8 * MINUTE
    refund = _refund(order_id, name, "FULL", "PLATFORM_INITIATED_CANCELLATION", TOTAL, "SETTLED", requested=-12 * MINUTE, settled=done,
                     split=(TOTAL, 0, 0), scope="FULL", tax=PRICED["tax_total_cents"])
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, refunded=TOTAL, authorized_at=-31 * MINUTE, captured_at=ACCEPTED)
    make(
        name, "CANCELLED",
        {"cancel_reason": "SUPPORT_CANCELLED", "dispatch_state": None, "rider": None, "eta_at": None,
         "state_since": ts(-12 * MINUTE), "placed_at": ts(PLACED), "accepted_at": ts(ACCEPTED)},
        {"timeline": _timeline([created, authorised, pending, preparing,
                                ("CANCELLED", "ADMIN", -12 * MINUTE, "Cancelled by support")]),
         "dispatch_history": [], "payment": payment, "refunds": [refund],
         "money_timeline": _money_timeline(payment, _refund_events(refund, "ACCOUNT", ADMIN_STAFF)),
         **money(name, _capture(ACCEPTED) + _reversal(-12 * MINUTE, TOTAL))},
        "Staff cancelled the order while it was being prepared. The cancel and a whole-order refund were one "
        "transaction, and the provider has confirmed the refund, so everything captured has been refunded.",
    )

    # ---- delivered, with a refund that failed or settled ---------------------------------------
    delivered_steps = [created, authorised, pending, preparing, ready, picked_up, arrived, delivered]
    delivered_over = {"dispatch_history": searched}
    name = "delivered_refund_failed"
    order_id = uuid_for(f"order:{name}")
    settled_refund = _refund(order_id, f"{name}-1", "PARTIAL_ITEMS", "ITEM_MISSING", 1695, "SETTLED", requested=-100,
                             settled=-70, split=(0, 1695, 0), scope="PARTIAL_ITEMS", tax=220, note="The biryani was missing from the bag.")
    failed_refund = _refund(order_id, f"{name}-2", "GOODWILL", "GOODWILL", 500, "FAILED", requested=-40, split=(500, 0, 0),
                            scope="PARTIAL_AMOUNT", failure="The card issuer declined the refund.")
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, refunded=1695, authorized_at=-31 * MINUTE, captured_at=ACCEPTED)
    make(
        name, "DELIVERED",
        {"state_since": ts(DELIVERED), "deadline_at": ts(70), "placed_at": ts(PLACED), "accepted_at": ts(ACCEPTED),
         "ready_at": ts(READY), "picked_up_at": ts(PICKED_UP), "delivered_at": ts(DELIVERED), "dispatch_state": "COMPLETED"},
        {"timeline": _timeline(delivered_steps), "payment": payment, "refunds": [settled_refund, failed_refund],
         "money_timeline": _money_timeline(payment, _refund_events(settled_refund, "ACCOUNT", SUPPORT_AGENT)
                                           + _refund_events(failed_refund, "ACCOUNT", SUPPORT_AGENT)),
         **money(name, _capture(ACCEPTED) + _reversal(-70, 1695)), **delivered_over},
        "A delivered order, still `DELIVERED`, with one refund settled and a second one the provider refused. "
        "A failed refund holds settlement: the order is not allowed to reach `COMPLETED`, so its settlement "
        "deadline stays armed and re-arms on every attempt until a new refund succeeds.",
    )

    name = "delivered_refund_settled"
    order_id = uuid_for(f"order:{name}")
    refund = _refund(order_id, name, "PARTIAL_ITEMS", "ITEM_MISSING", 1695, "SETTLED", requested=-90, settled=-30, split=(0, 1695, 0),
                     scope="PARTIAL_ITEMS", tax=220, note="The biryani was missing from the bag.")
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, refunded=1695, authorized_at=-31 * MINUTE, captured_at=ACCEPTED)
    make(
        name, "DELIVERED",
        {"state_since": ts(DELIVERED), "deadline_at": ts(95), "placed_at": ts(PLACED), "accepted_at": ts(ACCEPTED),
         "ready_at": ts(READY), "picked_up_at": ts(PICKED_UP), "delivered_at": ts(DELIVERED), "dispatch_state": "COMPLETED"},
        {"timeline": _timeline(delivered_steps), "payment": payment, "refunds": [refund],
         "money_timeline": _money_timeline(payment, _refund_events(refund, "ACCOUNT", SUPPORT_AGENT)),
         **money(name, _capture(ACCEPTED) + _reversal(-30, 1695)), **delivered_over},
        "A delivered order, still `DELIVERED` and about to settle, with one refund the provider has confirmed. "
        "Nothing is failing, so nothing holds the settlement deadline.",
    )

    # ---- disputes opened at other points -------------------------------------------------------
    def dispute(name, steps, state_since, deadline, describes, **base):
        order_id = uuid_for(f"order:{name}")
        payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=-31 * MINUTE, captured_at=ACCEPTED)
        make(
            name, "DISPUTED",
            {"state_since": ts(state_since), "deadline_at": ts(deadline), "placed_at": ts(PLACED), "accepted_at": ts(ACCEPTED),
             "can_cancel": False, **base},
            {"timeline": _timeline(steps), "payment": payment, "refunds": [],
             "money_timeline": _money_timeline(payment, []), **money(name, _capture(ACCEPTED))},
            describes,
        )

    dispute(
        "disputed_delivered",
        delivered_steps + [("DISPUTED", "CUSTOMER", -1 * MINUTE, "Half the order is missing: no bread, no drinks")],
        -1 * MINUTE, 171900,
        "The customer reported a problem right after delivery, before the order settled, so it went from `DELIVERED` "
        "to `DISPUTED` and carries the 48-hour dispute deadline. It never reached `COMPLETED`.",
        ready_at=ts(READY), picked_up_at=ts(PICKED_UP), delivered_at=ts(DELIVERED), dispatch_state="COMPLETED", eta_at=None,
    )
    dispute(
        "disputed_mid_delivery",
        [created, authorised, pending, preparing, ready, picked_up,
         ("DISPUTED", "SUPPORT", -4 * MINUTE, "Customer says the rider is at the wrong building and won’t answer the phone")],
        -4 * MINUTE, 172500,
        "Support opened an incident while the rider was still carrying the order, so it went from `PICKED_UP` to "
        "`DISPUTED`. The rider still holds the delivery, so dispatch is `CARRYING`.",
        ready_at=ts(READY), picked_up_at=ts(PICKED_UP), dispatch_state="CARRYING", eta_at=ts(8 * MINUTE),
    )
    dispute(
        "disputed_restaurant",
        [created, authorised, pending, preparing, ready,
         ("DISPUTED", "RESTAURANT", -3 * MINUTE, "The wrong sauce went on the whole platter and we can’t remake it tonight")],
        -3 * MINUTE, 172300,
        "The restaurant reported an unrecoverable problem after marking the order ready and before any pickup, so it "
        "went from `READY_FOR_PICKUP` to `DISPUTED`. A rider had accepted it and is waiting for a decision.",
        ready_at=ts(READY), dispatch_state="ASSIGNED", eta_at=None,
    )

    # ---- refunds, halal concern and ledger batches on a completed order ------------------------
    # These orders completed three hours ago, so a refund asked for since lands after the delivery.
    EARLIER = -3 * HOUR
    completed_steps = [(to, actor, offset + EARLIER) for to, actor, offset in
                       (created, authorised, pending, preparing, ready, picked_up, arrived, delivered, completed)]
    c_accepted, c_settled = ACCEPTED + EARLIER, -1 * MINUTE + EARLIER
    completed_base = {"state_since": ts(c_settled), "deadline_at": None, "placed_at": ts(PLACED + EARLIER),
                      "accepted_at": ts(c_accepted), "ready_at": ts(READY + EARLIER), "picked_up_at": ts(PICKED_UP + EARLIER),
                      "delivered_at": ts(DELIVERED + EARLIER), "completed_at": ts(c_settled), "dispatch_state": "COMPLETED",
                      "eta_at": None}
    c_dispatch = _dispatch(
        ("PENDING", None, None, None, None, c_accepted),
        ("SEARCHING", 1, 3000, None, None, c_accepted + 20),
        ("OFFERED", 1, 3000, RIDER_BILAL, "EXPIRED", c_accepted + 30),
        ("OFFERED", 2, 6000, RIDER_OMAR, "ACCEPTED", c_accepted + 3 * MINUTE),
        ("ASSIGNED", 2, 6000, RIDER_OMAR, None, c_accepted + 3 * MINUTE),
    )
    c_authorised = -31 * MINUTE + EARLIER

    name = "halal_concern_refund"
    order_id = uuid_for(f"order:{name}")
    refund = _refund(order_id, name, "FULL", "HALAL_CONCERN", TOTAL, "REQUESTED", requested=-5 * MINUTE, scope="FULL",
                     tax=PRICED["tax_total_cents"], note="Raised by the customer from their app.")
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=c_authorised, captured_at=c_accepted)
    make(
        name, "COMPLETED", completed_base,
        {"timeline": _timeline(completed_steps), "payment": payment, "refunds": [refund], "dispatch_history": c_dispatch,
         "money_timeline": _money_timeline(payment, _refund_events(refund, "ACCOUNT", CUSTOMER)),
         **money(name, _capture(c_accepted) + _settle(c_settled))},
        "A completed order with a whole-order refund the customer raised as a halal concern. It is only `REQUESTED`: "
        "nothing is authorised yet, so the liability split is not computed (it is fixed when the refund is "
        "authorised, and depends on whether the complaint is upheld).",
    )

    name = "refund_states"
    order_id = uuid_for(f"order:{name}")
    rows = [
        ("req", "GOODWILL", "GOODWILL", 500, "REQUESTED", -22 * MINUTE, None, None, "PARTIAL_AMOUNT"),
        ("pend", "GOODWILL", "GOODWILL", 1200, "PENDING_APPROVAL", -20 * MINUTE, None, None, "PARTIAL_AMOUNT"),
        ("appr", "GOODWILL", "GOODWILL", 500, "APPROVED", -37 * MINUTE, None, None, "PARTIAL_AMOUNT"),
        ("auth", "PARTIAL_ITEMS", "FOOD_QUALITY", 1349, "AUTHORISED", -18 * MINUTE, (0, 1349, 0), None, "PARTIAL_ITEMS"),
        ("succ", "PARTIAL_ITEMS", "ITEM_MISSING", 499, "SUCCEEDED", -62 * MINUTE, (0, 499, 0), -60 * MINUTE, "PARTIAL_ITEMS"),
        ("decl", "GOODWILL", "GOODWILL", 800, "DECLINED", -72 * MINUTE, None, None, "PARTIAL_AMOUNT"),
        ("canc", "FULL", "PRICING_ERROR", TOTAL, "CANCELLED", -69 * MINUTE, None, None, "FULL"),
    ]
    refunds = [_refund(order_id, f"{name}-{k}", kind, reason, amt, st, requested=req, settled=sett, split=sp, scope=scope)
               for k, kind, reason, amt, st, req, sp, sett, scope in rows]
    # Every claim that can still move money fits what was captured (the sum of the live refunds is below it).
    live = sum(r["amount_cents"] for r in refunds if r["state"] not in ("DECLINED", "CANCELLED"))
    assert live <= TOTAL, live
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, refunded=499, authorized_at=c_authorised, captured_at=c_accepted)
    events = [e for r in refunds for e in _refund_events(r, "ACCOUNT", SUPPORT_AGENT)]
    make(
        name, "COMPLETED", completed_base,
        {"timeline": _timeline(completed_steps), "payment": payment, "refunds": refunds, "dispatch_history": c_dispatch,
         "money_timeline": _money_timeline(payment, events),
         **money(name, _capture(c_accepted) + _settle(c_settled) + _reversal(-60 * MINUTE, 499))},
        "A completed order carrying a refund in each state that has not been settled or failed: requested, waiting "
        "for a second approver, approved, authorised, succeeded, declined and withdrawn (settled and failed refunds "
        "have their own fixtures). Only the money the provider has confirmed shows as refunded on the payment, and "
        "the refunds that can still move money add up to less than was captured.",
    )

    name = "ledger_batches"
    order_id = uuid_for(f"order:{name}")
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=c_authorised, captured_at=c_accepted)
    fee = 330
    make(
        name, "COMPLETED", completed_base,
        {"timeline": _timeline(completed_steps), "payment": payment, "refunds": [], "dispatch_history": c_dispatch,
         "money_timeline": _money_timeline(payment, []),
         **money(name, _capture(c_accepted) + [
             ("PSP_FEE", "PSP_FEES", "PSP_FEE", fee, c_accepted + 45), ("PSP_FEE", "PLATFORM_REVENUE", "PSP_FEE", -fee, c_accepted + 45)]
                 + _settle(c_settled))},
        "A completed order whose ledger shows each kind of batch it has in these fixtures: the capture, the "
        "provider's fee and the settlement that splits the charge between the restaurant, the platform, the rider "
        "and tax. Every batch sums to zero on its own.",
    )

    # ---- dispatch variants: the order is in the kitchen or ready, the search is somewhere else ---
    prep_base = {"state_since": ts(-20), "placed_at": ts(-4 * MINUTE), "accepted_at": ts(-20), "eta_at": ts(26 * MINUTE),
                 "rider": None, "can_cancel": False}
    ready_base = {"state_since": ts(-3 * MINUTE), "placed_at": ts(-32 * MINUTE), "accepted_at": ts(ACCEPTED), "ready_at": ts(-3 * MINUTE),
                  "eta_at": None, "can_cancel": False}
    ready_steps = [created, authorised, pending, preparing, ("READY_FOR_PICKUP", "RESTAURANT", -3 * MINUTE)]

    def running(name, state, steps, base, history, deadline, describes, *, captured_at=ACCEPTED):
        order_id = uuid_for(f"order:{name}")
        payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=-31 * MINUTE, captured_at=captured_at)
        make(
            name, state, {"deadline_at": ts(deadline), **base},
            {"timeline": _timeline(steps), "dispatch_history": history, "payment": payment, "refunds": [],
             "money_timeline": _money_timeline(payment, []), **money(name, _capture(captured_at))},
            describes,
        )

    running(
        "preparing_dispatch_pending", "PREPARING",
        [("CREATED", "CUSTOMER", -4 * MINUTE), ("AUTHORIZED", "SYSTEM", -4 * MINUTE + 4), ("RESTAURANT_PENDING", "SYSTEM", -3 * MINUTE),
         ("PREPARING", "RESTAURANT", -20)],
        {**prep_base, "dispatch_state": "PENDING"}, _dispatch(("PENDING", None, None, None, None, -20)), 1580,
        "The restaurant accepted 20 seconds ago. Dispatch has the order but has not started searching: the search "
        "starts within 10 seconds of acceptance.", captured_at=-20,
    )

    searching_history = _dispatch(
        ("PENDING", None, None, None, None, -13 * MINUTE),
        ("SEARCHING", 1, 3000, None, None, -13 * MINUTE + 10),
        ("SEARCHING", 2, 6000, None, None, -2 * MINUTE),
    )
    running(
        "ready_searching", "READY_FOR_PICKUP", ready_steps,
        {**ready_base, "dispatch_state": "SEARCHING", "rider": None}, searching_history, 810,
        "Ready for pickup with the search still open in its second wave, 6 km out, and no rider offered it yet.",
    )
    offered_history = _dispatch(
        ("PENDING", None, None, None, None, -13 * MINUTE),
        ("SEARCHING", 1, 3000, None, None, -13 * MINUTE + 10),
        ("OFFERED", 1, 3000, RIDER_BILAL, "EXPIRED", -12 * MINUTE),
        ("OFFERED", 2, 6000, RIDER_OMAR, None, -30),
    )
    running(
        "ready_offered", "READY_FOR_PICKUP", ready_steps,
        {**ready_base, "dispatch_state": "OFFERED", "rider": None}, offered_history, 840,
        "Ready for pickup, with a live offer to a rider: they have 30 seconds to answer before the search moves on.",
    )
    at_restaurant = _dispatch(
        ("PENDING", None, None, None, None, ACCEPTED),
        ("SEARCHING", 1, 3000, None, None, ACCEPTED + 20),
        ("OFFERED", 1, 3000, RIDER_OMAR, "ACCEPTED", ACCEPTED + 40),
        ("ASSIGNED", 1, 3000, RIDER_OMAR, None, ACCEPTED + 40),
        ("AT_RESTAURANT", 1, 3000, RIDER_OMAR, None, -2 * MINUTE),
    )
    running(
        "ready_at_restaurant", "READY_FOR_PICKUP", ready_steps,
        {**ready_base, "dispatch_state": "AT_RESTAURANT", "rider": rider_public_profile(), "eta_at": ts(12 * MINUTE)},
        at_restaurant, 600,
        "Ready for pickup, and the assigned rider is at the restaurant waiting for the bag. They still need the "
        "kitchen’s pickup code to take it.",
    )
    unassigned = _dispatch(
        ("PENDING", None, None, None, None, ACCEPTED),
        ("SEARCHING", 1, 3000, None, None, ACCEPTED + 20),
        ("OFFERED", 1, 3000, RIDER_OMAR, "ACCEPTED", ACCEPTED + 40),
        ("ASSIGNED", 1, 3000, RIDER_OMAR, None, ACCEPTED + 40),
        ("UNASSIGNED", 1, 3000, None, None, -2 * MINUTE),
    )
    running(
        "ready_unassigned", "READY_FOR_PICKUP", ready_steps,
        {**ready_base, "dispatch_state": "UNASSIGNED", "rider": None}, unassigned, 610,
        "Ready for pickup, but the rider who accepted it dropped it before collecting. Dispatch re-opens the search "
        "within seconds; until then no rider holds the order.",
    )
    no_rider = _dispatch(
        ("PENDING", None, None, None, None, ACCEPTED),
        ("SEARCHING", 1, 3000, None, None, ACCEPTED + MINUTE),
        ("SEARCHING", 2, 6000, None, None, ACCEPTED + 2 * MINUTE),
        ("SEARCHING", 3, 10000, None, None, ACCEPTED + 3 * MINUTE),
        ("NO_RIDER_FOUND", 3, 10000, None, None, -5 * MINUTE),
    )
    running(
        "ready_no_rider", "READY_FOR_PICKUP", ready_steps,
        {**ready_base, "dispatch_state": "NO_RIDER_FOUND", "rider": None}, no_rider, 95,
        "Ready for pickup, and the search ran every wave without finding a rider. The order is not cancelled: its "
        "pickup deadline re-opens the search and alerts operations, and after the third escalation the system cancels "
        "it and refunds the customer in full.",
    )

    # The same order as `order_admin_view_preparing`, a moment after its first prep deadline passed: the server
    # re-armed the deadline ten minutes ahead and gave the customer a new estimate.
    name = "preparing_rearmed"
    order_id = uuid_for("order:preparing")
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, authorized_at=-35 * MINUTE, captured_at=-31 * MINUTE)
    view = order_admin_view(
        synth, "PREPARING",
        base_over={"deadline_at": ts(9 * MINUTE), "eta_at": ts(19 * MINUTE), "state_since": ts(-31 * MINUTE),
                   "accepted_at": ts(-31 * MINUTE), "placed_at": ts(-35 * MINUTE)},
        timeline=_timeline([("CREATED", "CUSTOMER", -35 * MINUTE), ("AUTHORIZED", "SYSTEM", -35 * MINUTE + 4),
                            ("RESTAURANT_PENDING", "SYSTEM", -34 * MINUTE), ("PREPARING", "RESTAURANT", -31 * MINUTE)]),
        payment=payment, money_timeline=_money_timeline(payment, []),
    )
    view["quote_id"] = uuid_for("quote:preparing")
    reg.add(
        "order_admin_view_preparing_rearmed", "orders", "OrderAdminView",
        "The order of `order_admin_view_preparing` about a minute after its first prep deadline passed. The server "
        "re-armed the deadline ten minutes ahead and gave the customer a new estimate; the order is still "
        "`PREPARING`. After the third overrun the system cancels it and refunds the customer in full.",
        view, operations=["getOrderAdmin"], tags=["admin", "order-state-matrix"],
    )

    # ---- resolved automatically ---------------------------------------------------------------
    name = "resolved_auto"
    order_id = uuid_for(f"order:{name}")
    placed = -6 * DAY
    disputed_at, resolved_at = -5 * DAY + 3 * HOUR, -2 * HOUR
    refund = _refund(order_id, name, "FULL", "DISPUTE_RESOLUTION", TOTAL, "SETTLED", requested=resolved_at,
                     settled=resolved_at + 3 * MINUTE, split=(TOTAL, 0, 0), scope="FULL", tax=PRICED["tax_total_cents"])
    payment = _payment(order_id, "SUCCEEDED", authorized=TOTAL, captured=TOTAL, refunded=TOTAL,
                       authorized_at=placed + MINUTE, captured_at=placed + 3 * MINUTE)
    steps = [("CREATED", "CUSTOMER", placed), ("AUTHORIZED", "SYSTEM", placed + 4), ("RESTAURANT_PENDING", "SYSTEM", placed + MINUTE),
             ("PREPARING", "RESTAURANT", placed + 3 * MINUTE), ("READY_FOR_PICKUP", "RESTAURANT", placed + 18 * MINUTE),
             ("PICKED_UP", "RIDER", placed + 21 * MINUTE), ("ARRIVED", "RIDER", placed + 38 * MINUTE),
             ("DELIVERED", "RIDER", placed + 40 * MINUTE), ("COMPLETED", "SYSTEM", placed + 42 * MINUTE),
             ("DISPUTED", "CUSTOMER", disputed_at, "Wrong curry in the bag"),
             ("RESOLVED", "SYSTEM", resolved_at, "The dispute passed its last deadline and was resolved in the customer’s favour")]
    make(
        name, "RESOLVED",
        {"state_since": ts(resolved_at), "deadline_at": None, "placed_at": ts(placed), "accepted_at": ts(placed + 3 * MINUTE),
         "ready_at": ts(placed + 18 * MINUTE), "picked_up_at": ts(placed + 21 * MINUTE), "delivered_at": ts(placed + 40 * MINUTE),
         "completed_at": ts(placed + 42 * MINUTE), "dispatch_state": "COMPLETED", "eta_at": None},
        {"timeline": _timeline(steps), "payment": payment, "refunds": [refund], "dispatch_history": searched,
         "money_timeline": _money_timeline(payment, _refund_events(refund, "SYSTEM", None)),
         **money(name, _capture(placed + 3 * MINUTE) + _settle(placed + 42 * MINUTE) + _reversal(resolved_at, TOTAL))},
        "A dispute nobody resolved: it was escalated at each deadline until the third, and then the system resolved "
        "it itself in the customer’s favour (`actor_kind: SYSTEM` on the move to `RESOLVED`), refunding the order "
        "in full. A person resolving a dispute is the `order_admin_view_resolved` fixture.",
    )

    # ---- the customer's view of a no-rider cancellation ----------------------------------------
    reg.add(
        "order_cancelled_no_rider", "orders", "OrderCustomerView",
        "Terminal. Dispatch found no rider, the order sat `READY_FOR_PICKUP` through its pickup escalations, and the "
        "system cancelled it (`cancel_reason: NO_RIDER_FOUND`). The customer is refunded in full. This is the "
        "fixture a payment-failed order (`order_failed`) is not.",
        customer_order(
            "CANCELLED", label="cancelled-no-rider", cancel_reason="NO_RIDER_FOUND", dispatch_state="NO_RIDER_FOUND",
            accepted_at=ts(-92 * MINUTE), ready_at=ts(-47 * MINUTE), placed_at=ts(-96 * MINUTE), state_since=ts(-2 * MINUTE),
        ),
        operations=["getOrder", "getActiveOrder"], tags=["order-state-matrix"],
    )


ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


def order_code(name: str) -> str:
    """`HG-XXXX-NX`, stable for a name, so a fixture's code does not move when another is added."""
    digest = uuid_for(f"code:admin-states:{name}").replace("-", "")
    chars = [ALPHABET[int(digest[i : i + 2], 16) % len(ALPHABET)] for i in range(0, 12, 2)]
    return f"HG-{''.join(chars[:4])}-{''.join(chars[4:])}"
