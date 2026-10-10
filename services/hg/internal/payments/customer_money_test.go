package payments

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// What a customer may see and do with their own money, and nobody else's: saved
// cards (docs/spec/02-customer.md, "C-24"), their order's payment and their
// refunds. Each runs on a database of its own with the shared fixtures, on
// HG_TEST_POSTGRES_DSN's server or in a throwaway container when that is unset,
// so the weekly coverage scan, which has no shared database, runs them too.

// newSeededRefundHarness is the refund harness on a fresh, seeded database.
func newSeededRefundHarness(t *testing.T, prefix string) *refundHarness {
	t.Helper()
	dsn := testseed.FreshDatabase(t, prefix)
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return newRefundHarnessOn(t, newWebhookHarnessOn(t, pool))
}

// saveCards gives an account n live cards, the first its default.
func (h *refundHarness) saveCards(account string, n int) []string {
	h.t.Helper()
	ids := make([]string, 0, n)
	for i := range n {
		ids = append(ids, h.text(`
			INSERT INTO saved_payment_method (account_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default)
			VALUES ($1, $2, 'visa', $3, 12, 2030, $4) RETURNING id::text`,
			account, fmt.Sprintf("pm_%s_%d", account, i), fmt.Sprintf("42%02d", i), i == 0))
	}
	return ids
}

func (h *refundHarness) customer(name string) string {
	h.t.Helper()
	return h.text(`INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id::text`,
		name+"-"+h.run+"@customer.test.local")
}

func TestSavedCards_CapOwnershipAndInUse(t *testing.T) {
	h := newSeededRefundHarness(t, "hg_pay_cards")
	ctx := context.Background()
	stripe := &mockStripe{}
	setups := 0
	stripe.SetupIntentFn = func(string, string) (*StripeSetupIntent, error) {
		setups++
		return &StripeSetupIntent{ID: "seti_cards", ClientSecret: "seti_cards_secret"}, nil
	}
	svc := NewService(NewRepo(h.pool), stripe, config.Stripe{}, nil)

	t.Run("a sixth card is refused before Stripe is asked", func(t *testing.T) {
		full := h.customer("five-cards")
		h.saveCards(full, MaxSavedCards)
		_, err := svc.CreateSetupIntent(ctx, full, "setup:"+full)
		wantDomainErr(t, err, string(CodePaymentMethodLimit))
		if setups != 0 {
			t.Fatalf("Stripe was asked for %d setup intents; a customer at the cap must not reach it", setups)
		}

		room := h.customer("four-cards")
		h.saveCards(room, MaxSavedCards-1)
		si, err := svc.CreateSetupIntent(ctx, room, "setup:"+room)
		if err != nil || si.ClientSecret != "seti_cards_secret" || setups != 1 {
			t.Fatalf("fifth card: %+v err=%v setups=%d; want Stripe's client secret", si, err, setups)
		}
	})

	t.Run("another customer's card is not theirs to remove or make default", func(t *testing.T) {
		owner, other := h.customer("card-owner"), h.customer("card-other")
		card := h.saveCards(owner, 2)[1]
		wantDomainErr(t, svc.DeletePaymentMethod(ctx, other, card), httpxNotFound)
		_, err := svc.SetDefaultPaymentMethod(ctx, other, card)
		wantDomainErr(t, err, httpxNotFound)
		if cards, _ := svc.ListPaymentMethods(ctx, owner); len(cards) != 2 || cards[0].IsDefault && cards[0].ID == card {
			t.Fatalf("owner's cards after another customer tried them: %+v", cards)
		}
	})

	t.Run("removing the default card promotes another, and a card behind a live order stays", func(t *testing.T) {
		owner := h.customer("card-default")
		cards := h.saveCards(owner, 2)
		if err := svc.DeletePaymentMethod(ctx, owner, cards[0]); err != nil {
			t.Fatalf("delete the default card: %v", err)
		}
		left, err := svc.ListPaymentMethods(ctx, owner)
		if err != nil || len(left) != 1 || left[0].ID != cards[1] || !left[0].IsDefault {
			t.Fatalf("cards after removing the default: %+v err=%v; want the other one, now default", left, err)
		}

		// The remaining card pays for an order the restaurant has not answered.
		order := seedOrderWithIntent(t, h.pool, h.id("pi_card_in_use"), "RESTAURANT_PENDING", "REQUIRES_CAPTURE")
		if _, err := h.pool.Exec(ctx, `
			UPDATE payment_intent SET stripe_payment_method_id =
			       (SELECT stripe_payment_method_id FROM saved_payment_method WHERE id = $2)
			 WHERE order_id = $1`, order, cards[1]); err != nil {
			t.Fatalf("pay with the card: %v", err)
		}
		wantDomainErr(t, svc.DeletePaymentMethod(ctx, owner, cards[1]), string(CodePaymentMethodInUse))
		if left, _ := svc.ListPaymentMethods(ctx, owner); len(left) != 1 {
			t.Fatalf("the card behind a live order was removed: %+v", left)
		}
	})
}

