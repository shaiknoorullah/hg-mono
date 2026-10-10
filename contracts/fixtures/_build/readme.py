"""
Generates `contracts/fixtures/README.md` from the manifest.

The scenario menu is written by the builder rather than by hand, because a hand-written
menu is a second source of truth and will be wrong within a week.
"""

from __future__ import annotations

import os

FIXTURE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

DOMAIN_BLURB = {
    "admin": "Review queues, applications, staff, the menu-review workflow and payout runs.",
    "cart": "Cart and quote — every blocking reason, the quantity cap, and the money edges.",
    "catalogue": "Discovery, restaurant detail, hours and menus.",
    "dispatch": "Dispatch states, rider offers and assignments.",
    "documents": "KYC uploads, review states and every rejection reason.",
    "errors": "`{error}` envelopes for the codes an app actually branches on.",
    "halal": "Badges, certificates, checks and issuing bodies — the platform's core promise.",
    "handoff": "The package-seal chain of custody (later version: seals are not used at launch) — every `PackageSeal` status, `HandoffEvent` type, and the bind/pickup-scan/delivery-scan/tamper-report results.",
    "onboarding": "Restaurant and rider onboarding, profiles, vehicles and trading state.",
    "orders": "The 14 `OrderState` values, per-audience projections, tracking and receipts.",
    "payments": "The 8 `PaymentState` values, saved cards and setup intents.",
    "platform": "Auth, config, addresses, notifications, Connect and health.",
    "realtime": "Scripted WebSocket sequences that drive a screen through a whole lifecycle.",
    "refunds": "The 10 `RefundState` values, liability splits, approval requests, the staff review queue and chargebacks.",
    "rider": "Availability, dashboard, earnings and payouts.",
}

HEADER = """# `contracts/fixtures/` — the scenario menu

**Every file in this directory is generated.** Do not hand-edit one; edit
`contracts/fixtures/_build/` and run `pnpm fixtures:build`. CI runs the builder and then
`git diff --exit-code`, so a hand edit fails the build.

```bash
pnpm fixtures:build        # regenerate from contracts/openapi.yaml
pnpm validate:fixtures     # assert every fixture against its schema
pnpm mock                  # serve them all at http://localhost:4010
```

---

## What a fixture is

One JSON file per scenario, under `<domain>/<scenario>.json`:

```jsonc
{
  "scenario":   "order_arrived",            // globally unique; this is the name you pass
  "domain":     "orders",
  "schema":     "OrderCustomerView",        // the component schema it validates against
  "describes":  "Rider is at the drop-off, proof of delivery not yet recorded.",
  "operations": ["getOrder", "getActiveOrder", "cancelOrder"],
  "status":     200,
  "tags":       ["order-state-matrix"],
  "meta":       { "next_cursor": null, "has_more": false, "total": 1 },  // collections only
  "payload":    { }                         // the `data` member of the envelope
}
```

`payload` is the **`data` value**, not the envelope. The mock server wraps it as
`{"data": payload}` (plus `{"meta": …}` for collections); an `ErrorEnvelope` fixture is
served as-is with its own status. `contracts/fixtures/index.json` is the machine-readable
manifest: counts, the `operationId → scenarios` index, and the default scenario per
operation.

## How to use one

| Where | How |
|---|---|
| Mock server, one request | `GET /v1/orders/any?scenario=order_arrived` |
| Mock server, whole session | header `X-Mock-Scenario: order_arrived`, or cookie `mock_scenario=` |
| Generated client | `createHgClient({ baseUrl, mockScenario: 'order_arrived' })` |
| MSW / unit test | `import fixture from 'contracts/fixtures/orders/order_arrived.json'` |
| Realtime | `ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path` |

A scenario name that does not exist comes back with `X-Mock-Warning` rather than silently
falling through, so a typo is visible immediately.

## Conventions every fixture obeys

* **Money is integer cents.** Never a float, never a string. Order totals are *derived* from
  their lines — `subtotal + fees − discounts + HST(13%) + tip` genuinely equals `total_cents`,
  so an app can assert on the arithmetic.
* **Ontario.** Real Toronto / Mississauga / Scarborough / Brampton / Ottawa / Kitchener /
  Hamilton streets, postal codes that satisfy the contract's FSA/LDU pattern, `+1` numbers in
  the 555 reserved range, `America/Toronto`, CAD.
* **A frozen clock.** Every timestamp is relative to **2026-08-10T18:42:11.412Z**, so the
  build is reproducible. Countdowns are therefore in the past unless you run the mock, which
  re-stamps realtime frames to wall clock.
* **Stable ids.** `uuid_for("restaurant:karachi-kitchen")` is the same value in every
  fixture, so `order_preparing.restaurant.id` really is `restaurant_detail_certified.id`.
* **Enum values are never invented.** Every one comes from the contract.

---
"""

