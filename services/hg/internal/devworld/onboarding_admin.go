package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/pquerna/otp/totp"
)

// scenarioOnboardAdmin invites a new admin as admin-seed (a super admin), then,
// as the invitee, opens the emailed invitation, sets the first password and
// signs in with the password alone: two-step sign-in is opt-in for staff
// (docs/decisions/README.md, "Two-step sign-in is opt-in"). Moving money still
// needs a session signed in with an authenticator code, so the invitee then
// turns two-step sign-in on (enrollTotp, verifyTotpEnrolment) and signs in
// again with password and code. The scenario ends with an admin who can move
// money.
func scenarioOnboardAdmin(ctx context.Context, base string) error {
	// Refuse a non-local API before the first request: the invitation creates
	// an account, as onboard-restaurant's registration does.
	if err := AllowAPI(base); err != nil {
		return err
	}
	super, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	email := "onboard-admin-" + randomSuffix() + "@devworld.test"
	if _, _, err := super.call(ctx, http.MethodPost, "/v1/admin/staff", map[string]any{
		"email": email, "full_name": "Devworld New Admin", "role": "ADMIN",
	}, true); err != nil {
		return fmt.Errorf("devworld: createStaffUser: %w", err)
	}
	fmt.Printf("invited  %s  as ADMIN\n", email)

	token, err := emailLink(ctx, email, "STAFF_INVITE")
	if err != nil {
		return err
	}
	invitee := newAPI(base, "admin-web")

	// Before accepting, the invitee cannot sign in: there is no password yet.
	_, _, err = invitee.call(ctx, http.MethodPost, "/v1/auth/login",
		map[string]any{"email": email, "password": OnboardPassword}, false)
	fmt.Printf("login before accepting  %s\n", refusal(err))

	if _, _, err := invitee.call(ctx, http.MethodPost, "/v1/auth/password/reset", map[string]any{
		"token": token, "new_password": OnboardPassword,
	}, false); err != nil {
		return fmt.Errorf("devworld: resetPassword: %w", err)
	}
	fmt.Println("accepted  first password set from the invitation link")

	amr, waited, err := invitee.loginHeld(ctx, email, "")
	if err != nil {
		return err
	}
	if waited > 0 {
		fmt.Printf("waited  %s for the password reset's account revocation to lift\n", waited.Round(time.Second))
	}
	if amr != "pwd" {
		return fmt.Errorf("devworld: a password-only sign-in carried amr %q, want pwd", amr)
	}
	fmt.Println("signed in  with the password alone (amr pwd: may not move money)")
	if _, _, err := invitee.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications", nil, false); err != nil {
		return fmt.Errorf("devworld: the new admin cannot read the review queue: %w", err)
	}
	fmt.Println("admin  the new admin reads the restaurant review queue")

	// Turn two-step sign-in on: the explicit step that lets this admin move money.
	_, data, err := invitee.call(ctx, http.MethodPost, "/v1/auth/totp/enroll", map[string]any{}, false)
	if err != nil {
		return fmt.Errorf("devworld: enrollTotp: %w", err)
	}
	var enrolment struct {
		ProvisioningURI string `json:"provisioning_uri"`
	}
	if err := json.Unmarshal(data, &enrolment); err != nil {
		return fmt.Errorf("devworld: enrollTotp: %w", err)
	}
	u, err := url.Parse(enrolment.ProvisioningURI)
	if err != nil || u.Query().Get("secret") == "" {
		return errors.New("devworld: the enrolment returned no authenticator secret")
	}
	secret := u.Query().Get("secret")
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		return err
	}
	if _, _, err := invitee.call(ctx, http.MethodPost, "/v1/auth/totp/verify",
		map[string]any{"totp_code": code}, false); err != nil {
		return fmt.Errorf("devworld: verifyTotpEnrolment: %w", err)
	}
	fmt.Println("authenticator  two-step sign-in turned on and confirmed with the first code")

	// Now the password alone is not enough.
	_, _, err = newAPI(base, "admin-web").call(ctx, http.MethodPost, "/v1/auth/login",
		map[string]any{"email": email, "password": OnboardPassword}, false)
	fmt.Printf("login without a code  %s\n", refusal(err))

	// A code is good once: sign in with the next one.
	if err := waitForNextCode(ctx, code, secret); err != nil {
		return err
	}
	next, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		return err
	}
	if err := invitee.login(ctx, email, next); err != nil {
		return err
	}
	if amr, err := invitee.sessionAMR(ctx); err != nil {
		return err
	} else if amr != "pwd+totp" {
		return fmt.Errorf("devworld: a sign-in with a code carried amr %q, want pwd+totp", amr)
	}
	fmt.Println("signed in  with password and authenticator code (amr pwd+totp: may move money)")
	fmt.Printf("done  %s is an ADMIN who can sign in with password %s; make dev-totp email=%s prints the current code\n",
		email, OnboardPassword, email)
	return nil
}

