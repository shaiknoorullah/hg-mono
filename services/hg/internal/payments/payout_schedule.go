package payments

import (
	"time"
	// The weekly payout calendar is Toronto time. Embedding the zone database
	// keeps it right in the distroless runtime image, whatever that image ships.
	_ "time/tzdata"
)

// The payout calendar (issue #251).
//
// Payouts are weekly, every Monday, automatic, with no minimum (decision log,
// "Settled — client decisions", payout cadence; docs/spec/01-platform.md,
// "P-19 — Stripe Connect: onboarding and payouts (Canada)"). The rider spec
// fixes the hour and the window (docs/spec/04-rider.md, "D-28 — Payouts" and
// the payout.schedule setting): the job runs Monday 09:00 America/Toronto and
// pays the week Monday 00:00 to Sunday 23:59:59 local. Restaurants share the
// same run.
//
// Every boundary is computed in America/Toronto with time.Date, so the week
// that contains a daylight-saving change is 167 or 169 hours long rather than
// a drifting 168.

// payoutZone is the calendar every payout boundary is computed in.
var payoutZone = mustLoadZone("America/Toronto")

// payoutRunHour is the local hour of the Monday run.
const payoutRunHour = 9

func mustLoadZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic("payments: load " + name + ": " + err.Error())
	}
	return loc
}

// PayoutPeriod is one payout week, [Start, End). End is the cutoff: earnings
// created before it are due in this period's payout.
type PayoutPeriod struct {
	Start time.Time
	End   time.Time
}

// closedPeriodAt returns the latest period that has closed by at: it ends at
// the most recent Monday 00:00 Toronto at or before at.
func closedPeriodAt(at time.Time) PayoutPeriod {
	local := at.In(payoutZone)
	back := (int(local.Weekday()) - int(time.Monday) + 7) % 7
	end := time.Date(local.Year(), local.Month(), local.Day()-back, 0, 0, 0, 0, payoutZone)
	start := time.Date(end.Year(), end.Month(), end.Day()-7, 0, 0, 0, 0, payoutZone)
	return PayoutPeriod{Start: start, End: end}
}

// scheduledRunAt is when the automatic run for the period that ends at end is
// due: that Monday at 09:00 Toronto.
func scheduledRunAt(end time.Time) time.Time {
	local := end.In(payoutZone)
	return time.Date(local.Year(), local.Month(), local.Day(), payoutRunHour, 0, 0, 0, payoutZone)
}

// nextScheduledRun is the first automatic run strictly after at.
func nextScheduledRun(at time.Time) time.Time {
	p := closedPeriodAt(at)
	if due := scheduledRunAt(p.End); due.After(at) {
		return due
	}
	next := p.End.In(payoutZone)
	return scheduledRunAt(time.Date(next.Year(), next.Month(), next.Day()+7, 0, 0, 0, 0, payoutZone))
}
