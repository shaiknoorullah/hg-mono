"""Package-seal chain of custody (migration 00027_handoff.sql, tag `handoff`).

Later version: seals are not used at launch and move to v1.1
(https://github.com/shaiknoorullah/hg-mono/issues/47). No seal scan gates an order
transition: the rider confirms pickup with the kitchen's pickup code, and delivery is
gated only by proof of delivery (round-2 decisions, "Orders and delivery":
https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#orders-and-delivery).
These fixtures describe the seal operations' shapes for when seals return.

Two schemas describe every state on the wire — `PackageSeal` (the seal's own
lifecycle) and `HandoffEvent` (one append-only row per scan/attestation) — plus
`HandoffScanResult`, the envelope `scanPickup`/`scanDelivery`/`reportTamper`
actually return: the proof and its effect together, so a client never has to
make a second call to learn whether the order advanced.

Every `package_seal_status` and `handoff_event_type` gets its own fixture, per
the same "every state, not the happy one" rule the rest of this builder follows.
"""

from __future__ import annotations

from content import ts
from synth import uuid_for

ORDER_ID = uuid_for("order:handoff-demo")
RESTAURANT_ID = uuid_for("restaurant:karachi-kitchen")
RIDER_ACCOUNT = uuid_for("account:rider:bilal")
CUSTOMER_ACCOUNT = uuid_for("account:customer:amina")
STAFF_ACCOUNT = uuid_for("account:restaurant-staff:karachi-kitchen")
PHOTO_OBJECT_ID = uuid_for("stored_object:handoff-pod-photo")


def _seal_id(label: str) -> str:
    return uuid_for(f"package_seal:{label}")


def _seal(label: str, *, status: str, order_id, bound_at, pickup_at, delivery_at, token) -> dict:
    return {
        "id": _seal_id(label),
        "seal_code": f"HGSEAL-{label.upper()}",
        "order_id": order_id,
        "restaurant_id": RESTAURANT_ID,
        "status": status,
        "qr_token": token,
        "bound_at": bound_at,
        "pickup_verified_at": pickup_at,
        "delivery_verified_at": delivery_at,
        "created_at": ts(-DAY),
        "updated_at": ts(0),
    }


DAY = 86400
HOUR = 3600
MINUTE = 60


# A token this deterministic can never verify against a real signing key — it is
# the wire *shape* a client renders as a QR, not a live credential. Real tokens
# are minted at request time by internal/handoff.MintSealToken (P-04 EdDSA).
def _token(label: str) -> str:
    return f"hgseal.{uuid_for('claims:' + label)[:22]}.{uuid_for('sig:' + label)[:22]}"


SEAL_STATES = {
    "issued": dict(
        status="ISSUED",
        order_id=None,
        bound_at=None,
        pickup_at=None,
        delivery_at=None,
        token=None,
        note="Platform-known stock, not yet bound to an order. The only status where `order_id` and `qr_token` are null.",
    ),
    "bound": dict(
        status="BOUND",
        order_id=ORDER_ID,
        bound_at=ts(-40 * MINUTE),
        pickup_at=None,
        delivery_at=None,
        token=_token("bound"),
        note="Bound at packing; `qr_token` is what the restaurant renders as the QR affixed to the package.",
    ),
    "pickup_verified": dict(
        status="PICKUP_VERIFIED",
        order_id=ORDER_ID,
        bound_at=ts(-40 * MINUTE),
        pickup_at=ts(-25 * MINUTE),
        delivery_at=None,
        token=_token("pickup_verified"),
        note="The rider's pickup scan verified the signature, order binding and single-use nonce.",
    ),
    "delivery_verified": dict(
        status="DELIVERY_VERIFIED",
        order_id=ORDER_ID,
        bound_at=ts(-40 * MINUTE),
        pickup_at=ts(-25 * MINUTE),
        delivery_at=ts(-1 * MINUTE),
        token=_token("delivery_verified"),
        note="Both proofs cleared: identity held at pickup and at the door.",
    ),
    "tamper_reported": dict(
        status="TAMPER_REPORTED",
        order_id=ORDER_ID,
        bound_at=ts(-2 * HOUR),
        pickup_at=ts(-90 * MINUTE),
        delivery_at=ts(-30 * MINUTE),
        token=_token("tamper_reported"),
        note="A scan (`seal_intact:false`) or the customer's own tamper report flagged this seal. The identity checks still passed — this is an integrity signal, not an identity failure — and never auto-fails the order.",
    ),
}


def _event(label: str, *, event_type: str, actor: str, actor_account, method: str,
           seal_id, seal_intact, geo: bool, photo: bool, note) -> dict:
    return {
        "id": uuid_for(f"handoff_event:{label}"),
        "order_id": ORDER_ID,
        "seal_id": seal_id,
        "type": event_type,
        "actor": actor,
        "actor_account_id": actor_account,
        "method": method,
        "seal_intact": seal_intact,
        "latitude": 43.6817 if geo else None,
        "longitude": -79.3403 if geo else None,
        "photo_object_id": PHOTO_OBJECT_ID if photo else None,
        "note": note,
        "at": ts(0),
    }


def build(reg, synth) -> None:
    _seals(reg)
    _events(reg)
    _scan_results(reg)


