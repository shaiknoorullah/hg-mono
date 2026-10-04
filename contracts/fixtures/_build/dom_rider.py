"""Dispatch, assignments, rider availability, earnings and payouts."""

from __future__ import annotations

from typing import Any

from content import DAY, HOUR, IMAGE_BASE, MINUTE, day, ts
from dom_catalogue import standard_quote_lines
from dom_orders import ORDER_STATES, customer_order
from money import price_quote
from synth import uuid_for
from world import address, restaurant_card

RIDER_ACCOUNT = uuid_for("account:rider:bilal")

# Seconds from 00:00 UTC on the frozen clock's Monday to the frozen clock itself.
_SINCE_MONDAY_MIDNIGHT = 18 * HOUR + 42 * MINUTE + 11.412

DISPATCH_STATES = {
    "PENDING": "Dispatch has the order but has not started searching — the restaurant has "
    "not accepted yet.",
    "SEARCHING": "A wave is open; no rider has been offered this order in this wave yet.",
    "OFFERED": "One or more riders are looking at a live offer with a running countdown.",
    "ASSIGNED": "A rider accepted. `dispatch.assigned` has fired to the customer.",
    "AT_RESTAURANT": "Rider is at the pickup, waiting on the pass.",
    "CARRYING": "Bag collected; `rider.location` is publishing at most once per 5 s.",
    "AT_CUSTOMER": "Rider is at the drop-off; proof of delivery is next.",
    "COMPLETED": "Handover recorded. Terminal, happy.",
    "UNASSIGNED": "The assigned rider dropped it or was removed; dispatch will re-search. "
    "The old rider is force-unsubscribed from `order:{id}` within 2 seconds.",
    "NO_RIDER_FOUND": "Every wave exhausted. Terminal — the order fails and is refunded.",
}

ASSIGNMENT_STATES = {
    "ASSIGNED": "Accepted, not yet moving.",
    "EN_ROUTE_TO_PICKUP": "Navigating to the restaurant.",
    "ARRIVED_AT_PICKUP": "At the restaurant; the wait timer is running.",
    "PICKED_UP": "Bag in hand. **The full customer address and unit appear only now** (§5).",
    "EN_ROUTE_TO_DROPOFF": "Navigating to the customer.",
    "ARRIVED_AT_DROPOFF": "At the door; proof of delivery is required to proceed.",
    "DELIVERED": "POD recorded. Terminal, happy.",
    "UNDELIVERABLE": "Nobody home, no safe drop. Awaiting a support decision.",
    "RETURNING": "Taking the food back to the restaurant.",
    "RETURNED": "Handed back at the restaurant. Terminal.",
    "CANCELLED_BY_PLATFORM": "Support pulled the assignment mid-delivery.",
    "REASSIGNED": "Moved to another rider. Terminal for this rider.",
}


def build(reg, synth) -> None:
    _dispatch(reg, synth)
    _offers(reg)
    _assignments(reg)
    _availability(reg, synth)
    _earnings(reg, synth)
    _payouts(reg, synth)


def _dispatch(reg, synth) -> None:
    for state, note in DISPATCH_STATES.items():
        base = {
            "PENDING": "RESTAURANT_PENDING",
            "SEARCHING": "PREPARING",
            "OFFERED": "PREPARING",
            "ASSIGNED": "READY_FOR_PICKUP",
            "AT_RESTAURANT": "READY_FOR_PICKUP",
            "CARRYING": "PICKED_UP",
            "AT_CUSTOMER": "ARRIVED",
            "COMPLETED": "DELIVERED",
            "UNASSIGNED": "PREPARING",
            "NO_RIDER_FOUND": "FAILED",
        }[state]
        has_rider = state in ("ASSIGNED", "AT_RESTAURANT", "CARRYING", "AT_CUSTOMER", "COMPLETED")
        order = customer_order(
            base,
            label=f"dispatch-{state.lower()}",
            dispatch_state=state,
        )
        if not has_rider:
            order["rider"] = None
        reg.add(
            f"dispatch_{state.lower()}",
            "dispatch",
            "OrderCustomerView",
            f"`dispatch_state = {state}` on an order in `{base}`. {note}",
            order,
            operations=["getOrder", "getActiveOrder"],
            tags=["dispatch-state-matrix"],
        )


