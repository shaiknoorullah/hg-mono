"""Onboarding, KYC documents, halal certificates, admin review queues, auth and config."""

from __future__ import annotations

from typing import Any

from content import DAY, DISHES, HOUR, IMAGE_BASE, ISSUING_BODIES, MINUTE, day, ts
from synth import int_for, uuid_for
from world import certification_panel, public_address, slug

# state -> (current_step, progress_percent, note). `current_step` is its own closed enum
# on RestaurantOnboardingStatus — it is NOT a NextRoute.
RESTAURANT_ONBOARDING = {
    "REGISTERED": ("PROFILE", 0, "Account created, email not yet verified. Nothing else is reachable."),
    "EMAIL_VERIFIED": ("PROFILE", 10, "Email confirmed; the profile form is next."),
    "PROFILE_PENDING": ("PROFILE", 20, "Profile form open — legal name, address, GST/HST number."),
    "DOCUMENTS_PENDING": ("DOCUMENTS", 40, "Profile accepted; the five-document pack is outstanding."),
    "DOCUMENTS_REVIEW": ("AWAITING_REVIEW", 60, "Pack submitted and locked. The applicant can only wait."),
    "DOCUMENTS_APPROVED": ("PAYOUT", 75, "Documents cleared; Stripe Connect is next."),
    "DOCUMENTS_REJECTED": ("FIX_DOCUMENTS", 60, "**At least one document was rejected with a reason.** The applicant must resubmit exactly the failed documents."),
    "PAYOUT_PENDING": ("PAYOUT", 85, "Connect onboarding started but `currently_due` is non-empty."),
    "MENU_PENDING": ("MENU", 95, "Payouts enabled; the first menu must exist before going live."),
    "ACTIVE": ("DONE", 100, "Live and trading. Terminal, happy."),
    "WITHDRAWN": ("DONE", 0, "The applicant withdrew. Terminal."),
}

# state -> (next_step, progress_percent, note). `next_step` is RiderOnboardingStatus's own
# closed enum; `next_route` is the separate NextRoute the client obeys.
RIDER_ONBOARDING = {
    "REGISTERED": ("PROFILE", 0, "Phone entered, OTP not yet verified."),
    "PHONE_VERIFIED": ("PROFILE", 10, "OTP verified; identity capture is next."),
    "PROFILE_PENDING": ("PROFILE", 20, "Name, date of birth, address. Under 18 is `UNDERAGE`."),
    "VEHICLE_PENDING": ("VEHICLE", 35, "Vehicle type and plate. `ON_FOOT` skips plate and insurance."),
    "DOCUMENTS_PENDING": ("DOCUMENTS", 50, "Six document types outstanding."),
    "DOCUMENTS_REVIEW": ("AWAITING_REVIEW", 70, "Pack submitted and locked."),
    "DOCUMENTS_APPROVED": ("PAYOUT", 85, "Documents cleared; payout setup is next."),
    "DOCUMENTS_REJECTED": ("FIX_DOCUMENTS", 70, "**Rejected with a reason** — e.g. the licence photo is cropped."),
    "PAYOUT_PENDING": ("PAYOUT", 90, "Connect started, requirements outstanding."),
    "ACTIVE": ("DONE", 100, "Approved and able to go online. Terminal, happy."),
}

RESTAURANT_DOCS = ["BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY", "OWNER_ID", "LIABILITY_INSURANCE"]
RIDER_DOCS = ["DRIVERS_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSURANCE", "GOVERNMENT_ID", "WORK_ELIGIBILITY", "PROFILE_PHOTO"]


def build(reg, synth) -> None:
    _restaurant_onboarding(reg, synth)
    _rider_onboarding(reg, synth)
    _documents(reg, synth)
    _halal(reg, synth)
    _applications(reg, synth)
    _auth_and_config(reg, synth)


