package payments

import (
	"sort"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Routes registers the payments, refunds, connect, earnings and payout routes.
//
// Deny by default: every route carries an explicit Action except the Stripe
// webhook, which the contract marks PUBLIC (it is authenticated by signature,
// not by session — P-17). MONEY-class routes are Idempotent, enforced by
// Router.Verify at boot.
func Routes(r *httpx.Router, h *Handler) {
	read := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassRead, OperationID: op}
	}
	write := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassWrite, OperationID: op}
	}
	money := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassMoney, Idempotent: true, OperationID: op}
	}

	// Payment methods (C-24).
	r.Get("/v1/payment-methods", read(ActionPaymentMethodRead, "listPaymentMethods"), h.ListPaymentMethods)
	r.Post("/v1/payment-methods/setup-intent", money(ActionPaymentMethodWrite, "createPaymentMethodSetupIntent"), h.CreateSetupIntent)
	r.Delete("/v1/payment-methods/{paymentMethodId}", write(ActionPaymentMethodWrite, "deletePaymentMethod"), h.DeletePaymentMethod)
	r.Post("/v1/payment-methods/{paymentMethodId}/default", write(ActionPaymentMethodWrite, "setDefaultPaymentMethod"), h.SetDefaultPaymentMethod)

	// Order payment state (P-16).
	r.Get("/v1/orders/{orderId}/payment", read(ActionPaymentRead, "getOrderPayment"), h.GetOrderPayment)

	// Refunds (P-18).
	r.Post("/v1/refunds", money(ActionRefundRequest, "createRefund"), h.CreateRefund)
	r.Get("/v1/refunds", read(ActionRefundRead, "listRefunds"), h.ListRefunds)
	r.Get("/v1/refunds/{refundId}", read(ActionRefundRead, "getRefund"), h.GetRefund)

	// Admin goodwill refund under an authority cap (A-33 / P-18). MONEY-class and
	// Idempotent — the mandatory Idempotency-Key is what stops a retried support
	// click from issuing a second refund. Declares the refund.issue_goodwill
	// action; the auth matrix must grant it to SUPPORT_AGENT, ADMIN, SUPER_ADMIN.
	r.Post("/v1/admin/refunds", money(ActionRefundIssueGoodwill, "issueRefund"), h.IssueRefund)

	// Stripe webhook (P-17) — the only PUBLIC route in this module.
	r.Post("/v1/webhooks/stripe", httpx.Policy{
		Public:      true,
		Class:       httpx.ClassWebhook,
		OperationID: "receiveStripeWebhook",
	}, h.ReceiveStripeWebhook)

	// Connect (P-19).
	r.Post("/v1/connect/account", money(ActionConnectWrite, "createConnectAccount"), h.CreateConnectAccount)
	r.Post("/v1/connect/onboarding-link", write(ActionConnectWrite, "createConnectOnboardingLink"), h.CreateOnboardingLink)
	r.Get("/v1/connect/status", read(ActionConnectRead, "getConnectStatus"), h.GetConnectStatus)

	// Rider earnings & payouts (D-26..D-28 / P-19).
	r.Get("/v1/riders/me/earnings/summary", read(ActionEarningsRead, "getRiderEarningsSummary"), h.GetRiderEarningsSummary)
	r.Get("/v1/riders/me/earnings/entries", read(ActionEarningsRead, "listRiderEarningEntries"), h.ListRiderEarningEntries)
	r.Get("/v1/riders/me/payouts", read(ActionPayoutRead, "listRiderPayouts"), h.ListRiderPayouts)
	r.Get("/v1/riders/me/payouts/{payoutId}", read(ActionPayoutRead, "getRiderPayout"), h.GetRiderPayout)

	// Restaurant payouts (P-19 / S-04).
	r.Get("/v1/restaurant/payouts", read(ActionPayoutRead, "listRestaurantPayouts"), h.ListRestaurantPayouts)

	// Payout runs, for admins (issue #251): run the weekly payout now for one
	// partner or for all, and read what every run did. Requesting a run moves
	// money, so it is MONEY-class with a mandatory Idempotency-Key.
	r.Post("/v1/admin/payout-runs", money(ActionPayoutRunCreate, "createPayoutRun"), h.CreatePayoutRun)
	r.Get("/v1/admin/payout-runs", read(ActionPayoutRunRead, "listPayoutRuns"), h.ListPayoutRuns)
	r.Get("/v1/admin/payout-runs/{runId}", read(ActionPayoutRunRead, "getPayoutRun"), h.GetPayoutRun)
}

// PublicRouteAllowlist is the checked-in set of PUBLIC routes this module adds,
// required by I-06.2. Only the Stripe webhook is public.
func PublicRouteAllowlist() []string {
	routes := []string{
		"POST /v1/webhooks/stripe",
	}
	sort.Strings(routes)
	return routes
}
