package devworld

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// The account-state scenarios (https://github.com/shaiknoorullah/hg-mono/issues/708
// and https://github.com/shaiknoorullah/hg-mono/issues/720): admin-seed suspends or
// reinstates a rider or a customer through the platform's own admin actions
// (applyRiderAccountAction, applyCustomerAccountAction), so the state change,
// its history row, its audit record and the notice to the person are written
// by the API in one transaction, as they would be in production. Nothing is
// written to the database here.
//
// Each acts on a persona of its own, so no other scenario loses its rider or
// customer: rider-flagged and customer-flagged start ACTIVE. The suspended
// states that need no scenario (rider-suspended, customer-suspended,
// customer-banned) are seeded.

// accountAction is one admin action on one persona.
type accountAction struct {
	slug string
	// path is the admin route, with the account id still to fill in.
	path       string
	action     string
	reasonCode string
	reasonText string
	// want is the state the action leaves the account in.
	want string
}

var (
	riderSuspend = accountAction{
		slug: "rider-flagged", path: "/v1/admin/riders/%s/account-actions",
		action: "SUSPEND", reasonCode: "INCIDENT_UNDER_INVESTIGATION",
		reasonText: "Devworld: suspended to show the suspended rider screens.", want: "SUSPENDED",
	}
	riderReinstate = accountAction{
		slug: "rider-flagged", path: "/v1/admin/riders/%s/account-actions",
		action: "REINSTATE", reasonCode: "ISSUE_RESOLVED",
		reasonText: "Devworld: reinstated to show the rider able to go online again.", want: "ACTIVE",
	}
	customerSuspend = accountAction{
		slug: "customer-flagged", path: "/v1/admin/customers/%s/account-actions",
		action: "SUSPEND", reasonCode: "PAYMENT_FAILURE_UNRESOLVED",
		reasonText: "Devworld: suspended to show the suspended customer screens.", want: "SUSPENDED",
	}
	customerReinstate = accountAction{
		slug: "customer-flagged", path: "/v1/admin/customers/%s/account-actions",
		action: "REINSTATE", reasonCode: "ISSUE_RESOLVED",
		reasonText: "Devworld: reinstated to show the customer able to sign in again.", want: "ACTIVE",
	}
)

// scenarioAccountAction signs in as admin-seed and applies the action once. An
// account already in the state the action leaves it in is reported, not
// treated as a failure, so a second run is harmless.
func scenarioAccountAction(ctx context.Context, base string, a accountAction) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	who, err := identity(a.slug)
	if err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err := admin.call(ctx, http.MethodPost, fmt.Sprintf(a.path, who.AccountID), map[string]any{
		"action":      a.action,
		"reason_code": a.reasonCode,
		"reason_text": a.reasonText,
	}, true)
	if err != nil {
		if isCode(err, "ILLEGAL_STATE_TRANSITION") {
			fmt.Printf("%s  %s  refused as an illegal transition (already in the state it leads to, or past it); nothing changed, make dev-reset starts over\n", a.action, a.slug)
			return nil
		}
		return fmt.Errorf("devworld: %s %s: %w", a.action, a.slug, err)
	}
	var change struct {
		FromState       string `json:"from_state"`
		ToState         string `json:"to_state"`
		SessionsRevoked bool   `json:"sessions_revoked"`
	}
	if jerr := json.Unmarshal(data, &change); jerr != nil {
		return fmt.Errorf("devworld: %s %s: unreadable answer: %w", a.action, a.slug, jerr)
	}
	fmt.Printf("%s  %s  http %d  %s -> %s\n", a.action, a.slug, status, change.FromState, change.ToState)
	if change.ToState != a.want {
		return fmt.Errorf("devworld: %s left %s %s, want %s", a.action, a.slug, change.ToState, a.want)
	}
	return nil
}
