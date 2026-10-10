"""
Single source of truth for the contract-enum -> Postgres-type mapping.

`contracts/openapi.yaml` is the wire contract. Every enum it exposes either
  (a) has a Postgres enum type whose label set is byte-identical — generated
      into 00002_enums.sql (MAPPED) or created by its own feature migration
      (MAPPED_IN_MIGRATION), or
  (b) appears in EXCLUSIONS with a written reason.

There is no third option, and `check_enums.py` fails CI if one appears.
"""

# contract schema name (or "Schema/properties/field" for inline enums) -> pg type name
MAPPED = {
    # --- identity / session -------------------------------------------------
    "AccountStatus":                      "account_status",
    "Role":                               "role_name",
    "RoleGrant/properties/scope_type":    "role_scope_type",
    "AuthMethod":                         "auth_method",
    "ClientSurface":                      "client_surface",
    "NextRoute":                          "next_route",
    "Principal/properties/locale":        "locale_code",
    "OtpRequestInput/properties/purpose": "otp_purpose",
    "StaffStatus":                        "staff_status",

    # --- geography / money primitives --------------------------------------
    "Currency":                           "currency_code",
    "Province":                           "province",

    # --- orders -------------------------------------------------------------
    "OrderState":                         "order_state",
    "OrderStatusGroup":                   "order_status_group",
    "OrderActorKind":                     "order_actor_kind",
    "Fulfilment":                         "fulfilment",
    "DeliveryInstruction":                "delivery_instruction",
    "CustomerCancellationReasonCode":     "customer_cancellation_reason_code",
    "OrderCancellationReasonCode":        "order_cancellation_reason_code",
    "RestaurantRejectReasonCode":         "restaurant_reject_reason_code",
    "DelayReasonCode":                    "delay_reason_code",

    # --- dispatch / rider ---------------------------------------------------
    "DispatchState":                      "dispatch_state",
    "DispatchOfferOutcome":               "dispatch_offer_outcome",
    "OfferState":                         "offer_state",
    "OfferRejectReasonCode":              "offer_reject_reason_code",
    "AssignmentState":                    "assignment_state",
    "RiderAvailabilityState":             "rider_availability_state",
    "RiderOnboardingState":               "rider_onboarding_state",
    "RiderAccountStatus":                 "rider_account_status",
    "VehicleType":                        "vehicle_type",
    "RiderDocType":                       "rider_doc_type",
    "PodMethod":                          "pod_method",
    "HandoverMethod":                     "handover_method",
    "TrackingHealth":                     "tracking_health",
    "RouteSource":                        "route_source",
    "RiderAvailability/properties/blocking_reasons/items":
                                          "rider_blocking_reason",
    "RiderPositionAck/properties/rejected/items/properties/code":
                                          "rider_position_reject_code",
    "RiderOnboardingStatus/properties/next_step":
                                          "rider_onboarding_step",

    # --- restaurant ---------------------------------------------------------
    "RestaurantOnboardingState":          "restaurant_onboarding_state",
    "RestaurantAccountState":             "restaurant_account_state",
    "RestaurantOpenState":                "restaurant_open_state",
    "RestaurantAvailabilityState":        "restaurant_availability_state",
    "RestaurantDocType":                  "restaurant_doc_type",
    "RestaurantDecision":                 "restaurant_decision",
    "RestaurantApproveReasonCode":        "restaurant_approve_reason_code",
    "RestaurantRejectApplicationReasonCode":
                                          "restaurant_reject_application_reason_code",
    "RestaurantOnboardingStatus/properties/current_step":
                                          "restaurant_onboarding_step",
    "RestaurantAvailability/properties/resolvable_by":
                                          "availability_resolvable_by",
    "PriceBand":                          "price_band",
    "RestaurantSort":                     "restaurant_sort",
    "FeedSection/properties/key":         "feed_section_key",

    # --- halal --------------------------------------------------------------
    "HalalDisplayState":                  "halal_display_state",
    "HalalCertificateStatus":             "halal_certificate_status",
    "HalalCertificateScope":              "halal_certificate_scope",
    "HalalCheckKey":                      "halal_check_key",
    "HalalCheckResult":                   "halal_check_result",
    "HalalRejectionReasonCode":           "halal_rejection_reason_code",
    "HalalIssuingBodyStatus":             "halal_issuing_body_status",

    # --- menu ---------------------------------------------------------------
    "MenuReviewStatus":                   "menu_review_status",
    "MenuItemAvailabilityState":          "menu_item_availability_state",
    "MenuRejectionReasonCode":            "menu_rejection_reason_code",
    "VariantPricingMode":                 "variant_pricing_mode",
    "DietaryTag":                         "dietary_tag",
    "AllergenTag":                        "allergen_tag",
    "CartLineAvailability/properties/reason":
                                          "cart_line_unavailable_reason",

    # --- documents ----------------------------------------------------------
    "KycDocumentState":                   "kyc_document_state",
    "KycDocument/properties/subject_type": "kyc_subject_type",
    "DocumentRejectionReasonCode":        "document_rejection_reason_code",
    "StoredObjectPurpose":                "stored_object_purpose",
    "StoredObjectState":                  "stored_object_state",

    # --- payments / money ---------------------------------------------------
    "PaymentState":                       "payment_state",
    "PaymentIntentKind":                  "payment_intent_kind",
    "RefundKind":                         "refund_kind",
    "RefundScope":                        "refund_scope",
    "RefundState":                        "refund_state",
    "RefundReasonCode":                   "refund_reason_code",
    "TaxCategory":                        "tax_category",
    "TaxKind":                            "tax_kind",
    "RemittableBy":                       "remittable_by",
    "DiscountTarget":                     "discount_target",
    "DiscountFundedBy":                   "discount_funded_by",
    "LedgerAccount":                      "ledger_account",
    "LedgerComponent":                    "ledger_component",
    "LedgerEntry/properties/batch_kind":  "ledger_batch_kind",
    "LedgerEntry/properties/counterparty_type":
                                          "ledger_counterparty_type",
    "PayoutState":                        "payout_state",
    "PayoutInterval":                     "payout_interval",
    "EarningEntryType":                   "earning_entry_type",
    "EarningEntryStatus":                 "earning_entry_status",
    "EarningsPeriod":                     "earnings_period",

    # --- notifications ------------------------------------------------------
    "NotificationChannel":                "notification_channel",
    "NotificationPriority":               "notification_priority",
    "DevicePlatform":                     "device_platform",

    # --- operations ---------------------------------------------------------
    # Each replica writes its start-up check of the text-message sender to
    # Postgres, so every admin page reads the same answer (getSmsSenderStatus).
    "SmsSenderCheckState":                "sms_sender_check_state",

    # --- pre-launch waitlist (#212, https://github.com/shaiknoorullah/hg-mono/issues/212)
    # Stored on the waitlist_signup row with its consent record (joinWaitlist).
    "WaitlistAudience":                   "waitlist_audience",
    "WaitlistContactKind":                "waitlist_contact_kind",
}

