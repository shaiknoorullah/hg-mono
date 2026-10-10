"""
Fixtures the redesign tracks asked for, batch 2.

One section per request, in the order the requests were filed:

* rider (#708): sign-in errors with `details`, every Home dashboard state, payout and
  earnings lists that are lists, every Stripe Connect status, the suspended rider and the
  document packs with an expiring or expired document;
* customer (#720);
* restaurant (#676);
* admin (#700).

Like batch 1 (`dom_redesign.py`) this is its own module, so the batch adds a file instead of
editing the domain modules. Fixes to fixtures the domain modules already build are made in
those modules, where the bug was.

Where the contract defines a value `services/hg` does not produce yet, the fixture exists and
its `describes` has a sentence starting "Contract-only:". Where the contract cannot express a
requested state at all, there is no fixture; the request's tracking issue says so.
"""

from __future__ import annotations

import copy
import datetime as dt
from typing import Any

from content import DAY, HOUR, MINUTE, NOW, day, ts
from synth import ulid_for, uuid_for

# The rider the rider fixtures share (dom_rider.RIDER_ACCOUNT).
RIDER_ACCOUNT = uuid_for("account:rider:bilal")

BLOCKING_REASONS = [
    "ONBOARDING_INCOMPLETE",
    "ACCOUNT_NOT_ACTIVE",
    "PAYOUT_ACCOUNT_INCOMPLETE",
    "FOREGROUND_LOCATION_PERMISSION",
    "BACKGROUND_LOCATION_PERMISSION",
    "NOTIFICATION_PERMISSION",
    "STALE_LOCATION_FIX",
    "DOCUMENT_EXPIRED",
    "CONTINUOUS_ONLINE_CAP",
]

# Monday 10 August 2026 00:00 America/Toronto, the start of the frozen clock's week.
WEEK_START = dt.datetime(2026, 8, 10, 4, 0, 0, tzinfo=dt.timezone.utc)


def _iso(moment: dt.datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _week_start(weeks_ago: int) -> dt.datetime:
    return WEEK_START - dt.timedelta(days=7 * weeks_ago)


def build(reg, synth) -> None:
    _rider(reg, synth)
    _customer(reg, synth)
    _restaurant(reg, synth)


# --------------------------------------------------------------------------- #
# Shared: error envelopes
# --------------------------------------------------------------------------- #


def _error(reg, scenario, status, code, message, note, operations, details=None, extra_tags=()):
    envelope: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "request_id": ulid_for(f"request:{scenario}"),
        }
    }
    if details is not None:
        envelope["error"]["details"] = details
    reg.add(
        scenario,
        "errors",
        "ErrorEnvelope",
        f"`{status}` · `{code}`. {note}",
        envelope,
        operations=operations,
        status=status,
        tags=["error-envelope", "error-path", *extra_tags],
    )


# =========================================================================== #
# Rider (#708)
# =========================================================================== #


def _rider(reg, synth) -> None:
    _rider_sign_in(reg)
    _rider_home(reg)
    _rider_payouts(reg)
    _rider_earnings(reg)
    _rider_connect(reg)
    _rider_account(reg)


def _rider_sign_in(reg) -> None:
    auth = ("rider", "customer", "auth")
    for remaining in (2, 0):
        note = {
            2: "Two wrong codes left on this challenge. `details.attempts_remaining` is the "
            "count `services/hg` sends with every `OTP_INCORRECT` (always present, an "
            "integer from 0 up).",
            0: "The last attempt was wrong: `attempts_remaining: 0`. The code field locks and "
            "the app offers \"Send a new code\"; the next `verifyOtp` on this challenge is "
            "`400 OTP_INVALID_OR_EXPIRED` (`error_otp_invalid_or_expired`).",
        }[remaining]
        _error(
            reg, f"error_otp_incorrect_attempts_{remaining}", 400, "OTP_INCORRECT",
            "That code is incorrect.", note, ["verifyOtp"],
            details={"attempts_remaining": remaining}, extra_tags=auth,
        )
    _error(
        reg, "error_otp_rate_limited_with_retry", 429, "RATE_LIMITED",
        "Too many verification requests. Please wait before trying again.",
        "`requestOtp` over the per-phone or per-device cap. `details.retry_after_seconds` "
        "(the contract's documented `RATE_LIMITED` shape) says how long the button stays "
        "disabled. Contract-only: `services/hg` sends the wait only as the `Retry-After` "
        "header today, with `details` absent; a fixture cannot carry a header, so read both.",
        ["requestOtp", "verifyOtp"],
        details={"retry_after_seconds": 47}, extra_tags=auth,
    )
    _error(
        reg, "error_invalid_phone", 422, "INVALID_PHONE",
        "The phone number is not a valid E.164 number.",
        "`requestOtp` with a number that is not E.164 (`+` and 8 to 15 digits). Exactly the "
        "body `services/hg` sends: one `FieldError` on `phone_e164`.",
        ["requestOtp"],
        details=[{"field": "phone_e164", "code": "format", "message": "must be E.164, e.g. +14165550123"}],
        extra_tags=auth,
    )

    challenge = copy.deepcopy(reg.fixtures["otp_challenge"].payload)
    challenge.update({"challenge_id": uuid_for("otp-challenge:resend-open"), "resend_after_s": 0, "expires_at": ts(4 * MINUTE)})
    reg.add(
        "otp_challenge_resend_open",
        "platform",
        "OtpChallenge",
        "A challenge whose resend cooldown is over (`resend_after_s: 0`): \"Send a new code\" "
        "is enabled at once. The code itself is still valid for four minutes.",
        challenge,
        operations=["requestOtp"],
        tags=["platform", "auth", "edge"],
    )


# --- Home ------------------------------------------------------------------- #

def _today(gross: int, trips: int, online_s: int) -> dict:
    return {"gross_cents": gross, "currency": "CAD", "trips": trips, "online_seconds": online_s}


def _dashboard(mode: str, *, today: dict | None = None, assignment: dict | None = None,
               offer: dict | None = None, tracking: str | None = "HEALTHY",
               blocking: list[str] | None = None) -> dict:
    return {
        "mode": mode,
        "today": today or _today(4296, 3, 2 * HOUR + 14 * MINUTE),
        "active_assignment": assignment,
        "current_offer": offer,
        "tracking_health": tracking,
        "blocking_reasons": blocking or [],
    }


_NOT_SENT = (
    " Contract-only: `getRiderDashboard` on `services/hg` sends `mode` and `today` but not "
    "`active_assignment`, `tracking_health` or `blocking_reasons` yet."
)


