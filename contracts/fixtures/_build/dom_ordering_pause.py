"""
The platform-wide pause on new orders, for use during an incident
(https://github.com/shaiknoorullah/hg-mono/issues/244).

Every state the apps must draw: ordering open (never changed, and resumed after a
pause), ordering paused, the public config and the cart while paused, and the
`409 ORDERING_PAUSED` that `createQuote` and `createOrder` answer while paused.

Runs after `dom_orders`, whose healthy cart it copies for the paused cart.
"""

from __future__ import annotations

import copy

from content import MINUTE, ts
from synth import ulid_for, uuid_for

ON_CALL_ADMIN = uuid_for("account:admin:on-call")

PAUSE_REASON = "Stripe is refusing card authorisations; pausing new orders until their incident clears."
RESUME_REASON = "Stripe's incident is resolved and a test checkout went through end to end."


def build(reg, synth) -> None:
    _staff_view(reg)
    _customer_view(reg, synth)
    _refusal(reg)


def _staff_view(reg) -> None:
    reg.add(
        "ordering_pause_never_changed",
        "admin",
        "OrderingPause",
        "Ordering is open and nobody has ever paused it: every field but `paused` is null.",
        {
            "paused": False,
            "paused_since": None,
            "reason": None,
            "changed_at": None,
            "changed_by": None,
        },
        operations=["getOrderingPause"],
        tags=["admin", "empty"],
    )
    reg.add(
        "ordering_pause_open",
        "admin",
        "OrderingPause",
        "Ordering is open again: the on-call admin resumed it 20 minutes ago, with a reason. "
        "`paused_since` is null once ordering resumes; the audit log keeps the pause.",
        {
            "paused": False,
            "paused_since": None,
            "reason": RESUME_REASON,
            "changed_at": ts(-20 * MINUTE),
            "changed_by": ON_CALL_ADMIN,
        },
        operations=["getOrderingPause", "setOrderingPause"],
        tags=["admin", "state-matrix"],
    )
    reg.add(
        "ordering_pause_on",
        "admin",
        "OrderingPause",
        "New orders are paused platform-wide during an incident. Orders already placed carry "
        "on; `createQuote` and `createOrder` answer `error_ordering_paused`.",
        {
            "paused": True,
            "paused_since": ts(-12 * MINUTE),
            "reason": PAUSE_REASON,
            "changed_at": ts(-12 * MINUTE),
            "changed_by": ON_CALL_ADMIN,
        },
        operations=["getOrderingPause", "setOrderingPause"],
        tags=["admin", "state-matrix", "degraded"],
    )


def _customer_view(reg, synth) -> None:
    config = synth.make("PublicConfig", "public-config")
    config["ordering"] = {"paused": True, "paused_since": ts(-12 * MINUTE)}
    reg.add(
        "public_config_ordering_paused",
        "platform",
        "PublicConfig",
        "Staff have paused new orders platform-wide. The customer app says ordering is paused "
        "instead of letting checkout fail; `ordering` carries no reason, which is for staff.",
        config,
        operations=["getPublicConfig"],
        tags=["platform", "degraded"],
    )

    cart = copy.deepcopy(reg.fixtures["cart_many_lines"].payload)
    cart["is_quotable"] = False
    cart["blocking_reasons"] = ["ORDERING_PAUSED"]
    reg.add(
        "cart_ordering_paused",
        "cart",
        "Cart",
        "A cart that would be quotable, while staff have paused new orders platform-wide: "
        "`is_quotable` is false and `blocking_reasons` names `ORDERING_PAUSED`.",
        cart,
        operations=["getCart"],
        tags=["edge", "degraded"],
    )


def _refusal(reg) -> None:
    reg.add(
        "error_ordering_paused",
        "errors",
        "ErrorEnvelope",
        "`409` · `ORDERING_PAUSED`. Staff have paused new orders platform-wide during an "
        "incident. Nothing was stored and nothing was charged; the same Idempotency-Key can "
        "be sent again once ordering resumes. A 409 like `RESTAURANT_CLOSED`, not a 503: "
        "the server is fine.",
        {
            "error": {
                "code": "ORDERING_PAUSED",
                "message": "Ordering is paused on HalalGoes right now. Nothing was charged; please try again later.",
                "request_id": ulid_for("request:ordering_paused"),
            }
        },
        operations=["createQuote", "createOrder"],
        status=409,
        tags=["error-envelope"],
    )
