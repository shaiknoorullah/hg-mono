"""
Fixtures the redesign tracks asked for, batch 1 (the redesign master plan, section 5.4).

Kept in its own module so the batches add files instead of editing the domain modules other
pull requests are changing. Every fixture here validates against `contracts/openapi.yaml` as
it is on `main`; nothing depends on an unmerged contract change.

Where the contract defines a code or a frame that `services/hg` does not produce yet, the
fixture still exists (an app must handle every contract value) and its `describes` says so
in one sentence starting "Contract-only:", so nobody mistakes it for a state the real API
can reach today.

What is here:

* staff principals and a staff session (`getCurrentPrincipal`, `login`);
* the `admin:ops` realtime frames (contracts/websocket.md section 4.7);
* the restaurant offer frames: one offer, a burst of four, expired, withdrawn, accepted
  on another tablet (section 4.4);
* the rider error envelopes from the rider manifest's missing-fixture list;
* the customer session errors from the customer manifest's missing-fixture list;
* the restaurant's own profile in every `account_state` and every halal display state,
  plus the profile with no halal object at all.
"""

from __future__ import annotations

import copy

from content import MINUTE, ts
from synth import ulid_for, uuid_for

# The devworld staff personas (services/hg/internal/devworld/personas.go and
# migrations/devworld/001_personas.sql): `admin-seed` is the SUPER_ADMIN, `support-seed` the
# SUPPORT_AGENT. The fixtures use the same account ids so a screen test (mock) and a journey
# (devworld) name the same people. Devworld has no plain ADMIN persona yet.
SUPER_ADMIN_SEED_ACCOUNT = "a0000000-0000-4000-8000-000000000001"
SUPPORT_SEED_ACCOUNT = "a0000000-0000-4000-8000-000000000002"
ADMIN_ACCOUNT = uuid_for("account:staff:admin")
PASSWORD_ONLY_ADMIN_ACCOUNT = uuid_for("account:staff:admin-password-only")


def build(reg, synth) -> None:
    _staff_principals(reg, synth)
    _admin_ops(reg)
    _restaurant_offers(reg)
    _rider_errors(reg)
    _customer_session_errors(reg)
    _restaurant_profiles(reg, synth)


# --------------------------------------------------------------------------- #
# Staff principals
# --------------------------------------------------------------------------- #


def _principal(account_id: str, role: str, amr: str, label: str) -> dict:
    return {
        "account_id": account_id,
        "session_id": uuid_for(f"session:{label}"),
        "roles": [{"role": role, "scope_type": "GLOBAL", "scope_id": None}],
        "amr": amr,
        "status": "ACTIVE",
        "locale": "en-CA",
        "timezone": "America/Toronto",
        "next_route": "HOME",
    }


STAFF = [
    (
        "principal_admin",
        _principal(ADMIN_ACCOUNT, "ADMIN", "pwd+totp", "staff:admin"),
        "`GET /v1/auth/me` for an `ADMIN` signed in with password and authenticator code "
        "(`amr: pwd+totp`), so money actions are allowed. Global grant, `scope_id: null`. "
        "Devworld has no plain `ADMIN` persona yet; `admin-seed` is the super admin.",
    ),
    (
        "principal_admin_password_only",
        _principal(PASSWORD_ONLY_ADMIN_ACCOUNT, "ADMIN", "pwd", "staff:admin-password-only"),
        "An `ADMIN` whose session was signed in with a password only (`amr: pwd`). The "
        "console works, but every money action answers `403 MFA_REQUIRED` "
        "(`error_refund_mfa_required`); the app offers to sign in again with the code.",
    ),
    (
        "principal_support_agent",
        _principal(SUPPORT_SEED_ACCOUNT, "SUPPORT_AGENT", "pwd", "staff:support"),
        "`GET /v1/auth/me` for a `SUPPORT_AGENT`: read-mostly console, no decisions, no "
        "staff management. The account id is the devworld `support-seed` persona's.",
    ),
    (
        "principal_super_admin",
        _principal(SUPER_ADMIN_SEED_ACCOUNT, "SUPER_ADMIN", "pwd+totp", "staff:super-admin"),
        "`GET /v1/auth/me` for a `SUPER_ADMIN` with an authenticator-code session: staff "
        "management, certificate revocation and refunds above every approver's limit. "
        "The account id is the devworld `admin-seed` persona's (`make dev-admin`).",
    ),
]