func TestOrderPaymentAndRefunds_OnlyTheirCustomerSeesThem(t *testing.T) {
	h := newSeededRefundHarness(t, "hg_pay_owner")
	ctx := context.Background()
	stranger := h.customer("stranger")

	t.Run("an order's payment", func(t *testing.T) {
		pi := h.id("pi_challenge")
		order := seedOrderWithIntent(t, h.pool, pi, "CREATED", "REQUIRES_ACTION")
		owner := h.customerOf(order)
		stripe := &mockStripe{GetIntentFn: func(id string) (*StripeIntent, error) {
			return &StripeIntent{ID: id, Status: "requires_action", ClientSecret: id + "_secret_live"}, nil
		}}
		svc := NewService(NewRepo(h.pool), stripe, config.Stripe{}, nil)

		_, err := svc.GetOrderPayment(ctx, order, stranger, false)
		wantDomainErr(t, err, httpxNotFound)

		// A 3-D Secure challenge is resumed with Stripe's live secret.
		got, err := svc.GetOrderPayment(ctx, order, owner, false)
		if err != nil || got.State != string(StateRequiresAction) || got.ClientSecret == nil || *got.ClientSecret != pi+"_secret_live" {
			t.Fatalf("owner's payment: %+v err=%v; want REQUIRES_ACTION with Stripe's secret", got, err)
		}

		// Once the card is authorised there is nothing to resume: no secret.
		authorised := seedOrderWithIntent(t, h.pool, h.id("pi_authorised"), "RESTAURANT_PENDING", "REQUIRES_CAPTURE")
		got, err = svc.GetOrderPayment(ctx, authorised, "", true)
		if err != nil || got.ClientSecret != nil || got.AmountAuthorizedCents != 3919 {
			t.Fatalf("staff read of an authorised payment: %+v err=%v; want 3919 authorised and no secret", got, err)
		}
	})

	t.Run("a refund request and its reads", func(t *testing.T) {
		order, _ := h.capturedOrder("owned", 3000)
		owner := h.customerOf(order)

		refund, err := h.svc.RequestRefund(ctx, RefundInput{OrderID: order, Kind: RefundFull,
			ReasonCode: "ORDER_NEVER_ARRIVED", Note: "nothing came"}, owner)
		if err != nil || refund.State != string(RefundRequested) || refund.AmountCents != 3919 {
			t.Fatalf("request: %+v err=%v; want a CAD 39.19 refund in REQUESTED", refund, err)
		}
		// A request moves no money until a person approves it.
		if n := h.count(`SELECT count(*) FROM ledger_batch WHERE order_id = $1 AND kind = 'REFUND'`, order); n != 0 {
			t.Fatalf("a request posted %d REFUND batches; want none before review", n)
		}

		_, err = h.svc.GetRefund(ctx, refund.ID, stranger, false)
		wantDomainErr(t, err, httpxNotFound)
		if got, err := h.svc.GetRefund(ctx, refund.ID, owner, false); err != nil || got.ID != refund.ID {
			t.Fatalf("owner's read: %+v err=%v", got, err)
		}
		if mine, err := h.svc.ListRefunds(ctx, ListRefundsFilter{AccountID: stranger}); err != nil || len(mine) != 0 {
			t.Fatalf("stranger's refund list: %+v err=%v; want empty", mine, err)
		}

		// A second full request would refund more than was captured: refused,
		// and nothing is written.
		_, err = h.svc.RequestRefund(ctx, RefundInput{OrderID: order, Kind: RefundFull, ReasonCode: "ORDER_NEVER_ARRIVED"}, owner)
		var de *DomainError
		if !errors.As(err, &de) || de.Status != 422 && de.Status != 409 {
			t.Fatalf("second full request: err=%v; want it refused", err)
		}
		if n := h.count(`SELECT count(*) FROM refund WHERE order_id = $1`, order); n != 1 {
			t.Fatalf("%d refunds on the order after a refused second request; want 1", n)
		}
	})

	t.Run("requests the customer route never takes", func(t *testing.T) {
		order, _ := h.capturedOrder("goodwill", 3000)
		_, err := h.svc.RequestRefund(ctx, RefundInput{OrderID: order, Kind: RefundGoodwill, ReasonCode: "GOODWILL"}, h.customerOf(order))
		wantDomainErr(t, err, string(CodePaymentNotRefundable))

		// Authorised, never captured: that is a cancel and a void, not a refund.
		uncaptured := seedOrderWithIntent(t, h.pool, h.id("pi_uncaptured"), "RESTAURANT_PENDING", "REQUIRES_CAPTURE")
		_, err = h.svc.RequestRefund(ctx, RefundInput{OrderID: uncaptured, Kind: RefundFull, ReasonCode: "ORDER_NEVER_ARRIVED"},
			h.customerOf(uncaptured))
		wantDomainErr(t, err, string(CodePaymentNotRefundable))
	})
}
