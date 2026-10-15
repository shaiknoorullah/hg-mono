package accountstate

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestStateMachine pins, for every subject and every state, which actions are
// legal (and where each leads) and which are refused, with and without a pending
// ban proposal. Any change to the table is a visible diff here. The specs:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist
// and the rider and customer sections after it.
func TestStateMachine(t *testing.T) {
	type want map[Action]string // action -> destination; anything absent is refused
	cases := []struct {
		subject  Subject
		from     string
		proposed bool
		want     want
	}{
		// Restaurants.
		{Restaurant, StatePending, false, want{}},
		{Restaurant, StateLive, false, want{Suspend: StateSuspended, Delist: StateDelisted, ProposeBan: StateSuspended, Deactivate: StateDeactivated}},
		{Restaurant, StateDelisted, false, want{Suspend: StateSuspended, ProposeBan: StateSuspended, Deactivate: StateDeactivated, Reinstate: StateLive}},
		{Restaurant, StateSuspended, false, want{ProposeBan: StateSuspended, Reinstate: StateLive}},
		{Restaurant, StateSuspended, true, want{ConfirmBan: StateBanned, Reinstate: StateLive}},
		{Restaurant, StateDeactivated, false, want{Reinstate: StateLive}},
		{Restaurant, StateBanned, false, want{Reinstate: StateLive}},
		{Restaurant, StateClosed, false, want{}},
		// Riders.
		{Rider, StatePending, false, want{}},
		{Rider, StateActive, false, want{Suspend: StateSuspended, ProposeBan: StateSuspended, Deactivate: StateDeactivated}},
		{Rider, StateSuspended, false, want{ProposeBan: StateSuspended, Deactivate: StateDeactivated, Reinstate: StateActive}},
		{Rider, StateSuspended, true, want{ConfirmBan: StateBanned, Deactivate: StateDeactivated, Reinstate: StateActive}},
		{Rider, StateDeactivated, false, want{Reinstate: StateActive}},
		{Rider, StateBanned, false, want{Reinstate: StateActive}},
		// Customers.
		{Customer, StateActive, false, want{Suspend: StateSuspended, ProposeBan: StateSuspended}},
		{Customer, StateSuspended, false, want{ProposeBan: StateSuspended, Reinstate: StateActive}},
		{Customer, StateSuspended, true, want{ConfirmBan: StateBanned, Reinstate: StateActive}},
		{Customer, StateBanned, false, want{Reinstate: StateActive}},
		{Customer, StateDeleted, false, want{}},
	}
	for _, c := range cases {
		for _, a := range allActions {
			d, err := Decide(Request{Subject: c.subject, From: c.from, Action: a, BanProposed: c.proposed})
			to, legal := c.want[a]
			name := string(c.subject) + " " + c.from + " " + string(a)
			if c.proposed {
				name += " (ban proposed)"
			}
			switch {
			case legal && err != nil:
				t.Errorf("%s: refused (%v), want it to lead to %s", name, err, to)
			case legal && d.To != to:
				t.Errorf("%s: leads to %s, want %s", name, d.To, to)
			case !legal && err == nil:
				t.Errorf("%s: allowed (to %s), want it refused", name, d.To)
			case !legal:
				var ite *IllegalTransitionError
				if !errors.As(err, &ite) {
					t.Errorf("%s: error %T, want *IllegalTransitionError", name, err)
					continue
				}
				var allowed []Action
				for _, x := range allActions {
					if _, ok := c.want[x]; ok {
						allowed = append(allowed, x)
					}
				}
				if allowed == nil {
					allowed = []Action{}
				}
				if !reflect.DeepEqual(ite.Allowed, allowed) {
					t.Errorf("%s: allowed actions reported %v, want %v", name, ite.Allowed, allowed)
				}
			}
		}
	}
}