def _rider_home(reg) -> None:
    def add(name, note, payload, extra_tags=()):
        reg.add(name, "rider", "RiderDashboard", note, payload,
                operations=["getRiderDashboard"], tags=["rider", "home", *extra_tags])

    add(
        "rider_dashboard_online_idle",
        "Online, waiting for an offer: no assignment, no offer, healthy tracking, three "
        "trips so far today.",
        _dashboard("ONLINE_IDLE"),
    )
    add(
        "rider_dashboard_offline",
        "Off shift. Today's totals stay on screen; tracking is not reported while offline "
        "(`tracking_health: null`).",
        _dashboard("OFFLINE", tracking=None),
    )
    add(
        "rider_dashboard_online_stale",
        "Online but no location has arrived recently: offers are held back until one does. "
        "`blocking_reasons: [STALE_LOCATION_FIX]`, tracking `DEGRADED`." + _NOT_SENT,
        _dashboard("ONLINE_STALE", tracking="DEGRADED", blocking=["STALE_LOCATION_FIX"]),
        ("degraded",),
    )
    add(
        "rider_dashboard_tracking_degraded",
        "Online and dispatchable, but location fixes are arriving late or imprecise "
        "(`tracking_health: DEGRADED`)." + _NOT_SENT,
        _dashboard("ONLINE_IDLE", tracking="DEGRADED"),
        ("degraded",),
    )
    add(
        "rider_dashboard_tracking_lost",
        "Online, but no location for long enough that tracking is `LOST`. Tracking loss alone "
        "never reassigns anything; the app asks the rider to check location access." + _NOT_SENT,
        _dashboard("ONLINE_IDLE", tracking="LOST"),
        ("degraded",),
    )
    add(
        "rider_dashboard_offline_blocked",
        "Offline with all nine `blocking_reasons` at once, so one screen test covers every "
        "row and deep link. Nothing earned today." + _NOT_SENT,
        _dashboard("OFFLINE", today=_today(0, 0, 0), tracking=None, blocking=list(BLOCKING_REASONS)),
        ("error-path",),
    )
    for reason in BLOCKING_REASONS:
        add(
            f"rider_dashboard_offline_blocked_{reason.lower()}",
            f"Offline with one blocking reason, `{reason}`, so its row can be tested alone."
            + _NOT_SENT,
            _dashboard("OFFLINE", today=_today(0, 0, 0), tracking=None, blocking=[reason]),
            ("error-path",),
        )

    for leg, state, note in [
        ("pickup", "EN_ROUTE_TO_PICKUP", "Heading to the restaurant; the drop-off shows the street and "
         "neighbourhood only until pickup."),
        ("dropoff", "EN_ROUTE_TO_DROPOFF", "Bag collected, heading to the customer; the full address and "
         "unit are now present."),
    ]:
        assignment = copy.deepcopy(reg.fixtures[f"assignment_{state.lower()}"].payload)
        add(
            f"rider_dashboard_on_delivery_{leg}",
            f"`ON_DELIVERY` with the assignment in `{state}`. {note} No offer while carrying "
            "an order." + _NOT_SENT,
            _dashboard("ON_DELIVERY", today=_today(3147, 2, HOUR + 51 * MINUTE), assignment=assignment),
        )

    reg.add(
        "rider_availability_go_offline_after_delivery",
        "rider",
        "RiderAvailability",
        "`setRiderAvailability {state: OFFLINE}` while carrying an order: `services/hg` keeps "
        "the rider `ON_DELIVERY` and sets `go_offline_after_delivery: true`; the rider goes "
        "offline by themselves once this delivery is done.",
        {
            "availability_state": "ON_DELIVERY",
            "since": ts(-14 * MINUTE),
            "can_receive_offers": False,
            "go_offline_after_delivery": True,
            "blocking_reasons": [],
        },
        operations=["setRiderAvailability"],
        tags=["rider", "home"],
    )


# --- Payouts ---------------------------------------------------------------- #

def _payout(label: str, state: str, weeks_ago: int, amount: int, entries: int) -> dict:
    start = _week_start(weeks_ago)
    end = start + dt.timedelta(days=7)
    paid_at = _iso(end + dt.timedelta(days=2, hours=9)) if state == "PAID" else None
    return {
        "id": uuid_for(f"rider-payout:{label}"),
        "period_start": _iso(start),
        "period_end": _iso(end),
        "amount_cents": amount,
        "currency": "CAD",
        "state": state,
        "hold_reason": (
            "Payouts are paused while Stripe checks your identity. Your earnings are safe."
            if state == "HELD" else None
        ),
        "entry_count": entries,
        "paid_at": paid_at,
        "failure_message": (
            "The bank declined the transfer: the account number on file is closed."
            if state == "FAILED" else None
        ),
    }


# (label, state, weeks ago, amount, entries): newest first. The frozen clock is a Monday, so
# the current week is still accruing and last week's payout is mid-transfer.
EVERY_STATE = [
    ("every-draft", "DRAFT", 0, 0, 0),
    ("every-ready", "READY", 1, 41235, 23),
    ("every-transferring", "TRANSFERRING", 2, 38810, 21),
    ("every-transferred", "TRANSFERRED", 3, 44120, 25),
    ("every-held", "HELD", 4, 29960, 17),
    ("every-failed", "FAILED", 5, 36475, 20),
    ("every-paid", "PAID", 6, 40390, 22),
]


def _payout_meta(rows):
    return {"next_cursor": None, "has_more": False, "total": len(rows)}


def _rider_payouts(reg) -> None:
    every = [_payout(*row) for row in EVERY_STATE]
    reg.add(
        "payout_list_every_state",
        "rider",
        "array<Payout>",
        "`listRiderPayouts` with one payout in each `PayoutState`, newest first: this week "
        "accruing (`DRAFT`), then `READY`, `TRANSFERRING`, `TRANSFERRED`, `HELD` (with its "
        "`hold_reason`), `FAILED` (with its `failure_message`) and `PAID`.",
        every,
        operations=["listRiderPayouts"],
        meta=_payout_meta(every),
        tags=["rider", "money", "payout-state-matrix"],
    )

    problems = [
        _payout("multi-draft", "DRAFT", 0, 0, 0),
        _payout("multi-failed", "FAILED", 1, 41235, 23),
        _payout("multi-held", "HELD", 2, 38810, 21),
        _payout("multi-paid", "PAID", 3, 44120, 25),
    ]
    reg.add(
        "payout_list_multi_problem",
        "rider",
        "array<Payout>",
        "Two problems at once: last week's payout `FAILED` and the week before is `HELD`. "
        "The alert names both (\"Two payouts need attention\"), not just the newest.",
        problems,
        operations=["listRiderPayouts"],
        meta=_payout_meta(problems),
        tags=["rider", "money", "error-path"],
    )

    draft_paid = [
        _payout("draft-paid-draft", "DRAFT", 0, 0, 0),
        _payout("draft-paid-1", "PAID", 1, 41235, 23),
        _payout("draft-paid-2", "PAID", 2, 38810, 21),
    ]
    reg.add(
        "payout_list_draft_paid",
        "rider",
        "array<Payout>",
        "The ordinary history: this week accruing, two paid weeks before it. Nothing needs "
        "attention.",
        draft_paid,
        operations=["listRiderPayouts"],
        meta=_payout_meta(draft_paid),
        tags=["rider", "money"],
    )

    entries = reg.fixtures["payout_detail_paid"].payload["entries"]
    for label, state, weeks_ago, amount, count in EVERY_STATE:
        if state == "PAID":
            continue  # payout_detail_paid
        detail = _payout(f"detail-{state.lower()}", state, weeks_ago, amount, 0 if state == "DRAFT" else len(entries))
        if state != "DRAFT":
            detail["amount_cents"] = sum(e["gross_cents"] for e in entries)
        lines = []
        if state != "DRAFT":
            for i, e in enumerate(entries):
                line = copy.deepcopy(e)
                line["id"] = uuid_for(f"payout-detail:{state}:{i}")
                line["payout_id"] = detail["id"]
                line["status"] = "AVAILABLE"
                lines.append(line)
        detail["entries"] = lines
        reg.add(
            f"payout_detail_{state.lower()}",
            "rider",
            "PayoutDetail",
            {
                "DRAFT": "This week's payout, still accruing: no entries stamped yet, amount 0.",
                "READY": "Week closed, amount final, waiting for Monday's run.",
                "TRANSFERRING": "Submitted to Stripe Connect on Monday's run.",
                "TRANSFERRED": "Stripe accepted the transfer; the bank has not shown it yet.",
                "FAILED": "The transfer failed. `failure_message` is shown verbatim; the money "
                          "stays in the balance and goes into the next run.",
                "HELD": "Held: `hold_reason` is shown verbatim. Nothing is lost; it goes out on "
                        "the next Monday payout after the hold is lifted.",
            }[state] + " The amount is exactly the sum of its entries.",
            detail,
            operations=["getRiderPayout"],
            tags=["rider", "money", "payout-state-matrix"],
        )


# --- Earnings --------------------------------------------------------------- #

def _entry(label: str, kind: str, status: str, gross: int, *, tip: int = 0, order: str | None,
           earned: float, payout: str | None = None, adjustment: int = 0) -> dict:
    delivery = kind == "DELIVERY"
    return {
        "id": uuid_for(f"earning-entry:{label}"),
        "assignment_id": uuid_for(f"assignment:{order}") if order else None,
        "order_code": order,
        "type": kind,
        "status": status,
        "base_cents": gross - tip if delivery else 0,
        "distance_cents": 0,
        "wait_cents": 0,
        "surge_multiplier": "1.00",
        "guarantee_topup_cents": 0,
        "tip_cents": tip,
        "adjustment_cents": adjustment,
        "gross_cents": gross,
        "currency": "CAD",
        "billable_distance_m": 4120 if delivery else None,
        "distance_source": "ROUTED" if delivery else None,
        "formula_version": 3,
        "payout_id": payout,
        "earned_at": ts(earned),
    }


