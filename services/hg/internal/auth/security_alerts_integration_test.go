package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// TestIntegrationSecurityAlertEmails (issue #348): a password reset, a
// password change and a sign-in from a new device each queue one security
// email in the transaction that makes the change, to the account's verified
// address only. The email says what happened and when, has no link, and
// holds no IP address or token. Delivery goes through the non-production
// allow-list, so an address off the list is suppressed, not sent.
func TestIntegrationSecurityAlertEmails(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	svc, captured, worker := emailTestService(t, pool, inserter, NewMemoryRateLimiter())
	allow, err := notify.NewAllowList([]string{"@halalgoes.test"})
	if err != nil {
		t.Fatal(err)
	}
	// No override target: the address comes from the account's verified email, as in production.
	worker.Accounts = notify.PgAccountLookup{DB: pool}
	worker.Notifier = notify.NewNotifier().Register(notify.ChannelEmail,
		notify.EmailAdapter{EmailSender: notify.AllowListSender{Next: captured, Allow: allow}})

	// deliverAlerts runs the worker on every queued security alert for the
	// account, as River would, and returns how many were queued.
	deliverAlerts := func(accountID string) int {
		t.Helper()
		rows, err := pool.Query(ctx, `
			SELECT j.args
			  FROM notification n
			  JOIN river_job j ON j.kind = 'notify_deliver' AND j.args->>'notification_id' = n.id::text
			 WHERE n.account_id = $1 AND n.kind = $2
			 ORDER BY n.created_at, n.id`, accountID, string(notify.KindSecurityAlert))
		if err != nil {
			t.Fatal(err)
		}
		argsList, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
		if err != nil {
			t.Fatal(err)
		}
		for _, raw := range argsList {
			var args notify.DeliverArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				t.Fatal(err)
			}
			job := &river.Job[notify.DeliverArgs]{
				JobRow: &rivertype.JobRow{ID: 1, Kind: args.Kind(), Attempt: 1, State: rivertype.JobStateRunning},
				Args:   args,
			}
			if err := worker.Work(ctx, job); err != nil {
				t.Fatalf("deliver security alert: %v", err)
			}
		}
		return len(argsList)
	}

	// A restaurant owner resets, then changes, their password.
	email := fmt.Sprintf("owner-%s@halalgoes.test", uuid.NewString()[:8])
	reg, err := svc.RegisterRestaurant(ctx, email, "a long first password for tests", "Alert Test Kitchen", testClient)
	if err != nil {
		t.Fatalf("RegisterRestaurant: %v", err)
	}
	if err := svc.RequestPasswordReset(ctx, email, testClient); err != nil {
		t.Fatal(err)
	}
	tokens := linkTokens(t, pool, reg.AccountID, notify.KindPasswordReset)
	if len(tokens) != 1 {
		t.Fatalf("%d reset links, want 1", len(tokens))
	}
	if err := svc.ResetPassword(ctx, tokens[0], "a brand new password for tests", nil); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}
	if err := svc.store.ChangePasswordAndRevokeAll(ctx, reg.AccountID, "$argon2id$changed", "password_changed"); err != nil {
		t.Fatal(err)
	}

	// The owner signs in on a phone, then on a second phone: only the second
	// is a new device.
	ip := "203.0.113.42"
	signIn := func(accountID, device string) {
		t.Helper()
		_, hash, _ := NewRefreshToken()
		if _, err := svc.store.CreateSession(ctx, NewSessionParams{
			AccountID: accountID, AMR: "pwd", Client: "restaurant-web", DeviceID: &device, IP: &ip, RefreshHash: hash,
			IdleExpires: time.Now().Add(time.Hour), AbsExpires: time.Now().Add(2 * time.Hour),
		}); err != nil {
			t.Fatalf("CreateSession: %v", err)
		}
	}
	signIn(reg.AccountID, "phone-a")
	signIn(reg.AccountID, "phone-a")
	signIn(reg.AccountID, "phone-b")

	if n := deliverAlerts(reg.AccountID); n != 3 {
		t.Fatalf("%d security alerts queued, want 3: the reset, the change and the new phone", n)
	}
	if len(captured.sent) != 3 {
		t.Fatalf("%d security emails sent, want 3", len(captured.sent))
	}
	wants := []string{"was reset", "was changed", "signed in on a device it has not used before"}
	for i, sent := range captured.sent {
		if sent.to != email {
			t.Errorf("alert %d went to %q, want the account's verified address %q", i, sent.to, email)
		}
		m := sent.msg.Email
		if m == nil {
			t.Fatalf("alert %d has no rendered email", i)
		}
		whole := m.Subject + m.HTML + m.Text
		if strings.Contains(m.Text, "http") {
			t.Errorf("alert %d's text has a link:\n%s", i, m.Text)
		}
		if !strings.Contains(m.Text, wants[i]) {
			t.Errorf("alert %d does not say it %s:\n%s", i, wants[i], m.Text)
		}
		for _, must := range []string{"When: ", "Where: Not known", "If this wasn't you"} {
			if !strings.Contains(m.Text, must) {
				t.Errorf("alert %d is missing %q", i, must)
			}
		}
		for what, never := range map[string]string{
			"a link": "https://", "an anchor": "<a ", "an href": "href=", "the IP address": ip, "the reset token": tokens[0],
			"the account id": reg.AccountID, "an unfilled slot": "{{",
		} {
			if strings.Contains(whole, never) {
				t.Errorf("alert %d contains %s", i, what)
			}
		}
	}

	// A customer whose verified address is off the non-production allow-list:
	// the alert is queued, and suppressed rather than sent.
	cust, _, err := svc.store.FindOrCreateByPhone(ctx, uniquePhone(), "CUSTOMER")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE account SET email = $2, email_verified_at = now() WHERE id = $1`,
		cust.ID, "customer-"+uuid.NewString()[:8]+"@example.test"); err != nil {
		t.Fatal(err)
	}
	signIn(cust.ID, "phone-c")
	signIn(cust.ID, "phone-d")
	if n := deliverAlerts(cust.ID); n != 1 {
		t.Fatalf("%d alerts for the customer's new phone, want 1", n)
	}
	if len(captured.sent) != 3 {
		t.Errorf("an address off the allow-list was sent an email")
	}
}