def _staff_principals(reg, synth) -> None:
    for scenario, principal, note in STAFF:
        reg.add(
            scenario,
            "platform",
            "Principal",
            note,
            principal,
            operations=["getCurrentPrincipal"],
            tags=["platform", "auth", "staff"],
        )

    grant = synth.make("SessionGrant", "session-staff")
    grant.update(
        {
            "access_token": "eyJhbGciOiJFZERTQSJ9.staff-session.signature",
            # Web surface: the refresh token travels only as the `hg_rt` cookie.
            "refresh_token": None,
            "expires_in": 900,
            "is_new_account": False,
            "principal": copy.deepcopy(STAFF[0][1]),
        }
    )
    reg.add(
        "session_grant_staff",
        "platform",
        "SessionGrant",
        "`login` for staff on the web console: password plus authenticator code, a "
        "15-minute access token, `refresh_token: null` (the refresh token is the `hg_rt` "
        "cookie on web) and the `principal_admin` principal.",
        grant,
        operations=["login", "refreshSession"],
        tags=["platform", "auth", "staff"],
    )


# --------------------------------------------------------------------------- #
# Realtime: shared event helper (the envelope from contracts/websocket.md section 2)
# --------------------------------------------------------------------------- #


def _event(seq: int, channel: str, etype: str, offset_ms: int, data: dict, v: int = 1) -> dict:
    return {
        "id": ulid_for(f"event:{channel}:{etype}:{seq}:{offset_ms}"),
        "seq": seq,
        "channel": channel,
        "type": etype,
        "v": v,
        "ts": ts(offset_ms / 1000.0),
        "data": data,
        # Not part of the envelope: the mock server reads it to pace the script.
        "_delay_ms": offset_ms,
    }


# --------------------------------------------------------------------------- #
# admin:ops (contracts/websocket.md section 4.7)
# --------------------------------------------------------------------------- #

OPS = "admin:ops"


def _queue_depth(seq, offset_ms, restaurants, riders, disputes, refunds):
    return _event(seq, OPS, "admin.queue_depth", offset_ms, {
        "pending_restaurant_reviews": restaurants,
        "pending_rider_reviews": riders,
        "open_disputes": disputes,
        "failed_refunds": refunds,
    })


def _alert(seq, offset_ms, severity, kind, subject_type, subject_id, message):
    return _event(seq, OPS, "admin.alert", offset_ms, {
        "severity": severity,
        "kind": kind,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "message": message,
        "at": ts(offset_ms / 1000.0),
    })


