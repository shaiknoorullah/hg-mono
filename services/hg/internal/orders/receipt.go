package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// writeReceiptSnapshotTx issues the order's receipt: it builds the contract
// Receipt from what the order froze and writes it to order.receipt_snapshot
// (docs/spec/01-platform.md, "P-10 — Fee breakdown presented to the
// customer"). It runs inside the DELIVERED → COMPLETED transition, so an order
// is never COMPLETED without its receipt, and the order.completed event that
// points at the receipt commits with it.
//
// The snapshot is the same receiptSnapshotDTO GetOrderReceipt decodes, so what
// is stored is what is served. Nothing in it is re-priced: lines, addons and
// money are the order's own frozen columns, tax lines are the order's quote's.
// The write-once trigger (migration 00013, I-10.3) refuses a second write, so
// a receipt once issued never changes.
//
// https://github.com/shaiknoorullah/hg-mono/issues/511
func (s *Store) writeReceiptSnapshotTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	snap, err := s.buildReceiptSnapshot(ctx, tx, orderID)
	if err != nil {
		return fmt.Errorf("build receipt: %w", err)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("encode receipt: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "order" SET receipt_snapshot = $2 WHERE id = $1`, orderID, raw); err != nil {
		return fmt.Errorf("write receipt_snapshot: %w", err)
	}
	return nil
}

// buildReceiptSnapshot reads a COMPLETED order inside tx and renders it as the
// contract Receipt.
func (s *Store) buildReceiptSnapshot(ctx context.Context, tx pgx.Tx, orderID string) (*receiptSnapshotDTO, error) {
	var (
		accountID, state string
		completedAt      *time.Time
		issuedYear       *int
		legalName        string
		gstHSTNumber     *string
	)
	err := tx.QueryRow(ctx, `
		SELECT o.account_id, o.state::text, o.completed_at,
		       extract(year FROM o.completed_at AT TIME ZONE r.timezone)::int,
		       r.legal_name, r.gst_hst_number
		  FROM "order" o JOIN restaurant r ON r.id = o.restaurant_id
		 WHERE o.id = $1`, orderID).Scan(&accountID, &state, &completedAt, &issuedYear, &legalName, &gstHSTNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load order: %w", err)
	}
	if machine.State(state) != machine.StateCompleted || completedAt == nil || issuedYear == nil {
		return nil, fmt.Errorf("order %s is %s, not COMPLETED: no receipt", orderID, state)
	}

	// The customer projection already reads the order's frozen lines, money,
	// quote tax lines and delivery address; the receipt is rendered from it.
	v, err := s.loadOrderView(ctx, tx, accountID, orderID)
	if err != nil {
		return nil, err
	}
	pay, err := loadReceiptPayment(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}

	issuedAt := *completedAt
	r := &receiptSnapshotDTO{
		OrderID:       v.ID,
		OrderCode:     v.Code,
		ReceiptNumber: receiptNumber(*issuedYear, v.Code),
		IssuedAt:      httpx.Timestamp(issuedAt),
		// O-01: the platform's name and registration number are printed only
		// when configured; an empty value is never replaced by a placeholder.
		PlatformLegalName:             s.platformLegalName,
		PlatformTaxRegistrationNumber: nonEmpty(s.platformTaxRegistrationNumber),
		RestaurantLegalName:           legalName,
		Lines:                         make([]receiptLineDTO, 0, len(v.Lines)),
		Money: receiptMoneyDTO{
			SubtotalCents: v.SubtotalCents, DiscountCents: v.DiscountCents,
			DeliveryFeeCents: v.DeliveryFeeCents, ServiceFeeCents: v.ServiceFeeCents,
			TaxLines: make([]quoteTaxLineDTO, 0, len(v.TaxLines)), TaxTotalCents: v.TaxTotalCents,
			TipCents: v.TipCents, TotalCents: v.TotalCents, Currency: v.Currency,
		},
		Payment:     *pay,
		Refunds:     []json.RawMessage{},
		PlacedAt:    httpx.Timestamp(v.PlacedAt),
		DeliveredAt: tsPtr(v.DeliveredAt),
	}
	// The restaurant's registration number is printed when the restaurant is
	// the supplier of record, which the frozen quote says: it remits a tax line.
	for _, tl := range v.TaxLines {
		r.Money.TaxLines = append(r.Money.TaxLines, taxLineToDTO(tl))
		if tl.RemittableBy == "RESTAURANT" && gstHSTNumber != nil {
			r.RestaurantTaxRegistrationNumber = nonEmpty(*gstHSTNumber)
		}
	}
	for _, l := range v.Lines {
		rl := receiptLineDTO{
			LineNo: l.LineNo, MenuItemID: l.MenuItemID, Name: l.Name, VariantName: l.VariantName,
			Variants: lineVariantsToDTO(l.Variants),
			Addons:   make([]quoteLineAddonDTO, 0, len(l.Addons)), Quantity: l.Quantity,
			SpecialRequest: l.SpecialRequest, UnitPriceCents: l.UnitPriceCents,
			LineTotalCents: l.LineTotalCents, Currency: l.Currency,
		}
		for _, a := range l.Addons {
			rl.Addons = append(rl.Addons, quoteLineAddonDTO{
				AddonID: a.AddonID, AddonName: a.AddonName, AddonQuantity: a.AddonQuantity, AddonPriceCents: a.PriceCents,
			})
		}
		r.Lines = append(r.Lines, rl)
	}
	// A pickup order has no delivery address; the receipt prints none.
	if a := v.DeliveryAddress; a != nil {
		r.DeliveryAddress = &publicAddressDTO{
			Line1: a.Line1, Line2: a.Line2, City: a.City, Province: a.Province,
			PostalCode: a.PostalCode, Latitude: a.Latitude, Longitude: a.Longitude,
		}
	}
	return r, nil
}

// loadReceiptPayment reads what the customer was charged from the order's
// payment intent: the captured amount and the card's display fields. A
// delivered order was captured when the restaurant accepted it (P-16), so an
// order with no payment intent has no charge to print, and the receipt is not
// issued rather than invented; the settle is retried and the warning logged.
func loadReceiptPayment(ctx context.Context, tx pgx.Tx, orderID string) (*receiptPaymentDTO, error) {
	var p receiptPaymentDTO
	err := tx.QueryRow(ctx, `
		SELECT card_brand, card_last4, wallet, amount_captured_cents, currency::text
		  FROM payment_intent
		 WHERE order_id = $1 AND kind = 'ORDER'`, orderID).Scan(
		&p.CardBrand, &p.CardLast4, &p.Wallet, &p.AmountChargedCents, &p.Currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("order %s has no payment intent: no charge to print on its receipt", orderID)
	}
	if err != nil {
		return nil, fmt.Errorf("load payment intent: %w", err)
	}
	return &p, nil
}

// receiptNumber is the receipt's number: HG-<year issued>-<the order code's
// six characters>, e.g. HG-2026-8F3K2Q. The order code is unique, so the
// receipt number is too, and it reads back to the order. The year is the
// restaurant's local year at issue, computed by Postgres, which carries the
// time-zone database the binary's image may not.
func receiptNumber(year int, orderCode string) string {
	return fmt.Sprintf("HG-%d-%s", year, strings.TrimPrefix(orderCode, "HG-"))
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