ORDER_CODES = [
    "HG-7K2M-4T", "HG-3P9R-8W", "HG-6D4N-2V", "HG-9W6H-1F", "HG-5D8N-4V", "HG-2C7Q-6M",
    "HG-8B3K-5R", "HG-4F1T-9J", "HG-1H6Y-3P", "HG-7N2X-8D", "HG-3V5L-2K", "HG-6Q8S-7B",
    "HG-9T4G-1C", "HG-2M7Z-5H", "HG-5R3W-6N",
]


def _rider_earnings(reg) -> None:
    # 25 entries, newest first: deliveries with their tips, one tip added after delivery.
    rows = []
    for i in range(25):
        code = ORDER_CODES[i % len(ORDER_CODES)] if i < len(ORDER_CODES) else f"HG-{i:02d}AB-{i % 10}Z"
        kind = "TIP" if i % 6 == 5 else "DELIVERY"
        tip = 0 if kind == "TIP" else [300, 0, 500, 200, 700][i % 5]
        gross = 400 if kind == "TIP" else 449 + tip
        status = "PENDING" if i < 3 else "AVAILABLE"
        rows.append(_entry(f"paging-{i}", kind, status, gross, tip=tip if kind == "DELIVERY" else 0,
                           order=code, earned=-(i * 47 + 9) * MINUTE))
        if kind == "TIP":
            rows[-1]["tip_cents"] = 400
    first, second = rows[:20], rows[20:]
    reg.add(
        "earning_entries_paging",
        "rider",
        "array<EarningEntry>",
        "The first page of a long ledger: 20 entries (the default `limit`), newest first, "
        "`has_more: true` and `next_cursor` set to the last entry's id, as `services/hg` "
        "pages. The next page is `earning_entries_paging_page_2`.",
        first,
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": first[-1]["id"], "has_more": True, "total": None},
        tags=["rider", "money", "dense"],
    )
    reg.add(
        "earning_entries_paging_page_2",
        "rider",
        "array<EarningEntry>",
        "The second and last page after `earning_entries_paging`: five older entries, "
        "`has_more: false`, `next_cursor: null`.",
        second,
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": None, "has_more": False, "total": None},
        tags=["rider", "money"],
    )

    clawback = [
        _entry("clawback-reversal", "CLAWBACK", "AVAILABLE", -949, order="HG-3P9R-8W", earned=-20 * MINUTE),
        _entry("clawback-original", "DELIVERY", "REVERSED", 949, tip=500, order="HG-3P9R-8W", earned=-3 * HOUR),
        _entry("clawback-other", "DELIVERY", "AVAILABLE", 749, tip=300, order="HG-7K2M-4T", earned=-4 * HOUR),
    ]
    reg.add(
        "earning_entries_clawback",
        "rider",
        "array<EarningEntry>",
        "A delivery taken back: the original `DELIVERY` row is now `REVERSED` and a new "
        "`CLAWBACK` row of -9.49 follows it (append-only; nothing was edited). The line "
        "shows the minus sign.",
        clawback,
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": None, "has_more": False, "total": len(clawback)},
        tags=["rider", "money", "edge"],
    )

    pending = [
        _entry("pending-0", "DELIVERY", "PENDING", 749, tip=300, order="HG-6D4N-2V", earned=-12 * MINUTE),
        _entry("pending-1", "DELIVERY", "PENDING", 449, order="HG-9W6H-1F", earned=-58 * MINUTE),
        _entry("pending-2", "TIP", "PENDING", 500, order="HG-9W6H-1F", earned=-31 * MINUTE),
    ]
    pending[2]["tip_cents"] = 500
    reg.add(
        "earning_entries_pending",
        "rider",
        "array<EarningEntry>",
        "Today's entries, all `PENDING`: earned, not yet available for a payout. One is a "
        "tip added after the delivery, its own `TIP` row.",
        pending,
        operations=["listRiderEarningEntries"],
        meta={"next_cursor": None, "has_more": False, "total": len(pending)},
        tags=["rider", "money"],
    )

    def bucket(start: dt.datetime, gross: int, trips: int, tips: int, adjustment: int = 0) -> dict:
        delivery = gross - tips - adjustment
        return {
            "bucket_start": _iso(start),
            "gross_cents": gross,
            "delivery_cents": delivery,
            "tip_cents": tips,
            "bonus_cents": 0,
            "adjustment_cents": adjustment,
            "trips": trips,
            "online_seconds": trips * 26 * MINUTE,
            "distance_m": trips * 4120,
            "effective_cents_per_hour": (gross * 3600) // (trips * 26 * MINUTE) if trips else None,
        }

    next_payout = "2026-08-17T13:00:00.000Z"  # Monday 09:00 Toronto
    today_bucket = bucket(WEEK_START, 4296, 3, 1600)
    reg.add(
        "earnings_summary_day",
        "rider",
        "EarningsSummary",
        "`period=DAY` for today: one bucket, as `services/hg` answers `period=DAY&from=` today "
        "(the bucket unit is the period). Three trips so far.",
        {
            "period": "DAY",
            "buckets": [today_bucket],
            "total": copy.deepcopy(today_bucket),
            "unpaid_balance_cents": 4296,
            "next_payout_at": next_payout,
            "currency": "CAD",
        },
        operations=["getRiderEarningsSummary"],
        tags=["rider", "money"],
    )

    month_start = dt.datetime(2026, 8, 1, 4, 0, 0, tzinfo=dt.timezone.utc)
    month_bucket = bucket(month_start, 98415, 131, 31850)
    reg.add(
        "earnings_summary_month",
        "rider",
        "EarningsSummary",
        "`period=MONTH` for August so far: one bucket, as `services/hg` answers "
        "`period=MONTH&from=2026-08-01`. 131 trips, CAD 984.15, of which 318.50 tips.",
        {
            "period": "MONTH",
            "buckets": [month_bucket],
            "total": copy.deepcopy(month_bucket),
            "unpaid_balance_cents": 4296,
            "next_payout_at": next_payout,
            "currency": "CAD",
        },
        operations=["getRiderEarningsSummary"],
        tags=["rider", "money"],
    )

    days = [
        bucket(_week_start(1) + dt.timedelta(days=d), g, t, tip, adj)
        for d, (g, t, tip, adj) in enumerate(
            [(1347, 2, 450, 0), (0, 0, 0, 0), (-1898, 0, 0, -1898), (898, 2, 0, 0), (0, 0, 0, 0), (449, 1, 0, 0), (0, 0, 0, 0)]
        )
    ]
    total = bucket(_week_start(1), sum(b["gross_cents"] for b in days), sum(b["trips"] for b in days),
                   sum(b["tip_cents"] for b in days), sum(b["adjustment_cents"] for b in days))
    reg.add(
        "earnings_summary_negative_balance",
        "rider",
        "EarningsSummary",
        "Last week ended below zero: two clawbacks on Wednesday (-18.98) outweigh the five "
        "trips, so the week's total is 7.96 and `unpaid_balance_cents` is -4.49. A negative "
        "balance is carried to the next run, never paid out or charged.",
        {
            "period": "WEEK",
            "buckets": days,
            "total": total,
            "unpaid_balance_cents": -449,
            "next_payout_at": next_payout,
            "currency": "CAD",
        },
        operations=["getRiderEarningsSummary"],
        tags=["rider", "money", "edge"],
    )


# --- Stripe Connect ----------------------------------------------------------- #

