"""
Generates `contracts/fixtures/SCENARIOS.md`: the one scenario vocabulary.

A redesign track tests a screen twice: against fixtures through the mock server (layer A)
and against the real API in the dev world (layer B). This file gives both the same words:
the naming rules every fixture follows, how the mock picks one fixture per operation, and
which fixtures show the state each `make dev-scenario s=...` leaves behind.

The tables are data here, and the build fails if they drift:

* every fixture name in them must exist, and be registered for the operation it is listed
  under unless it is a generic fixture registered for none (realtime scripts are listed
  under `ws`);
* every devworld scenario named must be in `ScenarioNames` in
  `services/hg/internal/devworld/scenario.go`. A scenario without a row is allowed (it
  has no mock fixture mapped yet), so adding a devworld scenario never breaks this build;
* every persona must be a `Slug` in `services/hg/internal/devworld/personas.go`.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE_ROOT = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(FIXTURE_ROOT, "..", ".."))
DEVWORLD = os.path.join(REPO, "services", "hg", "internal", "devworld")

WS = "ws"

# --------------------------------------------------------------------------- #
# Naming families, derived from the names already in the set. Longest prefix wins.
# --------------------------------------------------------------------------- #

FAMILIES = [
    # (prefix, what the suffix names, example)
    ("error_", "`error_<code>` for a code's plain meaning; `error_<context>_<situation>` when one code means several things (`error_menu_locked_banned`, `error_staff_email_in_use`). Status and code live in the fixture, never only in the name.", "error_quote_stale"),
    ("realtime_", "`realtime_<area>_<story>`: a whole WebSocket script, played over one connection. Areas: `order`, `payment`, `rider`, `restaurant`, `admin_ops`, plus the transport stories `gap_and_resume` and `control_frames`.", "realtime_restaurant_offer_burst"),
    ("realtime_ticket", "Not a script: the single-use ticket `createRealtimeTicket` returns.", "realtime_ticket"),
    ("order_admin_view_", "An `OrderState` (lower case) as the staff projection shows it.", "order_admin_view_disputed"),
    ("order_list_", "A list variant: `active`, `past`, `empty`.", "order_list_active"),
    ("order_rating_", "A rating state.", "order_rating_unrated"),
    ("order_", "An `OrderState`, lower case, in the customer projection (`order_ready_for_pickup`), or a money or shape edge (`order_zero_tip`).", "order_arrived"),
    ("restaurant_order_", "An `OrderState` in the restaurant projection, or the queue (`_queue_busy`, `_queue_empty`).", "restaurant_order_preparing"),
    ("tracking_", "An `OrderState` (or a degraded signal) in the tracking projection.", "tracking_picked_up"),
    ("assignment_", "An `AssignmentState`, lower case, or a drop-off instruction edge.", "assignment_arrived_at_pickup"),
    ("dispatch_", "A `DispatchState`, lower case.", "dispatch_searching"),
    ("offer_", "A rider offer outcome.", "offer_pending"),
    ("payment_", "A `PaymentState`, lower case, or saved methods.", "payment_requires_action"),
    ("refund_", "A `RefundState` in the customer view.", "refund_settled"),
    ("admin_refund_", "A `RefundState` or queue in the staff view.", "admin_refund_queue"),
    ("chargeback_", "A chargeback state or list.", "chargeback_needs_response"),
    ("halal_badge_", "A `HalalDisplayState`, lower case.", "halal_badge_expiring_soon"),
    ("certification_panel_", "A `HalalDisplayState` in the customer certification panel.", "certification_panel_certified"),
    ("halal_certificate_", "A certificate status or expiry edge (staff view).", "halal_certificate_status_pending"),
    ("halal_issuing_bod", "An issuing-body status or list.", "halal_issuing_body_suspended"),
    ("restaurant_detail_", "A `HalalDisplayState` or availability edge on the customer restaurant page.", "restaurant_detail_expiring_soon"),
    ("restaurant_availability_", "The customer availability answer.", "restaurant_availability_paused"),
    ("restaurant_open_state_", "A `RestaurantOpenState`, lower case.", "restaurant_open_state_closed_suspended"),
    ("restaurant_profile_account_", "A `RestaurantAccountState`, lower case.", "restaurant_profile_account_suspended"),
    ("restaurant_profile_halal_", "A `HalalDisplayState`, lower case, or `missing` (no `halal` object).", "restaurant_profile_halal_missing"),
    ("restaurant_onboarding_", "A `RestaurantOnboardingState`, lower case.", "restaurant_onboarding_documents_review"),
    ("rider_onboarding_", "A `RiderOnboardingState`, lower case.", "rider_onboarding_vehicle_pending"),
    ("restaurant_application_", "An application in the staff review queue.", "restaurant_application_pending_review"),
    ("rider_application_", "An application in the staff review queue.", "rider_application_pending_review"),
    ("document_", "A `KycDocumentState` or rejection reason.", "document_rejected_illegible"),
    ("session_next_route_", "A `NextRoute`, lower case.", "session_next_route_suspended"),
    ("session_grant_", "Who was signed in.", "session_grant_staff"),
    ("principal_", "The signed-in principal, by role (`principal_<role>`).", "principal_support_agent"),
    ("menu_", "A menu, item, category or version state.", "menu_version_pending_review"),
    ("rider_availability_", "A `RiderAvailabilityState`, lower case.", "rider_availability_online_idle"),
    ("payout_", "A `PayoutState`, lower case, or a payout run.", "payout_held"),
    ("payout_list_", "A rider payout list (`_every_state`, `_multi_problem`, `_draft_paid`).", "payout_list_every_state"),
    ("rider_dashboard_", "Rider Home: a `RiderAvailabilityState` (lower case), a `TrackingHealth` problem, a blocking reason or a delivery leg.", "rider_dashboard_online_stale"),
    ("connect_status_", "A Stripe Connect requirement state, in Stripe's words (`currently_due`, `past_due`, `pending_verification`).", "connect_status_past_due"),
    ("earnings_summary_", "An `EarningsPeriod`, lower case, or a money edge.", "earnings_summary_day"),
    ("earning_entries_", "A rider ledger page or situation (`_paging`, `_clawback`, `_pending`).", "earning_entries_clawback"),
    ("restaurant_list_", "A customer home list: halal-field gaps, sort order, availability mix, a page.", "restaurant_list_partial_halal"),
    ("restaurant_hours_", "An opening-hours shape.", "restaurant_hours_split_past_midnight"),
    ("restaurant_payout_history", "A restaurant's payout list or one of its pages.", "restaurant_payout_history_every_state"),
    ("owned_menu_", "The restaurant's own menu, as its editor reads it.", "owned_menu_every_review_status"),
    ("order_admin_list_", "A staff order list variant.", "order_admin_list_every_state"),
    ("staff_list", "A platform staff list variant.", "staff_list_edge_rows"),
]


def _family(name: str) -> str | None:
    best = None
    for prefix, _, _ in FAMILIES:
        if name.startswith(prefix) and (best is None or len(prefix) > len(best)):
            best = prefix
    return best


# --------------------------------------------------------------------------- #
# Devworld scenarios -> the fixtures that show the same state
# --------------------------------------------------------------------------- #

# (devworld scenario, what it leaves in the world, [(operation or ws, fixture)], gap note)
DEVWORLD_SCENARIOS = [
    (
        "new-order",
        "amina's order at `bismillah-grill` waiting for the restaurant (`RESTAURANT_PENDING`).",
        [
            ("getActiveOrder", "order_restaurant_pending"),
            ("getRestaurantOrder", "restaurant_order_restaurant_pending"),
            ("listRestaurantOrders", "restaurant_order_restaurant_pending"),
            (WS, "realtime_restaurant_offer_one"),
        ],
        "",
    ),
    (
        "rush",
        "Two orders waiting (amina and nour); a third from amina refused with `ACTIVE_ORDER_EXISTS`.",
        [
            ("listRestaurantOrders", "restaurant_order_queue_busy"),
            ("createOrder", "error_active_order_exists"),
            (WS, "realtime_restaurant_offer_burst"),
        ],
        "The burst script rings four offers; devworld places two.",
    ),
    (
        "order-preparing",
        "The restaurant accepted: `PREPARING`, payment captured.",
        [
            ("getOrder", "order_preparing"),
            ("getOrderTracking", "tracking_preparing"),
            ("getRestaurantOrder", "restaurant_order_preparing"),
        ],
        "",
    ),
    (
        "order-ready",
        "Marked ready: `READY_FOR_PICKUP`.",
        [
            ("getOrder", "order_ready_for_pickup"),
            ("getOrderTracking", "tracking_ready_for_pickup"),
            ("getRestaurantOrder", "restaurant_order_ready_for_pickup"),
        ],
        "",
    ),
    (
        "customer-cancels",
        "amina cancels before acceptance: `CANCELLED`, the authorisation voided.",
        [
            ("cancelOrder", "order_cancelled"),
            ("getOrder", "order_cancelled"),
            (WS, "realtime_restaurant_offer_withdrawn"),
        ],
        "",
    ),
    (
        "restaurant-rejected",
        "`bismillah-grill` declines the waiting order: `REJECTED`, the authorisation voided.",
        [
            ("getOrder", "order_rejected"),
            ("rejectOrder", "restaurant_order_rejected"),
            (WS, "realtime_order_restaurant_rejects"),
        ],
        "",
    ),
    (
        "docs-approve",
        "The admin approves the document waiting in review for `docs-review`.",
        [
            ("reviewRestaurantDocument", "document_approved"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_review"),
        ],
        "The onboarding state moves on only when every document is approved "
        "(`restaurant_onboarding_documents_approved`).",
    ),
    (
        "docs-reject",
        "The admin rejects that document as `ILLEGIBLE`.",
        [
            ("reviewRestaurantDocument", "document_rejected_illegible"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_rejected"),
        ],
        "",
    ),
    (
        "menu-approve",
        "The admin approves the oldest menu version waiting for review (persona `menu`).",
        [
            ("listMenuReviewQueue", "menu_review_queue"),
            ("decideMenuVersion", "menu_version_approved"),
        ],
        "",
    ),
    (
        "menu-reject",
        "The admin rejects it as `MISLEADING_DESCRIPTION`.",
        [
            ("listMenuReviewQueue", "menu_review_queue"),
            ("decideMenuVersion", "menu_version_rejected"),
        ],
        "",
    ),
    (
        "onboard-restaurant",
        "A new restaurant from sign-up to live: every `RestaurantOnboardingState` in turn, ending `ACTIVE`.",
        [
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_registered"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_profile_pending"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_review"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_payout_pending"),
            ("getRestaurantOnboardingStatus", "restaurant_onboarding_active"),
        ],
        "",
    ),
    (
        "onboard-rider",
        "A new rider from first sign-in to online, ending `ACTIVE` and `ONLINE_IDLE`.",
        [
            ("getRiderOnboardingStatus", "rider_onboarding_phone_verified"),
            ("getRiderOnboardingStatus", "rider_onboarding_vehicle_pending"),
            ("getRiderOnboardingStatus", "rider_onboarding_documents_review"),
            ("getRiderOnboardingStatus", "rider_onboarding_payout_pending"),
            ("getRiderOnboardingStatus", "rider_onboarding_active"),
            ("setRiderAvailability", "rider_availability_online_idle"),
        ],
        "",
    ),
]

# `make dev-journey`: not a scenario name, but the same vocabulary applies.
JOURNEY = [
    ("getCurrentOffer", "offer_pending"),
    ("getAssignment", "assignment_en_route_to_pickup"),
    ("getAssignment", "assignment_picked_up"),
    ("getOrderTracking", "tracking_picked_up"),
    ("getOrderTracking", "tracking_arrived"),
    ("getOrderTracking", "tracking_delivered"),
    (WS, "realtime_order_happy_path"),
]

# Devworld persona -> the fixtures that show it.
PERSONAS = [
    ("admin-seed", [("getCurrentPrincipal", "principal_super_admin")]),
    ("support-seed", [("getCurrentPrincipal", "principal_support_agent")]),
    ("amina", [("getCurrentPrincipal", "principal_customer")]),
    ("nour", [("getCurrentPrincipal", "principal_customer")]),
    ("rider-sim", [("getRiderOnboardingStatus", "rider_onboarding_active"),
                   ("setRiderAvailability", "rider_availability_offline")]),
    ("rider-docs", [("getRiderOnboardingStatus", "rider_onboarding_documents_review")]),
    ("rider-rejected", [("getRiderOnboardingStatus", "rider_onboarding_documents_rejected")]),
    ("rider-registered", [("getRiderOnboardingStatus", "rider_onboarding_registered")]),
    ("fresh", [("getRestaurantOnboardingStatus", "restaurant_onboarding_registered"),
               ("getRestaurantProfile", "restaurant_profile_account_pending")]),
    ("profile", [("getRestaurantOnboardingStatus", "restaurant_onboarding_profile_pending")]),
    ("docs-todo", [("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_pending")]),
    ("docs-review", [("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_review"),
                     ("getRestaurantProfile", "restaurant_profile_account_pending")]),
    ("docs-rejected", [("getRestaurantOnboardingStatus", "restaurant_onboarding_documents_rejected")]),
    ("payout", [("getRestaurantOnboardingStatus", "restaurant_onboarding_payout_pending"),
                ("getConnectStatus", "connect_status_requirements_due")]),
    ("menu", [("getRestaurantOnboardingStatus", "restaurant_onboarding_menu_pending"),
              ("listMenuReviewQueue", "menu_review_queue")]),
    ("bismillah-grill", [("getRestaurantProfile", "restaurant_profile_account_live"),
                         ("getRestaurant", "restaurant_detail_certified"),
                         ("getRestaurantAvailability", "restaurant_open_state_open")]),
    ("expiring-halal", [("getRestaurantProfile", "restaurant_profile_halal_expiring_soon"),
                        ("getRestaurant", "restaurant_detail_expiring_soon"),
                        ("getRestaurantCertification", "certification_panel_expiring_soon")]),
    ("expired-halal", [("getRestaurantProfile", "restaurant_profile_halal_expired"),
                       ("getRestaurantProfile", "restaurant_profile_account_delisted"),
                       ("getRestaurant", "restaurant_detail_expired")]),
    ("paused", [("getRestaurantAvailability", "restaurant_open_state_paused")]),
    ("suspended", [("getRestaurantProfile", "restaurant_profile_account_suspended"),
                   ("getRestaurantAvailability", "restaurant_open_state_closed_suspended"),
                   ("updateMenuItem", "error_menu_locked")]),
]


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #


def _go_scenario_names() -> list[str] | None:
    path = os.path.join(DEVWORLD, "scenario.go")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    block = re.search(r"var ScenarioNames = \[\]string\{(.*?)\}", src, re.S)
    if not block:
        raise RuntimeError("vocabulary: ScenarioNames not found in devworld/scenario.go")
    return re.findall(r'"([a-z0-9-]+)"', block.group(1))


def _go_persona_slugs() -> set[str] | None:
    path = os.path.join(DEVWORLD, "personas.go")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return set(re.findall(r'Slug: "([a-z0-9-]+)"', fh.read()))


def _check_pairs(reg, where: str, pairs) -> None:
    for op, name in pairs:
        fx = reg.fixtures.get(name)
        if fx is None:
            raise RuntimeError(f"vocabulary: {where} names `{name}`, which is not a fixture")
        if op == WS:
            if fx.schema != "RealtimeEvent[]":
                raise RuntimeError(f"vocabulary: {where} lists `{name}` under ws, but it is not a realtime script")
        elif fx.operations and op not in fx.operations:
            # A fixture with no operations is a generic one (most `error_*`): it may be
            # named for any operation.
            raise RuntimeError(f"vocabulary: {where} lists `{name}` under `{op}`, but it is not registered for it")


def _check(reg) -> None:
    go_names = _go_scenario_names()
    ours = [name for name, *_ in DEVWORLD_SCENARIOS]
    if go_names is not None:
        stale = [name for name in ours if name not in go_names]
        if stale:
            raise RuntimeError(
                f"vocabulary: DEVWORLD_SCENARIOS names {stale}, which are not devworld "
                f"ScenarioNames: {go_names}"
            )
    slugs = _go_persona_slugs()
    for slug, pairs in PERSONAS:
        if slugs is not None and slug not in slugs:
            raise RuntimeError(f"vocabulary: persona `{slug}` is not in devworld/personas.go")
        _check_pairs(reg, f"persona {slug}", pairs)
    for name, _, pairs, _ in DEVWORLD_SCENARIOS:
        _check_pairs(reg, f"dev-scenario {name}", pairs)
    _check_pairs(reg, "dev-journey", JOURNEY)


# --------------------------------------------------------------------------- #
# Writing
# --------------------------------------------------------------------------- #

INTRO = """# The scenario vocabulary

