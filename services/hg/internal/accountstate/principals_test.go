package accountstate

import (
	"reflect"
	"strings"
	"testing"
)

// TestSystemPrincipalsTakeOnlyTheirOwnTransitions pins what each system
// principal may record: the expiry only delists a LIVE restaurant for a lapsed
// certificate, the renewal only lists a DELISTED one again, and a certifying
// body's withdrawal or acceptance only delists or lists again. None of them may
// suspend, ban, deactivate, lift a penalty, or touch a rider or a customer.
// (Onboarding records no history row; internal/admin's
// TestCompletingOnboardingIsTheOnboardingPrincipal pins it.)
func TestSystemPrincipalsTakeOnlyTheirOwnTransitions(t *testing.T) {
	var system []Transition
	for _, tr := range Transitions() {
		if strings.HasPrefix(string(tr.Principal), "SYSTEM:") {
			system = append(system, tr)
		}
	}
	want := []Transition{
		{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
			Principal: "SYSTEM:HALAL_EXPIRY", Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
		{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
			Principal: "SYSTEM:HALAL_RENEWAL", Permission: "restaurant.relisted", ReasonCode: "ISSUE_RESOLVED"},
		{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
			Principal: "SYSTEM:HALAL_ISSUER", Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_UNVERIFIED"},
		{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
			Principal: "SYSTEM:HALAL_ISSUER", Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
		{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
			Principal: "SYSTEM:HALAL_ISSUER", Permission: "restaurant.relisted", ReasonCode: "ISSUE_RESOLVED"},
	}
	if !reflect.DeepEqual(system, want) {
		t.Fatalf("system transitions:\n got %+v\nwant %+v", system, want)
	}
	for _, tr := range system {
		if tr.To == StateSuspended || tr.To == StateBanned || tr.To == StateDeactivated {
			t.Errorf("%s may take a punitive or voluntary transition: %+v", tr.Principal, tr)
		}
		if tr.From == StateSuspended || tr.From == StateBanned || tr.From == StateDeactivated {
			t.Errorf("%s may lift a penalty or a deactivation: %+v", tr.Principal, tr)
		}
		// HALAL_CERTIFICATE_UNVERIFIED (no certificate counts at all) is a delisting
		// reason only the system gives; staff never choose it.
		if !ReasonAllowed(tr.Subject, tr.Action, tr.ReasonCode) && tr.ReasonCode != "HALAL_CERTIFICATE_UNVERIFIED" {
			t.Errorf("%s gives a reason that does not fit %s: %s", tr.Principal, tr.Action, tr.ReasonCode)
		}
	}
}

// TestTransitionsFollowTheStateMachine: every staff transition is legal in the
// state machine from its state (ignoring the ban proposal, which the database
// checks separately), and the super admin ones are exactly confirming a ban and
// lifting one.
func TestTransitionsFollowTheStateMachine(t *testing.T) {
	seen := map[Transition]bool{}
	for _, tr := range Transitions() {
		if seen[tr] {
			t.Errorf("listed twice: %+v", tr)
		}
		seen[tr] = true
		if strings.HasPrefix(string(tr.Principal), "SYSTEM:") {
			continue
		}
		d, err := Decide(Request{Subject: tr.Subject, From: tr.From, Action: tr.Action, BanProposed: tr.Action == ConfirmBan})
		if err != nil {
			t.Errorf("%+v is not legal in the state machine: %v", tr, err)
			continue
		}
		if d.To != tr.To && !(tr.Subject == Restaurant && tr.Action == Reinstate && tr.To == StateDelisted) {
			t.Errorf("%+v: the state machine leads to %s", tr, d.To)
		}
		super := tr.Action == ConfirmBan || (tr.Action == Reinstate && tr.From == StateBanned)
		if (tr.Principal == PrincipalSuperAdmin) != super {
			t.Errorf("%+v: super admin only is %v, want %v", tr, tr.Principal == PrincipalSuperAdmin, super)
		}
	}
}
