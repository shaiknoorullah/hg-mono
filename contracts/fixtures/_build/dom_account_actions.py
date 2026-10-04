"""
Account actions: suspend, reinstate, delist, deactivate and ban a restaurant, a rider or
a customer (applyRestaurantAccountAction, applyRiderAccountAction,
applyCustomerAccountAction). One fixture per legal transition, and one error envelope per
way an action is refused. Issue: https://github.com/shaiknoorullah/hg-mono/issues/253.
"""

from __future__ import annotations

from content import DAY, HOUR, ts
from synth import ulid_for, uuid_for

ADMIN = uuid_for("staff:admin:amina")
SUPER_ADMIN = uuid_for("staff:super-admin:yusuf")
RESTAURANT = uuid_for("restaurant:karachi-kitchen")
RIDER = uuid_for("rider:bilal")
CUSTOMER = uuid_for("customer:fatima")

OP = {
    "RESTAURANT": "applyRestaurantAccountAction",
    "RIDER": "applyRiderAccountAction",
    "CUSTOMER": "applyCustomerAccountAction",
}
SUBJECT = {"RESTAURANT": RESTAURANT, "RIDER": RIDER, "CUSTOMER": CUSTOMER}


def _in_flight(cancelled=(), refunded=(), continuing=(), withdrawn=()) -> dict:
    return {
        "cancelled_order_ids": [uuid_for(f"order:{o}") for o in cancelled],
        "refunded_order_ids": [uuid_for(f"order:{o}") for o in refunded],
        "continuing_order_ids": [uuid_for(f"order:{o}") for o in continuing],
        "withdrawn_offer_ids": [uuid_for(f"offer:{o}") for o in withdrawn],
    }


def _change(scenario, subject, action, frm, to, reason, text, *, actor=ADMIN, offset=0,
            delist=None, in_flight=None, sessions=0) -> dict:
    created = ts(offset)
    out = {
        "id": uuid_for(f"account-state-event:{scenario}"),
        "subject_type": subject,
        "subject_id": SUBJECT[subject],
        "action": action,
        "from_state": frm,
        "to_state": to,
        "reason_code": reason,
        "reason_text": text,
        "actor_account_id": actor,
        "ban_proposal": None,
        "delist_reasons": list(delist or []) if subject == "RESTAURANT" else [],
        "menu_locked": (to in ("SUSPENDED", "BANNED")) if subject == "RESTAURANT" else None,
        "sessions_revoked": sessions,
        "in_flight": in_flight or _in_flight(),
        "created_at": created,
    }
    if action == "PROPOSE_BAN":
        out["ban_proposal"] = {
            "proposed_by": actor,
            "proposed_at": created,
            "lapses_at": ts(offset + 7 * DAY),
        }
    return out