def _offer(label: str, state: str, **over: Any) -> dict:
    out = {
        "offer_id": uuid_for(f"offer:{label}"),
        "order_id": uuid_for("order:preparing"),
        "state": state,
        "wave": 2,
        "expires_at": ts(28),
        "server_time": ts(0),
        "pickup": {
            "restaurant_name": "Karachi Kitchen",
            "address_short": "1245 Danforth Avenue, Toronto",
            "latitude": 43.6817,
            "longitude": -79.3403,
        },
        # §5 / websocket.md §4.5: street and neighbourhood only. No unit, no phone alias.
        "dropoff": {"area": "Harbourfront, Toronto", "latitude": 43.6412, "longitude": -79.3810},
        "distance_m": 5240,
        "est_duration_s": 780,
        "earnings": {
            "base_cents": 449,
            "distance_cents": 0,
            "surge_cents": 0,
            "tip_so_far_cents": 700,
            "estimated_total_cents": 1149,
            "currency": "CAD",
        },
        "items_count": 3,
    }
    out.update(over)
    return out


def _offers(reg) -> None:
    reg.add(
        "offer_pending",
        "dispatch",
        "DispatchOffer",
        "A live offer with 28 seconds left. The countdown is `expires_at - server_time`, "
        "corrected for device clock skew — a phone whose clock is ten minutes fast must "
        "still show ~28 s.",
        _offer("pending", "PENDING"),
        operations=["getCurrentOffer"],
        tags=["rider", "offer-state-matrix"],
    )
    reg.add(
        "offer_expired",
        "dispatch",
        "DispatchOffer",
        "`expires_at` is in the past. Accepting is `409 OFFER_EXPIRED` — one of the three "
        "codes that collided during the SCREAMING_SNAKE normalisation.",
        _offer("expired", "EXPIRED", expires_at=ts(-6), wave=1),
        operations=["getCurrentOffer"],
        tags=["rider", "error-path", "offer-state-matrix"],
    )
    reg.add(
        "offer_withdrawn",
        "dispatch",
        "DispatchOffer",
        "Withdrawn because the customer cancelled. The card must dismiss itself rather than "
        "wait for the rider to tap.",
        _offer("withdrawn", "WITHDRAWN", expires_at=ts(-2)),
        operations=["getCurrentOffer"],
        tags=["rider", "offer-state-matrix"],
    )
    reg.add(
        "offer_taken_by_another",
        "dispatch",
        "DispatchOffer",
        "Another rider accepted first. Accepting is `409 OFFER_ALREADY_TAKEN`.",
        _offer("taken", "ACCEPTED", expires_at=ts(-1)),
        operations=["getCurrentOffer"],
        tags=["rider", "error-path", "offer-state-matrix"],
    )
    reg.add(
        "offer_rejected",
        "dispatch",
        "DispatchOffer",
        "This rider declined it (`EARNINGS_TOO_LOW`). Kept so the rejection reason sheet has "
        "something to render against.",
        _offer("rejected", "REJECTED", expires_at=ts(-30)),
        operations=["getCurrentOffer"],
        tags=["rider", "offer-state-matrix"],
    )
    reg.add(
        "offer_none",
        "dispatch",
        "DispatchOffer|null",
        "No live offer. `getCurrentOffer` returns **null data**, not 404 — an online idle "
        "rider polls this and gets null all day.",
        None,
        operations=["getCurrentOffer"],
        tags=["rider", "edge", "empty"],
    )
    reg.add(
        "offer_zero_tip_low_value",
        "dispatch",
        "DispatchOffer",
        "A 12 km trip with no tip so far — CAD 4.49 estimated. Under pure pass-through "
        "earnings (decision R-02) there is no rate-card floor, so this is what the rider "
        "sees. The screen must not imply a guarantee.",
        _offer(
            "low",
            "PENDING",
            distance_m=12140,
            est_duration_s=1680,
            earnings={
                "base_cents": 449,
                "distance_cents": 0,
                "surge_cents": 0,
                "tip_so_far_cents": 0,
                "estimated_total_cents": 449,
                "currency": "CAD",
            },
            items_count=1,
        ),
        operations=["getCurrentOffer"],
        tags=["rider", "edge", "money"],
    )


