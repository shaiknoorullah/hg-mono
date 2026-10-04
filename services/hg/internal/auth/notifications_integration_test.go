package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify/emailtmpl"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// capturedEmail is one email a test sender received instead of a provider.
type capturedEmail struct {
	to  string
	msg notify.Message
}

type captureSender struct {
	mu   sync.Mutex
	sent []capturedEmail
}

func (c *captureSender) SendEmail(_ context.Context, to string, msg notify.Message) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, capturedEmail{to: to, msg: msg})
	return fmt.Sprintf("captured-%d", len(c.sent)), nil
}

// deliverQueued runs the delivery worker on the queued job of every
// notification of kind for the account, exactly as River would: the job's
// arguments are read back from river_job, so the token travels the real path.
func deliverQueued(t *testing.T, pool *pgxpool.Pool, accountID string, kind notify.Kind, w *notify.DeliveryWorker) {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		SELECT j.args
		  FROM notification n
		  JOIN river_job j ON j.kind = 'notify_deliver' AND j.args->>'notification_id' = n.id::text
		 WHERE n.account_id = $1 AND n.kind = $2`, accountID, string(kind))
	if err != nil {
		t.Fatalf("load queued jobs: %v", err)
	}
	argsList, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		t.Fatal(err)
	}
	if len(argsList) != 1 {
		t.Fatalf("%d %s jobs queued, want 1", len(argsList), kind)
	}
	var args notify.DeliverArgs
	if err := json.Unmarshal(argsList[0], &args); err != nil {
		t.Fatal(err)
	}
	job := &river.Job[notify.DeliverArgs]{
		JobRow: &rivertype.JobRow{ID: 1, Kind: args.Kind(), Attempt: 1, State: rivertype.JobStateRunning},
		Args:   args,
	}
	if err := w.Work(ctx, job); err != nil {
		t.Fatalf("deliver %s: %v", kind, err)
	}
}

// TestIntegrationPasswordResetEmailHasAWorkingLinkAndNoOtherSecret follows a
// restaurant owner's password reset from the request to the email, through
// the real outbox: the email links to the restaurant web app with the
// single-use token, the link works once, and the token is the only secret the
// email holds — it is not in the inbox row, and nothing else (the password
// hash, the token's stored hash, the sign-up email's own token) is in the
// email.
func TestIntegrationPasswordResetEmailHasAWorkingLinkAndNoOtherSecret(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()

	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	svc := NewService(NewStore(pool), NewRateLimiter(nil), NewLogSMSSender(nil, false),
		session.NewIssuer("k1", priv, "hg-api"), session.NewDenySet(), testSecrets(t), nil)
	svc.UseNotifications(notify.NewEnqueuer(notify.NewRepo(), inserter))

	captured := &captureSender{}
	worker := &notify.DeliveryWorker{
		DB: pool, Repo: notify.NewRepo(),
		Notifier: notify.NewNotifier().Register(notify.ChannelEmail, notify.EmailAdapter{EmailSender: captured}),
		Emails: &notify.EmailRenderer{
			Templates: emailtmpl.MustLoad(),
			Links:     notify.Links{Restaurant: "https://partners.halalgoes.test", Admin: "https://admin.halalgoes.test"},
		},
	}

	email := fmt.Sprintf("owner-%s@halalgoes.test", uuid.NewString()[:8])
	reg, err := svc.RegisterRestaurant(ctx, email, "a long first password for tests", "Reset Test Kitchen")
	if err != nil {
		t.Fatalf("RegisterRestaurant: %v", err)
	}
	// Sign-up queued its verification email in the same transaction.
	deliverQueued(t, pool, reg.AccountID, notify.KindEmailVerification, worker)

	if err := svc.RequestPasswordReset(ctx, email); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	deliverQueued(t, pool, reg.AccountID, notify.KindPasswordReset, worker)

	if len(captured.sent) != 2 {
		t.Fatalf("%d emails sent, want the verification and the reset", len(captured.sent))
	}
	verify, reset := captured.sent[0], captured.sent[1]
	if reset.to != email || reset.msg.Email == nil {
		t.Fatalf("reset email went to %q (email %v), want %q", reset.to, reset.msg.Email != nil, email)
	}

	// The link: the restaurant web app's reset page, carrying the token.
	link := regexp.MustCompile(`https://partners\.halalgoes\.test/reset-password\?token=([A-Za-z0-9_-]+)`)
	m := link.FindStringSubmatch(reset.msg.Email.Text)
	if m == nil {
		t.Fatalf("no reset link in the email text:\n%s", reset.msg.Email.Text)
	}
	token := m[1]
	if !strings.Contains(reset.msg.Email.HTML, `href="https://partners.halalgoes.test/reset-password?token=`+token+`"`) {
		t.Error("the HTML button does not link to the same reset URL")
	}
	verifyToken := regexp.MustCompile(`verify-email\?token=([A-Za-z0-9_-]+)`).FindStringSubmatch(verify.msg.Email.Text)
	if verifyToken == nil {
		t.Fatalf("no verification link in the sign-up email:\n%s", verify.msg.Email.Text)
	}

	// No other secret in the email.
	var passwordHash string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM account WHERE id = $1`, reg.AccountID).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	whole := reset.msg.Email.Subject + reset.msg.Email.HTML + reset.msg.Email.Text
	for what, secret := range map[string]string{
		"the password hash":            passwordHash,
		"the token's stored hash":      hex.EncodeToString(HashOpaqueToken(token)),
		"the sign-up email's token":    verifyToken[1],
		"the account id":               reg.AccountID,
		"the first password":           "a long first password for tests",
		"an unfilled template slot":    "{{",
		"a token outside the link URL": "token=" + token + "&",
	} {
		if strings.Contains(whole, secret) {
			t.Errorf("the reset email contains %s", what)
		}
	}
	if n := strings.Count(reset.msg.Email.Text, token); n != 1 {
		t.Errorf("the token appears %d times in the text part, want once (in the link)", n)
	}

	// The token is never in the inbox row (title, body or data).
	var title, body, data string
	if err := pool.QueryRow(ctx, `
		SELECT title, body, data::text FROM notification WHERE account_id = $1 AND kind = $2`,
		reg.AccountID, string(notify.KindPasswordReset)).Scan(&title, &body, &data); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(title+body+data, token) {
		t.Error("the reset token is stored in the notification row")
	}

	// The link works, once.
	if err := svc.ResetPassword(ctx, token, "a brand new password for tests"); err != nil {
		t.Fatalf("ResetPassword with the emailed token: %v", err)
	}
	if err := svc.ResetPassword(ctx, token, "another new password for tests"); err != errTokenUsed {
		t.Fatalf("second use of the token: err = %v, want errTokenUsed", err)
	}
	// Using a link sent to the address proves the address.
	var verified *time.Time
	if err := pool.QueryRow(ctx, `SELECT email_verified_at FROM account WHERE id = $1`, reg.AccountID).Scan(&verified); err != nil {
		t.Fatal(err)
	}
	if verified == nil {
		t.Error("resetting the password did not mark the email verified")
	}
}
