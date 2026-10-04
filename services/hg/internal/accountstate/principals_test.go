package accountstate

import (
	"reflect"
	"strings"
	"testing"
)

// TestSystemPrincipalsTakeOnlyTheirOwnTransitions pins what each system
// principal may do: the expiry only delists a LIVE restaurant for a lapsed
// certificate, the renewal only lists a DELISTED one again, and onboarding only
// takes a restaurant out of PENDING. None of them may suspend, ban, deactivate,
// lift a penalty, or touch a rider or a customer.
func TestSystemPrincipalsTakeOnlyTheirOwnTransitions(t *testing.T) {
	var system []Transition
	for _, tr := range Transitions() {
		if strings.HasPrefix(string(tr.Principal), "SYSTEM:") {
			system = append(system, tr)
		}
	}
	want := []Transition{
		{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
			Principal: "SYSTEM:HALAL_EXPIRY", ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
		{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
			Principal: "SYSTEM:HALAL_RENEWAL", ReasonCode: "ISSUE_RESOLVED"},
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
		if !ReasonAllowed(tr.Subject, tr.Action, tr.ReasonCode) {
			t.Errorf("%s gives a reason that does not fit %s: %s", tr.Principal, tr.Action, tr.ReasonCode)
		}
	}

	// Onboarding leaves PENDING and nothing else; it lists only what an admin
	// reinstating the restaurant could list.
	for _, c := range []struct {
		from, cert string
		reasons    []string
		to         string
		left       []string
		ok         bool
	}{
		{StatePending, "CERTIFIED", nil, StateLive, []string{}, true},
		{StatePending, "EXPIRING_SOON", []string{"HALAL_CERTIFICATE_EXPIRED"}, StateLive, []string{}, true},
		{StatePending, "EXPIRED", nil, StateDelisted, []string{"HALAL_CERTIFICATE_EXPIRED"}, true},
		{StatePending, "UNVERIFIED", nil, StateDelisted, []string{"HALAL_CERTIFICATE_UNVERIFIED"}, true},
		{StatePending, "CERTIFIED", []string{"DOCUMENT_EXPIRED"}, StateDelisted, []string{"DOCUMENT_EXPIRED"}, true},
		{StateSuspended, "CERTIFIED", nil, StateSuspended, nil, false},
		{StateBanned, "CERTIFIED", nil, StateBanned, nil, false},
		{StateDeactivated, "CERTIFIED", nil, StateDeactivated, nil, false},
		{StateDelisted, "CERTIFIED", []string{"NO_APPROVED_MENU"}, StateDelisted, []string{"NO_APPROVED_MENU"}, false},
		{StateLive, "EXPIRED", nil, StateLive, nil, false},
	} {
		to, left, ok := GoLive(c.from, c.cert, c.reasons)
		if to != c.to || ok != c.ok || !reflect.DeepEqual(left, c.left) {
			t.Errorf("GoLive(%s, %s, %v) = %s %v %v, want %s %v %v", c.from, c.cert, c.reasons, to, left, ok, c.to, c.left, c.ok)
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
