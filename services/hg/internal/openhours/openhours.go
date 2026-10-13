// Package openhours decides whether a restaurant can take an order now: whether
// it is inside its trading hours, from its weekly restaurant_hours and its dated
// restaurant_hours_override rows in the restaurant's own IANA timezone, and,
// together with its accepting-orders toggle, timed pause, order-screen heartbeat
// and payout block, which R-22 open state it is in
// (docs/spec/03-restaurant.md, R-22).
//
// It is the one statement of that rule. The catalog derives the customer card's
// open state from it (C-14 in docs/spec/02-customer.md;
// https://github.com/shaiknoorullah/hg-mono/issues/645), and the order path
// refuses to add a cart line, quote or place an order unless it reads OPEN
// (https://github.com/shaiknoorullah/hg-mono/issues/648). It imports no domain
// module, so both can use it.
package openhours

import (
	"sort"
	"time"
)

// StaleHeartbeat is the R-22 heartbeat gate: a restaurant whose order screen has
// not checked in for 5 minutes is CLOSED_OFFLINE.
const StaleHeartbeat = 5 * time.Minute

// RestaurantOpenState members (contract RestaurantOpenState, R-22).
const (
	StateOpen            = "OPEN"
	StatePaused          = "PAUSED"
	StateClosedHours     = "CLOSED_HOURS"
	StateClosedHoliday   = "CLOSED_HOLIDAY"
	StateClosedToggle    = "CLOSED_TOGGLE"
	StateClosedOffline   = "CLOSED_OFFLINE"
	StateClosedSuspended = "CLOSED_SUSPENDED"
)

// Slot is one restaurant_hours row as WeeklyJSON aggregates it. Day is
// 0 = Sunday, like time.Weekday; Opens and Closes are local "HH:MM".
type Slot struct {
	Day             int    `json:"day"`
	Opens           string `json:"opens"`
	Closes          string `json:"closes"`
	CrossesMidnight bool   `json:"crosses_midnight"`
}

// Override is one restaurant_hours_override row: a local date that is either
// closed or has its own hours in place of the weekly ones.
type Override struct {
	Date   string  `json:"date"`
	Closed bool    `json:"closed"`
	Opens  *string `json:"opens"`
	Closes *string `json:"closes"`
}

// Verdict is where now falls in the restaurant's hours.
type Verdict struct {
	Within bool
	// Holiday: today has a closed override and no interval holds now.
	Holiday bool
	// OpensAt is the next opening when not within, nil when none is scheduled
	// in the coming week.
	OpensAt *time.Time
	// ClosesAt is when the current run of hours ends when within, nil when the
	// restaurant stays open past the coming week.
	ClosesAt *time.Time
}

// HorizonDays is how far ahead the next opening and closing are looked for.
// OverridesJSON reads overrides for a slightly wider range of dates.
const HorizonDays = 8

// Columns reads, from a `restaurant` aliased r, what the open state is derived
// from, in the order Restaurant.ScanTargets expects: the account state, the
// toggle, the pause, the heartbeat, the open payout collection that blocks new
// orders (internal/payments/payout_run.go), then HoursColumns. The timezone is
// read by the caller.
const Columns = `
	r.account_state::text, r.is_accepting_orders, r.pause_until, r.last_heartbeat_at,
	EXISTS (SELECT 1 FROM restaurant_collection rcl
	         WHERE rcl.restaurant_id = r.id AND rcl.closed_at IS NULL) AS collection_block,` + HoursColumns

// HoursColumns reads, from a `restaurant` aliased r, the weekly hours as a JSON
// array of Slot and the overrides for the dates around today as a JSON array of
// Override (Evaluate looks one day back and HorizonDays ahead). They are
// aggregated per row, so a list of restaurants is one statement, not one per
// restaurant.
const HoursColumns = `
	COALESCE((
		SELECT json_agg(json_build_object('day', h.day_of_week,
		         'opens', to_char(h.opens_at, 'HH24:MI'), 'closes', to_char(h.closes_at, 'HH24:MI'),
		         'crosses_midnight', h.crosses_midnight))
		  FROM restaurant_hours h WHERE h.restaurant_id = r.id
	), '[]') AS weekly_hours,
	COALESCE((
		SELECT json_agg(json_build_object('date', o.on_date::text, 'closed', o.is_closed,
		         'opens', to_char(o.opens_at, 'HH24:MI'), 'closes', to_char(o.closes_at, 'HH24:MI')))
		  FROM restaurant_hours_override o
		 WHERE o.restaurant_id = r.id AND o.on_date BETWEEN current_date - 2 AND current_date + 10
	), '[]') AS hours_overrides`

// Trading is the restaurant's own switches, read straight from its row (R-22).
type Trading struct {
	AccountState      string
	IsAcceptingOrders bool
	PauseUntil        *time.Time
	LastHeartbeatAt   *time.Time
}

// Restaurant is everything Columns reads plus the timezone: enough to decide
// whether the restaurant can take an order now.
type Restaurant struct {
	Trading
	// CollectionBlock: an open payout collection blocks new orders
	// (https://github.com/shaiknoorullah/hg-mono/issues/164).
	CollectionBlock bool
	Timezone        string
	Weekly          []Slot
	Overrides       []Override
}

// ScanTargets are the scan targets for Columns, in order.
func (r *Restaurant) ScanTargets() []any {
	return []any{
		&r.AccountState, &r.IsAcceptingOrders, &r.PauseUntil, &r.LastHeartbeatAt,
		&r.CollectionBlock, &r.Weekly, &r.Overrides,
	}
}