def _restaurant_onboarding(reg, synth) -> None:
    for state, (step, percent, note) in RESTAURANT_ONBOARDING.items():
        status = synth.make("RestaurantOnboardingStatus", f"r-onboarding-{state}")
        status["onboarding_state"] = state
        status["current_step"] = step
        status["progress_percent"] = percent
        status["account_state"] = "LIVE" if state == "ACTIVE" else "PENDING"
        done = list(RESTAURANT_ONBOARDING).index(state)
        status["steps_completed"] = {
            "profile": done >= 2,
            "documents_uploaded": done >= 4,
            "documents_submitted": done >= 4,
            "documents_approved": done >= 5 and state != "DOCUMENTS_REJECTED",
            "payout_account": done >= 8,
            "menu_published": state == "ACTIVE",
        }
        status["blocking_reason"] = (
            "Two documents were rejected. Re-upload them to continue."
            if state == "DOCUMENTS_REJECTED"
            else None
        )
        status["review_cycle"] = 2 if state == "DOCUMENTS_REJECTED" else 1
        status["rejection"] = (
            {
                "reason_code": "DOCUMENTS_INSUFFICIENT",
                "note": "The food-handling certificate has expired and the owner ID is cropped.",
                "documents": [
                    _document("FOOD_SAFETY", "REJECTED", subject="restaurant",
                              rejection_reason_code="EXPIRED",
                              review_note="This certificate expired on 2026-02-14."),
                    _document("OWNER_ID", "REJECTED", subject="restaurant"),
                ],
            }
            if state == "DOCUMENTS_REJECTED"
            else None
        )
        reg.add(
            f"restaurant_onboarding_{state.lower()}",
            "onboarding",
            "RestaurantOnboardingStatus",
            f"`onboarding_state = {state}`. {note}",
            status,
            operations=["getRestaurantOnboardingStatus", "submitRestaurantDocuments"],
            tags=["onboarding-state-matrix", "restaurant"],
        )

    reg.add(
        "restaurant_profile",
        "onboarding",
        "RestaurantProfile",
        "A submitted restaurant profile: Ontario address, CRA-form GST/HST number, "
        "America/Toronto. Server-controlled fields (`is_approved`, `account_state`, "
        "`commission_rate_bps`, anything `_cents`) do not exist on this DTO at all.",
        synth.make("RestaurantProfile", "restaurant-profile"),
        operations=["getRestaurantProfile", "submitRestaurantProfile"],
        tags=["restaurant"],
    )

    reg.add(
        "restaurant_registration",
        "onboarding",
        "RestaurantRegistration",
        "The response to `registerRestaurant` — the only public write that creates a "
        "partner account.",
        synth.make("RestaurantRegistration", "restaurant-registration"),
        operations=["registerRestaurant"],
        status=201,
        tags=["restaurant"],
    )

    for state, note in [
        ("OPEN", "Trading."),
        ("PAUSED", "Owner pressed pause; `is_accepting_orders` is untouched underneath."),
        ("CLOSED_HOURS", "Outside the trading calendar."),
        ("CLOSED_HOLIDAY", "An hours override closed today."),
        ("CLOSED_TOGGLE", "`is_accepting_orders: false` — the explicit switch."),
        ("CLOSED_OFFLINE", "No tablet heartbeat within the window; the kitchen is presumed away."),
        ("CLOSED_SUSPENDED", "Admin suspension. The owner cannot reopen."),
    ]:
        av = synth.make("RestaurantAvailability", f"open-state-{state}")
        av["open_state"] = state
        if "is_accepting_orders" in av:
            av["is_accepting_orders"] = state in ("OPEN", "CLOSED_HOURS", "CLOSED_HOLIDAY", "CLOSED_OFFLINE")
        reg.add(
            f"restaurant_open_state_{state.lower()}",
            "onboarding",
            "RestaurantAvailability",
            f"`open_state = {state}`. {note} R-22 evaluates these in strict precedence.",
            av,
            operations=["getRestaurantAvailability", "setRestaurantAcceptingOrders"],
            tags=["restaurant", "state-matrix"],
        )

    reg.add(
        "restaurant_heartbeat",
        "onboarding",
        "RestaurantHeartbeat",
        "The tablet's liveness ping response.",
        synth.make("RestaurantHeartbeat", "heartbeat"),
        operations=["sendRestaurantHeartbeat"],
        tags=["restaurant"],
    )


def _rider_onboarding(reg, synth) -> None:
    for state, (step, percent, note) in RIDER_ONBOARDING.items():
        status = synth.make("RiderOnboardingStatus", f"rider-onboarding-{state}")
        done = list(RIDER_ONBOARDING).index(state)
        status["onboarding_state"] = state
        status["next_step"] = step
        status["progress_percent"] = percent
        status["account_status"] = "ACTIVE" if state == "ACTIVE" else "PENDING"
        status["next_route"] = {
            "PROFILE": "ONBOARDING_PROFILE",
            "VEHICLE": "ONBOARDING_VEHICLE",
            "DOCUMENTS": "ONBOARDING_DOCUMENTS",
            "AWAITING_REVIEW": "ONBOARDING_AWAITING_REVIEW",
            "FIX_DOCUMENTS": "ONBOARDING_REJECTED",
            "PAYOUT": "ONBOARDING_PAYOUT",
            "DONE": "HOME",
        }[step]
        status["submitted_at"] = ts(-6 * DAY) if done >= 5 else None
        status["decided_at"] = ts(-2 * DAY) if done >= 6 else None
        status["attempt_number"] = 2 if state == "DOCUMENTS_REJECTED" else 1
        status["documents"] = (
            [
                _document("DRIVERS_LICENCE", "REJECTED", subject="rider"),
                _document("GOVERNMENT_ID", "APPROVED", subject="rider"),
            ]
            if state == "DOCUMENTS_REJECTED"
            else [_document(t, "APPROVED", subject="rider") for t in RIDER_DOCS]
            if done >= 6
            else []
        )
        status["steps_completed"] = {
            "phone_verified": done >= 1,
            "profile": done >= 3,
            "vehicle": done >= 4,
            "documents_submitted": done >= 5,
            "documents_approved": done >= 6 and state != "DOCUMENTS_REJECTED",
            "payout_onboarded": state == "ACTIVE",
        }
        reg.add(
            f"rider_onboarding_{state.lower()}",
            "onboarding",
            "RiderOnboardingStatus",
            f"`onboarding_state = {state}`. {note}",
            status,
            operations=["getRiderOnboardingStatus", "submitRiderDocuments"],
            tags=["onboarding-state-matrix", "rider"],
        )

    reg.add(
        "rider_profile",
        "onboarding",
        "RiderProfile",
        "A submitted rider profile with an Ontario address and a 1994 date of birth.",
        synth.make("RiderProfile", "rider-profile"),
        operations=["submitRiderProfile"],
        tags=["rider"],
    )

    vehicle = synth.make("RiderVehicle", "rider-vehicle")
    vehicle["vehicle_type"] = "SCOOTER"
    reg.add(
        "rider_vehicle_scooter",
        "onboarding",
        "RiderVehicle",
        "A scooter with a plate and insurance on file.",
        vehicle,
        operations=["submitRiderVehicle"],
        tags=["rider"],
    )

    on_foot = synth.make("RiderVehicle", "rider-vehicle-foot")
    on_foot["vehicle_type"] = "ON_FOOT"
    for key in ("plate", "make", "model", "colour", "year", "vehicle_make", "vehicle_model"):
        if key in on_foot:
            on_foot[key] = None
    reg.add(
        "rider_vehicle_on_foot",
        "onboarding",
        "RiderVehicle",
        "`ON_FOOT`: no plate, no make, no model, no insurance requirement. Every "
        "vehicle-shaped field is null at once (`FIELD_NOT_APPLICABLE`).",
        on_foot,
        operations=["submitRiderVehicle"],
        tags=["rider", "edge"],
    )


