package auth

import "testing"

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

func TestRefreshTTLByRoleClass(t *testing.T) {
	cases := []struct {
		roles     []string
		idleHours float64
	}{
		{[]string{"CUSTOMER"}, 30 * 24},
		{[]string{"RESTAURANT_OWNER"}, 14 * 24},
		{[]string{"SUPPORT_AGENT"}, 12},
		{[]string{"ADMIN"}, 8},
		{[]string{"CUSTOMER", "ADMIN"}, 8}, // most privileged wins
	}
	for _, c := range cases {
		idle, _ := refreshTTL(c.roles)
		if got := idle.Hours(); got != c.idleHours {
			t.Errorf("refreshTTL(%v) idle = %vh, want %vh", c.roles, got, c.idleHours)
		}
	}
}
