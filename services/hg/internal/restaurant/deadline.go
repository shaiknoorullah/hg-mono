package restaurant

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// readyDeadline is the deadline and action an order takes when the kitchen
// marks it ready, read from the orders module's deadline table, the one the
// deadline runner handles (docs/spec/01-platform.md, "P-15 — Deadlines and
// timeout actions"). A value written here by hand once had no handler, and
// every ready order stopped moving
// (https://github.com/shaiknoorullah/hg-mono/issues/293).
func readyDeadline(now time.Time) (time.Time, string) {
	at, action, _ := machine.ComputeDeadline(machine.StateReadyForPickup, now, 0)
	return at, action
}