# Contract enums whose Postgres type is created by the feature migration that
# introduced it, not by the generated 00002_enums.sql. gen_enums.py must not
# emit these (the type would be created twice); check_enums.py still verifies
# their labels against the live database. contract name -> (pg type, migration)
MAPPED_IN_MIGRATION = {
    "RatingStatus":                       ("rating_status", "00025_ratings.sql"),
    "PackageSealStatus":                  ("package_seal_status", "00027_handoff.sql"),
    "HandoffEventType":                   ("handoff_event_type", "00027_handoff.sql"),
    "HandoffActor":                       ("handoff_actor", "00027_handoff.sql"),
    "HandoffMethod":                      ("handoff_method", "00027_handoff.sql"),
    "PayoutRunKind":                      ("payout_run_kind", "00030_payout_run.sql"),
    "PayoutRunState":                     ("payout_run_state", "00030_payout_run.sql"),
    "PayoutRunOutcome":                   ("payout_run_outcome", "00030_payout_run.sql"),
}

# Contract enums with no persisted counterpart. Each needs a reason.
EXCLUSIONS = {
    "ErrorCode":
        "Transport-level error vocabulary. Never stored; lives in the Go error registry.",
    "Address/properties/country":
        "Single-value ('CA') constant enforced by a CHECK on address.country, not a type.",
    "GeocodedAddress/properties/country":
        "Single-value ('CA') constant on a geocoding answer. The saved address stores it "
        "as address.country, under that column's CHECK, not a type.",
    "GeoResultKind":
        "How precise a Mapbox search result is. Shown to the user and never stored: the "
        "address search adds no persistent entity (customer spec, C-31).",
    "HealthStatus/properties/status":
        "Liveness probe literal. Not persisted.",
    "ReadinessStatus/properties/dependencies/items/properties/name":
        "Runtime dependency probe names. Not persisted.",
    "DependencyReport/properties/environment":
        "Process environment (HG_ENV). Configuration, not data.",
    "DependencyReport/properties/boot_probes/items/properties/name":
        "Boot self-probe names. Not persisted.",
    "PresignedUpload/properties/method":
        "HTTP verb literal in a presign response. Not persisted.",
    "Assignment/properties/payment_status":
        "Derived projection ('PREPAID' always, orders are pre-authorised). Not stored.",
    "MenuVersionDecisionInput/properties/decision":
        "Request-only verb; outcome lands in menu_item_version.review_status.",
    "DocumentReviewInput/properties/decision":
        "Request-only verb; outcome lands in kyc_document.state.",
    "HalalDecisionInput/properties/decision":
        "Request-only verb; outcome lands in halal_certificate.status.",
    # The application decision bodies are one shape per decision (issue #163,
    # https://github.com/shaiknoorullah/hg-mono/issues/163). Each shape pins its
    # `decision` to one value so the body can only carry the reasons that fit it.
    "RestaurantApplicationApproveInput/properties/decision":
        "Single-value request discriminator; the decision is stored as "
        "restaurant_application.decision (restaurant_decision).",
    "RestaurantApplicationRejectInput/properties/decision":
        "Single-value request discriminator; the decision is stored as "
        "restaurant_application.decision (restaurant_decision).",
    "RestaurantApplicationRequestChangesInput/properties/decision":
        "Single-value request discriminator; the decision is stored as "
        "restaurant_application.decision (restaurant_decision).",
    "RiderApplicationApproveInput/properties/decision":
        "Single-value request discriminator; the outcome lands in "
        "rider_profile.onboarding_state.",
    "RiderApplicationRejectInput/properties/decision":
        "Single-value request discriminator; the outcome lands in "
        "rider_profile.onboarding_state.",
    "RiderApplicationRequestChangesInput/properties/decision":
        "Single-value request discriminator; the outcome lands in "
        "rider_profile.onboarding_state.",
    "RiderApproveReasonCode":
        "rider_application has no approval-reason column (only reject_reason_code); the "
        "approval reason is kept as text on the decision's audit_event.reason_code.",
    "MenuItemAvailabilityInput/properties/availability_state":
        "Writable subset of menu_item_availability_state (HIDDEN/BLOCKED are not "
        "restaurant-settable). Enforced at the boundary.",
    "StaffUserInput/properties/role":
        "Writable subset of role_name (staff-grantable roles only).",
    "OrderDelayInput/properties/added_minutes":
        "Integer enum of permitted delay increments; stored as plain int minutes.",
    "RefundApprovalRequest/properties/status":
        "Approval sub-state of refund_state; stored on refund.approval_status as a "
        "CHECK-constrained text to avoid a near-duplicate type.",
    "RefundRequesterKind":
        "Derived per read: CUSTOMER when refund.requested_by is the order's own account, "
        "STAFF otherwise. Not stored.",
    "ChargebackStatus":
        "Stripe's dispute status, stored as Stripe sends it (lower case text) on "
        "chargeback.state and chargeback.outcome; upper-cased at the API boundary.",
    "MoneyEventKind":
        "The admin order view's money timeline, derived per read from payment_intent, "
        "refund, chargeback and audit_event rows. Not stored.",
    "MoneyEvent/properties/actor_kind":
        "audit_event.actor_kind's CHECK-constrained text values, read through. Not a type.",
    "RestaurantStaffUser/properties/role":
        "Restaurant-scoped subset of role_name; stored as an account_role grant.",
    "PayoutPayeeType":
        "Stored as CHECK-constrained text, matching connect_account.owner_type, "
        "which predates it.",
    "FoodRating/properties/tags/items":
        "Rating tag vocabulary. Stored as free text[] on the rating row; the "
        "allowed set is enforced at the API boundary.",
    "RiderRating/properties/tags/items":
        "Rating tag vocabulary. Stored as free text[] on the rating row; the "
        "allowed set is enforced at the API boundary.",
    "OrderRatingInput/properties/food/oneOf/0/properties/tags/items":
        "Rating tag vocabulary. Stored as free text[] on the rating row; the "
        "allowed set is enforced at the API boundary.",
    "OrderRatingInput/properties/rider/oneOf/0/properties/tags/items":
        "Rating tag vocabulary. Stored as free text[] on the rating row; the "
        "allowed set is enforced at the API boundary.",
    # The handover-code request shapes
    # (https://github.com/shaiknoorullah/hg-mono/pull/290). Each method/to_state
    # below is a one-value discriminator that picks the request shape; what is
    # stored is the full enum it narrows.
    "AssignmentStepInput/properties/to_state/not":
        "Request-shape rule: PICKED_UP is not a plain step (it needs the pickup "
        "code). The stored value is assignment_state.",
    "PickupTransitionInput/properties/to_state":
        "One-value discriminator (PICKED_UP) of the pickup request; stored as "
        "assignment_state.",
    "OtpProofInput/properties/method":
        "One-value discriminator of the proof shape; stored as pod_method.",
    "PhotoProofInput/properties/method":
        "One-value discriminator of the proof shape; stored as pod_method.",
    "PhotoWithAttestationProofInput/properties/method":
        "One-value discriminator of the proof shape; stored as pod_method.",
    "HandoverOverride/properties/actor_kind":
        "Subset of order_actor_kind (SUPPORT, ADMIN); stored as order_actor_kind "
        "with a CHECK on handover_override.actor_kind.",
    "HandoverCodeKind":
        "Contract-only until the backend lands "
        "(https://github.com/shaiknoorullah/hg-mono/pull/315): nothing stores it yet. "
        "That PR adds handover_code_kind in its own migration and moves this entry "
        "to MAPPED_IN_MIGRATION.",
    # Address search (https://github.com/shaiknoorullah/hg-mono/issues/179) is
    # forwarded to Mapbox and answered without touching the database.
    "GeoResultKind":
        "Response-only: how precise an address-search result is. Search results "
        "are forwarded from Mapbox and never stored; a chosen address is saved "
        "as an Address.",
    "GeocodedAddress/properties/country":
        "Response-only, always CA: an address-search result is never stored. "
        "A saved address carries Address.country.",
}


def db_type_for(contract_name):
    if contract_name in MAPPED_IN_MIGRATION:
        return MAPPED_IN_MIGRATION[contract_name][0]
    return MAPPED.get(contract_name)