FOOTER = """
---

## Coverage this set guarantees

| Requirement | Where |
|---|---|
| All 14 `OrderState` values, complete order objects | `orders/order_*` |
| All 10 `DispatchState` values | `dispatch/dispatch_*` |
| All 12 `AssignmentState` values | `dispatch/assignment_*` |
| All 4 `HalalDisplayState` values | `halal/halal_badge_*`, `catalogue/restaurant_detail_*` |
| Certificate valid / expiring within 30 days / expired | `halal/halal_certificate_valid`, `…_expiring_within_30_days`, `…_expiring_tomorrow`, `…_expired` |
| All 6 `HalalCertificateStatus` values | `halal/halal_certificate_status_*` |
| All 11 restaurant onboarding states | `onboarding/restaurant_onboarding_*` |
| All 10 rider onboarding states | `onboarding/rider_onboarding_*` |
| All 6 `KycDocumentState` values | `documents/document_*` |
| Rejected-with-reason, six distinct reason codes | `documents/document_rejected_*` |
| All 8 `PaymentState` values incl. `REQUIRES_ACTION` and `FAILED` | `payments/payment_*` |
| All 10 `RefundState` values | `refunds/refund_*` |
| All 7 `PayoutState` values | `rider/payout_*` |
| All 4 `PayoutRunState` values, and a run with every `PayoutRunOutcome` | `admin/payout_run_*` |
| All 7 `RestaurantOpenState` values | `onboarding/restaurant_open_state_*` |
| Empty lists | every `*_empty` scenario (tag `empty`) |
| Exactly-one-item lists | `restaurant_list_single`, `menu_single_item`, `cart_single_line`, `order_list_active` |
| Names that overflow | `restaurant_list_long_names`, `menu_item_long_name_no_image` |
| Missing images | `restaurant_list_missing_images`, `menu_item_long_name_no_image` |
| A restaurant with no menu | `catalogue/menu_empty` + `catalogue/restaurant_detail_no_menu` |
| An item with many variants and add-ons | `catalogue/menu_item_many_variants_and_addons` (16 variants, 16 add-ons) |
| A cart at the quantity cap | `cart/cart_at_quantity_cap` (20 — contradiction log #21) |
| A large tip and a zero tip | `orders/order_large_tip`, `orders/order_zero_tip`, `cart/quote_large_tip`, `cart/quote_zero_tip` |
| A rider with zero earnings | `rider/rider_dashboard_zero_earnings`, `rider/earnings_summary_zero` |

## Realtime scripts

The `realtime/` fixtures are **event sequences**, not response bodies. Each event carries a
`_delay_ms` the mock server uses to pace playback; everything else is the `websocket.md` §2
envelope exactly.

```bash
# drive a tracking screen through the whole lifecycle
ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path

# same, at 5× speed
MOCK_WS_SPEED=0.2 pnpm mock
```

Playback starts on the first `subscribe`, or immediately with `&autoplay=1`.

## Adding a scenario

1. Edit the relevant `contracts/fixtures/_build/dom_*.py`.
2. `pnpm fixtures:build && pnpm validate:fixtures`.
3. If it should be an operation's default, add it to `DEFAULT_SCENARIO` in
   `_build/registry.py`.
4. Commit the builder change **and** the generated JSON together.
"""