def _admin_ops(reg) -> None:
    failed_order = uuid_for("order:ops-no-rider")
    recon_order = uuid_for("order:ops-reconciliation")
    exception_id = uuid_for("reconciliation_exception:ops-1")
    refund_id = uuid_for("refund:ops-dead-letter")
    chargeback_id = uuid_for("chargeback:ops-opened")

    depth = [
        _queue_depth(1, 0, 3, 5, 1, 0),
        _queue_depth(2, 6000, 4, 5, 1, 0),
        _queue_depth(3, 12000, 4, 4, 2, 1),
        _queue_depth(4, 18000, 0, 0, 0, 0),
    ]
    reg.add(
        "realtime_admin_ops_queue_depth",
        "realtime",
        "RealtimeEvent[]",
        "`admin.queue_depth` on `admin:ops`: the first frame fills the nav counts (hidden "
        "until it arrives), two updates change them, the last one is all zeros (no badge "
        "rendered for 0). Contract-only: `services/hg` does not emit `admin.queue_depth` "
        "yet, so on the real API the counts stay hidden; read the queues instead.",
        depth,
        tags=["realtime", "script", "admin"],
    )

    alerts = [
        _alert(1, 0, "high", "webhook_refused", "stripe_event", "evt_3QkR7mE8xVn2LbQ1",
               "A Stripe webhook was refused: its signature did not verify."),
        _alert(2, 4000, "high", "chargeback_opened", "chargeback", chargeback_id,
               "A chargeback was opened on HG-4K2M-9T. Evidence is due in 7 days."),
        _alert(3, 8000, "critical", "refund_dead_letter", "refund", refund_id,
               "A refund failed five times and stopped retrying. The customer has not been paid."),
        _alert(4, 12000, "high", "unknown_intent", "reconciliation_exception", exception_id,
               "Stripe has a payment this database has no row for. Stripe object pi_3QkR7mE8xVn2LbQ1."),
    ]
    reg.add(
        "realtime_admin_ops_alerts",
        "realtime",
        "RealtimeEvent[]",
        "Four `admin.alert` frames in the shapes `services/hg` raises today: a refused "
        "webhook (`high`), a chargeback opened (`high`), a refund dead letter (`critical`) "
        "and a reconciliation exception (`high`, `subject_type: reconciliation_exception`). "
        "`severity` is `high` or `critical`.",
        alerts,
        tags=["realtime", "script", "admin"],
    )

    dispatch_failure = _event(1, OPS, "admin.dispatch_failure", 0, {
        "order_id": failed_order, "waves": 3, "riders_offered": 8, "radius_m": 10000,
    })
    reg.add(
        "realtime_admin_ops_dispatch_failure",
        "realtime",
        "RealtimeEvent[]",
        "`admin.dispatch_failure`: three dispatch waves ran out to 10 km, eight riders were "
        "offered the order and nobody accepted. `services/hg` emits this when dispatch "
        "reaches `NO_RIDER_FOUND`.",
        [dispatch_failure],
        tags=["realtime", "script", "admin", "error-path"],
    )

    recon = _event(1, OPS, "admin.reconciliation_exception", 0, {
        "kind": "transfer_mismatch", "order_id": recon_order,
        "expected_cents": 4120, "actual_cents": 3980,
    })
    reg.add(
        "realtime_admin_ops_reconciliation_exception",
        "realtime",
        "RealtimeEvent[]",
        "`admin.reconciliation_exception`: a transfer of 39.80 where the ledger expected "
        "41.20. Contract-only: `services/hg` reports reconciliation exceptions as an "
        "`admin.alert` with `subject_type: reconciliation_exception` "
        "(`realtime_admin_ops_alerts`), not as this frame.",
        [recon],
        tags=["realtime", "script", "admin", "error-path"],
    )

    everything = [
        _queue_depth(1, 0, 3, 5, 1, 0),
        _alert(2, 3000, "high", "webhook_refused", "stripe_event", "evt_3QkR7mE8xVn2LbQ1",
               "A Stripe webhook was refused: its signature did not verify."),
        _event(3, OPS, "admin.dispatch_failure", 6000, {
            "order_id": failed_order, "waves": 3, "riders_offered": 8, "radius_m": 10000,
        }),
        _alert(4, 9000, "critical", "refund_dead_letter", "refund", refund_id,
               "A refund failed five times and stopped retrying. The customer has not been paid."),
        _event(5, OPS, "admin.reconciliation_exception", 12000, {
            "kind": "transfer_mismatch", "order_id": recon_order,
            "expected_cents": 4120, "actual_cents": 3980,
        }),
        _queue_depth(6, 15000, 3, 5, 2, 1),
    ]
    reg.add(
        "realtime_admin_ops_all",
        "realtime",
        "RealtimeEvent[]",
        "Every `admin:ops` type in one script, `seq` 1 to 6: queue depth, an alert, a "
        "dispatch failure, a critical alert, a reconciliation exception, queue depth again. "
        "Drives the alerts page from empty to busy.",
        everything,
        tags=["realtime", "script", "admin"],
    )

    reg.add(
        "realtime_admin_ops_unknown_type",
        "realtime",
        "RealtimeEvent[]",
        "Frames a client must ignore without crashing (websocket.md section 2): an unknown "
        "type `admin.capacity_warning`, and `admin.queue_depth` at `v: 2`. Then a normal "
        "`v: 1` queue depth that must be shown. `seq` stays gapless across all three.",
        [
            _event(1, OPS, "admin.capacity_warning", 0, {"region": "toronto", "online_riders": 2}),
            _event(2, OPS, "admin.queue_depth", 2000, {
                "pending": {"restaurants": 3, "riders": 5}, "disputes": 1,
            }, v=2),
            _queue_depth(3, 4000, 3, 5, 1, 0),
        ],
        tags=["realtime", "script", "admin", "edge"],
    )


# --------------------------------------------------------------------------- #
# restaurant:{id} offers (contracts/websocket.md section 4.4)
# --------------------------------------------------------------------------- #

RESTAURANT_ID = uuid_for("restaurant:karachi-kitchen")
RESTAURANT_CHANNEL = f"restaurant:{RESTAURANT_ID}"
RESPONSE_WINDOW_S = 180

