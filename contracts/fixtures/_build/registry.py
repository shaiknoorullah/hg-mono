"""Fixture registry: collects fixtures, writes them out, builds the manifest."""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from typing import Any

FIXTURE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# What the mock server serves for an operation when no scenario is named. Only listed where
# the automatic "plainest healthy shape" rule would pick something unhelpful.
DEFAULT_SCENARIO: dict[str, str] = {
    "getOrder": "order_preparing",
    "getActiveOrder": "order_preparing",
    "cancelOrder": "order_cancelled",
    "getOrderTracking": "tracking_picked_up",
    "listOrders": "order_list_active",
    "listOrdersAdmin": "order_list_past",
    "getOrderAdmin": "order_admin_view_completed",
    "cancelOrderAdmin": "order_admin_view_completed",
    "getRestaurant": "restaurant_detail_certified",
    "getRestaurantMenu": "menu_full",
    "getRestaurantCertification": "certification_panel_certified",
    "listRestaurants": "restaurant_list_populated",
    "getCart": "cart_many_lines",
    "addCartLine": "cart_many_lines",
    "updateCartLine": "cart_many_lines",
    "removeCartLine": "cart_single_line",
    "createQuote": "quote_standard",
    "getQuote": "quote_standard",
    "getOrderPayment": "payment_succeeded",
    "getRefund": "refund_settled",
    "listRefunds": "refund_list_empty",
    "createRefund": "refund_requested",
    "issueRefund": "refund_goodwill_admin",
    "getCurrentOffer": "offer_pending",
    "acceptOffer": "assignment_assigned",
    "getAssignment": "assignment_en_route_to_dropoff",
    "createAssignmentTransition": "assignment_picked_up",
    "submitProofOfDelivery": "assignment_delivered",
    "setRiderAvailability": "rider_availability_online_idle",
    "getRiderDashboard": "rider_dashboard_active",
    "getRiderEarningsSummary": "earnings_summary_week",
    "listRiderEarningEntries": "earning_entries_mixed",
    "listRiderPayouts": "payout_paid",
    "listRestaurantPayouts": "restaurant_payout_history",
    "getRiderPayout": "payout_detail_paid",
    "getRestaurantOnboardingStatus": "restaurant_onboarding_active",
    "getRiderOnboardingStatus": "rider_onboarding_active",
    "submitRestaurantDocuments": "restaurant_onboarding_documents_review",
    "submitRiderDocuments": "rider_onboarding_documents_review",
    "listRestaurantDocuments": "restaurant_document_pack_complete",
    "listRiderDocuments": "rider_document_pack_complete",
    "attachRestaurantDocument": "document_submitted",
    "attachRiderDocument": "document_submitted",
    "reviewRestaurantDocument": "document_approved",
    "reviewRiderDocument": "document_approved",
    "getHalalCertificate": "halal_certificate_valid",
    "decideHalalCertificate": "halal_certificate_valid",
    "recordHalalChecks": "halal_certificate_valid",
    "transcribeHalalCertificate": "halal_certificate_status_pending",
    "listHalalIssuingBodies": "halal_issuing_body_accepted",
    "getRestaurantAvailability": "restaurant_open_state_open",
    "setRestaurantAcceptingOrders": "restaurant_open_state_open",
    "listRestaurantOrders": "restaurant_order_queue_busy",
    "getRestaurantOrder": "restaurant_order_preparing",
    "acceptOrder": "restaurant_order_preparing",
    "rejectOrder": "restaurant_order_rejected",
    "markOrderReady": "restaurant_order_ready_for_pickup",
    "delayOrder": "restaurant_order_preparing",
    "listPaymentMethods": "payment_methods_list",
    "setDefaultPaymentMethod": "payment_methods_list",
    "getOrderReceipt": "receipt_standard",
    "listAddresses": "addresses_list",
    "listNotifications": "notifications_list",
    "search": "search_results_populated",
    "getHomeFeed": "feed_sections",
    "listRestaurantApplications": "restaurant_application_queue",
    "takeNextRestaurantApplication": "restaurant_application_pending_review",
    "listRiderApplications": "rider_application_queue",
    "takeNextRiderApplication": "rider_application_pending_review",
    "listMenuReviewQueue": "menu_review_queue",
    "decideMenuVersion": "menu_version_approved",
    "createMenuItem": "menu_item_created_pending_review",
    "updateMenuItem": "menu_item_edit_pending_review",
    "updateMenuItemOnBehalf": "menu_item_edited_by_admin",
    "setMenuItemAvailability": "menu_item_marked_out_of_stock_until",
    "changePassword": "session_grant_password_changed",
    "getConnectStatus": "connect_status_complete",
    "confirmUpload": "stored_object_ready",
    # The healthy answer. Without this the three states tie on weight and the name
    # tie-break picks FAILED, so every admin page in `pnpm mock` showed the sticky
    # "sign-in codes cannot be sent" banner.
    "getSmsSenderStatus": "sms_sender_passed",
}


