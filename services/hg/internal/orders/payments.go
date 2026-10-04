package orders

import "context"

// PaymentGateway is the boundary to the payments module (P-16). The orders
// module owns the order and its state machine; the Stripe PaymentIntent is
// created and captured by the payments sibling. This interface is how orders
// asks for that without importing Stripe or fabricating a payment identifier —
// the anti-pattern the legacy system lived in (minted stripe_${nanoid()},
// TODO'd every refund).
//
// createOrder calls CreateOrderIntent inside its own transaction is NOT possible
// (Stripe is a network call), so the handler creates the order row first, then
// asks the gateway, per P-16 step 3/4. A gateway that is not yet wired returns
// ErrPaymentGatewayUnavailable and the handler answers 503 rather than
// fabricating a client_secret.
type PaymentGateway interface {
	// CreateOrderIntent creates a manual-capture PaymentIntent for exactly
	// amountCents and returns the client secret. It is idempotency-keyed by the
	// order id inside the implementation (I-16.1). The real implementation lives
	// in the payments module; orders depends only on this contract.
	CreateOrderIntent(ctx context.Context, in CreateIntentInput) (CreateIntentResult, error)

	// VoidOrderPayment cancels the order's uncaptured PaymentIntent, releasing
	// the hold on the customer's card. The deadline runner calls it after a
	// system cancel of an order the restaurant never accepted: authorise then
	// capture means such an order was never captured, so a void, not a refund,
	// gives the money back (AGENTS.md, "Non-negotiable invariants", authorise
	// then capture: https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).
	// An order with no PaymentIntent yet (still CREATED) has nothing to void
	// and returns nil.
	VoidOrderPayment(ctx context.Context, orderID string) error
}

// CreateIntentInput is the P-16 PaymentIntent creation input. It carries the
// server-computed amount (quote.total_cents), never a client value.
type CreateIntentInput struct {
	OrderID           string
	OrderCode         string
	QuoteID           string
	AccountID         string
	RestaurantID      string
	AmountCents       int64
	Currency          string
	PaymentMethodID   *string
	SavePaymentMethod bool
}

// CreateIntentResult is what the gateway returns.
type CreateIntentResult struct {
	ClientSecret string
}

// unwiredGateway is the honest default: it refuses rather than fabricating a
// PaymentIntent. The server wires the real payments gateway at boot; until then
// createOrder answers 503 and creates no order (the order transaction is rolled
// back), so no half-created order without a payment can exist.
type unwiredGateway struct{}

// ErrPaymentGatewayUnavailable is returned by the unwired gateway.
var ErrPaymentGatewayUnavailable = errPaymentGatewayUnavailable{}

type errPaymentGatewayUnavailable struct{}

func (errPaymentGatewayUnavailable) Error() string {
	return "payment gateway not wired: the payments module must provide a PaymentGateway"
}

func (unwiredGateway) CreateOrderIntent(context.Context, CreateIntentInput) (CreateIntentResult, error) {
	return CreateIntentResult{}, ErrPaymentGatewayUnavailable
}

func (unwiredGateway) VoidOrderPayment(context.Context, string) error {
	return ErrPaymentGatewayUnavailable
}
