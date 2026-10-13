// Package riderview holds the rules for how much of a customer's drop-off a
// rider may see, in one place for every path that shows one: the rider's REST
// offer and assignment reads (internal/dispatch) and, once it merges, the
// realtime dispatch.offer (https://github.com/shaiknoorullah/hg-mono/pull/378).
//
// The rules are built from structured values only — a stored column passed
// through whole, or the drop-off's geography point — never by parsing a free-
// text or formatted value and removing parts of it. A field a rider may not
// see yet is not sent at all. Redacting a string by parsing it fails when the
// redactor and a client read it differently (a unit with a phone number in it,
// a newline in a note, lookalike digits); leaving the field out cannot.
//
// When each part is released:
//
//   - Before accepting an offer, the area only: its name and a point rounded to
//     about a kilometre, as the owner decided (the customer's address on a
//     rider's offer,
//     https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
//   - Once accepted, the full address line and the exact point, as the same
//     decision says.
//   - Once the food is picked up, also the unit, the buzzer and the customer's
//     free-text instructions and item notes, verbatim. The contract releases the
//     unit and buzzer at pickup (contracts/websocket.md section 5, "Per-role
//     projection rules"); when the owner wants them is still open
//     (https://github.com/shaiknoorullah/hg-mono/issues/183), so they wait for
//     the later point. Free text can hold anything, a phone number included,
//     and the rider needs it only at the door.
//   - Once the assignment is over, the city and the area's point only.
package riderview

import "math"

// areaDegrees rounds a coordinate to two decimals: a cell about 1.1 km
// north–south and 0.8 km east–west at Ontario's latitudes. That is a
// neighbourhood, enough for a rider to judge a trip's distance and direction,
// and many streets wide, so it does not point at a home.
func areaDegrees(f float64) float64 { return math.Round(f*100) / 100 }

// Area is a drop-off point a rider may see when the exact one is not theirs to
// see: before accepting an offer, and after the assignment is over. Its fields
// are unexported, so the only way to make one is AreaOf, which rounds: an
// exact point cannot be put in an Area by mistake.
type Area struct{ lat, lng float64 }

// AreaOf is the area around a drop-off's geography point: the point rounded
// to about a kilometre.
func AreaOf(lat, lng float64) Area { return Area{lat: areaDegrees(lat), lng: areaDegrees(lng)} }

// Lat is the area's latitude.
func (a Area) Lat() float64 { return a.lat }

// Lng is the area's longitude.
func (a Area) Lng() float64 { return a.lng }

// Stage is how far a rider has got with an order, which decides how much of
// the drop-off they may see (the package comment lists what each stage adds).
type Stage int

const (
	// Finished: the assignment is over. The city and the area's point only.
	// It is the zero value, so a stage nobody named shows the least.
	Finished Stage = iota
	// Accepted: the rider accepted and has not picked the food up. The full
	// address line and the exact point.
	Accepted
	// Carrying: the rider has the food. Also the unit, the buzzer, the
	// special instructions and the item notes.
	Carrying
)

// StageOf is the stage of an assignment in the given state. A terminated
// assignment is Finished whatever its state. The states are listed, so a state
// added to the assignment machine later is Finished until it is named here.
func StageOf(assignmentState string, terminated bool) Stage {
	if terminated {
		return Finished
	}
	switch assignmentState {
	case "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP",
		// The delivery failed and the food goes back to the restaurant: the
		// rider keeps the address, not the door details.
		"UNDELIVERABLE", "RETURNING":
		return Accepted
	case "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_AT_DROPOFF":
		return Carrying
	}
	return Finished
}
