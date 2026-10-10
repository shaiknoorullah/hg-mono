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
