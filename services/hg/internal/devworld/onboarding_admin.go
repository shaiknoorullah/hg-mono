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
// as the invitee, opens the emailed invitation, sets up the authenticator from
// the link, sets the first password with the first code, and signs in with
// password and code. A staff role cannot hold a session without an
// authenticator, so this is the whole path a new admin has.
func scenarioOnboardAdmin(ctx context.Context, base string) error {
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

	// Before anything, the invitee cannot sign in: no password, no authenticator.
	_, _, err = invitee.call(ctx, http.MethodPost, "/v1/auth/login",
		map[string]any{"email": email, "password": OnboardPassword}, false)
	fmt.Printf("login before accepting  %s\n", refusal(err))

	_, data, err := invitee.call(ctx, http.MethodPost, "/v1/auth/invite/totp", map[string]any{"token": token}, false)
	if err != nil {
		return fmt.Errorf("devworld: startInviteTotpEnrolment: %w", err)
	}
	var enrolment struct {
		ProvisioningURI string `json:"provisioning_uri"`
	}
	if err := json.Unmarshal(data, &enrolment); err != nil {
		return fmt.Errorf("devworld: startInviteTotpEnrolment: %w", err)
	}
	u, err := url.Parse(enrolment.ProvisioningURI)
	if err != nil || u.Query().Get("secret") == "" {
		return errors.New("devworld: the enrolment returned no authenticator secret")
	}
	secret := u.Query().Get("secret")
	fmt.Println("authenticator  enrolment started from the invitation link")

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		return err
	}
	if _, _, err := invitee.call(ctx, http.MethodPost, "/v1/auth/password/reset", map[string]any{
		"token": token, "new_password": OnboardPassword, "totp_code": code,
	}, false); err != nil {
		return fmt.Errorf("devworld: resetPassword with totp_code: %w", err)
	}
	fmt.Println("accepted  first password set and authenticator confirmed with the first code")

	// A code is good once: sign in with the next one.
	if err := waitForNextCode(ctx, code, secret); err != nil {
		return err
	}
	next, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		return err
	}
	_, grant, err := invitee.call(ctx, http.MethodPost, "/v1/auth/login",
		map[string]any{"email": email, "password": OnboardPassword, "totp_code": next}, false)
	if err != nil {
		return fmt.Errorf("devworld: login with password and authenticator code: %w", err)
	}
	if err := invitee.keepToken(grant); err != nil {
		return err
	}
	fmt.Println("signed in  with password and authenticator code")
	if _, _, err := invitee.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications", nil, false); err != nil {
		return fmt.Errorf("devworld: the new admin cannot read the review queue: %w", err)
	}
	fmt.Println("admin  the new admin reads the restaurant review queue")
	fmt.Printf("done  %s is an ADMIN who can sign in with password %s; make dev-totp email=%s prints the current code\n",
		email, OnboardPassword, email)
	return nil
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
