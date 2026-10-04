package accountstate

// The reason vocabularies are contracts/openapi.yaml's RestaurantAccountReasonCode,
// RiderAccountReasonCode and CustomerAccountReasonCode; migration 00034 holds the
// stored rows to the same sets. Which reasons fit which action is the rule below:
// a penalty takes a penalty reason, a voluntary exit takes only the partner's own
// request, delisting takes a non-punitive cause, and reinstating says why the
// account is back.

func set(codes ...string) map[string]bool {
	m := make(map[string]bool, len(codes))
	for _, c := range codes {
		m[c] = true
	}
	return m
}

var (
	restaurantPenalty = set("COMPLIANCE_THRESHOLD", "HALAL_INTEGRITY", "FOOD_SAFETY_RISK",
		"FRAUD_SUSPECTED", "PAYMENT_OR_SETTLEMENT_ISSUE", "ABUSIVE_CONDUCT", "LEGAL_ORDER",
		"REPEATED_VIOLATIONS", "OTHER")
	restaurantDelist    = set("HALAL_CERTIFICATE_EXPIRED", "DOCUMENT_EXPIRED", "NO_APPROVED_MENU", "OTHER")
	restaurantReinstate = set("ISSUE_RESOLVED", "APPEAL_UPHELD", "ACTIONED_IN_ERROR", "MERCHANT_REQUEST", "OTHER")

	riderPenalty = set("DOCUMENT_EXPIRED", "INCIDENT_UNDER_INVESTIGATION", "SAFETY_RISK",
		"FRAUD_SUSPECTED", "REPEATED_CANCELLATIONS", "ABUSIVE_CONDUCT", "LOW_PERFORMANCE",
		"ACCOUNT_SHARING", "LEGAL_ORDER", "OTHER")
	riderReinstate = set("ISSUE_RESOLVED", "APPEAL_UPHELD", "ACTIONED_IN_ERROR", "RIDER_REQUEST", "OTHER")

	customerPenalty = set("PAYMENT_FAILURE_UNRESOLVED", "REFUND_ABUSE", "FRAUDULENT_CHARGEBACK",
		"ABUSIVE_CONDUCT_TO_RIDER", "ABUSIVE_CONDUCT_TO_RESTAURANT", "FAKE_REVIEWS",
		"ACCOUNT_TAKEOVER_RISK", "PROMOTION_ABUSE", "LEGAL_ORDER", "OTHER")
	customerReinstate = set("ISSUE_RESOLVED", "APPEAL_UPHELD", "ACTIONED_IN_ERROR", "OTHER")
)

var reasons = map[Subject]map[Action]map[string]bool{
	Restaurant: {
		Suspend: restaurantPenalty, ProposeBan: restaurantPenalty, ConfirmBan: restaurantPenalty,
		Delist: restaurantDelist, Deactivate: set("MERCHANT_REQUEST"), Reinstate: restaurantReinstate,
	},
	Rider: {
		Suspend: riderPenalty, ProposeBan: riderPenalty, ConfirmBan: riderPenalty,
		Deactivate: set("RIDER_REQUEST"), Reinstate: riderReinstate,
	},
	Customer: {
		Suspend: customerPenalty, ProposeBan: customerPenalty, ConfirmBan: customerPenalty,
		Reinstate: customerReinstate,
	},
}

// ReasonAllowed reports whether a reason code fits an action on a subject.
func ReasonAllowed(s Subject, a Action, reasonCode string) bool {
	return reasons[s][a][reasonCode]
}

// KnownAction reports whether an action applies to a subject at all, before any
// state is read: DELIST is for restaurants only, and customers are not
// deactivated here.
func KnownAction(s Subject, a Action) bool {
	_, ok := table[s][a]
	return ok
}