OFFERS = [
    # (label, code, first name, lines, subtotal, total, prep suggestion, fulfilment)
    (
        "offer-a", "HG-A7K2-4M", "Ayesha",
        [
            {"name": "Chicken Biryani", "variant": None, "addons": [], "qty": 2, "note": None},
            {"name": "Garlic Naan", "variant": None, "addons": [], "qty": 2, "note": None},
        ],
        3298, 4369, 20, "DELIVERY",
    ),
    (
        "offer-b", "HG-B3Q9-7T", "Bilal",
        [
            {"name": "Beef Nihari", "variant": "Full", "addons": [], "qty": 1, "note": "Extra gravy on the side"},
        ],
        1899, 2671, 25, "DELIVERY",
    ),
    (
        "offer-c", "HG-C8W4-2R", "Fatima",
        [
            {"name": "Chicken Karahi (Half)", "variant": None, "addons": ["Garlic naan"], "qty": 1, "note": None},
            {"name": "Mango Lassi", "variant": None, "addons": [], "qty": 3, "note": "No ice"},
        ],
        2846, 3216, 15, "PICKUP",
    ),
    (
        "offer-d", "HG-D2M6-9K", "Omar",
        [
            {"name": "Lamb Seekh Kebab", "variant": None, "addons": [], "qty": 4, "note": None},
            {"name": "Chicken Tikka", "variant": "Boneless", "addons": ["Mint chutney"], "qty": 2, "note": None},
            {"name": "Gulab Jamun", "variant": None, "addons": [], "qty": 2, "note": None},
        ],
        6118, 7932, 30, "DELIVERY",
    ),
]


def _offered(seq: int, offset_ms: int, offer, window_s: float = RESPONSE_WINDOW_S) -> dict:
    label, code, first_name, lines, subtotal, total, prep, fulfilment = offer
    expires = ts(offset_ms / 1000.0 + window_s)
    return _event(seq, RESTAURANT_CHANNEL, "restaurant.order_offered", offset_ms, {
        "order_id": uuid_for(f"order:{label}"),
        "code": code,
        "expires_at": expires,
        "deadline_at": expires,
        "customer_first_name": first_name,
        "lines": copy.deepcopy(lines),
        "subtotal_cents": subtotal,
        "total_cents": total,
        "currency": "CAD",
        "prep_eta_suggestion_min": prep,
        "fulfilment": fulfilment,
    })


def _order_id(offer) -> str:
    return uuid_for(f"order:{offer[0]}")


def _restaurant_offers(reg) -> None:
    a, b, c, d = OFFERS

    reg.add(
        "realtime_restaurant_offer_one",
        "realtime",
        "RealtimeEvent[]",
        "One `restaurant.order_offered` with the full 180-second window: the strip rings "
        "and shows one tile. Pre-acceptance projection only (first name, no phone, no "
        "address). Pair with `restaurant_order_restaurant_pending` for the tile's detail.",
        [_offered(1, 0, a)],
        tags=["realtime", "script", "restaurant"],
    )

    reg.add(
        "realtime_restaurant_offer_burst",
        "realtime",
        "RealtimeEvent[]",
        "A burst of four offers inside six seconds, each with its own 180-second window: "
        "three tiles in full and the fourth behind \"+1 more\". A new offer never takes "
        "focus. One is a pickup order.",
        [_offered(1, 0, a), _offered(2, 1500, b), _offered(3, 3500, c), _offered(4, 6000, d)],
        tags=["realtime", "script", "restaurant", "dense"],
    )

    reg.add(
        "realtime_restaurant_offer_expired",
        "realtime",
        "RealtimeEvent[]",
        "An offer seen with 15 seconds of its window left (as after a reconnect), then "
        "`restaurant.order_offer_expired {reason: timeout}` when it runs out. The server "
        "ends the offer; the customer was not charged. Accepting after this is "
        "`409 OFFER_EXPIRED` (`error_offer_expired`).",
        [
            _offered(1, 0, a, window_s=15),
            _event(2, RESTAURANT_CHANNEL, "restaurant.order_offer_expired", 15000, {
                "order_id": _order_id(a), "reason": "timeout",
            }),
        ],
        tags=["realtime", "script", "restaurant", "error-path"],
    )

    reg.add(
        "realtime_restaurant_offer_withdrawn",
        "realtime",
        "RealtimeEvent[]",
        "The customer cancels while the offer is ringing: "
        "`restaurant.order_offer_withdrawn {reason: customer_cancelled}` at 8 s. The tile "
        "leaves; nothing is prepared.",
        [
            _offered(1, 0, b),
            _event(2, RESTAURANT_CHANNEL, "restaurant.order_offer_withdrawn", 8000, {
                "order_id": _order_id(b), "reason": "customer_cancelled",
            }),
        ],
        tags=["realtime", "script", "restaurant", "error-path"],
    )

    reg.add(
        "realtime_restaurant_offer_withdrawn_payment_failed",
        "realtime",
        "RealtimeEvent[]",
        "The kitchen accepts, the capture is declined, and the offer is withdrawn with "
        "`reason: payment_failed`: \"Don't prepare this order. The customer was not "
        "charged.\" Accepting returns `error_capture_failed`.",
        [
            _offered(1, 0, c),
            _event(2, RESTAURANT_CHANNEL, "restaurant.order_offer_withdrawn", 9000, {
                "order_id": _order_id(c), "reason": "payment_failed",
            }),
        ],
        tags=["realtime", "script", "restaurant", "error-path"],
    )

    reg.add(
        "realtime_restaurant_offer_accepted_elsewhere",
        "realtime",
        "RealtimeEvent[]",
        "Two offers ring; another tablet accepts the first "
        "(`restaurant.order_accepted`, the fan-out) and declines the second "
        "(`restaurant.order_rejected`, `KITCHEN_AT_CAPACITY`). This screen only clears both tiles.",
        [
            _offered(1, 0, a),
            _offered(2, 1000, d),
            _event(3, RESTAURANT_CHANNEL, "restaurant.order_accepted", 7000, {
                "order_id": _order_id(a), "accepted_by": "Hamza K.", "prep_eta_minutes": 20,
            }),
            _event(4, RESTAURANT_CHANNEL, "restaurant.order_rejected", 11000, {
                "order_id": _order_id(d), "rejected_by": "Hamza K.", "reason_code": "KITCHEN_AT_CAPACITY",
            }),
        ],
        tags=["realtime", "script", "restaurant"],
    )