// TestOnlyASuperAdminBansOrUnbans pins the two-person rule's role half: confirming
// a ban, and reinstating a banned account, are super admin actions, and the 403
// names the permission.
func TestOnlyASuperAdminBansOrUnbans(t *testing.T) {
	for _, s := range []Subject{Restaurant, Rider, Customer} {
		d, err := Decide(Request{Subject: s, From: StateSuspended, Action: ConfirmBan, BanProposed: true})
		if err != nil || !d.SuperAdminOnly || !strings.HasSuffix(d.Permission, ".confirm_ban") {
			t.Errorf("%s confirm ban: %+v, %v; want super admin only, permission *.confirm_ban", s, d, err)
		}
		d, err = Decide(Request{Subject: s, From: StateBanned, Action: Reinstate})
		if err != nil || !d.SuperAdminOnly || !strings.HasSuffix(d.Permission, ".unban") {
			t.Errorf("%s reinstate from banned: %+v, %v; want super admin only, permission *.unban", s, d, err)
		}
		d, err = Decide(Request{Subject: s, From: StateSuspended, Action: Reinstate})
		if err != nil || d.SuperAdminOnly {
			t.Errorf("%s reinstate from suspended: %+v, %v; want any admin", s, d, err)
		}
	}
	if !BanPending(time.Unix(0, 0), time.Unix(0, 0).Add(BanProposalWindow-time.Second)) ||
		BanPending(time.Unix(0, 0), time.Unix(0, 0).Add(BanProposalWindow)) {
		t.Error("a ban proposal must wait exactly 7 days, then lapse")
	}
}

// TestReinstatingNeedsACurrentCertificate pins the certificate rule a restaurant
// must pass to go LIVE, which is the order path's rule
// (https://github.com/shaiknoorullah/hg-mono/pull/298): valid through its last
// local day, amber from 30 days out, expired the day after; no verified
// certificate is never current.
func TestReinstatingNeedsACurrentCertificate(t *testing.T) {
	day := func(s string) time.Time { d, _ := time.Parse("2006-01-02", s); return d }
	today := day("2026-10-04")
	grace := day("2026-10-06")
	cases := []struct {
		cert HalalCertificate
		want string
	}{
		{HalalCertificate{}, "UNVERIFIED"},
		{HalalCertificate{Status: "APPROVED", ExpiresOn: day("2026-11-04")}, "CERTIFIED"},
		{HalalCertificate{Status: "APPROVED", ExpiresOn: day("2026-11-03")}, "EXPIRING_SOON"},
		{HalalCertificate{Status: "APPROVED", ExpiresOn: day("2026-10-04")}, "EXPIRING_SOON"},
		{HalalCertificate{Status: "APPROVED", ExpiresOn: day("2026-10-03")}, "EXPIRED"},
		{HalalCertificate{Status: "APPROVED", ExpiresOn: day("2026-10-03"), GraceUntil: &grace}, "EXPIRING_SOON"},
		{HalalCertificate{Status: "EXPIRED", ExpiresOn: day("2027-10-03")}, "EXPIRED"},
	}
	for _, c := range cases {
		if got := CertificationState(c.cert, today); got != c.want {
			t.Errorf("CertificationState(%+v) = %s, want %s", c.cert, got, c.want)
		}
	}

	// Toronto's date, not the server's: 03:30 UTC on 4 Oct is still 3 Oct there.
	at := time.Date(2026, 10, 4, 3, 30, 0, 0, time.UTC)
	if got := LocalDate("America/Toronto", at); !got.Equal(day("2026-10-03")) {
		t.Errorf("LocalDate Toronto = %s, want 2026-10-03", got)
	}
	if got := LocalDate("Not/AZone", at); !got.Equal(day("2026-10-04")) {
		t.Errorf("LocalDate unknown zone = %s, want the latest date anywhere, 2026-10-04", got)
	}

	for _, c := range []struct {
		cert    string
		reasons []string
		to      string
		keeps   []string
	}{
		{"CERTIFIED", nil, StateLive, []string{}},
		{"EXPIRING_SOON", []string{"HALAL_CERTIFICATE_EXPIRED"}, StateLive, []string{}},
		{"CERTIFIED", []string{"DOCUMENT_EXPIRED"}, StateDelisted, []string{"DOCUMENT_EXPIRED"}},
		{"EXPIRED", nil, StateDelisted, []string{"HALAL_CERTIFICATE_EXPIRED"}},
		{"UNVERIFIED", nil, StateDelisted, []string{"HALAL_CERTIFICATE_UNVERIFIED"}},
	} {
		to, keeps := ReinstatedState(c.cert, c.reasons)
		if to != c.to || !reflect.DeepEqual(keeps, c.keeps) {
			t.Errorf("ReinstatedState(%s, %v) = %s %v, want %s %v", c.cert, c.reasons, to, keeps, c.to, c.keeps)
		}
	}
}