@dataclass
class Fixture:
    scenario: str
    domain: str
    schema: str
    describes: str
    payload: Any
    operations: list[str] = field(default_factory=list)
    meta: Any = None
    status: int = 200
    tags: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        out: dict[str, Any] = {
            "scenario": self.scenario,
            "domain": self.domain,
            "schema": self.schema,
            "describes": self.describes,
            "operations": self.operations,
            "status": self.status,
        }
        if self.tags:
            out["tags"] = self.tags
        if self.meta is not None:
            out["meta"] = self.meta
        out["payload"] = self.payload
        return out


class Registry:
    def __init__(self) -> None:
        self.fixtures: dict[str, Fixture] = {}

    def add(
        self,
        scenario: str,
        domain: str,
        schema: str,
        describes: str,
        payload: Any,
        operations: list[str] | None = None,
        meta: Any = None,
        status: int = 200,
        tags: list[str] | None = None,
    ) -> Fixture:
        if scenario in self.fixtures:
            raise RuntimeError(f"duplicate scenario name: {scenario}")
        fx = Fixture(
            scenario=scenario,
            domain=domain,
            schema=schema,
            describes=describes,
            payload=payload,
            operations=operations or [],
            meta=meta,
            status=status,
            tags=tags or [],
        )
        self.fixtures[scenario] = fx
        return fx

    # ------------------------------------------------------------- writing --

    def write(self) -> dict:
        for name in sorted(os.listdir(FIXTURE_ROOT)):
            path = os.path.join(FIXTURE_ROOT, name)
            if os.path.isdir(path) and not name.startswith("_"):
                shutil.rmtree(path)

        by_domain: dict[str, list[Fixture]] = {}
        for fx in self.fixtures.values():
            by_domain.setdefault(fx.domain, []).append(fx)

        manifest_entries = []
        for domain, items in sorted(by_domain.items()):
            os.makedirs(os.path.join(FIXTURE_ROOT, domain), exist_ok=True)
            for fx in sorted(items, key=lambda f: f.scenario):
                rel = f"{domain}/{fx.scenario}.json"
                with open(os.path.join(FIXTURE_ROOT, rel), "w", encoding="utf-8") as fh:
                    json.dump(fx.to_json(), fh, indent=2, ensure_ascii=False)
                    fh.write("\n")
                manifest_entries.append(
                    {
                        "scenario": fx.scenario,
                        "domain": domain,
                        "schema": fx.schema,
                        "describes": fx.describes,
                        "operations": fx.operations,
                        "status": fx.status,
                        "tags": fx.tags,
                        "file": rel,
                    }
                )

        by_operation: dict[str, list[str]] = {}
        for entry in manifest_entries:
            for op in entry["operations"]:
                by_operation.setdefault(op, []).append(entry["scenario"])

        defaults: dict[str, str] = {}
        for op, scenarios in by_operation.items():
            preferred = DEFAULT_SCENARIO.get(op)
            if preferred and preferred in scenarios:
                defaults[op] = preferred
                continue
            # Otherwise the plainest healthy shape wins: no edge/error/empty tag, 2xx.
            def weight(name: str) -> tuple[int, str]:
                fx = self.fixtures[name]
                tags = set(fx.tags)
                score = 0
                if fx.status >= 300:
                    score += 100
                for tag, cost in (
                    ("error-path", 40), ("edge", 20), ("empty", 15),
                    ("overflow", 10), ("missing-media", 10), ("boundary", 8),
                    ("degraded", 8), ("dense", 4),
                ):
                    if tag in tags:
                        score += cost
                return (score, name)

            best = min(scenarios, key=weight)
            # An error is never a default. An operation whose only fixtures are errors (one
            # that answers 204, such as resetPassword) gets no default, so the mock answers
            # with its success status and the error stays one `?scenario=` away.
            if self.fixtures[best].status < 300:
                defaults[op] = best

        manifest = {
            "generated_by": "contracts/fixtures/_build/build.py",
            "do_not_edit": "Every file under contracts/fixtures/ is generated. Run `pnpm fixtures:build`.",
            "frozen_clock": "2026-08-10T18:42:11.412Z",
            "count": len(manifest_entries),
            "counts_by_domain": {d: len(v) for d, v in sorted(by_domain.items())},
            "fixtures": manifest_entries,
            "by_operation": {k: sorted(v) for k, v in sorted(by_operation.items())},
            "defaults": dict(sorted(defaults.items())),
        }
        with open(os.path.join(FIXTURE_ROOT, "index.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        return manifest