# --------------------------------------------------------------------------- #
# Error envelopes
# --------------------------------------------------------------------------- #


def _error(reg, scenario, status, code, message, note, operations, details=None, extra_tags=()):
    envelope = {
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


def _rider_errors(reg) -> None:
    rider = ("rider",)
    _error(
        reg, "error_geofence_required", 422, "GEOFENCE_REQUIRED",
        "You must be near the location, or supply an override reason.",
        "A transition that needs the rider at the pickup or drop-off, sent from too far "
        "away and without `override_reason`. The app offers \"I'm here\" with a reason, "
        "which makes it a flagged manual transition.",
        ["createAssignmentTransition"], extra_tags=rider,
    )
    _error(
        reg, "error_invalid_transition", 409, "INVALID_TRANSITION",
        "That transition is not allowed.",
        "A backwards or skipped assignment transition. `details.current_state` is where "
        "the assignment really is; the app re-reads it and moves on from there. Repeating "
        "the current state is a 200 no-op, not this.",
        ["createAssignmentTransition"],
        details={"current_state": "PICKED_UP"}, extra_tags=rider,
    )
    _error(
        reg, "error_pod_required", 422, "POD_REQUIRED",
        "Proof of delivery is required before delivering.",
        "`DELIVERED` without the proof artefact. `details.required_pod_method` says which "
        "proof the drop-off needs (`OTP` here).",
        ["createAssignmentTransition", "submitProofOfDelivery"],
        details={"required_pod_method": "OTP"}, extra_tags=rider,
    )
    _error(
        reg, "error_cannot_go_online", 422, "CANNOT_GO_ONLINE",
        "You cannot go online yet.",
        "Going online without a fresh location fix: the one soft reason `services/hg` "
        "sends today. The app deep-links each `details.blocking_reasons` entry to its fix.",
        ["setRiderAvailability"],
        details={"blocking_reasons": ["STALE_LOCATION_FIX"]}, extra_tags=rider,
    )
    _error(
        reg, "error_cannot_go_online_all_reasons", 422, "CANNOT_GO_ONLINE",
        "You cannot go online yet.",
        "All nine contract `blocking_reasons` at once, so one screen test covers every "
        "row. Contract-only: `services/hg` sends `ONBOARDING_INCOMPLETE`, "
        "`ACCOUNT_NOT_ACTIVE` and `PAYOUT_ACCOUNT_INCOMPLETE` as their own 403 codes and "
        "only `STALE_LOCATION_FIX` in this list today.",
        ["setRiderAvailability"],
        details={"blocking_reasons": list(BLOCKING_REASONS)}, extra_tags=rider,
    )
    for reason in BLOCKING_REASONS:
        if reason == "STALE_LOCATION_FIX":
            continue  # that one is `error_cannot_go_online`
        _error(
            reg, f"error_cannot_go_online_{reason.lower()}", 422, "CANNOT_GO_ONLINE",
            "You cannot go online yet.",
            f"One blocking reason, `{reason}`, so its row and deep link can be tested "
            "alone. Contract-only: `services/hg` sends only `STALE_LOCATION_FIX` in "
            "`blocking_reasons` today.",
            ["setRiderAvailability"],
            details={"blocking_reasons": [reason]}, extra_tags=rider,
        )
    _error(
        reg, "error_active_delivery_in_progress", 409, "ACTIVE_DELIVERY_IN_PROGRESS",
        "Finish your current delivery before going offline.",
        "Going offline while carrying an order. Contract-only: `services/hg` does not "
        "return this code yet; it lets the rider set `go_offline_after_delivery` instead.",
        ["setRiderAvailability"], extra_tags=rider,
    )
    _error(
        reg, "error_onboarding_incomplete", 403, "ONBOARDING_INCOMPLETE",
        "Complete onboarding before going online.",
        "A rider who has not finished onboarding tries to go online. `details.next_step` "
        "is the onboarding state to route to.",
        ["setRiderAvailability"],
        details={"next_step": "DOCUMENTS_PENDING"}, extra_tags=rider,
    )
    _error(
        reg, "error_account_not_active", 403, "ACCOUNT_NOT_ACTIVE",
        "This account is not active.",
        "The account is suspended, banned or deleted. Returned by `login` and by "
        "`setRiderAvailability` going online; nothing changed.",
        ["setRiderAvailability", "login"], extra_tags=("rider", "auth"),
    )
    _error(
        reg, "error_payout_account_incomplete", 403, "PAYOUT_ACCOUNT_INCOMPLETE",
        "Finish setting up your payout account before going online.",
        "Stripe payouts are not enabled for this rider yet. The app links to the payout "
        "step (`getConnectStatus`).",
        ["setRiderAvailability"], extra_tags=rider,
    )
    _error(
        reg, "error_plate_in_use", 409, "PLATE_IN_USE",
        "Licence plate is already registered to another vehicle.",
        "The plate belongs to another rider's vehicle. Shown on the plate field.",
        ["submitRiderVehicle"], extra_tags=rider,
    )
    _error(
        reg, "error_rider_email_in_use", 409, "EMAIL_IN_USE",
        "Email is already in use.",
        "`submitRiderProfile` with an email that belongs to another account. Shown on the "
        "email field; nothing was saved.",
        ["submitRiderProfile"], extra_tags=rider,
    )
    _error(
        reg, "error_field_required", 422, "FIELD_REQUIRED",
        "licence_plate is required for motorised vehicles.",
        "A car, scooter or motorcycle without a plate.",
        ["submitRiderVehicle"],
        details=[{"field": "licence_plate", "code": "required",
                  "message": "licence_plate is required for CAR, SCOOTER, MOTORCYCLE"}],
        extra_tags=rider,
    )
    _error(
        reg, "error_field_not_applicable", 422, "FIELD_NOT_APPLICABLE",
        "licence_plate is not applicable for this vehicle type.",
        "A bicycle or on-foot rider sent a plate. The form hides the field for those types.",
        ["submitRiderVehicle"],
        details=[{"field": "licence_plate", "code": "not_applicable",
                  "message": "licence_plate must be absent for BICYCLE and ON_FOOT"}],
        extra_tags=rider,
    )
    _error(
        reg, "error_document_expires_too_soon", 422, "DOCUMENT_EXPIRES_TOO_SOON",
        "Document must be valid for at least 30 days.",
        "A document whose expiry date is less than 30 days away.",
        ["attachRiderDocument"], extra_tags=rider,
    )
    _error(
        reg, "error_image_too_small", 422, "IMAGE_TOO_SMALL",
        "The uploaded image is below the minimum size for a document scan.",
        "`confirmUpload` on a photo too small to be a real scan. PDFs are exempt. The app "
        "asks for a retake.",
        ["confirmUpload"], extra_tags=("rider", "upload"),
    )
    _error(
        reg, "error_content_type_mismatch", 422, "CONTENT_TYPE_MISMATCH",
        "The uploaded bytes do not match the declared content type.",
        "The file's bytes are not the type declared when the upload was created.",
        ["confirmUpload"], extra_tags=("rider", "upload"),
    )
    _error(
        reg, "error_checksum_mismatch", 422, "CHECKSUM_MISMATCH",
        "The uploaded bytes do not match the declared size or checksum.",
        "The upload was cut off or changed in transit. Upload it again.",
        ["confirmUpload"], extra_tags=("rider", "upload"),
    )
    _error(
        reg, "error_payload_too_large", 413, "PAYLOAD_TOO_LARGE",
        "The declared size exceeds the cap for this purpose.",
        "`createUpload` for a file over the purpose's cap; `details.max_bytes` is the cap.",
        ["createUpload"],
        details={"max_bytes": 10485760}, extra_tags=("rider", "upload"),
    )
    _error(
        reg, "error_nothing_to_resubmit", 409, "NOTHING_TO_RESUBMIT",
        "There are no changed documents to send.",
        "Sending the document pack again with nothing replaced since the last review. "
        "Contract-only: `services/hg` does not return this code yet.",
        ["submitRiderDocuments"], extra_tags=rider,
    )
    _error(
        reg, "error_otp_invalid_or_expired", 400, "OTP_INVALID_OR_EXPIRED",
        "This code is invalid or has expired. Request a new one.",
        "The challenge expired or was used up. Different from `error_otp_incorrect`: the "
        "app clears the code and offers \"Send a new code\".",
        ["verifyOtp"], extra_tags=("rider", "customer", "auth"),
    )
    _error(
        reg, "error_step_not_available", 409, "STEP_NOT_AVAILABLE",
        "The partner must be approved before creating a payout account.",
        "Payout setup before the application is approved.",
        ["createConnectAccount", "createConnectOnboardingLink"], extra_tags=("rider", "restaurant"),
    )
    _error(
        reg, "error_rate_limiter_unavailable", 503, "RATE_LIMITER_UNAVAILABLE",
        "Verification is temporarily unavailable. Please try again shortly.",
        "The sign-in code service's rate limiter cannot be reached, so no code is sent "
        "(fail closed). This is the 503 the rider manifest calls `error_service_unavailable`.",
        ["requestOtp", "verifyOtp"], extra_tags=("rider", "customer", "auth"),
    )


def _customer_session_errors(reg) -> None:
    auth = ("customer", "auth", "session")
    _error(
        reg, "error_session_revoked", 401, "SESSION_REVOKED",
        "This session has been revoked. Please sign in again.",
        "`refreshSession` after the session was signed out elsewhere (`logoutAll`) or "
        "revoked by staff. The app drops its tokens and shows the signed-out screen.",
        ["refreshSession"], extra_tags=auth,
    )
    _error(
        reg, "error_session_expired", 401, "SESSION_EXPIRED",
        "This session has expired. Please sign in again.",
        "`refreshSession` with a refresh token past its lifetime.",
        ["refreshSession"], extra_tags=auth,
    )
    _error(
        reg, "error_refresh_reuse_detected", 401, "REFRESH_REUSE_DETECTED",
        "This session has been revoked for security. Please sign in again.",
        "A refresh token was used twice, so the whole session family was revoked. Same "
        "screen as `error_session_revoked`; never retried.",
        ["refreshSession"], extra_tags=auth,
    )
    _error(
        reg, "error_account_suspended", 403, "ACCOUNT_SUSPENDED",
        "Your account is on hold. Contact support.",
        "The signed-in account is suspended; the app routes to the on-hold screen. "
        "Contract-only: `services/hg` answers a suspended account with "
        "`ACCOUNT_NOT_ACTIVE` at sign-in (`error_account_not_active`) and "
        "`SESSION_REVOKED` at refresh (`error_session_revoked`); handle all three.",
        ["getCurrentPrincipal", "refreshSession"], extra_tags=auth,
    )
    _error(
        reg, "error_idempotency_in_progress", 409, "IDEMPOTENCY_IN_PROGRESS",
        "A request with this Idempotency-Key is still in progress.",
        "A retry of `createOrder` with the same key while the first is still running. "
        "The app waits and re-reads the active order; it never sends a new key.",
        ["createOrder"], extra_tags=("customer",),
    )
    _error(
        reg, "error_cancellation_window_closed", 409, "CANCELLATION_WINDOW_CLOSED",
        "This order can no longer be cancelled from the app. Please contact support.",
        "Cancel after the restaurant accepted. The app swaps Cancel for Get help.",
        ["cancelOrder"], extra_tags=("customer",),
    )
    _error(
        reg, "error_address_in_use", 409, "ADDRESS_IN_USE",
        "This address is on an order in progress and cannot be deleted yet.",
        "Deleting the address of an active order. Contract-only: `services/hg` does not "
        "return this code yet.",
        ["deleteAddress"], extra_tags=("customer",),
    )
    _error(
        reg, "error_profile_incomplete", 422, "PROFILE_INCOMPLETE",
        "Add your name before placing an order.",
        "Placing an order before profile capture. Contract-only: `services/hg` does not "
        "return this code yet; `next_route: PROFILE_CAPTURE` routes there first.",
        ["createOrder"], extra_tags=("customer",),
    )


# --------------------------------------------------------------------------- #
# Restaurant profile per account_state and per halal display state
# --------------------------------------------------------------------------- #

ACCOUNT_STATES = [
    ("PENDING", "DOCUMENTS_REVIEW",
     "Not live yet: onboarding is under review. No orders; the console shows the "
     "onboarding progress instead of the order screens.", None),
    ("LIVE", "ACTIVE", "Trading normally.", None),
    ("DELISTED", "ACTIVE",
     "Hidden from customers by the system, not as a punishment: here the halal certificate "
     "lapsed. Clears by itself when the cause does.", "EXPIRED"),
    ("SUSPENDED", "ACTIVE",
     "Suspended by staff: orders in progress complete, no new orders, payouts paused, the "
     "menu is locked (`error_menu_locked`); opening hours stay editable.", None),
    ("BANNED", "ACTIVE",
     "Banned. Its own staff cannot sign in, so only admins acting on its behalf see this "
     "profile.", None),
    ("DEACTIVATED", "ACTIVE", "Deactivated at the owner's request. Read only.", None),
    ("CLOSED", "ACTIVE", "Closed for good. Read only.", None),
]

HALAL_STATES = [
    ("CERTIFIED", 210, "Halal certified, valid for months."),
    ("EXPIRING_SOON", 12,
     "Certificate expires in 12 days: the console shows the renewal banner. Customers "
     "still see the dated badge."),
    ("EXPIRED", -3,
     "Certificate expired 3 days ago: the restaurant is hidden from customers "
     "(`account_state: DELISTED`). Cool slate, never red."),
    ("UNVERIFIED", None,
     "No verified certificate: the restaurant is not shown to customers. Cool slate, "
     "never red."),
]


def _halal(display_state: str, days) -> dict:
    from content import day

    return {
        "display_state": display_state,
        "certifying_body_name": None if days is None else "Halal Monitoring Authority",
        "expires_on": None if days is None else day(days),
    }


def _restaurant_profiles(reg, synth) -> None:
    base = synth.make("RestaurantProfile", "restaurant-profile")
    base.update(
        {
            # The restaurant the offer scripts and restaurant_detail_* use.
            "id": RESTAURANT_ID,
            "legal_name": "Karachi Kitchen Inc.",
            "display_name": "Karachi Kitchen",
            "description": "Karachi-style biryani, nihari and charcoal grill on the Danforth.",
            "owner_first_name": "Hamza",
            "owner_last_name": "Khan",
            "address": {
                "line1": "1245 Danforth Avenue",
                "line2": None,
                "city": "Toronto",
                "province": "ON",
                "postal_code": "M4J 1M8",
                "latitude": 43.6817,
                "longitude": -79.3403,
            },
            "avg_prep_minutes": 20,
            "delivery_radius_m": 7000,
        }
    )

    for state, onboarding, note, halal_state in ACCOUNT_STATES:
        profile = copy.deepcopy(base)
        profile["account_state"] = state
        profile["onboarding_state"] = onboarding
        if halal_state == "EXPIRED":
            profile["halal"] = _halal("EXPIRED", -3)
        elif state == "PENDING":
            profile["halal"] = _halal("UNVERIFIED", None)
        else:
            profile["halal"] = _halal("CERTIFIED", 210)
        reg.add(
            f"restaurant_profile_account_{state.lower()}",
            "onboarding",
            "RestaurantProfile",
            f"`getRestaurantProfile` with `account_state: {state}`. {note}",
            profile,
            operations=["getRestaurantProfile"],
            tags=["restaurant", "account-state-matrix"],
        )

    for display_state, days, note in HALAL_STATES:
        profile = copy.deepcopy(base)
        profile["halal"] = _halal(display_state, days)
        if display_state == "EXPIRED":
            profile["account_state"] = "DELISTED"
        reg.add(
            f"restaurant_profile_halal_{display_state.lower()}",
            "onboarding",
            "RestaurantProfile",
            f"`getRestaurantProfile` with `halal.display_state: {display_state}`. {note}",
            profile,
            operations=["getRestaurantProfile"],
            tags=["restaurant", "halal-state-matrix"],
        )

    missing = copy.deepcopy(base)
    missing.pop("halal", None)
    reg.add(
        "restaurant_profile_halal_missing",
        "onboarding",
        "RestaurantProfile",
        "`getRestaurantProfile` with **no `halal` object** (`services/hg` omits it when "
        "there is no certificate). Render **no badge**, never an optimistic one.",
        missing,
        operations=["getRestaurantProfile"],
        tags=["restaurant", "halal-state-matrix", "edge"],
    )