def _assignment(state: str, **over: Any) -> dict:
    picked_up = state in (
        "PICKED_UP",
        "EN_ROUTE_TO_DROPOFF",
        "ARRIVED_AT_DROPOFF",
        "DELIVERED",
        "UNDELIVERABLE",
        "RETURNING",
        "RETURNED",
    )
    delivered = state == "DELIVERED"
    out = {
        "id": uuid_for(f"assignment:{state.lower()}"),
        "order_id": uuid_for("order:picked_up"),
        "order_code": "HG-PIUP-9X",
        "state": state,
        "pickup": {
            "restaurant_name": "Karachi Kitchen",
            "address": "1245 Danforth Avenue, Toronto, ON M4J 1M4",
            "latitude": 43.6817,
            "longitude": -79.3403,
            "phone_alias": "+16475550188",
            "pickup_notes": "Hot counter on the left. Ask for the app order by code.",
            "order_state": "PICKED_UP" if picked_up else "READY_FOR_PICKUP",
        },
        "dropoff": {
            # §5: street and neighbourhood before PICKED_UP; full address and unit after.
            "address": "88 Harbour Street, Toronto, ON M5J 0C3" if picked_up else "Harbour Street, Harbourfront",
            "unit": "Unit 4211" if picked_up else None,
            "buzzer": "4211" if picked_up else None,
            "latitude": 43.6412,
            "longitude": -79.3810,
            "customer_display_name": "Ayesha R.",
            "phone_alias": "+16475550233",
            "delivery_instructions": ["LEAVE_AT_DOOR", "DO_NOT_RING_BELL"],
            "special_instructions": "Please leave it on the mat, not the shoe rack.",
        },
        # "No prices." — the rider never sees item money.
        "items": [
            {
                "name": "Chicken Biryani",
                "quantity": 1,
                "variant_name": None,
                "addon_names": [],
                "note": None,
                "allergen_tags": ["MILK"],
            },
            {
                "name": "Beef Nihari",
                "quantity": 1,
                "variant_name": "Full",
                "addon_names": [],
                "note": "Extra gravy on the side",
                "allergen_tags": ["WHEAT_TRITICALE"],
            },
            {
                "name": "Chicken Karahi (Half)",
                "quantity": 1,
                "variant_name": None,
                "addon_names": ["Garlic naan"],
                "note": None,
                "allergen_tags": ["MILK"],
            },
        ],
        "payment_status": "PREPAID",
        "earnings": {
            "base_cents": 449,
            "distance_cents": 0,
            "surge_cents": 0,
            "tip_so_far_cents": 700,
            "estimated_total_cents": 1149,
            "currency": "CAD",
        },
        "required_pod_method": "PHOTO",
        "pod_recorded": delivered,
        "handover_method": "LEFT_AT_DOOR" if delivered else None,
        "tracking_health": "HEALTHY",
        "billable_distance_m": 5240,
        "pickup_wait_seconds": 240 if picked_up else None,
        "assigned_at": ts(-16 * MINUTE),
        "arrived_pickup_at": ts(-12 * MINUTE) if state != "ASSIGNED" and state != "EN_ROUTE_TO_PICKUP" else None,
        "picked_up_at": ts(-11 * MINUTE) if picked_up else None,
        "arrived_dropoff_at": ts(-3 * MINUTE) if state in ("ARRIVED_AT_DROPOFF", "DELIVERED", "UNDELIVERABLE") else None,
        "delivered_at": ts(-2 * MINUTE) if delivered else None,
    }
    out.update(over)
    return out


