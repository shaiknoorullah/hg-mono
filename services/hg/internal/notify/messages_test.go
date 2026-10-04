package notify

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify/emailtmpl"
)

// asStored round-trips a New through what the worker reads back: the
// notification row's data as JSON, and the job's overrides.
func asStored(t *testing.T, n New) (Notification, string) {
	t.Helper()
	raw, err := json.Marshal(withEmail(n.Data, n.Email))
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	return Notification{
		ID: uuid.New(), AccountID: n.AccountID, RoleContext: n.RoleContext, Kind: n.Kind,
		Title: n.Title, Body: n.Body, Data: data,
	}, n.Overrides[ChannelEmail].LinkToken
}

// TestEveryBuilderFillsItsTemplate: every message builder names a template
// that exists and fills every one of its slots (an unrendered {{ }} fails),
// and every exported template is used by some builder. The token of a link
// email appears in the email's link and nowhere in the inbox row.
func TestEveryBuilderFillsItsTemplate(t *testing.T) {
	when := time.Date(2026, 10, 4, 19, 42, 0, 0, time.UTC)
	acct, rest, cert := uuid.New(), uuid.New(), uuid.New()
	link := LinkEmail{AccountID: acct, Role: RoleRestaurant, To: "owner@halalgoes.test",
		Token: "TOKEN-abc123", TokenID: uuid.NewString(), ExpiresAt: when}
	must := func(n New, err error) New {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	certificate := Certificate{AccountID: acct, RestaurantID: rest, CertificateID: cert,
		RestaurantName: "Al-Noor Grill", IssuerName: "HMA Canada", ExpiresOn: time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)}
	adminLink := link
	adminLink.Role = RoleAdmin

	built := map[string]New{
		"verification": must(EmailVerification(link)),
		"reset":        must(PasswordReset(adminLink)),
		"invite": must(StaffInviteEmail(StaffInvite{LinkEmail: link, InviteeName: "Sara",
			TeamName: "Al-Noor Grill", RoleLabel: StaffRoleLabel("RESTAURANT_STAFF")})),
		"payout": must(PayoutSent(Payout{AccountID: acct, Role: RoleRider, PayeeName: "Omar", PayoutID: uuid.New(),
			AmountCents: 123456, PeriodStart: when.AddDate(0, 0, -7), PeriodEnd: when, SentAt: when})),
		"reminder": CertificateRenewalReminder(certificate, 7, 7),
		"lapsed":   CertificateLapsed(certificate),
	}
	for _, d := range []Decision{DecisionApprove, DecisionRequestChanges, DecisionReject} {
		built["restaurant "+string(d)] = must(RestaurantApplicationDecided(RestaurantApplicationDecision{
			AccountID: acct, RestaurantID: rest, RestaurantName: "Al-Noor Grill", Decision: d,
			ReasonText: "Please upload a clearer licence.", DecidedAt: when}))
		built["rider "+string(d)] = must(RiderApplicationDecided(RiderApplicationDecision{
			AccountID: acct, FirstName: "Omar", Decision: d, ReasonText: "Your licence photo is blurry.", DecidedAt: when}))
	}
	for _, suspended := range []bool{true, false} {
		built["restaurant standing "+map[bool]string{true: "suspended", false: "reinstated"}[suspended]] = must(
			RestaurantStandingChanged(RestaurantStanding{AccountID: acct, RestaurantID: rest, RestaurantName: "Al-Noor Grill",
				Suspended: suspended, ReasonText: "Repeated late cancellations.", ChangedAt: when}))
		built["rider standing "+map[bool]string{true: "suspended", false: "reinstated"}[suspended]] = must(
			RiderStandingChanged(RiderStanding{AccountID: acct, FirstName: "Omar", Suspended: suspended,
				ReasonText: "Repeated late deliveries.", ChangedAt: when}))
	}

	r := testRenderer()
	used := map[string]bool{genericTemplate: true}
	for name, n := range built {
		if n.Email == nil {
			t.Errorf("%s: no email template", name)
			continue
		}
		used[n.Email.Template] = true
		stored, token := asStored(t, n)
		out, err := r.Render(stored, token)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		for _, part := range []string{out.Subject, out.HTML, out.Text} {
			if strings.Contains(part, "{{") || strings.Contains(part, "}}") {
				t.Errorf("%s: an unfilled slot survived", name)
			}
			if strings.Contains(part, "Halal Goes") {
				t.Errorf("%s: HalalGoes is one word", name)
			}
		}
		if token != "" {
			if !strings.Contains(out.Text, "?token="+token) {
				t.Errorf("%s: the link does not carry the token", name)
			}
			row, _ := json.Marshal(stored)
			if strings.Contains(string(row), token) {
				t.Errorf("%s: the token leaked into the notification row", name)
			}
		}
	}
	if !strings.Contains(built["payout"].Body, "$1,234.56") {
		t.Errorf("payout body %q does not show $1,234.56 from 123456 cents", built["payout"].Body)
	}

	var unused []string
	for _, name := range emailtmpl.MustLoad().Names() {
		if !used[name] {
			unused = append(unused, name)
		}
	}
	sort.Strings(unused)
	if len(unused) > 0 {
		t.Errorf("templates no builder sends: %v", unused)
	}
}

// TestFormatting pins money from integer cents and the 12-hour clock
// (docs/decisions/README.md, "Time format").
func TestFormatting(t *testing.T) {
	for cents, want := range map[int64]string{0: "$0.00", 5: "$0.05", 123456: "$1,234.56", 100000000: "$1,000,000.00", -250: "-$2.50"} {
		if got := FormatCents(cents); got != want {
			t.Errorf("FormatCents(%d) = %q, want %q", cents, got, want)
		}
	}
	toronto := Zone("America/Toronto")
	at := time.Date(2026, 10, 4, 23, 42, 0, 0, time.UTC) // 7:42 pm in Toronto (EDT)
	if got := FormatDateTime(at, toronto); got != "7:42 pm on 4 Oct 2026" {
		t.Errorf("FormatDateTime = %q, want 7:42 pm on 4 Oct 2026", got)
	}
	if got := FormatClock(time.Date(2026, 1, 1, 5, 5, 0, 0, time.UTC), toronto); got != "12:05 am" {
		t.Errorf("FormatClock = %q, want 12:05 am", got)
	}
}