**Generated** by `contracts/fixtures/_build/vocabulary.py` (`pnpm fixtures:build`). Edit the
builder, not this file.

One set of words for both test layers of the redesign (master plan section 5.1):

| Layer | Runs against | You name a state with |
|---|---|---|
| **A. Mock** (screen tests, Playwright on `pnpm mock`) | `contracts/fixtures/**` through `tools/mock-server` | a **fixture scenario**, per operation |
| **B. Real API** (Playwright, Maestro on the compose stack) | `services/hg` with the dev world | `make dev-reset`, a **persona**, `make dev-scenario s=<name>`, `make dev-journey` |

A test that checks "the order is ready for pickup" uses `order_ready_for_pickup` in layer A and
`make dev-scenario s=order-ready` in layer B. The tables below say which is which. The full
fixture catalogue is [`README.md`](README.md); the machine-readable one is `index.json`.

## 1. Naming rules

These are the rules the existing names already follow; new fixtures follow them too.

1. **`snake_case`, globally unique.** The name is the scenario you pass; the folder is only
   filing.
2. **`<subject>_<state>`.** The subject is the thing the screen reads, in the projection it
   reads it (`order_` customer, `restaurant_order_` restaurant, `order_admin_view_` staff,
   `tracking_`, `assignment_`). The state is the **contract enum value, lower-cased**
   (`READY_FOR_PICKUP` becomes `order_ready_for_pickup`; `SUSPENDED` becomes
   `restaurant_profile_account_suspended`). Never a synonym for an enum value.
