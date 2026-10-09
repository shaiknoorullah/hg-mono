package auth

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// TestIntegrationSecurityEventsReachTheAccountsDevices: a sign-in from a
// device the account has not used, a session revoked from elsewhere, and a
// password changed or reset each write account.security_event on the
// account's own channel, in the transaction that makes the change (issue
// #376; contracts/websocket.md section 4.6). A first sign-in, a sign-in from
// a known device, a web sign-in (no device to compare), signing out, and
// revoking a session twice write nothing.
func TestIntegrationSecurityEventsReachTheAccountsDevices(t *testing.T) {
	pool := openTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()
	acct, _, err := s.FindOrCreateByPhone(ctx, uniquePhone(), "CUSTOMER")
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	grants, _ := s.RolesFor(ctx, acct.ID)
	signIn := func(device string) *SessionRow {
		t.Helper()
		_, hash, _ := NewRefreshToken()
		p := NewSessionParams{AccountID: acct.ID, AMR: "otp", Roles: grants, Client: "customer-app", RefreshHash: hash,
			IdleExpires: time.Now().Add(24 * time.Hour), AbsExpires: time.Now().Add(72 * time.Hour)}
		if device != "" {
			p.DeviceID = &device
		}
		sess, err := s.CreateSession(ctx, p)
		if err != nil {
			t.Fatalf("CreateSession: %v", err)
		}
		return sess
	}
	kinds := func() []string {
		t.Helper()
		var out []string
		for _, e := range realtimetest.Events(t, pool, realtime.AccountChannel(acct.ID)) {
			if e.Type != "account.security_event" {
				t.Fatalf("unexpected %s on the account channel", e.Type)
			}
			var ev struct{ Kind string }
			if err := json.Unmarshal(e.Payload, &ev); err != nil {
				t.Fatal(err)
			}
			out = append(out, ev.Kind)
		}
		return out
	}

	phoneA := signIn("phone-a") // the first sign-in ever
	signIn("phone-a")           // a known device
	signIn("")                  // the web: no device id
	if got := kinds(); len(got) != 0 {
		t.Fatalf("after a first, a known-device and a web sign-in: %v, want nothing", got)
	}
	phoneB := signIn("phone-b")
	if got := kinds(); !slices.Equal(got, []string{"new_device_login"}) {
		t.Fatalf("after a sign-in from a new phone: %v, want [new_device_login]", got)
	}

	for range 2 {
		if err := s.RevokeSessionForAccount(ctx, acct.ID, phoneB.ID, "revoked_by_user"); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RevokeSessionForAccount(ctx, acct.ID, phoneA.ID, "logout"); err != nil {
		t.Fatal(err)
	}
	if got := kinds(); !slices.Equal(got, []string{"new_device_login", "session_revoked"}) {
		t.Fatalf("after revoking a session twice and signing out: %v, want one session_revoked", got)
	}

	if err := s.ChangePasswordAndRevokeAll(ctx, acct.ID, "$argon2id$changed", "password_changed"); err != nil {
		t.Fatal(err)
	}
	if err := s.ResetPasswordAndRevokeAll(ctx, acct.ID, "$argon2id$reset"); err != nil {
		t.Fatal(err)
	}
	if got := kinds(); !slices.Equal(got, []string{"new_device_login", "session_revoked", "password_changed", "password_changed"}) {
		t.Fatalf("after a change and a reset: %v", got)
	}
	var live int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM session WHERE account_id = $1 AND revoked_at IS NULL`, acct.ID).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 0 {
		t.Errorf("%d live sessions after a password reset, want 0", live)
	}
}