# (scenario, subject, action, from, to, reason_code, reason_text, extra, note)
TRANSITIONS = [
    # --- restaurants -----------------------------------------------------------------
    ("restaurant_suspended", "RESTAURANT", "SUSPEND", "LIVE", "SUSPENDED", "COMPLIANCE_THRESHOLD",
     "Three late-acceptance violations in 30 days after two written warnings.",
     dict(in_flight=_in_flight(cancelled=["kk-pending"], continuing=["kk-preparing", "kk-picked-up"])),
     "A live restaurant suspended. The order it had not accepted is cancelled and its "
     "authorisation released; the order being prepared and the one with a rider finish. "
     "The menu is now locked for everyone, admins included."),
    ("restaurant_suspended_halal_integrity", "RESTAURANT", "SUSPEND", "LIVE", "SUSPENDED", "HALAL_INTEGRITY",
     "Supplier invoice shows non-certified chicken delivered on 9 August.",
     dict(in_flight=_in_flight(cancelled=["kk-pending", "kk-preparing"], refunded=["kk-preparing"],
                               continuing=["kk-picked-up"])),
     "Suspended for halal integrity: the order still being prepared is cancelled and fully "
     "refunded too, at the restaurant's cost. The order already with a rider finishes."),
    ("restaurant_suspended_from_delisted", "RESTAURANT", "SUSPEND", "DELISTED", "SUSPENDED", "FRAUD_SUSPECTED",
     "Bank account on file changed twice in a week and matches a rejected application.",
     dict(delist=["HALAL_CERTIFICATE_EXPIRED"]),
     "A delisted restaurant can still be suspended. Its delisting reason is kept."),
    ("restaurant_delisted", "RESTAURANT", "DELIST", "LIVE", "DELISTED", "NO_APPROVED_MENU",
     "Every menu item was withdrawn; nothing approved is left to sell.",
     dict(delist=["NO_APPROVED_MENU"], in_flight=_in_flight(cancelled=["kk-pending"])),
     "Taken out of listings without a penalty. The menu is **not** locked, so the "
     "restaurant can get it ready to be listed again."),
    ("restaurant_ban_proposed", "RESTAURANT", "PROPOSE_BAN", "SUSPENDED", "SUSPENDED", "REPEATED_VIOLATIONS",
     "Fourth halal-integrity finding this year; recommending a permanent ban.",
     dict(),
     "An admin proposes a ban. The restaurant stays suspended; a different super admin "
     "must confirm within 7 days or the proposal lapses."),
    ("restaurant_banned", "RESTAURANT", "CONFIRM_BAN", "SUSPENDED", "BANNED", "REPEATED_VIOLATIONS",
     "Confirmed after reviewing the four findings and the supplier invoices.",
     dict(actor=SUPER_ADMIN, offset=2 * HOUR, sessions=3,
          in_flight=_in_flight(cancelled=["kk-preparing"], refunded=["kk-preparing"],
                               continuing=["kk-ready"])),
     "A super admin confirms the ban. Orders still being prepared are cancelled and "
     "refunded; the ready order finishes. Every session of the restaurant's staff ends."),
    ("restaurant_deactivated", "RESTAURANT", "DEACTIVATE", "LIVE", "DEACTIVATED", "MERCHANT_REQUEST",
     "Owner emailed on 8 August: closing the premises at the end of the month.",
     dict(),
     "A voluntary exit, only on the restaurant's own request."),
    ("restaurant_reinstated", "RESTAURANT", "REINSTATE", "SUSPENDED", "LIVE", "ISSUE_RESOLVED",
     "Compliance review closed; acceptance times back within target for 14 days.",
     dict(),
     "Back to `LIVE`: the halal certificate is current and no delisting reason is left."),
    ("restaurant_reinstated_still_delisted", "RESTAURANT", "REINSTATE", "SUSPENDED", "DELISTED", "ISSUE_RESOLVED",
     "Compliance review closed; the halal certificate lapsed during the suspension.",
     dict(delist=["HALAL_CERTIFICATE_EXPIRED"]),
     "Reinstated, but the halal certificate lapsed meanwhile, so the restaurant returns to "
     "`DELISTED`, never `LIVE`."),
    ("restaurant_relisted", "RESTAURANT", "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED",
     "Renewed certificate verified; the menu has approved items again.",
     dict(),
     "A delisted restaurant relisted. Needs a current, verified halal certificate."),
    ("restaurant_reactivated", "RESTAURANT", "REINSTATE", "DEACTIVATED", "LIVE", "MERCHANT_REQUEST",
     "Owner asked to reopen after the renovation finished.",
     dict(),
     "A deactivated restaurant reactivated on request."),
    ("restaurant_unbanned", "RESTAURANT", "REINSTATE", "BANNED", "LIVE", "APPEAL_UPHELD",
     "Appeal upheld: the supplier invoice was forged by a former employee.",
     dict(actor=SUPER_ADMIN),
     "Only a super admin can reinstate a banned restaurant."),
    # --- riders ----------------------------------------------------------------------
    ("rider_suspended_mid_delivery", "RIDER", "SUSPEND", "ACTIVE", "SUSPENDED", "INCIDENT_UNDER_INVESTIGATION",
     "Customer reported an aggressive exchange at drop-off; pausing while we investigate.",
     dict(in_flight=_in_flight(continuing=["rider-delivery"], withdrawn=["rider-offer"])),
     "Suspended mid-delivery: the waiting offer is withdrawn and no new ones come; the "
     "current delivery finishes, is paid, and the rider goes offline afterwards."),
    ("rider_ban_proposed", "RIDER", "PROPOSE_BAN", "SUSPENDED", "SUSPENDED", "ACCOUNT_SHARING",
     "A different person completed three deliveries on this account.",
     dict(),
     "A ban proposed; the rider stays suspended until a second person decides."),
    ("rider_banned", "RIDER", "CONFIRM_BAN", "SUSPENDED", "BANNED", "ACCOUNT_SHARING",
     "Confirmed from the delivery photos and the account-holder's own statement.",
     dict(actor=SUPER_ADMIN, offset=HOUR, sessions=2),
     "Banned: every session ends and the rider role is no longer granted at sign-in. "
     "Earned money is still paid."),
    ("rider_deactivated", "RIDER", "DEACTIVATE", "ACTIVE", "DEACTIVATED", "RIDER_REQUEST",
     "Rider called support: moving out of the province.",
     dict(),
     "A voluntary exit, only on the rider's own request."),
    ("rider_reinstated", "RIDER", "REINSTATE", "SUSPENDED", "ACTIVE", "ISSUE_RESOLVED",
     "Investigation closed: the customer withdrew the complaint.",
     dict(),
     "Reinstated; the rider is told they can go online again."),
    ("rider_reactivated", "RIDER", "REINSTATE", "DEACTIVATED", "ACTIVE", "RIDER_REQUEST",
     "Rider moved back to Toronto and asked to ride again.",
     dict(),
     "A deactivated rider reactivated on request."),
    ("rider_unbanned", "RIDER", "REINSTATE", "BANNED", "ACTIVE", "ACTIONED_IN_ERROR",
     "The account-sharing finding was a mix-up between two riders with the same name.",
     dict(actor=SUPER_ADMIN),
     "Only a super admin can reinstate a banned rider."),
    # --- customers -------------------------------------------------------------------
    ("customer_suspended", "CUSTOMER", "SUSPEND", "ACTIVE", "SUSPENDED", "FRAUDULENT_CHARGEBACK",
     "Two chargebacks filed for orders the rider photographed at the door.",
     dict(in_flight=_in_flight(cancelled=["fatima-pending"], continuing=["fatima-preparing"])),
     "Suspended: the order the restaurant had not accepted is cancelled; the accepted one "
     "finishes. The customer cannot sign in until reinstated."),
    ("customer_ban_proposed", "CUSTOMER", "PROPOSE_BAN", "SUSPENDED", "SUSPENDED", "ABUSIVE_CONDUCT_TO_RIDER",
     "Third report of threats to riders, with a recording.",
     dict(),
     "A ban proposed; the customer stays suspended."),
    ("customer_banned", "CUSTOMER", "CONFIRM_BAN", "SUSPENDED", "BANNED", "ABUSIVE_CONDUCT_TO_RIDER",
     "Confirmed after listening to the recording.",
     dict(actor=SUPER_ADMIN, offset=HOUR, sessions=1),
     "Banned once no accepted order is in progress. Every session ends; any refund owed "
     "is still paid."),
    ("customer_reinstated", "CUSTOMER", "REINSTATE", "SUSPENDED", "ACTIVE", "ISSUE_RESOLVED",
     "The bank reversed both chargebacks in our favour; no further action.",
     dict(),
     "Reinstated; the customer can sign in and order again."),
    ("customer_unbanned", "CUSTOMER", "REINSTATE", "BANNED", "ACTIVE", "APPEAL_UPHELD",
     "The recording was of a different account holder.",
     dict(actor=SUPER_ADMIN),
     "Only a super admin can reinstate a banned customer."),
]