def _connect(**over: Any) -> dict:
    requirements = {
        "currently_due": [],
        "eventually_due": [],
        "past_due": [],
        "disabled_reason": None,
        "deadline": None,
    }
    requirements.update(over.pop("requirements", {}))
    out = {
        "stripe_account_id": "acct_1QkR7mE8xVn2LbQ1",
        "charges_enabled": False,
        "payouts_enabled": True,
        "details_submitted": True,
        "requirements": requirements,
        "bank_last4": "6789",
        "payout_interval": "WEEKLY",
    }
    out.update(over)
    return out


CONNECT_STATES = [
    (
        "not_started",
        "No Stripe account yet: `services/hg` answers a zeroed, not-ready status (not 404), "
        "so the payout step renders \"Set up payouts\".",
        _connect(stripe_account_id=None, payouts_enabled=False, details_submitted=False, bank_last4=None),
    ),
    (
        "details_not_submitted",
        "The rider opened Stripe's form and left before finishing: `details_submitted: "
        "false` and Stripe's requirement ids in `currently_due`, verbatim.",
        _connect(payouts_enabled=False, details_submitted=False, bank_last4=None, requirements={
            "currently_due": ["external_account", "individual.dob.day", "individual.id_number", "tos_acceptance.date"],
            "disabled_reason": "requirements.past_due",
        }),
    ),
    (
        "currently_due",
        "Stripe wants one more thing now (`currently_due: [external_account]`); payouts are "
        "off until it is given. No deadline.",
        _connect(payouts_enabled=False, bank_last4=None, requirements={
            "currently_due": ["external_account"],
            "disabled_reason": "requirements.past_due",
        }),
    ),
    (
        "due_with_deadline",
        "Payouts still on, but Stripe needs the SIN before `deadline` (in five days); after "
        "that it turns payouts off.",
        _connect(requirements={
            "currently_due": ["individual.id_number"],
            "eventually_due": ["individual.id_number"],
            "deadline": ts(5 * DAY),
        }),
    ),
    (
        "past_due",
        "The deadline passed: `past_due` is not empty and payouts are off. Payouts are `HELD` "
        "until the rider fixes it.",
        _connect(payouts_enabled=False, requirements={
            "currently_due": ["individual.verification.document"],
            "past_due": ["individual.verification.document"],
            "disabled_reason": "requirements.past_due",
        }),
    ),
    (
        "pending_verification",
        "Everything is submitted and Stripe is checking it: nothing due, payouts off, "
        "`disabled_reason: requirements.pending_verification`. Nothing for the rider to do.",
        _connect(payouts_enabled=False, requirements={
            "disabled_reason": "requirements.pending_verification",
        }),
    ),
    (
        "rejected",
        "Stripe rejected the account (`disabled_reason: rejected.other`). Payouts are off for "
        "good on this account; the app sends the rider to support.",
        _connect(payouts_enabled=False, requirements={
            "disabled_reason": "rejected.other",
        }),
    ),
]


def _rider_connect(reg) -> None:
    for name, note, payload in CONNECT_STATES:
        reg.add(
            f"connect_status_{name}",
            "platform",
            "ConnectStatus",
            note + " Requirement ids and `disabled_reason` are Stripe's own, never paraphrased.",
            payload,
            operations=["getConnectStatus"],
            tags=["platform", "money", "connect-state-matrix"]
            + ([] if name in ("not_started", "due_with_deadline") else ["error-path"]),
        )

    _error(
        reg, "error_connect_status_not_found", 404, "NOT_FOUND",
        "No payout account exists for this partner.",
        "The 404 the contract allows on `getConnectStatus`. Contract-only: `services/hg` "
        "answers a partner with no Stripe account with `connect_status_not_started` (200) "
        "instead; treat both as \"not set up\".",
        ["getConnectStatus"], extra_tags=("rider", "restaurant"),
    )

    reg.add(
        "connect_onboarding_link",
        "platform",
        "ConnectOnboardingLink",
        "`createConnectOnboardingLink` (201): a single-use Stripe-hosted onboarding URL that "
        "expires in five minutes. Open it straight away; never store it.",
        {
            "url": "https://connect.stripe.com/setup/e/acct_1QkR7mE8xVn2LbQ1/Xy7Qp2Lm9Rt4",
            "expires_at": ts(5 * MINUTE),
        },
        operations=["createConnectOnboardingLink"],
        status=201,
        tags=["platform", "money"],
    )


# --- Account ------------------------------------------------------------------ #