// Derive computes the open state in the strict R-22 precedence:
//
//	CLOSED_SUSPENDED → CLOSED_OFFLINE (stale heartbeat) → CLOSED_TOGGLE →
//	PAUSED → CLOSED_HOLIDAY → CLOSED_HOURS → OPEN
//
// Trading hours and holidays are evaluated by the caller (Evaluate) and passed
// in, which keeps the precedence testable without a clock or a database.
func Derive(t Trading, now time.Time, withinHours, holidayClosed bool) string {
	switch t.AccountState {
	case "SUSPENDED", "DEACTIVATED", "BANNED":
		return StateClosedSuspended
	}
	// Heartbeat gate: a stale order screen is offered nothing, but the toggle is
	// not mutated, so service resumes the moment it reconnects.
	if t.IsAcceptingOrders && (t.LastHeartbeatAt == nil || now.Sub(*t.LastHeartbeatAt) > StaleHeartbeat) {
		return StateClosedOffline
	}
	if !t.IsAcceptingOrders {
		return StateClosedToggle
	}
	if t.PauseUntil != nil && t.PauseUntil.After(now) {
		return StatePaused
	}
	if holidayClosed {
		return StateClosedHoliday
	}
	if !withinHours {
		return StateClosedHours
	}
	return StateOpen
}

// State is the restaurant's R-22 open state at now, and where now falls in its
// hours. Only StateOpen takes an order. An open payout collection reads as the
// toggle being off: the restaurant cannot take orders until it is settled.
func (r Restaurant) State(now time.Time) (string, Verdict) {
	hv := Evaluate(r.Weekly, r.Overrides, r.Timezone, now)
	t := r.Trading
	if r.CollectionBlock {
		t.IsAcceptingOrders = false
	}
	return Derive(t, now, hv.Within, hv.Holiday), hv
}

// RestaurantAvailabilityState members the customer sees (contract
// RestaurantAvailabilityState, C-14), for the open state alone.
const (
	CustomerOpen        = "OPEN"
	CustomerClosedHours = "CLOSED_HOURS"
	CustomerPaused      = "PAUSED"
)

// CustomerState maps an open state and its hours verdict to what the customer
// sees (C-14): OPEN; PAUSED inside hours when the restaurant is not taking
// orders for a reason on its side (toggle, pause, offline screen); and
// CLOSED_HOURS outside hours, on a closed day, or when the platform has
// suspended it.
func CustomerState(state string, hv Verdict) string {
	switch {
	case state == StateOpen:
		return CustomerOpen
	case !hv.Within || hv.Holiday:
		return CustomerClosedHours
	case state == StatePaused, state == StateClosedToggle, state == StateClosedOffline:
		return CustomerPaused
	default:
		return CustomerClosedHours
	}
}

type span struct{ start, end time.Time }

// Evaluate places now in the restaurant's hours. An interval whose close is not
// after its open crosses midnight, so 18:00–02:00 runs into the next day and
// 00:00–00:00 is a full 24 hours (C-14, rule 1). An override replaces that
// date's weekly intervals. An unknown timezone fails closed: never within.
func Evaluate(weekly []Slot, overrides []Override, timezone string, now time.Time) Verdict {
	loc, err := time.LoadLocation(timezone)
	if timezone == "" || err != nil {
		return Verdict{}
	}
	local := now.In(loc)
	y, m, d := local.Date()
	byDate := make(map[string]Override, len(overrides))
	for _, o := range overrides {
		byDate[o.Date] = o
	}

	var spans []span
	for off := -1; off <= HorizonDays; off++ {
		day := time.Date(y, m, d+off, 0, 0, 0, 0, loc)
		if o, ok := byDate[day.Format(time.DateOnly)]; ok {
			if !o.Closed && o.Opens != nil && o.Closes != nil {
				spans = appendSpan(spans, day, *o.Opens, *o.Closes, false, loc)
			}
			continue
		}
		for _, s := range weekly {
			if s.Day == int(day.Weekday()) {
				spans = appendSpan(spans, day, s.Opens, s.Closes, s.CrossesMidnight, loc)
			}
		}
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start.Before(spans[j].start) })

	var v Verdict
	horizon := time.Date(y, m, d+HorizonDays, 0, 0, 0, 0, loc)
	for i, s := range spans {
		if s.start.After(now) {
			if !v.Within && v.OpensAt == nil {
				t := s.start
				v.OpensAt = &t
			}
			continue
		}
		if !now.Before(s.end) || v.Within {
			continue
		}
		// Inside this interval: it closes when the run of touching or
		// overlapping intervals that follows it ends.
		v.Within = true
		end := s.end
		for _, next := range spans[i+1:] {
			if next.start.After(end) {
				break
			}
			if next.end.After(end) {
				end = next.end
			}
		}
		if end.Before(horizon) {
			v.ClosesAt = &end
		}
	}
	if o, ok := byDate[local.Format(time.DateOnly)]; ok && o.Closed && !v.Within {
		v.Holiday = true
	}
	return v
}

// appendSpan adds one interval starting on day, if its times parse.
func appendSpan(spans []span, day time.Time, opens, closes string, crossesMidnight bool, loc *time.Location) []span {
	oh, om, ok1 := parseClock(opens)
	ch, cm, ok2 := parseClock(closes)
	if !ok1 || !ok2 {
		return spans
	}
	y, m, d := day.Date()
	start := time.Date(y, m, d, oh, om, 0, 0, loc)
	end := time.Date(y, m, d, ch, cm, 0, 0, loc)
	if crossesMidnight || !end.After(start) {
		end = time.Date(y, m, d+1, ch, cm, 0, 0, loc)
	}
	return append(spans, span{start, end})
}

// parseClock reads "HH:MM" (to_char's HH24:MI).
func parseClock(s string) (h, m int, ok bool) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0, false
	}
	return t.Hour(), t.Minute(), true
}
