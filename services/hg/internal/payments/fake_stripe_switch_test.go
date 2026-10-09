package payments

import (
	"context"
	"errors"
	"testing"
)

// The fake's switch decides what a local order shows: the default still
// authorises at once, a declined card creates no intent, and an unpaid intent
// stays unconfirmed when read back, so reading the payment does not
// authorise the order behind the customer's back.
func TestFakeStripeSwitch(t *testing.T) {
	ctx := context.Background()
	fake := NewFakeStripe()

	pi, err := fake.CreatePaymentIntent(ctx, CreateIntentInput{AmountCents: 2597, Currency: "cad"})
	if err != nil || pi.Status != "requires_capture" || pi.AmountCapturableCents != 2597 {
		t.Fatalf("default: %+v %v, want an authorisation of 2597", pi, err)
	}
	if got, _ := fake.GetPaymentIntent(ctx, pi.ID); got.Status != "requires_capture" {
		t.Fatalf("default read back %s", got.Status)
	}

	pi, err = fake.CreatePaymentIntent(ctx, CreateIntentInput{AmountCents: 2597, PaymentMethodID: FakeMethodDeclined, Confirm: true})
	if !errors.Is(err, ErrFakeCardDeclined) || pi != nil {
		t.Fatalf("declined: %+v %v, want no intent and the decline", pi, err)
	}

	pi, err = fake.CreatePaymentIntent(ctx, CreateIntentInput{AmountCents: 2597, PaymentMethodID: FakeMethodUnpaid, Confirm: true})
	if err != nil || pi.Status != "requires_payment_method" || pi.AmountCapturableCents != 0 {
		t.Fatalf("unpaid: %+v %v, want an unconfirmed intent", pi, err)
	}
	if got, _ := fake.GetPaymentIntent(ctx, pi.ID); got.Status != "requires_payment_method" {
		t.Fatalf("unpaid read back %s, want requires_payment_method", got.Status)
	}
}
