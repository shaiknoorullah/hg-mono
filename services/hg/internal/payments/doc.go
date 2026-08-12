// Package payments owns Stripe, the double-entry ledger and payouts.
//
// Responsibility: authorise at checkout, capture on restaurant acceptance, void
// on rejection or timeout, refund, and keep a ledger whose residual is always
// zero.
//
// Spec: docs/spec/01-platform.md
//
//   - P-08 Currency representation — int64 minor units, CAD
//   - P-13 The ledger and the zero-residual invariant
//   - P-16 PaymentIntent lifecycle and capture timing: authorise at checkout,
//     capture on acceptance; a rejection or timeout voids the authorisation, so
//     a cancelled order costs the customer nothing
//   - P-17 Webhooks, idempotency and reconciliation. receiveStripeWebhook is
//     authenticated by signature, not by session — it is public in the contract
//     for exactly that reason.
//   - P-18 Refunds, cancellations and compensation
//   - P-19 Stripe Connect Express: onboarding and weekly Monday payouts, no
//     minimum, for both partner types (decisions S-04 / R-03)
//
// Launch money model (docs/spec/00-overview.md): 0% platform commission, $0
// service fee, delivery fee $2.99 + $1.00/km charged to the customer, rider
// earnings = delivery fee pass-through + 100% of tips. The consequence is
// deliberate and accepted: roughly −$1.30 per order once Stripe takes ~2.9% +
// $0.30. The service-fee mechanism is built and wired to zero so it can be
// corrected by configuration rather than a release.
//
// Hard constraints: G-2 bans float64 anywhere in this package's path — an
// arch-lint rejects it under internal/payments outright. G-3 bans price-shaped
// fields on inbound DTOs; the only allowlisted one here is amount_cents on
// issueRefund, which is admin goodwill, capped and dual-approved.
//
// TODO: P-37 idempotency records must commit in the *same transaction* as the
// business effect, so "money moved but the idempotency record did not commit"
// cannot happen. httpx extracts and validates the key; the claim/replay belongs
// here.
package payments