def _assignments(reg) -> None:
    for state, note in ASSIGNMENT_STATES.items():
        over: dict[str, Any] = {}
        if state == "UNDELIVERABLE":
            over = {"tracking_health": "DEGRADED"}
        if state in ("RETURNING", "RETURNED"):
            over = {"handover_method": None, "pod_recorded": False}
        if state == "CANCELLED_BY_PLATFORM":
            over = {"pickup_wait_seconds": 900, "tracking_health": "LOST"}
        reg.add(
            f"assignment_{state.lower()}",
            "dispatch",
            "Assignment",
            note,
            _assignment(state, **over),
            operations=["getAssignment", "acceptOffer", "createAssignmentTransition", "submitProofOfDelivery"],
            tags=["rider", "assignment-state-matrix"],
        )

    reg.add(
        "assignment_otp_pod_required",
        "dispatch",
        "Assignment",
        "`MEET_AT_DOOR` maps to **OTP** proof of delivery (contradiction log #6), not a "
        "photo. The rider must be shown a code entry, and neither a photo nor a photo with "
        "a statement satisfies it (`POD_METHOD_MISMATCH`), before or after the code locks. "
        "The assignment carries no code: the customer reads it out.",
        _assignment(
            "ARRIVED_AT_DROPOFF",
            required_pod_method="OTP",
            handover_method=None,
            dropoff={
                **_assignment("ARRIVED_AT_DROPOFF")["dropoff"],
                "delivery_instructions": ["MEET_AT_DOOR"],
            },
        ),
        operations=["getAssignment", "submitProofOfDelivery"],
        tags=["rider", "edge"],
    )

    reg.add(
        "assignment_no_instructions_no_unit",
        "dispatch",
        "Assignment",
        "A house, not a condo: no unit, no buzzer, no instructions, no special request, no "
        "pickup notes. Every optional row on the rider card is absent at once.",
        _assignment(
            "EN_ROUTE_TO_DROPOFF",
            dropoff={
                "address": "150 Charlton Avenue East, Hamilton, ON L8N 3X2",
                "unit": None,
                "buzzer": None,
                "latitude": 43.2508,
                "longitude": -79.8657,
                "customer_display_name": "Omar F.",
                "phone_alias": "+16475550233",
                "delivery_instructions": [],
                "special_instructions": None,
            },
            pickup={
                **_assignment("EN_ROUTE_TO_DROPOFF")["pickup"],
                "pickup_notes": None,
                "phone_alias": None,
            },
            items=[{"name": "Falafel Wrap", "quantity": 1, "variant_name": None, "addon_names": [], "note": None, "allergen_tags": ["SESAME", "WHEAT_TRITICALE"]}],
        ),
        operations=["getAssignment"],
        tags=["rider", "edge"],
    )


