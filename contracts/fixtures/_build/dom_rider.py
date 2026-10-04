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
    _payout_runs(reg, synth)


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
        "photo. The rider must be shown a code entry, and a photo must not satisfy it "
        "(`POD_METHOD_MISMATCH`).",
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


# The payout run closed at NOW (Monday 10 August 2026): the week from Monday
# 3 August 00:00 to Monday 10 August 00:00 America/Toronto, due 09:00 Toronto.
RUN_PERIOD_START = "2026-08-03T04:00:00.000Z"
RUN_PERIOD_END = "2026-08-10T04:00:00.000Z"
RUN_DUE = "2026-08-10T13:00:00.000Z"

PAYOUT_RUN_OUTCOMES = {
    "PAID": (2099, "Stripe transfer tr_1Q2w3E4r5T6y7U8i"),
    "HELD": (700, "Stripe has payouts turned off for this partner: requirements_due: external_account"),
    "STILL_HELD": (1250, "Stripe still has payouts turned off: requirements_due: individual.verification.document"),
    "RELEASED": (650, "Stripe transfer tr_9O8i7U6y5T4r3E2w"),
    "TRANSFER_FAILED": (4500, "stripe create transfer: insufficient available balance"),
    "ALREADY_PAID": (3000, "this period's payout already exists (PAID)"),
    "NOTHING_DUE": (0, None),
    "CARRIED_NEGATIVE": (-500, "below zero since 2026-08-05; carried to the next run"),
    "NO_PAYOUT_ACCOUNT": (0, "no Stripe account yet; the balance is paid once onboarding is complete"),
    "PARTNER_SUSPENDED": (0, "the restaurant is SUSPENDED; its balance is kept until it is reinstated"),
    "ORDERS_BLOCKED": (-500, "balance below zero since 2026-07-05, more than 30 days: no new orders until it recovers"),
    "ORDERS_UNBLOCKED": (0, "the balance has recovered"),
    "ERROR": (0, "build payout: connection reset by peer"),
}


def _payout_run(synth, label: str, state: str, kind: str = "SCHEDULED") -> dict[str, Any]:
    run = synth.make("PayoutRun", label)
    scheduled = kind == "SCHEDULED"
    run.update(
        kind=kind,
        state=state,
        payee=None if scheduled else {"type": "RIDER", "id": uuid_for("rider-payout-run")},
        period_start=RUN_PERIOD_START,
        period_end=RUN_PERIOD_END,
        as_of=RUN_DUE if scheduled else ts(),
        due_at=RUN_DUE if scheduled else ts(),
        requested_by=None if scheduled else uuid_for("admin-payout-run"),
        started_at=None,
        finished_at=None,
        attempts=0,
        partners=0,
        paid=0,
        held=0,
        released=0,
        carried=0,
        failed=0,
        paid_cents=0,
        held_cents=0,
        error=None,
        created_at=RUN_DUE if scheduled else ts(),
    )
    if state != "QUEUED":
        run.update(started_at=RUN_DUE, attempts=1)
    if state in ("SUCCEEDED", "FAILED"):
        run.update(finished_at="2026-08-10T13:00:04.180Z", partners=42, paid=37, held=2, released=1,
                   carried=2, paid_cents=184210, held_cents=1950)
    if state == "FAILED":
        run.update(paid=36, failed=1, paid_cents=179710)
    return run


def _payout_runs(reg, synth) -> None:
    notes = {
        "QUEUED": "An admin asked to run the payout now; the worker picks it up within seconds.",
        "RUNNING": "The Monday run is paying partners. A worker that stops mid-run is relieved by the next.",
        "SUCCEEDED": "The Monday run paid everyone it could; holds and carried balances are not failures.",
        "FAILED": "One transfer failed. The payout stays owed and the next run tries it again.",
    }
    for state, note in notes.items():
        kind = "ADMIN" if state == "QUEUED" else "SCHEDULED"
        reg.add(
            f"payout_run_{state.lower()}",
            "admin",
            "PayoutRun",
            note,
            _payout_run(synth, f"payout-run-{state}", state, kind),
            operations=["createPayoutRun"] if state == "QUEUED" else ["listPayoutRuns"],
            status=202 if state == "QUEUED" else 200,
            tags=["payout-run-state-matrix", "admin", "money"],
        )

    detail = _payout_run(synth, "payout-run-detail", "FAILED")
    detail["lines"] = [
        {
            "payee": {"type": "RESTAURANT" if outcome in ("PARTNER_SUSPENDED", "ORDERS_BLOCKED", "ORDERS_UNBLOCKED") else "RIDER",
                      "id": uuid_for(f"payee-{outcome}")},
            "outcome": outcome,
            "payout_id": uuid_for(f"payout-{outcome}") if outcome in ("PAID", "HELD", "STILL_HELD", "RELEASED", "TRANSFER_FAILED", "ALREADY_PAID") else None,
            "amount_cents": cents,
            "detail": text,
            "at": "2026-08-10T13:00:02.517Z",
        }
        for outcome, (cents, text) in PAYOUT_RUN_OUTCOMES.items()
    ]
    reg.add(
        "payout_run_detail_every_outcome",
        "admin",
        "PayoutRunDetail",
        "A run's audit trail with one line for every outcome a run can record.",
        detail,
        operations=["getPayoutRun"],
        tags=["admin", "money", "state-matrix"],
    )

    reg.add(
        "payout_run_list_empty",
        "admin",
        "array<PayoutRun>",
        "No payout run has happened yet.",
        [],
        operations=["listPayoutRuns"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["admin", "edge", "empty"],
    )