// TestInFlightOrders pins what each action does to orders already in progress
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change).
func TestInFlightOrders(t *testing.T) {
	cases := []struct {
		action Action
		reason string
		state  string
		want   OrderOutcome
	}{
		{Suspend, "COMPLIANCE_THRESHOLD", "RESTAURANT_PENDING", CancelRelease},
		{Suspend, "COMPLIANCE_THRESHOLD", "AUTHORIZED", CancelRelease},
		{Suspend, "COMPLIANCE_THRESHOLD", "PREPARING", Continue},
		{Suspend, "HALAL_INTEGRITY", "PREPARING", CancelRefund},
		{ProposeBan, "FOOD_SAFETY_RISK", "PREPARING", CancelRefund},
		{Suspend, "HALAL_INTEGRITY", "PICKED_UP", Continue},
		{Delist, "NO_APPROVED_MENU", "RESTAURANT_PENDING", CancelRelease},
		{Delist, "NO_APPROVED_MENU", "PREPARING", Continue},
		{ConfirmBan, "FRAUD_SUSPECTED", "PREPARING", CancelRefund},
		{ConfirmBan, "FRAUD_SUSPECTED", "READY_FOR_PICKUP", Continue},
		{Deactivate, "MERCHANT_REQUEST", "CREATED", CancelRelease},
		{Reinstate, "ISSUE_RESOLVED", "RESTAURANT_PENDING", Continue},
		{Suspend, "COMPLIANCE_THRESHOLD", "COMPLETED", Continue},
	}
	for _, c := range cases {
		if got := RestaurantOrderOutcome(c.action, c.reason, c.state); got != c.want {
			t.Errorf("restaurant %s (%s) on %s = %s, want %s", c.action, c.reason, c.state, got, c.want)
		}
	}
	if CustomerOrderOutcome(Suspend, "RESTAURANT_PENDING") != CancelRelease ||
		CustomerOrderOutcome(Suspend, "PREPARING") != Continue {
		t.Error("a customer's unaccepted orders are cancelled; accepted ones finish")
	}
	if !CustomerBanBlockedBy("PREPARING") || CustomerBanBlockedBy("RESTAURANT_PENDING") || CustomerBanBlockedBy("COMPLETED") {
		t.Error("only an accepted order in progress stops a customer's ban")
	}
	if !MenuLocked(StateSuspended) || !MenuLocked(StateBanned) || MenuLocked(StateDelisted) || MenuLocked(StateLive) {
		t.Error("the menu is locked when suspended or banned, never when delisted")
	}
	if RefundReasonFor("HALAL_INTEGRITY") != "HALAL_INTEGRITY" || RefundReasonFor("FRAUD_SUSPECTED") != "PLATFORM_INITIATED_CANCELLATION" {
		t.Error("halal-integrity refunds are charged to the restaurant; others to the platform")
	}
}

// TestReasons pins which reasons fit which action.
func TestReasons(t *testing.T) {
	ok := []struct {
		s Subject
		a Action
		r string
	}{
		{Restaurant, Suspend, "HALAL_INTEGRITY"}, {Restaurant, Delist, "NO_APPROVED_MENU"},
		{Restaurant, Deactivate, "MERCHANT_REQUEST"}, {Restaurant, Reinstate, "ISSUE_RESOLVED"},
		{Rider, Suspend, "SAFETY_RISK"}, {Rider, Deactivate, "RIDER_REQUEST"},
		{Customer, ProposeBan, "REFUND_ABUSE"}, {Customer, Reinstate, "APPEAL_UPHELD"},
	}
	for _, c := range ok {
		if !ReasonAllowed(c.s, c.a, c.r) {
			t.Errorf("%s %s %s refused, want allowed", c.s, c.a, c.r)
		}
	}
	bad := []struct {
		s Subject
		a Action
		r string
	}{
		{Restaurant, Delist, "FRAUD_SUSPECTED"}, {Restaurant, Deactivate, "OTHER"},
		{Restaurant, Suspend, "MERCHANT_REQUEST"}, {Rider, Suspend, "RIDER_REQUEST"},
		{Rider, Delist, "OTHER"}, {Customer, Deactivate, "OTHER"}, {Customer, Suspend, "SAFETY_RISK"},
	}
	for _, c := range bad {
		if ReasonAllowed(c.s, c.a, c.r) {
			t.Errorf("%s %s %s allowed, want refused", c.s, c.a, c.r)
		}
	}
}