def _availability(reg, synth) -> None:
    for state, note in [
        ("OFFLINE", "Rider is off shift. No offers will be sent."),
        ("ONLINE_IDLE", "Online, no assignment, waiting for an offer."),
        ("ONLINE_STALE", "Online but the phone has not reported a position recently — "
                         "offers are suppressed until it does."),
        ("ON_DELIVERY", "Carrying an order. Only one active delivery at a time "
                        "(`ACTIVE_DELIVERY_IN_PROGRESS`)."),
    ]:
        av = synth.make("RiderAvailability", f"availability-{state}")
        av["availability_state"] = state
        av["since"] = ts(-320) if state == "ONLINE_STALE" else ts(-42 * MINUTE)
        av["can_receive_offers"] = state == "ONLINE_IDLE"
        av["go_offline_after_delivery"] = state == "ON_DELIVERY"
        av["blocking_reasons"] = {
            "OFFLINE": [],
            "ONLINE_IDLE": [],
            "ONLINE_STALE": ["STALE_LOCATION_FIX"],
            "ON_DELIVERY": [],
        }[state]
        reg.add(
            f"rider_availability_{state.lower()}",
            "rider",
            "RiderAvailability",
            note,
            av,
            operations=["setRiderAvailability"],
            tags=["rider", "state-matrix"],
        )

    dash = synth.make("RiderDashboard", "dashboard-active")
    reg.add(
        "rider_dashboard_active",
        "rider",
        "RiderDashboard",
        "A rider mid-shift with an assignment in progress and earnings accrued today.",
        dash,
        operations=["getRiderDashboard"],
        tags=["rider"],
    )

    zero = synth.make("RiderDashboard", "dashboard-zero")
    for key, value in list(zero.items()):
        if key.endswith("_cents"):
            zero[key] = 0
        if key in ("deliveries", "deliveries_today", "trips", "trip_count"):
            zero[key] = 0
    reg.add(
        "rider_dashboard_zero_earnings",
        "rider",
        "RiderDashboard",
        "**A rider with zero earnings** — approved this morning, no deliveries yet. Every "
        "money field is 0 and every count is 0. The dashboard must read as 'not started', "
        "never as an error or a blank screen.",
        zero,
        operations=["getRiderDashboard"],
        tags=["rider", "edge", "empty", "money"],
    )

    reg.add(
        "rider_me",
        "rider",
        "RiderMe",
        "The rider's own bootstrap payload — identity, onboarding state, availability and "
        "what screen to land on.",
        synth.make("RiderMe", "rider-me"),
        operations=["getRiderMe"],
        tags=["rider"],
    )

    reg.add(
        "rider_position_ack",
        "rider",
        "RiderPositionAck",
        "Acknowledgement of a batched position upload. Points older than the server's "
        "tolerance come back rejected (`STALE_POINT`) rather than silently dropped.",
        synth.make("RiderPositionAck", "position-ack"),
        operations=["reportRiderPositions"],
        status=202,
        tags=["rider"],
    )


def _earnings(reg, synth) -> None:
    week = synth.make("EarningsSummary", "earnings-week")
    reg.add(
        "earnings_summary_week",
        "rider",
        "EarningsSummary",
        "A full week: 14 deliveries, delivery fees plus 100% of tips. The rate-card "
        "component fields (`base_cents`, `distance_cents`, `wait_cents`, "
        "`guarantee_topup_cents`) are present but zero — pure pass-through at launch "
        "(contradiction log #7).",
        week,
        operations=["getRiderEarningsSummary"],
        tags=["rider", "money"],
    )

    zero = synth.make("EarningsSummary", "earnings-zero")

    def zero_out(node):
        if isinstance(node, dict):
            return {
                k: (0 if (k.endswith("_cents") or k in ("deliveries", "trips", "count")) else zero_out(v))
                for k, v in node.items()
            }
        if isinstance(node, list):
            return [zero_out(v) for v in node]
        return node

    reg.add(
        "earnings_summary_zero",
        "rider",
        "EarningsSummary",
        "**Zero earnings across every bucket.** A rider who went online and got no offers. "
        "Charts must render an axis, not collapse.",
        zero_out(zero),
        operations=["getRiderEarningsSummary"],
        tags=["rider", "edge", "empty", "money"],
    )

    entries = [synth.make("EarningEntry", f"entry-{i}") for i in range(5)]
    for entry, kind, status, amount in zip(
        entries,
        ["DELIVERY", "TIP", "BONUS", "ADJUSTMENT", "CLAWBACK"],
        ["PAID", "PAID", "AVAILABLE", "PENDING", "REVERSED"],
        [449, 700, 500, 250, -449],
    ):
        entry["type"] = kind
        entry["status"] = status
        for key in entry:
            if key.endswith("_cents") and key not in ("base_cents", "distance_cents", "wait_cents", "guarantee_topup_cents"):
                entry[key] = amount
    reg.add(
        "earning_entries_mixed",
        "rider",
        "array<EarningEntry>",
        "One of every `EarningEntryType` and `EarningEntryStatus`, including a **negative** "
        "clawback. Ledger rows must handle a minus sign.",
        entries,
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": None, "has_more": False, "total": 5},
        tags=["rider", "money", "state-matrix"],
    )

    reg.add(
        "earning_entries_empty",
        "rider",
        "array<EarningEntry>",
        "No entries at all — pairs with `earnings_summary_zero`.",
        [],
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["rider", "edge", "empty"],
    )


