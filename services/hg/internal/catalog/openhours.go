package catalog

// openhours.go decides whether a restaurant is inside its trading hours, from
// its weekly restaurant_hours and its dated restaurant_hours_override rows, in
// the restaurant's own IANA timezone. The customer card's open state (C-14 in
// docs/spec/02-customer.md) is derived from it together with the toggle, the
// pause and the heartbeat (deriveOpenState).
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/645

import (
	"sort"
	"time"
)

// weeklySlot is one restaurant_hours row as the card query aggregates it.
// day is 0 = Sunday, like time.Weekday; opens and closes are local "HH:MM".
type weeklySlot struct {
	Day             int    `json:"day"`
	Opens           string `json:"opens"`
	Closes          string `json:"closes"`
	CrossesMidnight bool   `json:"crosses_midnight"`
}

// hoursOverride is one restaurant_hours_override row: a local date that is
// either closed or has its own hours in place of the weekly ones.
type hoursOverride struct {
	Date   string  `json:"date"`
	Closed bool    `json:"closed"`
	Opens  *string `json:"opens"`
	Closes *string `json:"closes"`
}

// hoursVerdict is where now falls in the restaurant's hours.
type hoursVerdict struct {
	within bool
	// holiday: today has a closed override and no interval holds now.
	holiday bool
	// opensAt is the next opening when not within, nil when none is scheduled
	// in the coming week.
	opensAt *time.Time
	// closesAt is when the current run of hours ends when within, nil when the
	// restaurant stays open past the coming week.
	closesAt *time.Time
}

// hoursHorizonDays is how far ahead the next opening and closing are looked
// for. The card query reads overrides for a slightly wider range of dates.
const hoursHorizonDays = 8

type span struct{ start, end time.Time }

// evaluateHours places now in the restaurant's hours. An interval whose close is
// not after its open crosses midnight, so 18:00–02:00 runs into the next day
// and 00:00–00:00 is a full 24 hours (C-14, rule 1). An override replaces that
// date's weekly intervals. An unknown timezone fails closed: never within.
func evaluateHours(weekly []weeklySlot, overrides []hoursOverride, timezone string, now time.Time) hoursVerdict {
	loc, err := time.LoadLocation(timezone)
	if timezone == "" || err != nil {
		return hoursVerdict{}
	}
	local := now.In(loc)
	y, m, d := local.Date()
	byDate := make(map[string]hoursOverride, len(overrides))
	for _, o := range overrides {
		byDate[o.Date] = o
	}

	var spans []span
	for off := -1; off <= hoursHorizonDays; off++ {
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

	var v hoursVerdict
	horizon := time.Date(y, m, d+hoursHorizonDays, 0, 0, 0, 0, loc)
	for i, s := range spans {
		if s.start.After(now) {
			if !v.within && v.opensAt == nil {
				t := s.start
				v.opensAt = &t
			}
			continue
		}
		if !now.Before(s.end) || v.within {
			continue
		}
		// Inside this interval: it closes when the run of touching or
		// overlapping intervals that follows it ends.
		v.within = true
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
			v.closesAt = &end
		}
	}
	if o, ok := byDate[local.Format(time.DateOnly)]; ok && o.Closed && !v.within {
		v.holiday = true
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

// cardOpenState is the open state behind a customer card. Outside its hours, or
// on a closed day, a restaurant is closed whatever its toggle, pause or
// heartbeat say, because the card's PAUSED means "inside hours but not taking
// orders" (C-14). Inside its hours the R-22 precedence applies as it does for
// the restaurant itself. collectionBlock is the payout block that quoting also
// refuses on (orders/quote_store.go), so the card never reads open when quoting
// would refuse for that reason.
func cardOpenState(a availabilityRow, collectionBlock bool, hv hoursVerdict, now time.Time) openStateVerdict {
	if collectionBlock {
		a.isAcceptingOrders = false
	}
	if a.accountState == "LIVE" && (!hv.within || hv.holiday) {
		a.isAcceptingOrders, a.pauseUntil, a.lastHeartbeatAt = true, nil, &now
	}
	return deriveOpenState(a, now, hv.within, hv.holiday)
}