// login signs c in with email and password, adding code when it is not empty,
// and keeps the access token. It drops any token c holds first: the API
// refuses a sign-in that presents a revoked bearer token.
func (c *apiClient) login(ctx context.Context, email, code string) error {
	c.token = ""
	body := map[string]any{"email": email, "password": OnboardPassword}
	how := "password"
	if code != "" {
		body["totp_code"] = code
		how = "password and authenticator code"
	}
	_, grant, err := c.call(ctx, http.MethodPost, "/v1/auth/login", body, false)
	if err != nil {
		return fmt.Errorf("devworld: login with %s: %w", how, err)
	}
	return c.keepToken(grant)
}

// loginHeld signs c in and returns the session's amr, retrying while the API
// still refuses the new session. A password reset puts the whole account on
// each replica's deny set until the next revocation refresh (every 10 seconds,
// internal/auth/module.go), so a sign-in straight after accepting the
// invitation is refused for up to that long. It gives up after 20 seconds.
func (c *apiClient) loginHeld(ctx context.Context, email, code string) (string, time.Duration, error) {
	start := time.Now()
	for tries := 0; ; tries++ {
		if err := c.login(ctx, email, code); err != nil {
			return "", 0, err
		}
		amr, err := c.sessionAMR(ctx)
		var api *apiError
		if err == nil && tries == 0 {
			return amr, 0, nil
		}
		if err == nil {
			return amr, time.Since(start), nil
		}
		if !errors.As(err, &api) || api.Status != http.StatusUnauthorized || time.Since(start) > 20*time.Second {
			return "", 0, err
		}
		select {
		case <-ctx.Done():
			return "", 0, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// sessionAMR asks getCurrentPrincipal how c's session was signed in.
// payments/staff.go lets a session move money only when this is "pwd+totp".
func (c *apiClient) sessionAMR(ctx context.Context) (string, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/auth/me", nil, false)
	if err != nil {
		return "", fmt.Errorf("devworld: getCurrentPrincipal: %w", err)
	}
	var p struct {
		AMR string `json:"amr"`
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return "", fmt.Errorf("devworld: getCurrentPrincipal: %w", err)
	}
	return p.AMR, nil
}

// waitForNextCode waits until the authenticator shows a code other than used,
// at most one 30-second step.
func waitForNextCode(ctx context.Context, used, secret string) error {
	for i := 0; i < 32; i++ {
		c, err := totp.GenerateCode(secret, time.Now())
		if err != nil {
			return err
		}
		if c != used {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return errors.New("devworld: the authenticator code did not change")
}

func refusal(err error) string {
	var api *apiError
	if errors.As(err, &api) {
		return fmt.Sprintf("refused  http %d %s", api.Status, api.Code)
	}
	if err != nil {
		return err.Error()
	}
	return "accepted (unexpected)"
}
