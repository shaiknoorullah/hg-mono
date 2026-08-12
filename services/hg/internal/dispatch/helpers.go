package dispatch

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// tsMillis renders a time as the contract Timestamp scalar (RFC3339 millis, UTC).
func tsMillis(t time.Time) string { return httpx.Timestamp(t) }

// tsPtr renders a nullable time as a *string, nil for a zero/absent time.
func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := httpx.Timestamp(*t)
	return &s
}

// buildEarnings computes the offer earnings estimate under the launch model
// (decisions S-03 / R-02): the rider's earnings are the delivery fee as a pure
// pass-through (base) plus 100% of the tip so far. No per-km rate card, no floor,
// no surge at launch. Money is int64 cents; there are no floats anywhere.
func buildEarnings(deliveryFeeCents, tipCents int64) OfferEarnings {
	if deliveryFeeCents < 0 {
		deliveryFeeCents = 0
	}
	if tipCents < 0 {
		tipCents = 0
	}
	return OfferEarnings{
		BaseCents:           deliveryFeeCents,
		DistanceCents:       0,
		SurgeCents:          0,
		TipSoFarCents:       tipCents,
		EstimatedTotalCents: deliveryFeeCents + tipCents,
		Currency:            "CAD",
	}
}