def write_readme(manifest: dict) -> None:
    lines: list[str] = [HEADER]

    lines.append("## Scenarios by domain\n")
    lines.append(f"**{manifest['count']} scenarios** across "
                 f"{len(manifest['counts_by_domain'])} domains.\n")
    lines.append("| Domain | Scenarios | What it covers |")
    lines.append("|---|---:|---|")
    for domain, count in manifest["counts_by_domain"].items():
        lines.append(f"| [`{domain}`](#{domain}) | {count} | {DOMAIN_BLURB.get(domain, '')} |")
    lines.append("")

    by_domain: dict[str, list[dict]] = {}
    for entry in manifest["fixtures"]:
        by_domain.setdefault(entry["domain"], []).append(entry)

    for domain in manifest["counts_by_domain"]:
        entries = by_domain[domain]
        lines.append(f"### {domain}\n")
        lines.append(f"{DOMAIN_BLURB.get(domain, '')} — {len(entries)} scenarios.\n")
        lines.append("| Scenario | Schema | Status | Represents |")
        lines.append("|---|---|---:|---|")
        for entry in entries:
            describes = entry["describes"].replace("|", "\\|").replace("\n", " ")
            schema = entry["schema"].replace("<", "&lt;").replace(">", "&gt;")
            lines.append(
                f"| `{entry['scenario']}` | `{schema}` | {entry['status']} | {describes} |"
            )
        lines.append("")

    lines.append("## Tags\n")
    tag_counts: dict[str, int] = {}
    for entry in manifest["fixtures"]:
        for tag in entry.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    lines.append("Filter with `GET /__mock/scenarios?tag=edge`.\n")
    lines.append("| Tag | Count | Meaning |")
    lines.append("|---|---:|---|")
    meanings = {
        "edge": "A shape that breaks naive layouts — empty, overflowing, at a boundary.",
        "empty": "Zero items. The empty state, never an error.",
        "boundary": "At an exact limit (quantity cap, expiry tomorrow, zero, the maximum).",
        "overflow": "Text long enough to break one-line layouts.",
        "missing-media": "No image where one is normally present.",
        "money": "Exercises the money path specifically.",
        "error-path": "The unhappy branch a client must handle.",
        "error-envelope": "A `{error}` body with a real `ErrorCode`.",
        "state-matrix": "One fixture per member of a closed enum.",
        "order-state-matrix": "One per `OrderState` (all 14).",
        "dispatch-state-matrix": "One per `DispatchState` (all 10).",
        "assignment-state-matrix": "One per `AssignmentState` (all 12).",
        "payment-state-matrix": "One per `PaymentState` (all 8).",
        "refund-state-matrix": "One per `RefundState` (all 10).",
        "payout-state-matrix": "One per `PayoutState` (all 7).",
        "payout-run-state-matrix": "One per `PayoutRunState` (all 4).",
        "offer-state-matrix": "One per `OfferState` (all 5).",
        "onboarding-state-matrix": "One per onboarding state, restaurant and rider.",
        "document-state-matrix": "One per `KycDocumentState`, plus rejection reasons.",
        "certificate-status-matrix": "One per `HalalCertificateStatus` (all 6).",
        "halal": "Touches the halal claim surface.",
        "certificate": "A `HalalCertificate` at a specific point in its life.",
        "restaurant": "Restaurant-facing surface.",
        "rider": "Rider-facing surface.",
        "admin": "Admin/support-facing surface.",
        "documents": "KYC document surface.",
        "tracking": "The live order-tracking screen.",
        "delivery-code": "The customer's 4-digit delivery code: shown, hidden, locked, overridden by support.",
        "dense": "Deliberately busy — the worst case for a list or a card.",
        "degraded": "A partially-broken real-world condition (stale GPS, lost tracking).",
        "review-queue": "An admin review queue item.",
        "request-body": "A request body a client sends, not a response. Registered against "
        "no operation, so the mock never serves it.",
        "script": "A realtime event sequence, not a response body.",
        "control": "Realtime control frames.",
        "realtime": "WebSocket, not HTTP.",
        "platform": "Cross-cutting platform surface.",
        "auth": "Session and identity.",
        "blocking-decision": "Encodes an OPEN decision from `docs/decisions/README.md`.",
    }
    for tag, count in sorted(tag_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| `{tag}` | {count} | {meanings.get(tag, '')} |")
    lines.append("")

    lines.append("## Operation coverage\n")
    covered = len(manifest["by_operation"])
    lines.append(
        f"{covered} of the contract's operations have at least one fixture registered "
        "against them; the rest are `204 No Content` or write-only operations the mock "
        "answers from the response schema. The full map lives in `index.json` under "
        "`by_operation`, and `GET /__mock/operations` serves it live.\n"
    )
    lines.append("| Operation | Default scenario | Also available |")
    lines.append("|---|---|---|")
    for op in sorted(manifest["by_operation"]):
        scenarios = manifest["by_operation"][op]
        default = manifest["defaults"].get(op, scenarios[0])
        others = [s for s in scenarios if s != default]
        rest = ", ".join(f"`{s}`" for s in others) if others else "—"
        lines.append(f"| `{op}` | `{default}` | {rest} |")

    lines.append(FOOTER)

    with open(os.path.join(FIXTURE_ROOT, "README.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines).rstrip() + "\n")