def _seals(reg) -> None:
    for label, cfg in SEAL_STATES.items():
        payload = _seal(
            label,
            status=cfg["status"],
            order_id=cfg["order_id"],
            bound_at=cfg["bound_at"],
            pickup_at=cfg["pickup_at"],
            delivery_at=cfg["delivery_at"],
            token=cfg["token"],
        )
        ops = ["bindPackageSeal"] if label == "bound" else []
        reg.add(
            f"seal_{label}",
            "handoff",
            "PackageSeal",
            cfg["note"],
            payload,
            operations=ops,
            tags=["seal-state-matrix"],
        )


def _events(reg) -> None:
    specs = {
        "seal": dict(
            event_type="SEAL", actor="RESTAURANT", actor_account=STAFF_ACCOUNT, method="QR",
            seal_id=_seal_id("bound"), seal_intact=None, geo=False, photo=False, note=None,
            describes="The bind: restaurant staff scanned the physical label and the token was minted.",
        ),
        "pickup": dict(
            event_type="PICKUP", actor="RIDER", actor_account=RIDER_ACCOUNT, method="QR",
            seal_id=_seal_id("pickup_verified"), seal_intact=True, geo=True, photo=False, note=None,
            describes="The rider's pickup scan — identity and integrity both held.",
        ),
        "delivery": dict(
            event_type="DELIVERY", actor="RIDER", actor_account=RIDER_ACCOUNT, method="QR",
            seal_id=_seal_id("delivery_verified"), seal_intact=True, geo=True, photo=True, note=None,
            describes="The rider's delivery scan, with an optional POD photo attached.",
        ),
        "delivery_tamper_flagged": dict(
            event_type="DELIVERY", actor="RIDER", actor_account=RIDER_ACCOUNT, method="QR",
            seal_id=_seal_id("tamper_reported"), seal_intact=False, geo=True, photo=True, note=None,
            describes="`seal_intact:false` at the rider's own scan — identity still held (this really is the assigned rider, at the door), so the delivery is still recorded; the integrity flag is evidence, not a block.",
        ),
        "tamper_report": dict(
            event_type="TAMPER_REPORT", actor="CUSTOMER", actor_account=CUSTOMER_ACCOUNT, method="PHOTO",
            seal_id=_seal_id("tamper_reported"), seal_intact=None, geo=False, photo=True,
            note="The seal was broken when the package arrived; nothing inside matched the receipt.",
            describes="Filed by the customer after delivery. No nonce (not a QR proof) — opens the dispute flow (A-33/A-35).",
        ),
    }
    for label, cfg in specs.items():
        describes = cfg.pop("describes")
        payload = _event(label, **cfg)
        reg.add(
            f"handoff_event_{label}",
            "handoff",
            "HandoffEvent",
            describes,
            payload,
            operations=[],
            tags=["handoff-event-matrix"],
        )


def _scan_results(reg) -> None:
    reg.add(
        "handoff_scan_pickup",
        "handoff",
        "HandoffScanResult",
        "scanPickup's 200 (later version): the scan recorded as custody evidence. `order_state` is the order's current state; the rider already confirmed pickup with the pickup code, and the scan changed nothing.",
        {
            "seal": _seal("pickup_verified", status="PICKUP_VERIFIED", order_id=ORDER_ID,
                           bound_at=ts(-40 * MINUTE), pickup_at=ts(0), delivery_at=None,
                           token=_token("pickup_verified")),
            "event": _event("scan_pickup_result", event_type="PICKUP", actor="RIDER",
                             actor_account=RIDER_ACCOUNT, method="QR", seal_id=_seal_id("pickup_verified"),
                             seal_intact=True, geo=True, photo=False, note=None),
            "order_state": "PICKED_UP",
        },
        operations=["scanPickup"],
    )
    reg.add(
        "handoff_scan_delivery",
        "handoff",
        "HandoffScanResult",
        "scanDelivery's 200 (later version): the same physical token scanned for the DELIVERY proof. `order_state` is the order's current state; delivery was gated only by proof of delivery.",
        {
            "seal": _seal("delivery_verified", status="DELIVERY_VERIFIED", order_id=ORDER_ID,
                           bound_at=ts(-40 * MINUTE), pickup_at=ts(-25 * MINUTE), delivery_at=ts(0),
                           token=_token("delivery_verified")),
            "event": _event("scan_delivery_result", event_type="DELIVERY", actor="RIDER",
                             actor_account=RIDER_ACCOUNT, method="QR", seal_id=_seal_id("delivery_verified"),
                             seal_intact=True, geo=True, photo=True, note=None),
            "order_state": "DELIVERED",
        },
        operations=["scanDelivery"],
    )
    reg.add(
        "handoff_tamper_report",
        "handoff",
        "HandoffScanResult",
        "reportTamper's 200 (later version): DELIVERED → DISPUTED. Never a money decision by itself — it hands the scan-and-photo trail to the dispute flow.",
        {
            "seal": _seal("tamper_reported", status="TAMPER_REPORTED", order_id=ORDER_ID,
                           bound_at=ts(-2 * HOUR), pickup_at=ts(-90 * MINUTE), delivery_at=ts(-30 * MINUTE),
                           token=_token("tamper_reported")),
            "event": _event("tamper_report_result", event_type="TAMPER_REPORT", actor="CUSTOMER",
                             actor_account=CUSTOMER_ACCOUNT, method="PHOTO", seal_id=_seal_id("tamper_reported"),
                             seal_intact=None, geo=False, photo=True,
                             note="The seal was broken when the package arrived; nothing inside matched the receipt."),
            "order_state": "DISPUTED",
        },
        operations=["reportTamper"],
        tags=["edge"],
    )
