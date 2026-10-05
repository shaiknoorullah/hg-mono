package auth

// amr → permitted roles (P-01 / I-01.2). An access token may only carry roles
// the session's authentication method is permitted to obtain:
//
//   - otp       → CUSTOMER, RIDER only. An account also holding ADMIN that signs
//     in by phone OTP receives CUSTOMER only (P-01 acceptance #2).
//   - pwd       → restaurant staff only. Support, admin and super admin require
//     pwd+totp (P-01: TOTP required for every staff role).
//   - pwd+totp  → every email/password role including support and admin.
//
// This is policy, not client choice: the filter runs server-side on the grants
// read from account_role.
func rolesForAMR(amr string, grants []RoleGrant) []RoleGrant {
	allowed := permittedRoles(amr)
	out := make([]RoleGrant, 0, len(grants))
	for _, g := range grants {
		if _, ok := allowed[g.Role]; ok {
			out = append(out, g)
		}
	}
	return out
}

func permittedRoles(amr string) map[string]struct{} {
	switch amr {
	case "otp":
		return map[string]struct{}{"CUSTOMER": {}, "RIDER": {}}
	case "pwd":
		return map[string]struct{}{
			"RESTAURANT_OWNER":   {},
			"RESTAURANT_MANAGER": {},
			"RESTAURANT_STAFF":   {},
		}
	case "pwd+totp":
		return map[string]struct{}{
			"RESTAURANT_OWNER":   {},
			"RESTAURANT_MANAGER": {},
			"RESTAURANT_STAFF":   {},
			"SUPPORT_AGENT":      {},
			"ADMIN":              {},
			"SUPER_ADMIN":        {},
		}
	default:
		return map[string]struct{}{}
	}
}

// requiresTOTP reports whether an account's grant set forces pwd+totp: support,
// admin and super-admin cannot obtain a token without TOTP (P-01 account model:
// TOTP required for every staff role). The
// service enforces this on login; roles requiring TOTP that a pwd-only session
// cannot carry are simply filtered out by rolesForAMR, but a login that would
// yield *no* roles surfaces MFA_REQUIRED rather than an empty session.
func requiresTOTP(grants []RoleGrant) bool {
	for _, g := range grants {
		switch g.Role {
		case "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN":
			return true
		}
	}
	return false
}

// nextRoute derives the client's landing screen (P-04). It is a server decision
// from the closed NextRoute enum; the client never branches on its own.
//
// The full derivation depends on onboarding state owned by sibling modules
// (restaurant/rider onboarding). This module decides the parts it owns
// authoritatively — suspended/banned accounts route to SUSPENDED, a brand-new
// customer with no profile routes to PROFILE_CAPTURE — and defaults the rest to
// HOME. Sibling modules refine the onboarding routes when they land.
func nextRoute(status string, isNewAccount bool, roles []RoleGrant) string {
	switch status {
	case "SUSPENDED", "BANNED", "DELETED":
		return "SUSPENDED"
	}
	// A first-time customer/rider lands on profile capture so the client can
	// collect a name without inventing the decision.
	if isNewAccount {
		for _, g := range roles {
			if g.Role == "CUSTOMER" || g.Role == "RIDER" {
				return "PROFILE_CAPTURE"
			}
		}
	}
	// TODO(onboarding siblings): restaurant/rider onboarding states map to
	// ONBOARDING_* routes here. Until those modules expose their state, a verified
	// account lands on HOME.
	return "HOME"
}
