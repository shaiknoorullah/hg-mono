package orders

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// PaymentAuthorised moves an order still waiting for its payment (CREATED) to
// AUTHORIZED and on to RESTAURANT_PENDING (docs/spec/01-platform.md, "P-14 —
// Order lifecycle states and transitions": the system's first two edges)
// inside a transaction the payments module owns. It implements
// payments.OrderHooks: in production the payment_intent.amount_capturable_updated
// webhook is what presents a paid order to the restaurant, and the stored
// event is marked processed in this same transaction (#231). It reports
// whether the order moved; an order already past CREATED, or cancelled by its
// deadline, is left as it is, so applying the event twice moves it once.
func (s *Store) PaymentAuthorised(ctx context.Context, tx pgx.Tx, orderID string) (bool, error) {
	err := s.transitionTx(ctx, tx, TransitionRequest{
		OrderID: orderID, To: machine.StateAuthorized, Actor: machine.ActorSystem,
		Reason: "payment authorised (Stripe webhook)",
	})
	var illegal *IllegalTransitionError
	if errors.As(err, &illegal) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := s.transitionTx(ctx, tx, TransitionRequest{
		OrderID: orderID, To: machine.StateRestaurantPending, Actor: machine.ActorSystem,
		Reason: "presented to restaurant",
	}); err != nil {
		return false, err
	}
	return true, nil
}

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
