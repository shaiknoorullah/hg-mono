// Package riderview holds the rules for how much of a customer's drop-off a
// rider may see, in one place for every path that shows one: the rider's REST
// offer and assignment reads (internal/dispatch) and, once it merges, the
// realtime dispatch.offer (https://github.com/shaiknoorullah/hg-mono/pull/378).
//
// The owner decided a rider sees only the approximate area of the drop-off
// before accepting an offer, and the full address once accepted (the
// customer's address on a rider's offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
// Once the assignment is over, the rider's history goes back to street level
// (contracts/websocket.md section 5, "Per-role projection rules").
package riderview

import (
	"math"
	"regexp"
	"strings"
)

// areaDegrees rounds a coordinate to two decimals: a cell about 1.1 km
// north–south and 0.8 km east–west at Ontario's latitudes. That is a
// neighbourhood, enough for a rider to judge a trip's distance and direction,
// and many streets wide, so it does not point at a home.
func areaDegrees(f float64) float64 { return math.Round(f*100) / 100 }

// ApproximateArea is the drop-off point a rider may see when the full address
// is not theirs to see: before accepting an offer, and after the assignment is
// over. It is the delivery address's coordinates rounded to about a kilometre;
// the exact point identifies the customer's home.
func ApproximateArea(lat, lng float64) (float64, float64) {
	return areaDegrees(lat), areaDegrees(lng)
}

// civicNumber matches the number a street address starts with — "88",
// "12A", "1203-45" (a unit before the building number), "45 1/2" — and the
// space after it.
var civicNumber = regexp.MustCompile(`^\s*\d[\w-]*(\s+\d+/\d+)?(\s+|$)`)

// StreetLevel is an address line without its civic number: "88 Harbour St"
// becomes "Harbour St". A line that does not start with a number, such as a
// street with no number or a rural route, is returned unchanged. It is what a
// rider's history shows once the assignment is over.
func StreetLevel(line1 string) string {
	return strings.TrimSpace(civicNumber.ReplaceAllString(line1, ""))
}