def _payouts(reg, synth) -> None:
    notes = {
        "DRAFT": "The week is still accruing. Nothing is owed yet.",
        "READY": "Week closed, amount final, waiting for Monday's run.",
        "TRANSFERRING": "Submitted to Stripe Connect.",
        "TRANSFERRED": "Stripe accepted the transfer; not yet in the bank.",
        "PAID": "Landed. **No minimum** for either partner type (contradiction log #16).",
        "FAILED": "The transfer bounced — usually a Connect requirement went `past_due`.",
        "HELD": "Held by compliance pending a review. The partner sees the hold, not the reason.",
    }
    for state, note in notes.items():
        payout = synth.make("Payout", f"payout-{state}")
        payout["state"] = state
        if state == "DRAFT":
            for k in payout:
                if k.endswith("_cents"):
                    payout[k] = 0
        reg.add(
            f"payout_{state.lower()}",
            "rider",
            "Payout",
            note,
            payout,
            operations=["listRiderPayouts", "listRestaurantPayouts"],
            tags=["payout-state-matrix", "money"],
        )

    reg.add(
        "payout_detail_paid",
        "rider",
        "PayoutDetail",
        "A paid weekly payout expanded into its constituent earning entries.",
        synth.make("PayoutDetail", "payout-detail"),
        operations=["getRiderPayout"],
        tags=["rider", "money"],
    )

    # A restaurant's payout history as the page shows it: newest first, one row per Monday
    # run. The frozen clock is a Monday, so last week's payout is mid-transfer today.
    history = []
    for weeks_ago, state, amount, entries in [
        (0, "DRAFT", 0, 0),
        (1, "TRANSFERRING", 184_250, 61),
        (2, "PAID", 201_475, 67),
        (3, "PAID", 176_830, 58),
        (4, "PAID", 193_115, 64),
    ]:
        start = -(weeks_ago * 7) * DAY - _SINCE_MONDAY_MIDNIGHT
        history.append(
            {
                "id": uuid_for(f"restaurant-payout:{weeks_ago}"),
                "period_start": ts(start),
                "period_end": ts(start + 7 * DAY),
                "amount_cents": amount,
                "currency": "CAD",
                "state": state,
                "hold_reason": None,
                "entry_count": entries,
                "paid_at": ts(start + 7 * DAY + 2 * DAY) if state == "PAID" else None,
                "failure_message": None,
            }
        )
    reg.add(
        "restaurant_payout_history",
        "rider",
        "array<Payout>",
        "A restaurant's payout history, newest first: this week still accruing, last week "
        "mid-transfer on Monday's run, three paid weeks before it. Weekly, automatic, no "
        "minimum.",
        history,
        operations=["listRestaurantPayouts"],
        meta={"next_cursor": None, "has_more": False, "total": len(history)},
        tags=["restaurant", "money"],
    )

    reg.add(
        "payout_list_empty",
        "rider",
        "array<Payout>",
        "No payout has ever run for this partner.",
        [],
        operations=["listRiderPayouts", "listRestaurantPayouts"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty"],
    )