3. **Two dimensions get a word each:** `restaurant_profile_account_<state>` and
   `restaurant_profile_halal_<display_state>`. A missing object is `_missing`
   (`restaurant_profile_halal_missing`: no badge, never an optimistic one).
4. **Collections:** `<subject>_list_<variant>` or `<subject>_queue[_<variant>]`; zero rows is
   `_empty`; a second page is `_page_2`.
5. **Errors:** `error_<code>` lower-cased is the code's plain meaning (`error_quote_stale`).
   When one code means different things in different places, the context goes first
   (`error_menu_locked_banned`, `error_refund_mfa_required`, `error_rider_email_in_use`). The
   HTTP status and `error.code` are in the fixture; clients branch on the code, never on the
   name or the message.
6. **Realtime:** `realtime_<area>_<story>`. A realtime fixture is a whole **script** played
   over one WebSocket connection, not one frame. Areas are `order`, `payment`, `rider`,
   `restaurant` and `admin_ops`.
7. **Request bodies** (fixtures of what a client sends) end in `_input_<variant>`
   (`restaurant_decision_input_reject`).
8. **Contract-only states.** When the contract defines a value `services/hg` does not produce
   yet, the fixture exists (apps handle every contract value) and its `describes` starts the
   sentence with "Contract-only:". Layer B cannot reach it.

