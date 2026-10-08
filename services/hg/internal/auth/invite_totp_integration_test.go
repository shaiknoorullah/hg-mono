package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// An invited staff member has no session, and a staff role cannot hold one
// without an authenticator, so the invitation link itself starts the
// enrolment and resetPassword confirms it (#170). The link stays the only key:
// a wrong code does not spend it, a role that needs no authenticator and an
// account that has one already are refused, and the confirmed authenticator
// is the one the code was checked against: a second enrolment started between
// the check and the confirm leaves the link, the password and the
// authenticator untouched.
func TestIntegrationInviteLinkEnrolsTheAuthenticator(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	svc := NewService(NewStore(pool), NewRateLimiter(nil, nil), NewLogSMSSender(nil, false),
		session.NewIssuer("k1", priv, "hg-api"), session.NewDenySet(), testSecrets(t), nil)

	link := func(role string) (string, string) {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id`,
			"invite-"+uuid.NewString()[:8]+"@halalgoes.test").Scan(&id); err != nil {
			t.Fatal(err)
		}
		scope, scopeID := "GLOBAL", any(nil)
		if role == "RESTAURANT_OWNER" {
			scope, scopeID = "RESTAURANT", uuid.NewString()
		}
		if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type, scope_id)
			VALUES ($1, $2, $3, $4)`, id, role, scope, scopeID); err != nil {
			t.Fatal(err)
		}
		token, hash, err := NewOpaqueToken()
		if err != nil {
			t.Fatal(err)
		}
		if err := NewStore(pool).InsertCredentialToken(ctx, id, "PASSWORD_RESET", hash, time.Hour); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			pool.Exec(context.Background(), `DELETE FROM session WHERE account_id = $1`, id)
			pool.Exec(context.Background(), `DELETE FROM credential_token WHERE account_id = $1`, id)
			pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id = $1`, id)
			pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1`, id)
		})
		return id, token
	}

	// A restaurant owner's reset link starts nothing: that role needs no authenticator here.
	_, owner := link("RESTAURANT_OWNER")
	if _, err := svc.StartInviteTOTP(ctx, owner, nil); err != errInviteTOTPNotAvailable {
		t.Fatalf("restaurant owner: err = %v, want errInviteTOTPNotAvailable", err)
	}

	adminID, token := link("ADMIN")
	enrolment, err := svc.StartInviteTOTP(ctx, token, nil)
	if err != nil {
		t.Fatalf("StartInviteTOTP: %v", err)
	}
	u, err := url.Parse(enrolment.ProvisioningURI)
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(u.Query().Get("secret"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	wrong := "000000"
	if wrong == code {
		wrong = "111111"
	}

	// A wrong code is refused and the link still works.
	if err := svc.ResetPassword(ctx, token, "a long first staff password", wrong, nil); err != errTOTPInvalidCode {
		t.Fatalf("wrong code: err = %v, want errTOTPInvalidCode", err)
	}

	// A second enrolment started between the code check and the confirm
	// replaces the secret the code was checked against. Nothing is written:
	// the link still works, no password is set, no authenticator confirmed.
	var second *wireTotpEnrolment
	svc.beforeResetRedeem = func() {
		svc.beforeResetRedeem = nil
		if second, err = svc.StartInviteTOTP(ctx, token, nil); err != nil {
			t.Errorf("second StartInviteTOTP: %v", err)
		}
	}
	if err := svc.ResetPassword(ctx, token, "a long first staff password", code, nil); err != errTOTPInvalidCode {
		t.Fatalf("code for a replaced secret: err = %v, want errTOTPInvalidCode", err)
	}
	if second == nil {
		t.Fatal("the second enrolment did not run between the check and the confirm")
	}
	var passwordSet, confirmed bool
	if err := pool.QueryRow(ctx, `SELECT password_hash IS NOT NULL, totp_enrolled_at IS NOT NULL
		FROM account WHERE id = $1`, adminID).Scan(&passwordSet, &confirmed); err != nil {
		t.Fatal(err)
	}
	if passwordSet || confirmed {
		t.Fatalf("after the refused confirm: password set = %v, authenticator confirmed = %v; want neither", passwordSet, confirmed)
	}
	if st, err := NewStore(pool).CredentialTokenState(ctx, "PASSWORD_RESET", HashOpaqueToken(token)); err != nil || st.AccountID != adminID {
		t.Fatalf("link after the refused confirm = %+v (err %v), want still usable", st, err)
	}

	// The code from the enrolment now pending is the one that confirms it.
	u, err = url.Parse(second.ProvisioningURI)
	if err != nil {
		t.Fatal(err)
	}
	if code, err = totp.GenerateCode(u.Query().Get("secret"), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetPassword(ctx, token, "a long first staff password", code, nil); err != nil {
		t.Fatalf("right code: %v", err)
	}
	var enrolled bool
	if err := pool.QueryRow(ctx, `SELECT totp_enrolled_at IS NOT NULL FROM account WHERE id = $1`, adminID).Scan(&enrolled); err != nil || !enrolled {
		t.Fatalf("authenticator confirmed = %v (err %v), want true", enrolled, err)
	}

	// Enrolled: a further reset link cannot replace the authenticator.
	again, hash, _ := NewOpaqueToken()
	if err := NewStore(pool).InsertCredentialToken(ctx, adminID, "PASSWORD_RESET", hash, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartInviteTOTP(ctx, again, nil); err != errInviteTOTPNotAvailable {
		t.Fatalf("already enrolled: err = %v, want errInviteTOTPNotAvailable", err)
	}
}
