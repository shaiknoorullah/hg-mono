package notify

import (
	"strconv"
	"strings"
	"time"
	// The zone database is embedded so "America/Toronto" resolves in a
	// container image that ships no /usr/share/zoneinfo.
	_ "time/tzdata"
)

// The formatters every message builder uses, so an email, an inbox row and
// the apps say the same thing the same way.

// defaultZone is where HalalGoes launches (Ontario: docs/decisions/README.md,
// launch province). A builder formats in the recipient's own zone when it
// knows it.
var defaultZone = mustZone("America/Toronto")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		// Unreachable with time/tzdata embedded; kept so a bad name cannot
		// panic at package init.
		return time.FixedZone("EST", -5*60*60)
	}
	return loc
}

// Zone returns the named IANA zone, or Ontario's when name is empty or unknown.
func Zone(name string) *time.Location {
	if name == "" {
		return defaultZone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return defaultZone
	}
	return loc
}

// FormatCents formats integer minor units as Canadian dollars: 123456 is
// "$1,234.56", -500 is "-$5.00". Money is int64 cents everywhere (AGENTS.md
// "Non-negotiable invariants" #3); no float ever touches it.
func FormatCents(cents int64) string {
	neg := cents < 0
	// Work in uint64 so the most negative int64 does not overflow.
	u := uint64(cents)
	if neg {
		u = uint64(-(cents + 1)) + 1
	}
	dollars := strconv.FormatUint(u/100, 10)
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	b.WriteByte('$')
	for i, d := range dollars {
		if i > 0 && (len(dollars)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(d)
	}
	rem := u % 100
	b.WriteByte('.')
	b.WriteByte(byte('0' + rem/10))
	b.WriteByte(byte('0' + rem%10))
	return b.String()
}

// FormatClock is the 12-hour time the apps print: "7:42 pm", "12:05 am"
// (docs/decisions/README.md, "Time format": 12-hour everywhere).
func FormatClock(t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = defaultZone
	}
	return strings.ToLower(t.In(loc).Format("3:04 PM"))
}

// FormatDate is the date the apps print: "20 Oct 2026".
func FormatDate(t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = defaultZone
	}
	return t.In(loc).Format("2 Jan 2006")
}

// FormatDateOnly formats a calendar date that has no time of day (a
// certificate's expiry date) without shifting it through a time zone.
func FormatDateOnly(d time.Time) string {
	return d.Format("2 Jan 2006")
}

// FormatDateTime is "7:42 pm on 20 Oct 2026".
func FormatDateTime(t time.Time, loc *time.Location) string {
	return FormatClock(t, loc) + " on " + FormatDate(t, loc)
}