def _document(doc_type: str, state: str, *, subject: str, **over: Any) -> dict:
    rejected = state == "REJECTED"
    reviewed = state not in ("SUBMITTED", "IN_REVIEW")
    out = {
        "id": uuid_for(f"doc:{subject}:{doc_type}:{state}"),
        "subject_type": "RESTAURANT" if subject == "restaurant" else "RIDER",
        "subject_id": uuid_for(f"subject:{subject}"),
        "doc_type": doc_type,
        "state": state,
        "issuer": (
            ISSUING_BODIES[0]
            if doc_type == "HALAL_CERTIFICATE"
            else "Province of Ontario"
        ),
        "certificate_number": "HMA-ON-40182" if doc_type == "HALAL_CERTIFICATE" else None,
        "issued_on": day(-154),
        "valid_until": None if doc_type == "PROFILE_PHOTO" else day(400),
        "version": 2 if state == "SUPERSEDED" else 1,
        "rejection_reason_code": "INCOMPLETE_PAGES" if rejected else None,
        "review_note": (
            "Page 2 is missing — we need the side showing the expiry date and the issuing "
            "authority. Re-upload both sides in one file."
            if rejected
            else None
        ),
        "reviewed_at": ts(-2 * DAY) if reviewed else None,
        "created_at": ts(-6 * DAY),
    }
    out.update(over)
    return out


def _documents(reg, synth) -> None:
    def doc(doc_type: str, state: str, subject: str, **over: Any) -> dict:
        return _document(doc_type, state, subject=subject, **over)

    notes = {
        "SUBMITTED": "Uploaded and queued. Editable until the pack is submitted.",
        "IN_REVIEW": "A reviewer holds the lock. Locked to the applicant "
        "(`DOCUMENT_LOCKED_FOR_REVIEW`).",
        "APPROVED": "Cleared.",
        "REJECTED": "**Rejected with a machine-readable reason code and free text.** "
        "`INCOMPLETE_PAGES` here — the applicant resubmits exactly this document.",
        "EXPIRED": "Was approved; the expiry date has since passed. Trading may continue "
        "for some doc types and not others.",
        "SUPERSEDED": "Replaced by a newer upload of the same `doc_type`; kept for audit.",
    }
    for state, note in notes.items():
        payload = doc("BUSINESS_LICENCE", state, "restaurant")
        if state == "EXPIRED":
            payload["valid_until"] = day(-12)
        reg.add(
            f"document_{state.lower()}",
            "documents",
            "KycDocument",
            note,
            payload,
            operations=["attachRestaurantDocument", "reviewRestaurantDocument", "reviewRiderDocument"],
            tags=["document-state-matrix"],
        )

    for code, text in [
        ("ILLEGIBLE", "The scan is too dark to read the licence number."),
        ("EXPIRED", "This certificate expired on 2026-02-14."),
        ("WRONG_DOCUMENT_TYPE", "This is a lease agreement, not a business licence."),
        ("NAME_MISMATCH", "The licence is issued to 'K. Kitchen Ltd', the application says 'Karachi Kitchen Inc.'."),
        ("PLATE_MISMATCH", "The registration shows CJHK 812; the vehicle form says CJHK 182."),
        ("SUSPECTED_FORGERY", "The certificate number does not appear in the issuer's register."),
    ]:
        reg.add(
            f"document_rejected_{code.lower()}",
            "documents",
            "KycDocument",
            f"Rejected with `{code}`. Every rejection carries a code **and** the reviewer's "
            f"sentence — the applicant must never see a bare code.",
            doc(
                "BUSINESS_LICENCE",
                "REJECTED",
                "restaurant",
                rejection_reason_code=code,
                review_note=text,
            ),
            operations=["reviewRestaurantDocument"],
            tags=["document-state-matrix", "error-path"],
        )

    reg.add(
        "restaurant_document_pack_complete",
        "documents",
        "array<KycDocument>",
        "All five restaurant document types present and APPROVED. Note "
        "`VOID_CHEQUE_OR_BANK_LETTER` is absent by design — Stripe Connect supersedes it "
        "and the platform stores no bank details (contradiction log #20).",
        [doc(t, "APPROVED", "restaurant") for t in RESTAURANT_DOCS],
        operations=["listRestaurantDocuments"],
        tags=["restaurant", "documents"],
    )

    reg.add(
        "restaurant_document_pack_incomplete",
        "documents",
        "array<KycDocument>",
        "Two of five uploaded, one rejected, two never attached. Submitting is "
        "`422 INCOMPLETE_DOCUMENT_PACK`.",
        [
            doc("BUSINESS_LICENCE", "APPROVED", "restaurant"),
            doc("HALAL_CERTIFICATE", "REJECTED", "restaurant", rejection_reason_code="ILLEGIBLE"),
            doc("FOOD_SAFETY", "SUBMITTED", "restaurant"),
        ],
        operations=["listRestaurantDocuments"],
        tags=["restaurant", "documents", "error-path"],
    )

    reg.add(
        "restaurant_document_pack_empty",
        "documents",
        "array<KycDocument>",
        "Nothing uploaded yet — the first thing a new partner sees.",
        [],
        operations=["listRestaurantDocuments"],
        tags=["edge", "empty", "documents"],
    )

    reg.add(
        "rider_document_pack_complete",
        "documents",
        "array<KycDocument>",
        "All six rider document types APPROVED, including `WORK_ELIGIBILITY` "
        "(retained per contradiction log #20).",
        [doc(t, "APPROVED", "rider") for t in RIDER_DOCS],
        operations=["listRiderDocuments"],
        tags=["rider", "documents"],
    )

    reg.add(
        "rider_document_pack_rejected",
        "documents",
        "array<KycDocument>",
        "The licence was rejected for cropping and the insurance has expired. The rider "
        "resubmits exactly two documents, not the whole pack.",
        [
            doc("DRIVERS_LICENCE", "REJECTED", "rider", rejection_reason_code="INCOMPLETE_PAGES"),
            doc("VEHICLE_REGISTRATION", "APPROVED", "rider"),
            doc("VEHICLE_INSURANCE", "EXPIRED", "rider", valid_until=day(-12)),
            doc("GOVERNMENT_ID", "APPROVED", "rider"),
            doc("WORK_ELIGIBILITY", "IN_REVIEW", "rider"),
            doc("PROFILE_PHOTO", "APPROVED", "rider", valid_until=None),
        ],
        operations=["listRiderDocuments"],
        tags=["rider", "documents", "error-path"],
    )

    reg.add(
        "presigned_upload",
        "documents",
        "PresignedUpload",
        "A one-hour presigned PUT plus the `PENDING` stored object it will fill.",
        synth.make("PresignedUpload", "presigned-upload"),
        operations=["createUpload"],
        status=201,
    )

    for state, note in [
        ("PENDING", "Slot reserved, nothing uploaded yet. Expires in an hour."),
        ("READY", "Uploaded and checksum-verified. Only a READY object may be attached."),
        ("REJECTED", "Failed the content-type or checksum gate at confirm time."),
        ("DELETED", "Purged. Attaching it is `404 UPLOAD_NOT_FOUND`."),
    ]:
        obj = synth.make("StoredObject", f"stored-{state}")
        obj["state"] = state
        reg.add(
            f"stored_object_{state.lower()}",
            "documents",
            "StoredObject",
            note,
            obj,
            operations=["confirmUpload"],
            tags=["state-matrix", "documents"],
        )

    reg.add(
        "presigned_download",
        "documents",
        "PresignedDownload",
        "A short-lived GET for viewing a certificate or a document.",
        synth.make("PresignedDownload", "presigned-download"),
        operations=["createDocumentDownloadUrl", "createCertificateViewUrl"],
    )


