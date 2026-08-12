package auth

// Wire types mirror the contract schemas exactly (contracts/openapi.yaml). Field
// names, nullability and enums are contract-authoritative; nothing here invents a
// field. additionalProperties:false in the contract means these structs are the
// full shape.

// wireRoleGrant is the contract's RoleGrant.
type wireRoleGrant struct {
	Role      string  `json:"role"`
	ScopeType string  `json:"scope_type"`
	ScopeID   *string `json:"scope_id"`
}

// wirePrincipal is the contract's Principal.
type wirePrincipal struct {
	AccountID string          `json:"account_id"`
	SessionID string          `json:"session_id"`
	Roles     []wireRoleGrant `json:"roles"`
	AMR       string          `json:"amr"`
	Status    string          `json:"status"`
	Locale    string          `json:"locale"`
	Timezone  string          `json:"timezone"`
	NextRoute string          `json:"next_route"`
}

// wireSessionGrant is the contract's SessionGrant. refresh_token is null for web
// surfaces (delivered as the hg_rt cookie instead).
type wireSessionGrant struct {
	AccessToken  string        `json:"access_token"`
	RefreshToken *string       `json:"refresh_token"`
	ExpiresIn    int32         `json:"expires_in"`
	IsNewAccount bool          `json:"is_new_account"`
	Principal    wirePrincipal `json:"principal"`
}

// wireOtpChallenge is the contract's OtpChallenge (the requestOtp response).
type wireOtpChallenge struct {
	ChallengeID  string `json:"challenge_id"`
	ResendAfterS int32  `json:"resend_after_s"`
	ExpiresAt    string `json:"expires_at"`
}

// wireRestaurantRegistration is the contract's RestaurantRegistration.
type wireRestaurantRegistration struct {
	RestaurantID    string `json:"restaurant_id"`
	Email           string `json:"email"`
	OnboardingState string `json:"onboarding_state"`
}

// wireSessionSummary is the contract's SessionSummary.
type wireSessionSummary struct {
	ID         string  `json:"id"`
	Client     string  `json:"client"`
	DeviceID   *string `json:"device_id"`
	IPCity     *string `json:"ip_city"`
	IssuedAt   string  `json:"issued_at"`
	LastUsedAt string  `json:"last_used_at"`
	IsCurrent  bool    `json:"is_current"`
}

// wireAcknowledgement is the inner data of AcknowledgementResponse.
type wireAcknowledgement struct {
	Acknowledged bool `json:"acknowledged"`
}

// toWireRoles converts store grants to the wire shape.
func toWireRoles(grants []RoleGrant) []wireRoleGrant {
	out := make([]wireRoleGrant, 0, len(grants))
	for _, g := range grants {
		out = append(out, wireRoleGrant{Role: g.Role, ScopeType: g.ScopeType, ScopeID: g.ScopeID})
	}
	return out
}

// roleStrings extracts the bare role names, for amr filtering and token claims.
func roleStrings(grants []RoleGrant) []string {
	out := make([]string, 0, len(grants))
	for _, g := range grants {
		out = append(out, g.Role)
	}
	return out
}
