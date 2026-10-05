package notify

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
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

// linkLike matches anything a mail client could turn into a link: a URL with
// a scheme (including scheme-only ones like javascript: and mailto:), a www.
// host, a bare domain name, or an IPv4 address.
var linkLike = regexp.MustCompile(`(?i)(?:\b[a-z][a-z0-9+.-]*://\S*|\b(?:javascript|vbscript|data|file|mailto|tel|sms):\S*|\bwww\.\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b\S*|\b\d{1,3}(?:\.\d{1,3}){3}\b\S*)`)

// Name length caps for SafeName.
const (
	maxNameRunes = 60
	maxTextRunes = 600
)

// SafeName makes a name someone else typed (a restaurant's display name, a
// rider's first name, a certifying body) safe to print in an email: control
// characters and line breaks become spaces, anything that could become a link
// is removed, runs of space collapse, and it is cut to 60 characters. An
// empty result becomes fallback. html/template escapes it on top of this.
// The point is that an email from HalalGoes never carries a link, or a line
// that reads like one, that HalalGoes did not write.
func SafeName(s, fallback string) string {
	return safeText(s, fallback, maxNameRunes)
}

func safeText(s, fallback string, max int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, s)
	s = linkLike.ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > max {
		s = strings.TrimSpace(string([]rune(s)[:max-1])) + "…"
	}
	if s == "" {
		return fallback
	}
	return s
}
