package payments

// The double-entry ledger, in Go. Every posting is balanced: a batch's entries
// sum to exactly zero, enforced independently by the deferred trigger in
// migration 00017. These builders exist so the Go side never even *attempts* an
// unbalanced batch — the trigger is the backstop, not the first line of defence.
//
// Sign convention (matches migration 00017's views):
//   * CUSTOMER_CHARGES is negative for money the customer owes us (a debit to
//     the customer). ledger_charge_identity_breach checks
//     -SUM(CUSTOMER_CHARGES) == captured - refunded.
//   * A party's payable (RESTAURANT_PAYABLE, RIDER_PAYABLE) is positive for
//     money we owe them.
//   * PSP_CLEARING is positive for money sitting at the PSP in our favour.

// LedgerAccount mirrors the ledger_account enum.
type LedgerAccount string

const (
	AcctCustomerCharges   LedgerAccount = "CUSTOMER_CHARGES"
	AcctPSPClearing       LedgerAccount = "PSP_CLEARING"
	AcctPSPFees           LedgerAccount = "PSP_FEES"
	AcctRestaurantPayable LedgerAccount = "RESTAURANT_PAYABLE"
	AcctRiderPayable      LedgerAccount = "RIDER_PAYABLE"
	AcctPlatformRevenue   LedgerAccount = "PLATFORM_REVENUE"
	AcctTaxPayable        LedgerAccount = "TAX_PAYABLE"
	AcctPromoExpense      LedgerAccount = "PROMO_EXPENSE"
	AcctRefunds           LedgerAccount = "REFUNDS"
	AcctPlatformAbsorbed  LedgerAccount = "PLATFORM_ABSORBED"
)

// LedgerComponent mirrors the ledger_component enum.
type LedgerComponent string

const (
	CompSubtotal    LedgerComponent = "SUBTOTAL"
	CompCommission  LedgerComponent = "COMMISSION"
	CompDeliveryFee LedgerComponent = "DELIVERY_FEE"
	CompServiceFee  LedgerComponent = "SERVICE_FEE"
	CompTax         LedgerComponent = "TAX"
	CompTip         LedgerComponent = "TIP"
	CompDiscount    LedgerComponent = "DISCOUNT"
	CompPSPFee      LedgerComponent = "PSP_FEE"
	CompRefund      LedgerComponent = "REFUND"
)

// LedgerBatchKind mirrors the ledger_batch_kind enum.
type LedgerBatchKind string

const (
	BatchCapture    LedgerBatchKind = "CAPTURE"
	BatchSettle     LedgerBatchKind = "SETTLE"
	BatchRefund     LedgerBatchKind = "REFUND"
	BatchPayout     LedgerBatchKind = "PAYOUT"
	BatchAdjustment LedgerBatchKind = "ADJUSTMENT"
	BatchPSPFee     LedgerBatchKind = "PSP_FEE"
)

// CounterpartyType mirrors ledger_counterparty_type.
type CounterpartyType string

const (
	CPRestaurant CounterpartyType = "RESTAURANT"
	CPRider      CounterpartyType = "RIDER"
	CPCustomer   CounterpartyType = "CUSTOMER"
	CPPlatform   CounterpartyType = "PLATFORM"
	CPCRA        CounterpartyType = "CRA"
)

// LedgerEntry is one posting within a batch. amount_cents is signed and the
// batch's entries sum to zero.
type LedgerEntry struct {
	Account          LedgerAccount
	CounterpartyType CounterpartyType
	CounterpartyID   string // uuid; "" when not party-scoped
	AmountCents      int64
	Component        LedgerComponent
	Memo             string
}

// LedgerBatch is a balanced set of entries plus its metadata.
type LedgerBatch struct {
	Kind           LedgerBatchKind
	OrderID        string
	RefundID       string
	PayoutID       string
	IdempotencyKey string
	PostedBy       string
	Memo           string
	Entries        []LedgerEntry
}

// Residual returns the signed sum of a batch's entries. A balanced batch has a
// residual of zero; the deferred trigger rejects any other value at COMMIT.
func (b LedgerBatch) Residual() int64 {
	var r int64
	for _, e := range b.Entries {
		r += e.AmountCents
	}
	return r
}

// Balanced reports whether the batch sums to zero and has at least two entries,
// matching the trigger's own rule.
func (b LedgerBatch) Balanced() bool {
	return len(b.Entries) >= 2 && b.Residual() == 0
}

// OrderMoney is the decomposed money of an order, from the "order" row.
type OrderMoney struct {
	OrderID            string
	RestaurantID       string
	RiderID            string // "" if not yet assigned
	SubtotalCents      int64
	DiscountCents      int64
	DeliveryFeeCents   int64
	ServiceFeeCents    int64
	TaxTotalCents      int64
	TipCents           int64
	TotalCents         int64
	CommissionCents    int64
	RestaurantNetCents int64
	RiderEarningsCents int64
	PlatformGrossCents int64
}