### Families in the set today

"""

SELECTION = """
## 2. How one scenario is chosen per operation (the mock server)

Every request is matched to one contract operation (`operationId`), then to one fixture:

1. **You name one.** In precedence order: the `?scenario=` query parameter, the
   `X-Mock-Scenario` header (the generated client's `mockScenario` option sends it), the
   `mock_scenario` cookie.
2. **The value is either one name or a per-operation map.**
   * One name, `order_arrived`: served for **every** request that carries it, even an
     operation it is not registered for (with an `X-Mock-Warning`). Fine for one request;
     wrong for a whole screen that calls several operations.
   * A map, `getCurrentPrincipal=principal_admin,listRestaurantOrders=restaurant_order_queue_busy`:
     each operation gets its own fixture; an operation the map does not name gets the
     bare name in the list that is registered for it, or else its **default**. This is how a
     screen test sets one scenario per operation with a single header or cookie.
3. **Nothing named:** the operation's **default** from `index.json` (`defaults`), the plainest
   healthy shape. An error is never a default.
4. A name that does not exist answers with `X-Mock-Warning: unknown scenario ...`; the
   `X-Mock-Scenario` response header always says which fixture was served.
5. An `ErrorEnvelope` fixture is served as-is with its own status (`error_session_revoked` is a
   401).

**Realtime.** One script per connection:
`ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_restaurant_offer_burst` (add
`&autoplay=1` to start without a `subscribe`). The mock re-stamps every timestamp in each
frame, `ts` and the ones inside `data` such as `expires_at`, to wall clock when it plays, so a
countdown in the client is live. `MOCK_WS_SPEED=0.2` plays five times faster.
"""


def _pairs_cell(pairs) -> str:
    out = []
    for op, name in pairs:
        where = "WebSocket" if op == WS else f"`{op}`"
        out.append(f"{where} → `{name}`")
    return "<br>".join(out)


def write_vocabulary(reg) -> None:
    _check(reg)

    lines = [INTRO.rstrip("\n"), ""]
    counts: dict[str, list[str]] = {}
    unclassified: list[str] = []
    for name in sorted(reg.fixtures):
        fam = _family(name)
        if fam is None:
            unclassified.append(name)
        else:
            counts.setdefault(fam, []).append(name)
    lines.append("| Prefix | Fixtures | The suffix names | Example |")
    lines.append("|---|---:|---|---|")
    for prefix, rule, example in FAMILIES:
        names = counts.get(prefix, [])
        if example not in reg.fixtures:
            raise RuntimeError(f"vocabulary: family example `{example}` is not a fixture")
        lines.append(f"| `{prefix}` | {len(names)} | {rule} | `{example}` |")
    lines.append(
        f"| (other) | {len(unclassified)} | One-off subjects named for what they are "
        "(`public_config`, `cart_many_lines`, `quote_standard`). | `public_config` |"
    )
    lines.append("")
    lines.append(SELECTION.strip("\n"))
    lines.append("")

    lines.append("## 3. Devworld scenarios and the fixtures that show the same state")
    lines.append("")
    lines.append(
        "`make dev-reset`, then `make dev-scenario s=<name>` (in `services/hg`). The fixtures "
        "are what the same screen shows in layer A. Several rows for one operation are the "
        "states the scenario passes through. A scenario missing here has no mock fixture "
        "mapped yet; `go run ./cmd/devworld scenario list` prints them all."
    )
    lines.append("")
    lines.append("| `s=` | Leaves the world with | Same state in the mock | Note |")
    lines.append("|---|---|---|---|")
    for name, leaves, pairs, note in DEVWORLD_SCENARIOS:
        lines.append(f"| `{name}` | {leaves} | {_pairs_cell(pairs)} | {note} |")
    lines.append(
        f"| `dev-journey` | `make dev-journey route= speed= auto=`: a rider takes the order "
        f"from offer to delivery. | {_pairs_cell(JOURNEY)} | |"
    )
    lines.append("")

    lines.append("## 4. Devworld personas and their fixtures")
    lines.append("")
    lines.append("| Persona | Same state in the mock |")
    lines.append("|---|---|")
    for slug, pairs in PERSONAS:
        lines.append(f"| `{slug}` | {_pairs_cell(pairs)} |")
    lines.append("")

    lines.append("## 5. States only the mock can show today")
    lines.append("")
    lines.append(
        "Fixtures whose `describes` says \"Contract-only:\": `services/hg` cannot produce them, "
        "so they have no layer B journey yet."
    )
    lines.append("")
    contract_only = sorted(n for n, fx in reg.fixtures.items() if "Contract-only:" in fx.describes)
    for name in contract_only:
        lines.append(f"- `{name}`")
    lines.append("")

    with open(os.path.join(FIXTURE_ROOT, "SCENARIOS.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines).rstrip() + "\n")