def _rider_account(reg) -> None:
    me = copy.deepcopy(reg.fixtures["rider_me"].payload)
    me.update(
        {
            "account_status": "SUSPENDED",
            "availability_state": "OFFLINE",
            "active_assignment_id": None,
            "next_route": "SUSPENDED",
        }
    )
    reg.add(
        "rider_me_suspended",
        "rider",
        "RiderMe",
        "A suspended rider: `account_status: SUSPENDED`, offline, no assignment, "
        "`next_route: SUSPENDED`. The app shows the on-hold screen with the support line; "
        "going online is refused.",
        me,
        operations=["getRiderMe"],
        tags=["rider", "error-path"],
    )

    complete = reg.fixtures["rider_document_pack_complete"].payload

    def pack(changes: dict[str, dict], extra: list[dict] | None = None) -> list[dict]:
        out = []
        for doc in complete:
            doc = copy.deepcopy(doc)
            doc.update(changes.get(doc["doc_type"], {}))
            out.append(doc)
        return out + (extra or [])

    reg.add(
        "rider_document_pack_expiring",
        "documents",
        "array<KycDocument>",
        "Every document approved, but the driver's licence expires in 21 days "
        "(`valid_until`). Home and Account show the \"renew soon\" notice; the rider can "
        "still go online.",
        pack({"DRIVERS_LICENCE": {"valid_until": day(21)}}),
        operations=["listRiderDocuments"],
        tags=["rider", "documents", "boundary"],
    )
    reg.add(
        "rider_document_pack_expired",
        "documents",
        "array<KycDocument>",
        "The driver's licence expired three days ago (`state: EXPIRED`). Going online is "
        "refused with `DOCUMENT_EXPIRED` until a new one is approved.",
        pack({"DRIVERS_LICENCE": {"state": "EXPIRED", "valid_until": day(-3)}}),
        operations=["listRiderDocuments"],
        tags=["rider", "documents", "error-path"],
    )
    licence = next(d for d in complete if d["doc_type"] == "DRIVERS_LICENCE")
    replacement = copy.deepcopy(licence)
    replacement.update(
        {
            "id": uuid_for("doc:rider:DRIVERS_LICENCE:replacement"),
            "state": "IN_REVIEW",
            "issued_on": day(-2),
            "valid_until": day(5 * 365),
            "version": 2,
            "reviewed_at": None,
            "created_at": ts(-5 * HOUR),
        }
    )
    reg.add(
        "rider_document_pack_expired_replacement_in_review",
        "documents",
        "array<KycDocument>",
        "The expired licence (version 1, `EXPIRED`) and its replacement (version 2, "
        "`IN_REVIEW`, uploaded five hours ago). Still blocked until the new one is approved; "
        "the screen says it is being checked rather than asking again.",
        pack({"DRIVERS_LICENCE": {"state": "EXPIRED", "valid_until": day(-3)}}, [replacement]),
        operations=["listRiderDocuments"],
        tags=["rider", "documents"],
    )
    reg.add(
        "rider_document_pack_empty",
        "documents",
        "array<KycDocument>",
        "No documents uploaded yet.",
        [],
        operations=["listRiderDocuments"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["rider", "documents", "edge", "empty"],
    )


# =========================================================================== #
# Customer (#720)
# =========================================================================== #


def _customer(reg, synth) -> None:
    _customer_sign_in(reg)
    _customer_home(reg)
    _customer_restaurant(reg)
    _customer_orders(reg)


def _customer_sign_in(reg) -> None:
    auth = ("customer", "auth")
    suspended = reg.fixtures["session_next_route_suspended"].payload
    for status, note in [
        ("BANNED", "The account is banned: the same dead end as suspended, with no appeal "
                   "route in the copy."),
        ("DELETED", "The account was deleted: the app says so and offers to start a new one "
                    "with the same number after the retention period."),
    ]:
        grant = copy.deepcopy(suspended)
        grant["principal"]["status"] = status
        grant["principal"]["account_id"] = uuid_for(f"account:customer:{status.lower()}")
        grant["principal"]["session_id"] = uuid_for(f"session:customer:{status.lower()}")
        reg.add(
            f"session_next_route_suspended_{status.lower()}",
            "platform",
            "SessionGrant",
            f"`next_route = SUSPENDED` with `principal.status: {status}`. {note} "
            "Contract-only: `services/hg` issues no session to an account that is not "
            "`ACTIVE`; it answers sign-in with `403 ACCOUNT_NOT_ACTIVE` "
            "(`error_account_not_active`).",
            grant,
            operations=["verifyOtp", "login", "refreshSession"],
            tags=["platform", "auth", "state-matrix", "error-path"],
        )

    _error(
        reg, "error_unsupported_country", 422, "UNSUPPORTED_COUNTRY",
        "Sign-in is available for Canadian phone numbers only.",
        "A valid E.164 number from a country the platform does not serve. Contract-only: "
        "`services/hg` accepts any E.164 number at `requestOtp` today.",
        ["requestOtp"], extra_tags=auth,
    )
    _error(
        reg, "error_account_banned", 403, "ACCOUNT_BANNED",
        "This account has been closed. Contact support.",
        "The signed-in account is banned. Contract-only: `services/hg` answers a banned "
        "account with `ACCOUNT_NOT_ACTIVE` at sign-in (`error_account_not_active`) and "
        "`SESSION_REVOKED` at refresh (`error_session_revoked`); handle all three.",
        ["getCurrentPrincipal", "refreshSession"], extra_tags=auth,
    )

    config = copy.deepcopy(reg.fixtures["public_config"].payload)
    config.update({"support_enabled": False, "support_phone_e164": None, "support_hours": None})
    reg.add(
        "public_config_support_unavailable",
        "platform",
        "PublicConfig",
        "Support is switched off (`support_enabled: false`): no phone number and no hours. "
        "Every \"Contact support\" control is hidden, never a dead number.",
        config,
        operations=["getPublicConfig"],
        tags=["platform", "edge"],
    )


# --- Home ------------------------------------------------------------------- #

PAGE_2_NAMES = ["Shahi Darbar", "Kabul Kebab House", "Yemeni Mandi Corner", "Little Lahore Sweets", "Istanbul Pide Oven"]


def _list_meta(rows, *, next_cursor=None, total=None):
    return {"next_cursor": next_cursor, "has_more": next_cursor is not None,
            "total": len(rows) if total is None else total}


def _customer_home(reg) -> None:
    from content import ISSUING_BODIES
    from world import availability, halal_badge, restaurant_card, slug

    def add(name, note, cards, meta=None, extra_tags=()):
        reg.add(name, "catalogue", "array<RestaurantCard>", note, cards,
                operations=["listRestaurants"], meta=meta or _list_meta(cards),
                tags=["customer", "home", *extra_tags])

    bare = [restaurant_card(i, halal={"display_state": state})
            for i, state in enumerate(["CERTIFIED", "EXPIRING_SOON", "CERTIFIED", "CERTIFIED"])]
    add(
        "restaurant_list_missing_halal_fields",
        "Every card's `halal` carries `display_state` only: no `certifying_body_name`, no "
        "`expires_on` (both optional). The badge shows only what is present; an "
        "`EXPIRING_SOON` badge with no date shows no date, never an invented one. (A card "
        "with no `halal` object at all is not contract-valid: `halal` is required.)",
        bare, extra_tags=("halal", "edge"),
    )

    partial = [
        restaurant_card(0),
        restaurant_card(1, halal=halal_badge("CERTIFIED", certifying_body_name=None)),
        restaurant_card(2, halal=halal_badge("EXPIRING_SOON", expires_on=None)),
        restaurant_card(3, halal={"display_state": "CERTIFIED", "certifying_body_name": ISSUING_BODIES[2]}),
    ]
    add(
        "restaurant_list_partial_halal",
        "A mix: one complete badge, one with `certifying_body_name: null`, one "
        "`EXPIRING_SOON` with `expires_on: null`, one with the body and no `expires_on` key. "
        "Each card renders only the fields it has.",
        partial, extra_tags=("halal", "edge"),
    )

    eta = []
    for rank, (i, lo, hi) in enumerate([(4, 15, 25), (1, 20, 30), (7, 25, 35), (0, 25, 40), (9, 35, 50)]):
        card = restaurant_card(i)
        card["availability"] = availability("OPEN", eta_min_minutes=lo, eta_max_minutes=hi,
                                            distance_m=900 + rank * 1300)
        eta.append(card)
    add(
        "restaurant_list_eta_sorted",
        "`sort=ETA_ASC`: five open restaurants in the server's order, fastest first by "
        "`eta_min_minutes` (15, 20, 25, 25, 35). The client never re-sorts.",
        eta,
    )

    page_2 = []
    for k, name in enumerate(PAGE_2_NAMES):
        key = slug(name)
        page_2.append(restaurant_card(
            k, id=uuid_for(f"restaurant:{key}"), name=name, slug=key,
            hero_image_url=f"https://cdn.halalgoes.ca/img/restaurant/hero/{key}.webp",
            logo_image_url=f"https://cdn.halalgoes.ca/img/restaurant/logo/{key}.webp",
            availability=availability("OPEN", distance_m=12400 + k * 850),
        ))
    add(
        "restaurant_list_page_2",
        "The next page after `restaurant_list_populated` (its `next_cursor`): five farther "
        "restaurants, `has_more: false`, `next_cursor: null`. No id repeats page one.",
        page_2, meta=_list_meta(page_2, total=None),
    )

    mixed = [
        restaurant_card(0),
        restaurant_card(2, availability=availability("CLOSED_HOURS")),
        restaurant_card(5, availability=availability("PAUSED")),
        restaurant_card(7, availability=availability("CLOSED_HOURS", opens_at=ts(16 * HOUR))),
        restaurant_card(9, availability=availability("PAUSED", distance_m=5120)),
    ]
    add(
        "restaurant_list_closed_and_paused",
        "One open card among two `CLOSED_HOURS` (with `opens_at`) and two `PAUSED`. Closed "
        "and paused cards stay browsable; only adding to the cart is blocked.",
        mixed, extra_tags=("state-matrix",),
    )

    no_address = [restaurant_card(i, availability=availability("NO_ADDRESS")) for i in range(4)]
    add(
        "restaurant_list_no_address",
        "The customer has no address yet: every card is `NO_ADDRESS`, with no distance, ETA "
        "or delivery fee. The list asks for an address instead of showing blanks.",
        no_address, extra_tags=("state-matrix", "edge"),
    )


# --- Restaurant page -------------------------------------------------------- #

def _customer_restaurant(reg) -> None:
    from world import availability, certification_panel, restaurant_detail

    for name, note, url in [
        ("certificate_view_url", "The certificate image: a presigned link that expires in "
         "300 s (the halal-certificate maximum). Fetch it at once; never cache or share it.",
         "https://files.halalgoes.ca/certificates/karachi-kitchen/hma-on-40182.jpg"),
        ("certificate_view_url_pdf", "The certificate as a PDF: the same 300 s link, a "
         "`.pdf` object. The viewer opens it as a document, not an image.",
         "https://files.halalgoes.ca/certificates/karachi-kitchen/hma-on-40182.pdf"),
    ]:
        reg.add(
            name,
            "halal",
            "PresignedDownload",
            note + " Contract-only in part: `CertificationPanel` does not say which it is, "
            "so the app learns PDF or image from the link.",
            {
                "url": url + "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=9f2c4e",
                "expires_at": ts(300),
            },
            operations=["createCertificateViewUrl"],
            tags=["customer", "halal"],
        )

    def panel(name, note, payload):
        reg.add(name, "halal", "CertificationPanel", note, payload,
                operations=["getRestaurantCertification"], tags=["customer", "halal", "edge"])

    panel(
        "certification_panel_partial",
        "Certified, but some transcribed fields are missing: no certificate number, no "
        "scope, no issue date. The panel shows the rows it has and leaves the others out; "
        "it never fills a gap.",
        certification_panel("CERTIFIED", certificate_number=None, scope=None, issued_on=None),
    )
    panel(
        "certification_panel_not_viewable",
        "Certified, but the certificate file cannot be opened (`certificate_viewable: "
        "false`): \"View certificate\" is not offered. `createCertificateViewUrl` would be "
        "a 404.",
        certification_panel("CERTIFIED", certificate_viewable=False),
    )

    for state, index, note in [
        ("PAUSED", 3, "The kitchen paused itself: still browsable, cannot be ordered from."),
        ("OUT_OF_RANGE", 6, "21.4 km from the selected address, with the server's "
         "`out_of_range_reason` copy. Browsable; ordering is blocked."),
        ("NO_ADDRESS", 1, "No address yet: no distance, ETA or fee. The page asks for an "
         "address before ordering."),
    ]:
        reg.add(
            f"restaurant_detail_{state.lower()}",
            "catalogue",
            "RestaurantDetail",
            f"Restaurant detail with `availability.state = {state}`. {note}",
            restaurant_detail(index, availability=availability(state)),
            operations=["getRestaurant"],
            tags=["customer", "state-matrix"],
        )

    menu = copy.deepcopy(reg.fixtures["menu_full"].payload)
    items = menu["categories"][0]["items"]
    items[1]["availability_state"] = "BLOCKED"
    items[2]["availability_state"] = "HIDDEN"
    menu["categories"][1]["items"][2]["availability_state"] = "BLOCKED"
    reg.add(
        "menu_with_hidden_and_blocked_items",
        "catalogue",
        "Menu",
        "`menu_full` with two `BLOCKED` items (shown, never orderable: an admin blocked "
        "them) and one `HIDDEN` item (never shown). `services/hg` leaves `HIDDEN` items out "
        "of the customer menu, so the hidden one pins the client's own filter.",
        menu,
        operations=["getRestaurantMenu"],
        tags=["customer", "edge"],
    )


# --- Orders ------------------------------------------------------------------- #

def _summary(order: dict) -> dict:
    return {
        "id": order["id"],
        "code": order["code"],
        "state": order["state"],
        "restaurant": order["restaurant"],
        "item_count": sum(line["quantity"] for line in order["lines"]),
        "first_item_names": [line["name"] for line in order["lines"][:2]],
        "total_cents": order["money"]["total_cents"],
        "currency": "CAD",
        "placed_at": order["placed_at"],
        "deadline_at": order["deadline_at"],
    }


def _customer_orders(reg) -> None:
    from dom_catalogue import standard_quote_lines
    from dom_orders import ORDER_STATES, customer_order
    from money import order_money, price_quote

    every = [_summary(customer_order(state)) for state in ORDER_STATES]
    reg.add(
        "order_list_mixed_states",
        "orders",
        "array<OrderSummary>",
        "One order in each of the 14 `OrderState` values, so every state chip renders in one "
        "list. Every non-terminal row has a `deadline_at`; terminal rows have none.",
        every,
        operations=["listOrders", "listOrdersAdmin"],
        meta={"next_cursor": None, "has_more": False, "total": len(every)},
        tags=["customer", "order-state-matrix", "dense"],
    )

    older = []
    for k, state in enumerate(["COMPLETED", "COMPLETED", "CANCELLED", "COMPLETED"]):
        order = customer_order(state, label=f"history-page-2-{k}")
        order["code"] = f"HG-P2{k}K-{k + 3}M"
        order["placed_at"] = ts(-(9 + 4 * k) * DAY)
        older.append(_summary(order))
    reg.add(
        "order_list_past_page_2",
        "orders",
        "array<OrderSummary>",
        "The next page of history after `order_list_past` (its `next_cursor`): four older "
        "orders, `has_more: false`, `next_cursor: null`.",
        older,
        operations=["listOrders", "listOrdersAdmin"],
        meta={"next_cursor": None, "has_more": False, "total": None},
        tags=["customer"],
    )

    standard = reg.fixtures["receipt_standard"].payload
    lines = standard_quote_lines()
    priced = price_quote(lines, tip_cents=0, fulfilment="PICKUP", service_fee_cents=0)
    money = order_money(priced)
    money.update({"tax_lines": [], "tax_total_cents": 0, "total_cents": priced["subtotal_cents"]})
    receipt = copy.deepcopy(standard)
    receipt.update(
        {
            "order_id": uuid_for("order:receipt-no-tax"),
            "order_code": "HG-NT4X-2P",
            "receipt_number": "HG-2026-000148377",
            "restaurant_tax_registration_number": None,
            "delivery_address": None,
            "money": money,
            "payment": {**standard["payment"], "amount_charged_cents": money["total_cents"]},
        }
    )
    reg.add(
        "receipt_no_tax_no_service_fee",
        "orders",
        "Receipt",
        "A pickup from a restaurant that is not registered for HST (a small supplier), with "
        "no service fee and no tip: `tax_lines` is empty and `tax_total_cents` 0, so there "
        "is no tax row and no registration number. The lines still sum to the total.",
        receipt,
        operations=["getOrderReceipt"],
        tags=["customer", "money", "edge"],
    )

    for name, note in [
        ("no_charge", "The order was rejected or cancelled before the restaurant accepted: the "
         "authorisation was voided, nothing was charged, and no receipt will ever exist. The "
         "app says \"You were not charged\" instead of offering a receipt."),
        ("never_completed", "The order was charged but never completed (it failed and was "
         "refunded in full): no receipt is written, because a receipt is written only at "
         "`COMPLETED`. The app points to the refund instead."),
    ]:
        _error(
            reg, f"error_receipt_not_ready_{name}", 409, "RECEIPT_NOT_READY",
            "This order does not have a receipt yet.",
            note + " Same body as `error_receipt_not_ready`; the app tells the cases apart by "
            "the order's state.",
            ["getOrderReceipt"], extra_tags=("customer",),
        )

    refunds = [copy.deepcopy(reg.fixtures[f"refund_{state}"].payload)
               for state in ("requested", "pending_approval", "succeeded", "settled", "failed", "declined")]
    reg.add(
        "refund_list_every_state",
        "refunds",
        "array<Refund>",
        "`listRefunds` with refunds in six states: requested, waiting for approval, sent "
        "(\"refund in progress\"), settled (\"refunded\"), failed and declined.",
        refunds,
        operations=["listRefunds"],
        meta={"next_cursor": None, "has_more": False, "total": len(refunds)},
        tags=["customer", "money", "refund-state-matrix"],
    )


# =========================================================================== #
# Restaurant (#676)
# =========================================================================== #


def _restaurant(reg, synth) -> None:
    _restaurant_principal(reg)
    _restaurant_realtime(reg)
    _restaurant_orders(reg)
    _restaurant_availability(reg)
    _restaurant_login_errors(reg)
    _restaurant_hours(reg)
    _restaurant_owned_menu(reg)
    _restaurant_payouts(reg)


def _restaurant_principal(reg) -> None:
    restaurant_id = reg.fixtures["restaurant_profile"].payload["id"]
    reg.add(
        "principal_restaurant_owner",
        "platform",
        "Principal",
        "`GET /v1/auth/me` for the owner of the `restaurant_profile` restaurant: one "
        "`RESTAURANT_OWNER` grant scoped to that restaurant (`scope_type: RESTAURANT`, "
        "`scope_id` its id), signed in with email and password.",
        {
            "account_id": uuid_for("account:restaurant-owner:profile"),
            "session_id": uuid_for("session:restaurant-owner:profile"),
            "roles": [{"role": "RESTAURANT_OWNER", "scope_type": "RESTAURANT", "scope_id": restaurant_id}],
            "amr": "pwd",
            "status": "ACTIVE",
            "locale": "en-CA",
            "timezone": "America/Toronto",
            "next_route": "HOME",
        },
        operations=["getCurrentPrincipal"],
        tags=["platform", "auth", "restaurant"],
    )


def _restaurant_realtime(reg) -> None:
    from dom_redesign import OFFERS, RESTAURANT_CHANNEL, RESTAURANT_ID, _event, _offered

    a, b = OFFERS[0], OFFERS[1]
    reg.add(
        "realtime_restaurant_auto_off",
        "realtime",
        "RealtimeEvent[]",
        "Two offers in a row run out unanswered, and the platform turns ordering off: "
        "`restaurant.status_changed {is_accepting_orders: false, open_state: CLOSED_TOGGLE}` "
        "after the second `restaurant.order_offer_expired`. The tablet shows \"Ordering is "
        "off\" with a button to turn it back on. Contract-only: `services/hg` counts missed "
        "offers but does not turn ordering off by itself yet.",
        [
            _offered(1, 0, a, window_s=12),
            _event(2, RESTAURANT_CHANNEL, "restaurant.order_offer_expired", 12000, {
                "order_id": uuid_for(f"order:{a[0]}"), "reason": "timeout",
            }),
            _offered(3, 15000, b, window_s=12),
            _event(4, RESTAURANT_CHANNEL, "restaurant.order_offer_expired", 27000, {
                "order_id": uuid_for(f"order:{b[0]}"), "reason": "timeout",
            }),
            _event(5, RESTAURANT_CHANNEL, "restaurant.status_changed", 27500, {
                "restaurant_id": RESTAURANT_ID,
                "is_accepting_orders": False,
                "open_state": "CLOSED_TOGGLE",
                "reason": "Ordering was turned off after two orders in a row went unanswered.",
                "changed_by": "HalalGoes",
            }),
        ],
        tags=["realtime", "script", "restaurant", "error-path"],
    )


def _restaurant_orders(reg) -> None:
    from dom_orders import restaurant_order
    from dom_redesign import OFFERS

    ops = ["getRestaurantOrder", "listRestaurantOrders"]

    def add(name, note, payload, extra_tags=()):
        reg.add(name, "orders", "OrderRestaurantView", note, payload, operations=ops,
                tags=["restaurant", "order-state-matrix", *extra_tags])

    for state, note in [
        ("ARRIVED", "The rider is at the customer's door. Nothing for the kitchen to do."),
        ("DELIVERED", "Handed over; settlement has not run yet."),
        ("COMPLETED", "Terminal, happy. Shown in history, never in the live queue."),
        ("DISPUTED", "The customer disputed it after delivery; support owns it. The kitchen "
                     "sees the state, not the case."),
        ("RESOLVED", "The dispute was settled. Terminal."),
    ]:
        add(f"restaurant_order_{state.lower()}", note, restaurant_order(state))

    add(
        "restaurant_order_cancelled",
        "Cancelled by the customer while the offer was ringing, before acceptance: no "
        "delivery address was ever shown and nothing was charged.",
        restaurant_order("CANCELLED"),
    )
    accepted = restaurant_order("PREPARING", label="cancelled-after-accept")
    accepted.update(
        {
            "state": "CANCELLED",
            "deadline_at": None,
            "is_late": False,
            "promised_ready_at": None,
            "rider": None,
        }
    )
    add(
        "restaurant_order_cancelled_after_accept",
        "Cancelled by support after the kitchen accepted it (`accepted_at` set, the address "
        "already shown): stop preparing. The customer is refunded; the kitchen's "
        "compensation follows the refund's liability split.",
        accepted,
        ("error-path",),
    )

    pending = []
    for k, (offer, left) in enumerate(zip(OFFERS, [25, 70, 120, 170])):
        order = restaurant_order("RESTAURANT_PENDING", label=offer[0], code=offer[1],
                                 elapsed_seconds=180 - left, deadline_at=ts(left))
        order["customer"] = {**order["customer"], "display_name": f"{offer[2]} {'RSKO'[k]}."}
        pending.append(order)
    reg.add(
        "restaurant_order_queue_pending_four",
        "orders",
        "array<OrderRestaurantView>",
        "Four offers waiting, sorted by `deadline_at` ascending (25, 70, 120 and 170 seconds "
        "left), the server's order. The same orders and codes as "
        "`realtime_restaurant_offer_burst`. No delivery address on any of them yet.",
        pending,
        operations=["listRestaurantOrders"],
        meta={"next_cursor": None, "has_more": False, "total": len(pending)},
        tags=["restaurant", "dense"],
    )

    with_completed = [
        restaurant_order("PREPARING"),
        restaurant_order("READY_FOR_PICKUP"),
        restaurant_order("COMPLETED"),
    ]
    reg.add(
        "restaurant_order_queue_with_completed",
        "orders",
        "array<OrderRestaurantView>",
        "A live queue that also carries a `COMPLETED` row. The live screen must leave a "
        "terminal order out (the client guard for issue #601), not render it as a ticket.",
        with_completed,
        operations=["listRestaurantOrders"],
        meta={"next_cursor": None, "has_more": False, "total": len(with_completed)},
        tags=["restaurant", "edge"],
    )


def _restaurant_availability(reg) -> None:
    ops = ["getRestaurantAvailability", "setRestaurantAcceptingOrders"]
    reg.add(
        "restaurant_open_state_paused_until_closing",
        "onboarding",
        "RestaurantAvailability",
        "Paused for the rest of the day: `pause_until` is tonight's closing time (22:00 "
        "Toronto). Ordering resumes by itself tomorrow at opening.",
        {
            "open_state": "PAUSED",
            "is_accepting_orders": True,
            "pause_until": "2026-08-11T02:00:00.000Z",
            "last_heartbeat_at": ts(-40),
            "missed_order_count": 0,
            "reason": "Paused until closing at 10:00 p.m.",
            "resolvable_by": "TIME",
        },
        operations=ops,
        tags=["restaurant", "state-matrix"],
    )
    reg.add(
        "restaurant_open_state_closed_toggle_auto_off",
        "onboarding",
        "RestaurantAvailability",
        "Ordering turned off by the platform after two offers in a row expired "
        "(`missed_order_count: 2`). The restaurant turns it back on itself. Contract-only: "
        "`services/hg` counts missed offers but does not turn ordering off by itself yet.",
        {
            "open_state": "CLOSED_TOGGLE",
            "is_accepting_orders": False,
            "pause_until": None,
            "last_heartbeat_at": ts(-25),
            "missed_order_count": 2,
            "reason": "Ordering was turned off after two orders in a row went unanswered.",
            "resolvable_by": "RESTAURANT",
        },
        operations=ops,
        tags=["restaurant", "state-matrix", "error-path"],
    )


def _restaurant_login_errors(reg) -> None:
    tags = ("restaurant", "auth")
    _error(
        reg, "error_invalid_credentials", 401, "INVALID_CREDENTIALS",
        "Those credentials are not valid.",
        "Wrong email or password. The same body whether the email exists or not, so the "
        "form never says which one was wrong.",
        ["login"], extra_tags=tags,
    )
    _error(
        reg, "error_invalid_credentials_email_verification_required", 401, "INVALID_CREDENTIALS",
        "Those credentials are not valid.",
        "The right password for an address that was never verified: the same 401, plus "
        "`details.email_verification_required: true`, so the form offers to resend the "
        "verification email.",
        ["login"], details={"email_verification_required": True}, extra_tags=tags,
    )
    _error(
        reg, "error_account_temporarily_locked", 429, "ACCOUNT_TEMPORARILY_LOCKED",
        "This account is temporarily locked after too many failed attempts.",
        "Too many wrong passwords: the account is locked for 15 minutes (`Retry-After: "
        "900`, a header a fixture cannot carry). `services/hg` answers 429, not 423.",
        ["login"], extra_tags=tags,
    )
    _error(
        reg, "error_email_already_registered", 409, "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists.",
        "Restaurant sign-up with an email that already has an account. The form offers "
        "\"Sign in instead\".",
        ["registerRestaurant"], extra_tags=tags,
    )
    _error(
        reg, "error_terms_version_stale", 409, "TERMS_VERSION_STALE",
        "The terms version is out of date.",
        "Sign-up accepted an older version of the terms. `details.current` is the version "
        "to show and accept again.",
        ["registerRestaurant"], details={"current": "2026-05-01"}, extra_tags=tags,
    )


def _restaurant_hours(reg) -> None:
    ops = ["getRestaurantHours", "setRestaurantHours"]

    def add(name, note, payload, extra_tags=()):
        reg.add(name, "catalogue", "RestaurantHours", note, payload, operations=ops,
                tags=["restaurant", "hours", *extra_tags])

    add(
        "restaurant_hours_none",
        "No opening hours set yet, and no special dates. The restaurant is `CLOSED_HOURS` "
        "all week until it adds some.",
        {"timezone": "America/Toronto", "intervals": [], "overrides": []},
        ("edge", "empty"),
    )

    intervals = []
    for dow in range(7):
        intervals += [
            {"day_of_week": dow, "opens_at": "06:00", "closes_at": "10:30", "crosses_midnight": False},
            {"day_of_week": dow, "opens_at": "12:00", "closes_at": "15:00", "crosses_midnight": False},
            {"day_of_week": dow, "opens_at": "18:00", "closes_at": "02:00", "crosses_midnight": True},
        ]
    add(
        "restaurant_hours_split_past_midnight",
        "Three ranges every day: breakfast, lunch, and dinner until 02:00 the next morning "
        "(`crosses_midnight: true`). Friday's last range still counts as Friday.",
        {"timezone": "America/Toronto", "intervals": intervals, "overrides": []},
        ("dense",),
    )

    standard = copy.deepcopy(reg.fixtures["restaurant_hours_standard"].payload)
    standard["overrides"] = [
        {"date": "2026-08-14", "is_closed": True, "opens_at": None, "closes_at": None,
         "reason": "Closed for a family wedding"},
        {"date": "2026-08-15", "is_closed": False, "opens_at": "15:00", "closes_at": "23:00",
         "reason": "Late opening"},
        {"date": "2026-12-25", "is_closed": False, "opens_at": "16:00", "closes_at": "22:00",
         "reason": None},
        {"date": "2027-03-20", "is_closed": True, "opens_at": None, "closes_at": None,
         "reason": "Closed for Eid al-Fitr"},
    ]
    add(
        "restaurant_hours_special_dates",
        "The standard week plus four special dates: a closed day this Friday, shorter hours "
        "on Saturday, a late opening on 25 December with no reason given, and Eid closed.",
        standard,
    )


def _restaurant_owned_menu(reg) -> None:
    from dom_catalogue import KARACHI, _owner_view, _version
    from world import menu_category, menu_item

    restaurant_id = uuid_for(f"restaurant:{KARACHI}")
    reg.add(
        "owned_menu_empty",
        "catalogue",
        "OwnedMenu",
        "The restaurant's own menu before anything was added: no categories. The editor "
        "shows \"Add your first category\".",
        {"restaurant_id": restaurant_id, "categories": []},
        operations=["getOwnMenu"],
        tags=["restaurant", "menu", "edge", "empty"],
    )

    statuses = [
        ("DRAFT", None, None),
        ("PENDING_REVIEW", None, None),
        ("APPROVED", None, -2 * DAY),
        ("REJECTED", "UNSUBSTANTIATED_HALAL_CLAIM", -1 * DAY),
        ("WITHDRAWN", None, None),
        ("SUPERSEDED", None, -3 * DAY),
    ]
    items = []
    for k, (status, reason, reviewed) in enumerate(statuses):
        item = menu_item(k)
        live = _version(item, 1, "APPROVED", created=-30 * DAY, reviewed=-29 * DAY)
        if status == "APPROVED":
            live = _version(item, 2, "APPROVED", created=-3 * DAY, reviewed=reviewed)
        version = _version(
            item, 2, status, created=-(k + 1) * HOUR,
            reviewed=reviewed if status in ("REJECTED", "SUPERSEDED") else None,
            note=("We cannot show \"zabiha\" in a description without the certificate "
                  "covering it. Remove the word or upload proof." if status == "REJECTED" else None),
            rejection_reason_code=reason,
            description=item["description"] + " Now with more saffron.",
        )
        pending = version if status in ("DRAFT", "PENDING_REVIEW", "REJECTED") else None
        view = _owner_view(item, live=live, pending=pending, sort_order=k + 1)
        items.append(view)
    reg.add(
        "owned_menu_every_review_status",
        "catalogue",
        "OwnedMenu",
        "Six items, one per `MenuReviewStatus` on its newest version: a draft, one waiting "
        "for review, one just approved, one rejected with its reason and note, one withdrawn "
        "and one superseded. Items whose newest version is withdrawn or superseded show only "
        "the live version.",
        {"restaurant_id": restaurant_id, "categories": [{**menu_category(0, []), "item_count": len(items), "items": items}]},
        operations=["getOwnMenu"],
        tags=["restaurant", "menu", "state-matrix"],
    )

    categories = []
    for k in range(40):
        category = menu_category(k, [], id=uuid_for(f"category:owned-40:{k}"),
                                 name=f"Section {k + 1:02d}", sort_order=k + 1)
        dish = menu_item(k, restaurant_key=f"owned-40-{k}")
        category["items"] = [_owner_view({**dish, "id": uuid_for(f"item:owned-40:{k}")}, live=None, pending=None)]
        category["items"][0]["category_id"] = category["id"]
        category["item_count"] = 1
        categories.append(category)
    reg.add(
        "owned_menu_forty_categories",
        "catalogue",
        "OwnedMenu",
        "Forty categories with one item each: the category rail scrolls and keeps the "
        "current one in view.",
        {"restaurant_id": restaurant_id, "categories": categories},
        operations=["getOwnMenu"],
        tags=["restaurant", "menu", "dense", "overflow"],
    )


def _restaurant_payouts(reg) -> None:
    def payout(label, state, weeks_ago, amount, entries):
        row = _payout(f"restaurant:{label}", state, weeks_ago, amount, entries)
        if state == "HELD":
            row["hold_reason"] = "Payouts are paused while Stripe checks the business details."
        return row

    every = [payout(*row) for row in [
        ("every-draft", "DRAFT", 0, 0, 0),
        ("every-ready", "READY", 1, 184250, 61),
        ("every-transferring", "TRANSFERRING", 2, 201475, 67),
        ("every-transferred", "TRANSFERRED", 3, 176830, 58),
        ("every-held", "HELD", 4, 193115, 64),
        ("every-failed", "FAILED", 5, 168940, 55),
        ("every-paid", "PAID", 6, 188320, 62),
    ]]
    reg.add(
        "restaurant_payout_history_every_state",
        "rider",
        "array<Payout>",
        "A restaurant's payouts with one in each `PayoutState`, newest first, including a "
        "`HELD` week with its reason and a `FAILED` week with its message.",
        every,
        operations=["listRestaurantPayouts"],
        meta={"next_cursor": None, "has_more": False, "total": len(every)},
        tags=["restaurant", "money", "payout-state-matrix"],
    )

    page_1 = [payout(f"page-1-{w}", "DRAFT" if w == 0 else "PAID", w, 0 if w == 0 else 180000 + w * 1375, 0 if w == 0 else 60)
              for w in range(20)]
    page_2 = [payout(f"page-2-{w}", "PAID", w, 170000 + w * 990, 57) for w in range(20, 26)]
    reg.add(
        "restaurant_payout_history_page_1",
        "rider",
        "array<Payout>",
        "The first page of a long payout history: 20 weeks, newest first, `has_more: true`. "
        "The next page is `restaurant_payout_history_page_2`.",
        page_1,
        operations=["listRestaurantPayouts"],
        meta={"next_cursor": page_1[-1]["id"], "has_more": True, "total": None},
        tags=["restaurant", "money", "dense"],
    )
    reg.add(
        "restaurant_payout_history_page_2",
        "rider",
        "array<Payout>",
        "The last page after `restaurant_payout_history_page_1`: six older paid weeks, "
        "`has_more: false`.",
        page_2,
        operations=["listRestaurantPayouts"],
        meta={"next_cursor": None, "has_more": False, "total": None},
        tags=["restaurant", "money"],
    )