// BuildCaptureBatch decomposes a captured charge into a balanced batch (P-13).
//
// The customer's total is charged (CUSTOMER_CHARGES debit); the same total lands
// at the PSP (PSP_CLEARING credit) and is then decomposed across the restaurant
// payable, rider payable, platform revenue and tax payable. At launch commission
// is 0% (S-01), the delivery fee is a 100% rider pass-through (S-03) and the
// service fee is zero, but the arithmetic is general.
//
// The batch balances by construction:
//
//	-total (CUSTOMER_CHARGES) + total (PSP_CLEARING)               = 0   (customer→psp)
//	-total (PSP_CLEARING) + restaurantNet + riderEarnings
//	                       + platformGross + tax                    = 0   (psp→parties)
func BuildCaptureBatch(m OrderMoney, idempotencyKey, postedBy string) LedgerBatch {
	b := LedgerBatch{
		Kind:           BatchCapture,
		OrderID:        m.OrderID,
		IdempotencyKey: idempotencyKey,
		PostedBy:       postedBy,
		Memo:           "capture",
	}

	// Leg 1: the customer is charged; the money is now at the PSP.
	b.Entries = append(b.Entries,
		LedgerEntry{Account: AcctCustomerCharges, CounterpartyType: CPCustomer, AmountCents: -m.TotalCents, Component: CompSubtotal, Memo: "customer charge"},
		LedgerEntry{Account: AcctPSPClearing, AmountCents: m.TotalCents, Component: CompSubtotal, Memo: "psp clearing"},
	)

	// Leg 2: the PSP balance is decomposed to the four parties.
	b.Entries = append(b.Entries,
		LedgerEntry{Account: AcctPSPClearing, AmountCents: -m.TotalCents, Component: CompSubtotal, Memo: "psp decomposition"},
	)
	if m.RestaurantNetCents != 0 {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctRestaurantPayable, CounterpartyType: CPRestaurant, CounterpartyID: m.RestaurantID,
			AmountCents: m.RestaurantNetCents, Component: CompSubtotal, Memo: "restaurant net",
		})
	}
	if m.RiderEarningsCents != 0 && m.RiderID != "" {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: m.RiderID,
			AmountCents: m.RiderEarningsCents, Component: CompDeliveryFee, Memo: "rider delivery earnings",
		})
	}
	if m.TipCents != 0 && m.RiderID != "" {
		// I-13.5 — the tip passes through to the rider in full.
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: m.RiderID,
			AmountCents: m.TipCents, Component: CompTip, Memo: "tip pass-through",
		})
	}
	if m.TaxTotalCents != 0 {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctTaxPayable, CounterpartyType: CPCRA,
			AmountCents: m.TaxTotalCents, Component: CompTax, Memo: "tax collected",
		})
	}
	// Platform revenue is the residual of the decomposition so the leg is exactly
	// zero even when the four named lines do not themselves sum to the total.
	// At launch (0% commission, $0 service fee, delivery→rider, tip→rider) this
	// equals platform_gross_cents, which is negative — the accepted −$1.30/order.
	platform := m.TotalCents - m.RestaurantNetCents - riderShare(m) - m.TaxTotalCents
	if platform != 0 {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctPlatformRevenue, CounterpartyType: CPPlatform,
			AmountCents: platform, Component: CompCommission, Memo: "platform revenue (residual)",
		})
	}
	return b
}

func riderShare(m OrderMoney) int64 {
	if m.RiderID == "" {
		return 0
	}
	return m.RiderEarningsCents + m.TipCents
}

// BuildRefundBatch posts a refund against the ledger (P-18 / I-18.2).
//
// The customer is credited back `amount` (CUSTOMER_CHARGES moves toward zero),
// and the same money is clawed back from the parties per the liability split:
// the restaurant's payable drops by its chargeback, the rider's by theirs, and
// the platform absorbs the remainder. The batch balances by construction.
func BuildRefundBatch(m OrderMoney, split LiabilitySplit, amountCents int64, idempotencyKey, postedBy string) LedgerBatch {
	b := LedgerBatch{
		Kind:           BatchRefund,
		OrderID:        m.OrderID,
		RefundID:       split.RefundID,
		IdempotencyKey: idempotencyKey,
		PostedBy:       postedBy,
		Memo:           "refund",
	}
	// Money leaves the platform back to the customer: CUSTOMER_CHARGES rises
	// (toward zero / positive) by the refunded amount, offset by REFUNDS.
	b.Entries = append(b.Entries,
		LedgerEntry{Account: AcctCustomerCharges, CounterpartyType: CPCustomer, AmountCents: amountCents, Component: CompRefund, Memo: "customer refunded"},
		LedgerEntry{Account: AcctRefunds, AmountCents: -amountCents, Component: CompRefund, Memo: "refund outflow"},
	)
	// The REFUNDS outflow is funded by the bearing parties.
	if split.RestaurantChargebackCents != 0 {
		b.Entries = append(b.Entries,
			LedgerEntry{Account: AcctRefunds, AmountCents: split.RestaurantChargebackCents, Component: CompRefund, Memo: "restaurant funds refund"},
			LedgerEntry{Account: AcctRestaurantPayable, CounterpartyType: CPRestaurant, CounterpartyID: m.RestaurantID, AmountCents: -split.RestaurantChargebackCents, Component: CompRefund, Memo: "restaurant chargeback"},
		)
	}
	if split.RiderChargebackCents != 0 && m.RiderID != "" {
		b.Entries = append(b.Entries,
			LedgerEntry{Account: AcctRefunds, AmountCents: split.RiderChargebackCents, Component: CompRefund, Memo: "rider funds refund"},
			LedgerEntry{Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: m.RiderID, AmountCents: -split.RiderChargebackCents, Component: CompRefund, Memo: "rider chargeback"},
		)
	}
	if split.PlatformAbsorbedCents != 0 {
		b.Entries = append(b.Entries,
			LedgerEntry{Account: AcctRefunds, AmountCents: split.PlatformAbsorbedCents, Component: CompRefund, Memo: "platform absorbs refund"},
			LedgerEntry{Account: AcctPlatformAbsorbed, CounterpartyType: CPPlatform, AmountCents: -split.PlatformAbsorbedCents, Component: CompRefund, Memo: "platform absorbed"},
		)
	}
	return b
}