def _halal(reg, synth) -> None:
    template = synth.make("HalalCertificate", "halal-template")

    def cert(label: str, status: str, **over: Any) -> dict:
        out = dict(template)
        out.update(
            {
                "id": uuid_for(f"cert:{label}"),
                "restaurant_id": uuid_for("restaurant:karachi-kitchen"),
                "document_id": uuid_for(f"doc:restaurant:HALAL_CERTIFICATE:{label}"),
                # `int_for`, not `hash()`. Python randomises string hashing per
                # process (PYTHONHASHSEED), so this field came out different on
                # every run and the drift gate could never pass — it compares
                # regenerated fixtures against the committed ones. The rest of
                # this builder already derives everything from a stable digest;
                # this was the single line that did not.
                "certificate_number": f"HMA-ON-{int_for(label, 40000, 49998)}",
                "certified_legal_name": "Karachi Kitchen Inc.",
                "certified_address": "1245 Danforth Avenue, Toronto, ON M4J 1M4",
                "scope": "WHOLE_ESTABLISHMENT",
                "issued_on": day(-154),
                "expires_on": day(211),
                "status": status,
                "checklist_version": 1,
                "checks": [
                    {
                        "check_key": key,
                        "result": "PASS",
                        "computed_result": "PASS",
                        "overridable": False,
                        "note": None,
                        "checked_at": ts(-152 * DAY),
                    }
                    for key in [
                        "H1_LEGIBLE_COMPLETE",
                        "H2_ISSUER_ACCEPTED",
                        "H3_NAME_MATCH",
                        "H4_ADDRESS_MATCH",
                        "H5_DATES_VALID",
                        "H6_SCOPE_SUFFICIENT",
                        "H7_UNIQUE_NOT_REUSED",
                    ]
                ],
                "rejection_reason_code": None,
                "rejection_reason_text": None,
                "verified_by": uuid_for("account:admin:reviewer"),
                "verified_at": ts(-152 * DAY),
            }
        )
        # keep only keys the schema declares
        out.update(over)
        checks_schema_keys = set(template.get("checks", [{}])[0].keys()) if template.get("checks") else None
        if checks_schema_keys:
            out["checks"] = [{k: v for k, v in c.items() if k in checks_schema_keys} for c in out["checks"]]
        return {k: v for k, v in out.items() if k in template}

    reg.add(
        "halal_certificate_valid",
        "halal",
        "HalalCertificate",
        "**Valid**: approved, all seven H-checks PASS, 211 days of validity remaining.",
        cert("valid", "APPROVED"),
        operations=["getHalalCertificate"],
        tags=["halal", "certificate"],
    )

    reg.add(
        "halal_certificate_expiring_within_30_days",
        "halal",
        "HalalCertificate",
        "**Expiring within 30 days** — expires in 18 days. Drives `EXPIRING_SOON` on the "
        "customer badge; the restaurant keeps trading (contradiction log #19).",
        cert("expiring", "APPROVED", expires_on=day(18)),
        operations=["getHalalCertificate"],
        tags=["halal", "certificate", "boundary"],
    )

    reg.add(
        "halal_certificate_expiring_tomorrow",
        "halal",
        "HalalCertificate",
        "The tightest boundary: expires **tomorrow**. Any 'days remaining' arithmetic that "
        "is off by one shows up here.",
        cert("expiring-tomorrow", "APPROVED", expires_on=day(1)),
        operations=["getHalalCertificate"],
        tags=["halal", "certificate", "boundary", "edge"],
    )

    reg.add(
        "halal_certificate_expired",
        "halal",
        "HalalCertificate",
        "**Expired** nine days ago. The restaurant 404s from every customer read path; the "
        "admin and owner surfaces still show this.",
        cert("expired", "EXPIRED", expires_on=day(-9)),
        operations=["getHalalCertificate"],
        tags=["halal", "certificate"],
    )

    for status, note, over in [
        ("PENDING", "Uploaded, transcribed, not yet decided. `checks` are NOT_ASSESSED.", {"checks": None}),
        ("APPROVED", "Decided in favour. Same as `halal_certificate_valid`.", {}),
        ("REJECTED", "Refused with `ISSUER_NOT_ACCEPTED` — the issuer is not on the O-02 list, so `H2_ISSUER_ACCEPTED` fails. **Until the client seeds that list, no restaurant can be certified.**", {}),
        ("EXPIRED", "Lapsed on its own expiry date.", {}),
        ("REVOKED", "Withdrawn by the issuer or by us after the fact.", {}),
        ("SUPERSEDED", "Replaced by a renewal. Kept for audit.", {}),
    ]:
        payload = cert(f"status-{status}", status)
        if status == "PENDING":
            payload["checks"] = [{**c, "result": "NOT_ASSESSED"} for c in payload["checks"]]
            payload["verified_by"] = None
            payload["verified_at"] = None
        if status == "REJECTED":
            payload["checks"] = [
                {**c, "result": "FAIL", "note": "Issuer is not on the accepted list (O-02)."}
                if c["check_key"] == "H2_ISSUER_ACCEPTED"
                else c
                for c in payload["checks"]
            ]
            payload["rejection_reason_code"] = "ISSUER_NOT_ACCEPTED"
            payload["rejection_reason_text"] = (
                "The certifying body on this certificate is not on our accepted list. If you "
                "believe it should be, reply with the issuer's registration details."
            )
        if status == "EXPIRED":
            payload["expires_on"] = day(-9)
        reg.add(
            f"halal_certificate_status_{status.lower()}",
            "halal",
            "HalalCertificate",
            f"`status = {status}`. {note}",
            payload,
            operations=["getHalalCertificate", "decideHalalCertificate", "recordHalalChecks", "transcribeHalalCertificate"],
            tags=["halal", "certificate-status-matrix"],
        )

    for state in ["CERTIFIED", "EXPIRING_SOON", "EXPIRED", "UNVERIFIED"]:
        from world import halal_badge

        reg.add(
            f"halal_badge_{state.lower()}",
            "halal",
            "HalalBadge",
            {
                "CERTIFIED": "The green badge. Certifying body and expiry both present.",
                "EXPIRING_SOON": "Amber. 18 days left; body and expiry present.",
                "EXPIRED": "Red. Never rendered on a customer surface — the restaurant 404s.",
                "UNVERIFIED": "No body, no expiry. Never rendered on a customer surface.",
            }[state],
            halal_badge(state),
            tags=["halal", "state-matrix"],
        )

    for status, note in [
        ("PROPOSED", "Suggested by a reviewer; **not yet usable**. `H2_ISSUER_ACCEPTED` fails against it."),
        ("ACCEPTED", "On the list. Promotion to this state is gated to a super admin (O-02)."),
        ("SUSPENDED", "Temporarily not accepted, pending an investigation."),
        ("RETIRED", "No longer issuing; existing certificates stand until expiry."),
        ("REJECTED", "Considered and refused."),
    ]:
        body = synth.make("HalalIssuingBody", f"body-{status}")
        body["status"] = status
        if "name" in body:
            body["name"] = ISSUING_BODIES[len(status) % len(ISSUING_BODIES)]
        reg.add(
            f"halal_issuing_body_{status.lower()}",
            "halal",
            "HalalIssuingBody",
            f"`status = {status}`. {note}",
            body,
            operations=["listHalalIssuingBodies", "proposeHalalIssuingBody", "setHalalIssuingBodyStatus"],
            tags=["halal", "state-matrix"],
        )

    reg.add(
        "halal_issuing_bodies_empty",
        "halal",
        "array<HalalIssuingBody>",
        "**The list is empty.** Not launch-day reality any more \u2014 O-02 is answered (S-11) "
        "and three bodies are seeded \u2014 but kept as the degenerate case: with no accepted "
        "issuer, `H2_ISSUER_ACCEPTED` fails for every certificate and no restaurant can be "
        "certified. A client must render this without implying the platform is broken.",
        [],
        operations=["listHalalIssuingBodies"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["halal", "edge", "empty", "blocking-decision"],
    )

    # The launch allowlist (decision S-11). Generated rather than hand-written: a file dropped
    # into contracts/fixtures/ does not survive `fixtures:build`, which regenerates the tree.
    # Authoritative copy for the running system is services/hg/migrations/seed/002.
    accepted = []
    for name, aliases, country in [
        ("Halal Monitoring Authority (HMA Canada)", ["HMA", "HMA Canada"], "CA"),
        ("Halal Food Standards Alliance of America (HFSAA)", ["HFSAA"], "US"),
        ("ISNA Canada Halal Certification Agency", ["ISNA Canada", "ISNA"], "CA"),
    ]:
        body = synth.make("HalalIssuingBody", f"seed-{aliases[0]}")
        body["status"] = "ACCEPTED"
        if "name" in body:
            body["name"] = name
        if "aliases" in body:
            body["aliases"] = aliases
        if "country" in body:
            body["country"] = country
        accepted.append(body)

    reg.add(
        "halal_issuing_bodies_seed",
        "halal",
        "array<HalalIssuingBody>",
        "**The launch allowlist** (decision S-11). A certificate from ANY ONE of these "
        "satisfies `H2_ISSUER_ACCEPTED`. Extensible at runtime by a super admin, so this is a "
        "starting registry, not a closed set.",
        accepted,
        operations=["listHalalIssuingBodies"],
        meta={"next_cursor": None, "has_more": False, "total": len(accepted)},
        tags=["halal", "seed", "launch-critical"],
    )


def _applications(reg, synth) -> None:
    app_template = synth.make("RestaurantApplication", "app-template")
    summary_template = synth.make("RestaurantApplicationSummary", "app-summary")

    reg.add(
        "restaurant_application_pending_review",
        "admin",
        "RestaurantApplication",
        "A complete application sitting in the queue: five documents, a halal certificate "
        "awaiting the seven checks, and no decision yet.",
        app_template,
        operations=["getRestaurantApplication", "takeNextRestaurantApplication", "decideRestaurantApplication"],
        tags=["admin", "review-queue"],
    )

    reg.add(
        "restaurant_application_queue",
        "admin",
        "array<RestaurantApplicationSummary>",
        "Four applications waiting, oldest first.",
        [synth.make("RestaurantApplicationSummary", f"app-summary-{i}") for i in range(4)],
        operations=["listRestaurantApplications"],
        meta={"next_cursor": None, "has_more": False, "total": 4},
        tags=["admin", "review-queue"],
    )

    reg.add(
        "restaurant_application_queue_empty",
        "admin",
        "array<RestaurantApplicationSummary>",
        "Queue drained. `takeNextRestaurantApplication` returns **null data**, not 404.",
        [],
        operations=["listRestaurantApplications"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["admin", "edge", "empty"],
    )

    reg.add(
        "restaurant_application_none_to_take",
        "admin",
        "RestaurantApplication|null",
        "`takeNextRestaurantApplication` with an empty queue — null, not an error.",
        None,
        operations=["takeNextRestaurantApplication"],
        tags=["admin", "edge", "empty"],
    )

    reg.add(
        "rider_application_pending_review",
        "admin",
        "RiderApplication",
        "A rider application with six documents and a vehicle on file.",
        synth.make("RiderApplication", "rider-app"),
        operations=["getRiderApplication", "takeNextRiderApplication", "decideRiderApplication"],
        tags=["admin", "review-queue"],
    )

    reg.add(
        "rider_application_queue",
        "admin",
        "array<RiderApplicationSummary>",
        "Nine rider applications waiting.",
        [synth.make("RiderApplicationSummary", f"rider-app-{i}") for i in range(9)],
        operations=["listRiderApplications"],
        meta={"next_cursor": None, "has_more": False, "total": 9},
        tags=["admin", "review-queue"],
    )

    reg.add(
        "rider_application_none_to_take",
        "admin",
        "RiderApplication|null",
        "Empty rider queue — null data.",
        None,
        operations=["takeNextRiderApplication"],
        tags=["admin", "edge", "empty"],
    )

    for status, note in [
        ("DRAFT", "The owner is still editing."),
        ("PENDING_REVIEW", "Claim-bearing fields queued. **Never auto-approved** (decision R-05)."),
        ("APPROVED", "Live to customers."),
        ("REJECTED", "Refused with `UNSUBSTANTIATED_HALAL_CLAIM`."),
        ("WITHDRAWN", "Pulled by the owner before review."),
        ("SUPERSEDED", "A newer version replaced it in the queue."),
    ]:
        version = synth.make("MenuItemVersion", f"menu-version-{status}")
        version["review_status"] = status
        reg.add(
            f"menu_version_{status.lower()}",
            "admin",
            "MenuItemVersion",
            f"`{status}`. {note}",
            version,
            operations=["listMenuReviewQueue", "decideMenuVersion"],
            tags=["admin", "state-matrix", "review-queue"],
        )

    reg.add(
        "menu_review_queue_empty",
        "admin",
        "array<MenuItemVersion>",
        "Nothing queued. A stalled queue must never freeze a restaurant's trading, which is "
        "why price and availability bypass review entirely.",
        [],
        operations=["listMenuReviewQueue"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["admin", "edge", "empty"],
    )

    # The review queue as `listMenuReviewQueue` returns it: only `PENDING_REVIEW`
    # versions, oldest first, across restaurants.
    queue = []
    for i, (dish, restaurant, waited_hours, version) in enumerate(
        [(1, "karachi-kitchen", 7, 4), (3, "beirut-shawarma", 3, 1), (14, "karachi-kitchen", 1, 2)]
    ):
        name, description, _, _, dietary, allergens = DISHES[dish]
        item_id = uuid_for(f"item:{restaurant}:{slug(name)}")
        queue.append(
            {
                "id": uuid_for(f"menu-version:queue:{i}"),
                "menu_item_id": item_id,
                "restaurant_id": uuid_for(f"restaurant:{restaurant}"),
                "version": version,
                "name": name,
                "description": description,
                "ingredients_text": None,
                "dietary_tags": dietary,
                "allergen_tags": allergens,
                "image_url": f"{IMAGE_BASE}/dish/{slug(name)}.webp",
                "review_status": "PENDING_REVIEW",
                "rejection_reason_code": None,
                "review_note": None,
                "submitted_at": ts(-waited_hours * HOUR),
                "reviewed_at": None,
                "created_at": ts(-waited_hours * HOUR - 4 * MINUTE),
            }
        )
    reg.add(
        "menu_review_queue",
        "admin",
        "array<MenuItemVersion>",
        "Three edits waiting, oldest first, from two restaurants. Only the words, the "
        "photo and the dietary and allergen tags wait here; price and availability went "
        "live on save. Nothing here is ever approved by waiting.",
        queue,
        operations=["listMenuReviewQueue"],
        meta={"next_cursor": None, "has_more": False, "total": len(queue)},
        tags=["admin", "review-queue"],
    )

    staff = []
    for i, (role, status) in enumerate(
        [("SUPER_ADMIN", "ACTIVE"), ("ADMIN", "INVITED"), ("SUPPORT_AGENT", "SUSPENDED"), ("ADMIN", "DEACTIVATED")]
    ):
        member = {**synth.make("StaffUser", f"staff-{i}"), "role": role, "status": status}
        if status == "INVITED":
            # An invitee has not set a password or enrolled two-step sign-in yet.
            member["mfa_enrolled"] = False
            member["last_login_at"] = None
        staff.append(member)
    reg.add(
        "staff_list",
        "admin",
        "array<StaffUser>",
        "Platform staff across every `StaffStatus`. The invitee has never signed in and has "
        "no two-step sign-in yet.",
        staff,
        operations=["listStaff"],
        meta={"next_cursor": None, "has_more": False, "total": len(staff)},
        tags=["admin", "state-matrix"],
    )

    reg.add(
        "staff_user_invited",
        "admin",
        "StaffUser",
        "What `createStaffUser` returns: a new account in `INVITED`. The super admin set no "
        "password; it becomes `ACTIVE` once the invitee sets one and enrols two-step "
        "sign-in.",
        {
            "id": uuid_for("staff:invited:hamza"),
            "email": "hamza.siddiqui@halalgoes.ca",
            "full_name": "Hamza Siddiqui",
            "role": "SUPPORT_AGENT",
            "status": "INVITED",
            "mfa_enrolled": False,
            "last_login_at": None,
            "created_at": ts(),
        },
        operations=["createStaffUser"],
        tags=["admin"],
    )

    reg.add(
        "restaurant_staff_list",
        "onboarding",
        "array<RestaurantStaffUser>",
        "A restaurant's own staff roster (`listRestaurantStaff`), scoped to the caller's "
        "restaurant — never platform staff and never another restaurant's accounts. "
        "Restaurant-scoped counterpart to admin's platform-role-only `/v1/admin/staff`.",
        [
            {**synth.make("RestaurantStaffUser", f"restaurant-staff-{i}"), "role": role, "status": status}
            for i, (role, status) in enumerate(
                [("RESTAURANT_MANAGER", "ACTIVE"), ("RESTAURANT_STAFF", "INVITED")]
            )
        ],
        operations=["listRestaurantStaff", "createRestaurantStaffUser"],
        meta={"next_cursor": None, "has_more": False, "total": 2},
        tags=["restaurant", "state-matrix"],
    )


def _auth_and_config(reg, synth) -> None:
    reg.add(
        "public_config",
        "platform",
        "PublicConfig",
        "Client bootstrap. Deliberately exposes **no fee parameter** — no client can compute "
        "a price (contradiction log #22). `restaurant_response_window_seconds` is 180 "
        "(decision R-04) and `served_provinces` gates ordering (O-05).",
        synth.make("PublicConfig", "public-config"),
        operations=["getPublicConfig"],
        tags=["platform"],
    )

    reg.add(
        "health_ok",
        "platform",
        "HealthStatus",
        "Liveness. Never touches a dependency.",
        synth.make("HealthStatus", "health"),
        operations=["getHealth"],
        tags=["platform"],
    )

    reg.add(
        "readiness_ok",
        "platform",
        "ReadinessStatus",
        "Every dependency reachable.",
        synth.make("ReadinessStatus", "readiness"),
        operations=["getReadiness"],
        tags=["platform"],
    )

    reg.add(
        "dependency_report",
        "platform",
        "DependencyReport",
        "Per-dependency detail for the internal status page.",
        synth.make("DependencyReport", "deps"),
        operations=["getDependencyStatus"],
        tags=["platform"],
    )

    reg.add(
        "otp_challenge",
        "platform",
        "OtpChallenge",
        "The OTP request response. The wire carries `resend_after_s` and `expires_at` and "
        "the client renders the **server's** cooldown — rate limits are not contract "
        "constants (contradiction log #23).",
        synth.make("OtpChallenge", "otp-challenge"),
        operations=["requestOtp"],
        tags=["platform", "auth"],
    )

    reg.add(
        "session_grant_customer",
        "platform",
        "SessionGrant",
        "A customer session issued by phone OTP, with `next_route` telling the app where to "
        "land — the client contains no branching tree of its own (P-04).",
        synth.make("SessionGrant", "session-customer"),
        operations=["verifyOtp", "login", "refreshSession"],
        tags=["platform", "auth"],
    )

    staff_grant = synth.make("SessionGrant", "session-password-changed")
    staff_grant.update(
        {
            "refresh_token": None,
            "expires_in": 900,
            "is_new_account": False,
            "principal": {
                "account_id": uuid_for("account:admin:amina"),
                "session_id": uuid_for("session:admin:amina:after-password-change"),
                "roles": [{"role": "ADMIN", "scope_type": "GLOBAL", "scope_id": None}],
                "amr": "pwd+totp",
                "status": "ACTIVE",
                "locale": "en-CA",
                "timezone": "America/Toronto",
                "next_route": "HOME",
            },
        }
    )
    reg.add(
        "session_grant_password_changed",
        "platform",
        "SessionGrant",
        "`changePassword` from the admin console: every other session was revoked and this "
        "one re-issued. Web, so the refresh token is in the `hg_rt` cookie and null here.",
        staff_grant,
        operations=["changePassword"],
        tags=["platform", "auth"],
    )

    reg.add(
        "totp_enrolment",
        "platform",
        "TotpEnrolment",
        "Two-step sign-in enrolment, step one: the authenticator URI and ten recovery codes, "
        "shown **once**. Step two is `verifyTotpEnrolment` with a live code.",
        {
            "provisioning_uri": (
                "otpauth://totp/HalalGoes:amina.rahman%40halalgoes.ca"
                "?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=HalalGoes"
                "&algorithm=SHA1&digits=6&period=30"
            ),
            "recovery_codes": [
                f"{int_for(f'recovery:{i}:a', 1000, 9999)}-{int_for(f'recovery:{i}:b', 1000, 9999)}"
                for i in range(10)
            ],
        },
        operations=["enrollTotp"],
        tags=["platform", "auth"],
    )

    for route, note in [
        ("HOME", "Fully onboarded; go to the main surface."),
        ("PROFILE_CAPTURE", "First sign-in — we have a phone and nothing else."),
        ("ONBOARDING_DOCUMENTS", "Mid-onboarding; documents outstanding."),
        ("ONBOARDING_REJECTED", "A document was rejected; the app must land on the reason."),
        ("ACTIVE_DELIVERY", "A rider with a delivery in progress resumes it, wherever they were."),
        ("ORDER_TRACKING", "A customer with a live order lands on tracking."),
        ("SUSPENDED", "Account suspended; a dead end with an explanation."),
        ("APP_UPDATE_REQUIRED", "Below `min_supported_version`. A hard stop."),
    ]:
        grant = synth.make("SessionGrant", f"session-{route}")
        if "next_route" in grant:
            grant["next_route"] = route
        reg.add(
            f"session_next_route_{route.lower()}",
            "platform",
            "SessionGrant",
            f"`next_route = {route}`. {note}",
            grant,
            operations=["verifyOtp", "login", "refreshSession"],
            tags=["platform", "auth", "state-matrix"],
        )

    reg.add(
        "principal_customer",
        "platform",
        "Principal",
        "`GET /v1/auth/me` for a customer — one account, one role, no restaurant scope.",
        synth.make("Principal", "principal-customer"),
        operations=["getCurrentPrincipal"],
        tags=["platform", "auth"],
    )

    reg.add(
        "realtime_ticket",
        "platform",
        "RealtimeTicket",
        "A single-use 30-second ticket plus the channels this principal may subscribe to. "
        "Mint a fresh one per connection attempt; never cache or reuse.",
        synth.make("RealtimeTicket", "realtime-ticket"),
        operations=["createRealtimeTicket"],
        tags=["platform", "realtime"],
    )

    reg.add(
        "notifications_list",
        "platform",
        "array<Notification>",
        "Mixed read and unread notifications across channels and priorities.",
        [synth.make("Notification", f"notification-{i}") for i in range(4)],
        operations=["listNotifications"],
        meta={"next_cursor": None, "has_more": False, "total": 4},
        tags=["platform"],
    )

    reg.add(
        "notifications_empty",
        "platform",
        "array<Notification>",
        "Nothing to show. The bell must not render a zero badge.",
        [],
        operations=["listNotifications"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["platform", "edge", "empty"],
    )

    reg.add(
        "addresses_list",
        "platform",
        "array<Address>",
        "Three saved addresses, one default, one with no unit or buzzer.",
        [
            {**_address_fixture(0, True)},
            {**_address_fixture(1, False)},
            {**_address_fixture(2, False), "unit": None, "buzzer": None, "delivery_notes": None, "label": None},
        ],
        operations=["listAddresses", "createAddress", "getAddress", "updateAddress", "setDefaultAddress"],
        tags=["platform"],
    )

    reg.add(
        "addresses_empty",
        "platform",
        "array<Address>",
        "No address yet — the state that makes every distance and ETA uncomputable "
        "(`NO_ADDRESS` availability).",
        [],
        operations=["listAddresses"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["platform", "edge", "empty"],
    )

    reg.add(
        "customer_profile",
        "platform",
        "CustomerProfile",
        "C-03: `first_name`/`last_name`, never a single `name`. `phone_e164` is read-only "
        "here — sending it is `422 UNKNOWN_FIELD`.",
        synth.make("CustomerProfile", "customer-profile"),
        operations=["getCustomerProfile", "updateCustomerProfile"],
        tags=["platform"],
    )

    reg.add(
        "connect_status_complete",
        "platform",
        "ConnectStatus",
        "Stripe Connect fully onboarded: payouts enabled, nothing due.",
        synth.make("ConnectStatus", "connect-complete"),
        operations=["getConnectStatus", "createConnectAccount"],
        tags=["platform", "money"],
    )

    incomplete = synth.make("ConnectStatus", "connect-incomplete")
    for key, value in [
        ("payouts_enabled", False),
        ("charges_enabled", False),
        ("currently_due", ["individual.verification.document", "external_account"]),
        ("past_due", ["individual.id_number"]),
    ]:
        if key in incomplete:
            incomplete[key] = value
    reg.add(
        "connect_status_requirements_due",
        "platform",
        "ConnectStatus",
        "Payouts disabled with `currently_due` and `past_due` surfaced **verbatim** from "
        "Stripe — we do not paraphrase requirement ids.",
        incomplete,
        operations=["getConnectStatus"],
        tags=["platform", "money", "error-path"],
    )


def _address_fixture(index: int, is_default: bool) -> dict:
    from world import address

    return address(f"saved-{index}", index, is_default=is_default)
