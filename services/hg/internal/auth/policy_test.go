package auth

import (
	"testing"
	"time"
)

// TestOTPCannotCarryAdmin is P-01 acceptance #2: an account holding CUSTOMER and
// ADMIN that signs in by phone OTP receives CUSTOMER only.
func TestOTPCannotCarryAdmin(t *testing.T) {
	grants := []RoleGrant{
		{Role: "CUSTOMER", ScopeType: "GLOBAL"},
		{Role: "ADMIN", ScopeType: "GLOBAL"},
	}
	got := rolesForAMR("otp", grants)
	if len(got) != 1 || got[0].Role != "CUSTOMER" {
		t.Fatalf("otp session carried %+v, want CUSTOMER only", got)
	}
}

func TestPwdCannotCarryAdminWithoutTOTP(t *testing.T) {
	grants := []RoleGrant{{Role: "ADMIN", ScopeType: "GLOBAL"}}
	if got := rolesForAMR("pwd", grants); len(got) != 0 {
		t.Fatalf("pwd session carried %+v, want none (admin needs pwd+totp)", got)
	}
	if got := rolesForAMR("pwd+totp", grants); len(got) != 1 {
		t.Fatalf("pwd+totp session carried %+v, want ADMIN", got)
	}
}

func TestNextRouteSuspended(t *testing.T) {
	if r := nextRoute("SUSPENDED", false, nil); r != "SUSPENDED" {
		t.Fatalf("suspended account routed to %q, want SUSPENDED", r)
	}
	if r := nextRoute("BANNED", false, nil); r != "SUSPENDED" {
		t.Fatalf("banned account routed to %q, want SUSPENDED", r)
	}
}

func TestNextRouteNewCustomerProfileCapture(t *testing.T) {
	grants := []RoleGrant{{Role: "CUSTOMER", ScopeType: "GLOBAL"}}
	if r := nextRoute("ACTIVE", true, grants); r != "PROFILE_CAPTURE" {
		t.Fatalf("new customer routed to %q, want PROFILE_CAPTURE", r)
	}
	if r := nextRoute("ACTIVE", false, grants); r != "HOME" {
		t.Fatalf("returning customer routed to %q, want HOME", r)
	}
}

// TestRefreshTTLByRoleClass pins the refresh lifetimes. Staff sessions end after
// 30 minutes idle and 12 hours in total, for every staff role (docs/decisions/README.md
// "Staff session length"); a co-held customer grant cannot stretch them.
func TestRefreshTTLByRoleClass(t *testing.T) {
	cases := []struct {
		roles    []string
		idle     time.Duration
		absolute time.Duration
	}{
		{[]string{"CUSTOMER"}, 30 * 24 * time.Hour, 180 * 24 * time.Hour},
		{[]string{"RESTAURANT_OWNER"}, 14 * 24 * time.Hour, 90 * 24 * time.Hour},
		{[]string{"SUPPORT_AGENT"}, 30 * time.Minute, 12 * time.Hour},
		{[]string{"ADMIN"}, 30 * time.Minute, 12 * time.Hour},
		{[]string{"SUPER_ADMIN"}, 30 * time.Minute, 12 * time.Hour},
		{[]string{"CUSTOMER", "ADMIN"}, 30 * time.Minute, 12 * time.Hour}, // most privileged wins
		{[]string{"RESTAURANT_OWNER", "SUPPORT_AGENT"}, 30 * time.Minute, 12 * time.Hour},
	}
	for _, c := range cases {
		idle, absolute := refreshTTL(c.roles)
		if idle != c.idle || absolute != c.absolute {
			t.Errorf("refreshTTL(%v) = %v idle, %v absolute; want %v, %v",
				c.roles, idle, absolute, c.idle, c.absolute)
		}
	}
}

// TestSupportAgentNeedsTOTP: TOTP is required for support agents as for admins
// (docs/spec/01-platform.md "P-01 — Account model"). A password-only login of a
// support agent is refused, and a pwd session cannot carry the role.
func TestSupportAgentNeedsTOTP(t *testing.T) {
	grants := []RoleGrant{{Role: "SUPPORT_AGENT", ScopeType: "GLOBAL"}}
	if !requiresTOTP(grants) {
		t.Fatal("requiresTOTP(SUPPORT_AGENT) = false, want true")
	}
	if got := rolesForAMR("pwd", grants); len(got) != 0 {
		t.Fatalf("pwd session carried %+v, want none (support needs pwd+totp)", got)
	}
	if got := rolesForAMR("pwd+totp", grants); len(got) != 1 {
		t.Fatalf("pwd+totp session carried %+v, want SUPPORT_AGENT", got)
	}
}
