package accountstate

import "time"

// OrderOutcome is what an account action does to one order still in progress,
// per https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change.
type OrderOutcome string

const (
	// Continue leaves the order to finish normally.
	Continue OrderOutcome = "CONTINUE"
	// CancelRelease cancels an order the restaurant has not accepted; nothing was
	// captured, so the payment authorisation is released and nothing is refunded.
	CancelRelease OrderOutcome = "CANCEL_RELEASE"
	// CancelRefund cancels an accepted order and refunds the customer in full.
	CancelRefund OrderOutcome = "CANCEL_REFUND"
)

// beforeAcceptance are the order states in which the restaurant has not yet
// accepted the order (contracts/openapi.yaml OrderState).
var beforeAcceptance = map[string]bool{"CREATED": true, "AUTHORIZED": true, "RESTAURANT_PENDING": true}

// terminalOrder are the order states that are already finished.
var terminalOrder = map[string]bool{
	"COMPLETED": true, "CANCELLED": true, "REJECTED": true, "FAILED": true, "RESOLVED": true,
}

// OrderInProgress reports whether an order is still in progress.
func OrderInProgress(orderState string) bool { return !terminalOrder[orderState] }

// halalOrSafety are the restaurant suspension reasons for which the platform can
// no longer stand behind food already being prepared: the one case where wasting
// it is the right outcome.
var halalOrSafety = map[string]bool{"HALAL_INTEGRITY": true, "FOOD_SAFETY_RISK": true}

// RestaurantOrderOutcome decides one in-progress order's fate when a restaurant
// action is applied. Orders the restaurant has not accepted are cancelled and
// released by every action except reinstating. Accepted orders finish, except
// that a confirmed ban, or a suspension (or ban proposal) for halal integrity or
// food safety, cancels and refunds orders still being prepared. Orders already
// ready or with a rider always finish here: the order state machine has no
// cancel step from those states without a rider recovery flow
// (https://github.com/shaiknoorullah/hg-mono/issues/253 lists this as deferred).
func RestaurantOrderOutcome(a Action, reasonCode, orderState string) OrderOutcome {
	if a == Reinstate || !OrderInProgress(orderState) {
		return Continue
	}
	if beforeAcceptance[orderState] {
		return CancelRelease
	}
	if orderState == "PREPARING" {
		if a == ConfirmBan {
			return CancelRefund
		}
		if (a == Suspend || a == ProposeBan) && halalOrSafety[reasonCode] {
			return CancelRefund
		}
	}
	return Continue
}

// RefundReasonFor is the refund reason a restaurant action's full refunds carry,
// which decides who bears the cost (payments.ComputeLiabilitySplit). For halal
// integrity or food safety the restaurant is not settled for the discarded food,
// the admin spec's proposed default for that question; otherwise the platform
// absorbs the cancellation.
func RefundReasonFor(restaurantReasonCode string) string {
	switch restaurantReasonCode {
	case "HALAL_INTEGRITY":
		return "HALAL_INTEGRITY"
	case "FOOD_SAFETY_RISK":
		return "FOOD_SAFETY"
	default:
		return "PLATFORM_INITIATED_CANCELLATION"
	}
}

// CustomerOrderOutcome decides one in-progress order's fate when a customer
// action is applied: orders the restaurant has not accepted are cancelled and
// released; accepted orders finish, because the restaurant has already committed
// to them.
func CustomerOrderOutcome(a Action, orderState string) OrderOutcome {
	if a == Reinstate || !OrderInProgress(orderState) {
		return Continue
	}
	if beforeAcceptance[orderState] {
		return CancelRelease
	}
	return Continue
}

// CustomerBanBlockedBy reports whether an order stops a customer's ban from
// being confirmed: an accepted order still in progress does. The ban waits until
// it finishes, and the admin is told which orders.
func CustomerBanBlockedBy(orderState string) bool {
	return OrderInProgress(orderState) && !beforeAcceptance[orderState]
}

// HalalCertificate is the restaurant's admin-verified halal certificate, as the
// order path reads it: APPROVED (or later moved to EXPIRED), verified by an admin,
// from an accepted issuing body. Status is empty when there is none.
type HalalCertificate struct {
	Status     string
	ExpiresOn  time.Time
	GraceUntil *time.Time
}

// CertificationState is the halal display state of a restaurant's certificate on
// its own local calendar date, today. It is the same rule as the order path's
// halal_certification_at() in https://github.com/shaiknoorullah/hg-mono/pull/298
// (and the expiry job in https://github.com/shaiknoorullah/hg-mono/pull/274): valid
// through the whole of its last day (expires_on, or grace_until when a super admin
// granted one), amber from 30 days out, expired from the next day. No verified
// certificate is UNVERIFIED. Once that pull request is merged the store can call that SQL
// function instead.
func CertificationState(c HalalCertificate, today time.Time) string {
	if c.Status == "" {
		return "UNVERIFIED"
	}
	lastValid := c.ExpiresOn
	if c.GraceUntil != nil {
		lastValid = *c.GraceUntil
	}
	day := func(t time.Time) time.Time { return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC) }
	today, lastValid, expires := day(today), day(lastValid), day(c.ExpiresOn)
	switch {
	case c.Status == "APPROVED" && !lastValid.Before(today) && expires.After(today.AddDate(0, 0, 30)):
		return "CERTIFIED"
	case c.Status == "APPROVED" && !lastValid.Before(today):
		return "EXPIRING_SOON"
	default:
		return "EXPIRED"
	}
}

// CertificateCurrent reports whether a halal display state lets a restaurant be
// listed: only a current certificate does, amber included.
func CertificateCurrent(displayState string) bool {
	return displayState == "CERTIFIED" || displayState == "EXPIRING_SOON"
}

// LocalDate is the calendar date at an instant in a restaurant's timezone. An
// unknown timezone takes the latest date anywhere (UTC+14), so a certificate is
// never treated as valid for longer than it is somewhere on Earth, as in
// https://github.com/shaiknoorullah/hg-mono/pull/298.
func LocalDate(timezone string, at time.Time) time.Time {
	loc, err := time.LoadLocation(timezone)
	if err != nil || timezone == "" {
		loc = time.FixedZone("UTC+14", 14*3600)
	}
	t := at.In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// ReinstatedState is where reinstating a restaurant leaves it: LIVE only with a
// current halal certificate and no delisting reason left; otherwise DELISTED,
// never LIVE (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist,
// rule 2). It also returns the delisting reasons the restaurant keeps: a current
// certificate clears the certificate's own reasons, as the expiry job in
// https://github.com/shaiknoorullah/hg-mono/pull/274
// does, and a certificate that is not current adds one.
func ReinstatedState(certState string, delistReasons []string) (string, []string) {
	out := []string{}
	for _, r := range delistReasons {
		if CertificateCurrent(certState) && (r == "HALAL_CERTIFICATE_EXPIRED" || r == "HALAL_CERTIFICATE_UNVERIFIED") {
			continue
		}
		out = append(out, r)
	}
	if !CertificateCurrent(certState) {
		reason := "HALAL_CERTIFICATE_EXPIRED"
		if certState == "UNVERIFIED" {
			reason = "HALAL_CERTIFICATE_UNVERIFIED"
		}
		if !contains(out, reason) {
			out = append(out, reason)
		}
	}
	if len(out) > 0 {
		return StateDelisted, out
	}
	return StateLive, out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