# (suffix, status, code, message, details, note, subjects)
ERRORS = [
    ("account_action_illegal", 409, "ILLEGAL_STATE_TRANSITION",
     "This action is not possible from the account's current state: SUSPEND is not possible from BANNED.",
     {"from_state": "BANNED", "action": "SUSPEND", "allowed_actions": ["REINSTATE"]},
     "An action that is not legal from the current state, naming the state and the actions "
     "that are. Also returned for confirming a ban nobody proposed, or one that lapsed.",
     ["RESTAURANT", "RIDER", "CUSTOMER"]),
    ("account_action_super_admin_only", 403, "FORBIDDEN_PERMISSION",
     "Only a super admin can do this.",
     {"permission": "restaurant.unban"},
     "An admin confirming a ban, or reinstating a banned account. `details.permission` names "
     "what is missing.",
     ["RESTAURANT", "RIDER", "CUSTOMER"]),
    ("account_action_ban_needs_second_person", 403, "SELF_APPROVAL_FORBIDDEN",
     "A ban needs a second person: a different super admin must confirm it.",
     None,
     "The person who proposed a ban tried to confirm it.",
     ["RESTAURANT", "RIDER", "CUSTOMER"]),
    ("account_action_needs_two_step_sign_in", 403, "MFA_REQUIRED",
     "Sign in with two-step sign-in to change an account's state.",
     None,
     "A session without two-step sign-in. Account actions are destructive.",
     ["RESTAURANT", "RIDER", "CUSTOMER"]),
    ("relist_needs_halal_certificate", 409, "HALAL_CERTIFICATE_REQUIRED",
     "The restaurant can be listed again only with a current, verified halal certificate.",
     {"halal_status": "EXPIRED"},
     "Relisting a delisted restaurant whose certificate expired. Verify a renewed "
     "certificate first.",
     ["RESTAURANT"]),
    ("reinstate_precondition_not_met", 409, "PRECONDITION_NOT_MET",
     "The account cannot be reinstated yet.",
     {"blockers": ["The rider has not finished onboarding, so they cannot be reinstated to take deliveries."]},
     "Reinstating a partner who never finished onboarding.",
     ["RESTAURANT", "RIDER"]),
    ("customer_ban_orders_in_progress", 409, "IN_FLIGHT_ORDERS_PRESENT",
     "The customer has accepted orders still in progress. Confirm the ban once they have finished.",
     {"order_ids": [uuid_for("order:fatima-preparing")]},
     "Confirming a customer's ban while a restaurant is preparing their order.",
     ["CUSTOMER"]),
]


def build(reg, synth) -> None:
    for scenario, subject, action, frm, to, reason, text, extra, note in TRANSITIONS:
        reg.add(
            scenario,
            "admin",
            "AccountStateChange",
            f"`{action}`: `{frm}` → `{to}`. {note}",
            _change(scenario, subject, action, frm, to, reason, text, **extra),
            operations=[OP[subject]],
            tags=["admin", "account-action", "state-matrix"],
        )

    for suffix, status, code, message, details, note, subjects in ERRORS:
        envelope = {"error": {"code": code, "message": message, "request_id": ulid_for(f"request:{suffix}")}}
        if details is not None:
            envelope["error"]["details"] = details
        reg.add(
            f"error_{suffix}",
            "errors",
            "ErrorEnvelope",
            f"`{status}` · `{code}`. {note}",
            envelope,
            operations=[OP[s] for s in subjects],
            status=status,
            tags=["error-envelope", "account-action"],
        )
