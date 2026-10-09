package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
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

// testClient stands in for httpx.RateLimitKey(httpx.ClientIP(r)).
const testClient = "203.0.113.7"

// emailTestService is an auth service wired to the real notification outbox,
// with a worker that captures emails instead of sending them.
func emailTestService(t *testing.T, pool *pgxpool.Pool, inserter *river.Client[pgx.Tx], rl *RateLimiter) (*Service, *captureSender, *notify.DeliveryWorker) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	svc := NewService(NewStore(pool), rl, NewLogSMSSender(nil, false),
		session.NewIssuer("k1", priv, "hg-api"), session.NewDenySet(), testSecrets(t), nil)
	svc.UseNotifications(notify.NewEnqueuer(notify.NewRepo(), inserter))
	svc.linkEmailDelay = 0
	captured := &captureSender{}
	worker := &notify.DeliveryWorker{
		DB: pool, Repo: notify.NewRepo(),
		Notifier: notify.NewNotifier().Register(notify.ChannelEmail, notify.EmailAdapter{EmailSender: captured}),
		Emails: &notify.EmailRenderer{
			Templates: emailtmpl.MustLoad(),
			Links:     notify.Links{Restaurant: "https://partners.halalgoes.test", Admin: "https://admin.halalgoes.test"},
		},
	}
	return svc, captured, worker
}

func countNotifications(t *testing.T, pool *pgxpool.Pool, accountID string, kind notify.Kind) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM notification WHERE account_id = $1 AND kind = $2`, accountID, string(kind)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
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
	svc, captured, worker := emailTestService(t, pool, inserter, NewRateLimiter(nil, nil))

	email := fmt.Sprintf("owner-%s@halalgoes.test", uuid.NewString()[:8])
	reg, err := svc.RegisterRestaurant(ctx, email, "a long first password for tests", "Reset Test Kitchen", testClient)
	if err != nil {
		t.Fatalf("RegisterRestaurant: %v", err)
	}
	// Sign-up queued its verification email in the same transaction.
	deliverQueued(t, pool, reg.AccountID, notify.KindEmailVerification, worker)

	if err := svc.RequestPasswordReset(ctx, email, testClient); err != nil {
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
	if err := svc.ResetPassword(ctx, token, "a brand new password for tests", "", nil); err != nil {
		t.Fatalf("ResetPassword with the emailed token: %v", err)
	}
	if err := svc.ResetPassword(ctx, token, "another new password for tests", "", nil); err != errTokenUsed {
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

// linkTokens returns the single-use tokens of every queued email of kind for
// the account, oldest first, read from the delivery jobs as the worker would.
func linkTokens(t *testing.T, pool *pgxpool.Pool, accountID string, kind notify.Kind) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT j.args->'overrides'->'EMAIL'->>'link_token'
		  FROM notification n
		  JOIN river_job j ON j.kind = 'notify_deliver' AND j.args->>'notification_id' = n.id::text
		 WHERE n.account_id = $1 AND n.kind = $2
		 ORDER BY n.created_at, n.id`, accountID, string(kind))
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return tokens
}

// TestIntegrationResetEmailsStopAtTheLimit: the tight limit is per address
// and client address, so an attacker filling their own quota for a victim's
// address does not stop the victim, asking from their own network; case and
// +tag variants share one count; a client's overall budget holds whichever
// addresses it names; and the overall cap per address bounds the total when
// many networks ask.
func TestIntegrationResetEmailsStopAtTheLimit(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	svc, _, _ := emailTestService(t, pool, inserter, NewMemoryRateLimiter())
	register := func(email, client string) string {
		t.Helper()
		reg, err := svc.RegisterRestaurant(ctx, email, "a long first password for tests", "Limit Test Kitchen", client)
		if err != nil {
			t.Fatal(err)
		}
		return reg.AccountID
	}

	// An attacker's network asks five times, in five spellings of the
	// victim's address: three emails at most, all to the victim.
	local := "victim-" + uuid.NewString()[:8]
	email := local + "@halalgoes.test"
	victim := register(email, "198.51.100.1")
	attacker := httpx.RateLimitKey("2001:db8:aa:1::5")
	for _, variant := range []string{
		strings.ToUpper(email), email, local + "+x@halalgoes.test", email, email,
	} {
		_ = svc.RequestPasswordReset(ctx, variant, attacker)
	}
	if n := countNotifications(t, pool, victim, notify.KindPasswordReset); n != 2 {
		t.Fatalf("%d reset emails from the attacker's network, want 2 (3 allowed; the +tag spelling used one)", n)
	}
	// Same /64, another host: still the attacker's quota.
	_ = svc.RequestPasswordReset(ctx, email, httpx.RateLimitKey("2001:db8:aa:1::77"))
	// The victim, from their own network, still gets their link.
	if err := svc.RequestPasswordReset(ctx, email, "203.0.113.20"); err != nil {
		t.Fatal(err)
	}
	if n := countNotifications(t, pool, victim, notify.KindPasswordReset); n != 3 {
		t.Fatalf("%d reset emails after the victim asked, want 3: the attacker's quota must not block the victim", n)
	}

	// A client's overall budget: ten requests to strangers use its hour;
	// the eleventh, for a real account, queues nothing.
	other := register("client-"+uuid.NewString()[:8]+"@halalgoes.test", "198.51.100.3")
	busy := httpx.RateLimitKey("2001:db8:bb:2::10")
	for i := 0; i < linkEmailsPerClient; i++ {
		_ = svc.RequestPasswordReset(ctx, fmt.Sprintf("stranger%d-%s@example.test", i, uuid.NewString()[:4]), busy)
	}
	var email2 string
	if err := pool.QueryRow(ctx, `SELECT email::text FROM account WHERE id = $1`, other).Scan(&email2); err != nil {
		t.Fatal(err)
	}
	_ = svc.RequestPasswordReset(ctx, email2, busy)
	if n := countNotifications(t, pool, other, notify.KindPasswordReset); n != 0 {
		t.Fatalf("%d reset emails past the client's overall budget, want 0", n)
	}

	// Many networks, one address: the overall cap bounds the total.
	target := register("bombed-"+uuid.NewString()[:8]+"@halalgoes.test", "198.51.100.4")
	var email3 string
	if err := pool.QueryRow(ctx, `SELECT email::text FROM account WHERE id = $1`, target).Scan(&email3); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < linkEmailsPerAddressHour+5; i++ {
		if err := svc.RequestPasswordReset(ctx, email3, fmt.Sprintf("192.0.2.%d", 10+i)); err != nil {
			t.Fatal(err)
		}
	}
	if n := countNotifications(t, pool, target, notify.KindPasswordReset); n != linkEmailsPerAddressHour {
		t.Fatalf("%d reset emails to one address from %d networks, want the cap of %d",
			n, linkEmailsPerAddressHour+5, linkEmailsPerAddressHour)
	}
}

// TestIntegrationUsingOneResetLinkEndsTheOthers: a new link does not cancel
// the earlier ones (so nobody can cancel the owner's link by asking for
// another), at most three are live at once, and using one ends the rest.
func TestIntegrationUsingOneResetLinkEndsTheOthers(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	svc, _, _ := emailTestService(t, pool, inserter, NewMemoryRateLimiter())
	email := "tokens-" + uuid.NewString()[:8] + "@halalgoes.test"
	reg, err := svc.RegisterRestaurant(ctx, email, "a long first password for tests", "Token Test Kitchen", "198.51.100.5")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		if err := svc.RequestPasswordReset(ctx, email, fmt.Sprintf("198.51.100.%d", 50+i)); err != nil {
			t.Fatal(err)
		}
	}
	tokens := linkTokens(t, pool, reg.AccountID, notify.KindPasswordReset)
	if len(tokens) != 4 {
		t.Fatalf("%d reset links, want 4", len(tokens))
	}
	// The fourth link ended the first: three live at most.
	if err := svc.ResetPassword(ctx, tokens[0], "a new password for tests 0", "", nil); err != errTokenExpired {
		t.Fatalf("oldest link of four: err = %v, want errTokenExpired", err)
	}
	// The second link still works although two newer ones were sent.
	if err := svc.ResetPassword(ctx, tokens[1], "a new password for tests 1", "", nil); err != nil {
		t.Fatalf("an earlier, still live link: %v", err)
	}
	// Using it ended the others.
	for _, tok := range tokens[2:] {
		if err := svc.ResetPassword(ctx, tok, "a new password for tests 2", "", nil); err != errTokenExpired {
			t.Fatalf("a link after another was used: err = %v, want errTokenExpired", err)
		}
	}
}

// TestIntegrationForgotPasswordAnswersTheSameForUnknownEmails: the response,
// and the time it takes, are the same whether or not the address has an
// account, so the form cannot be used to find out who has one.
func TestIntegrationForgotPasswordAnswersTheSameForUnknownEmails(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	svc, _, _ := emailTestService(t, pool, inserter, NewMemoryRateLimiter())
	svc.linkEmailDelay = 200 * time.Millisecond

	known := "known-" + uuid.NewString()[:8] + "@halalgoes.test"
	if _, err := svc.RegisterRestaurant(ctx, known, "a long first password for tests", "Known Kitchen", "198.51.100.4"); err != nil {
		t.Fatal(err)
	}
	unknown := "nobody-" + uuid.NewString()[:8] + "@halalgoes.test"

	h := NewHandler(svc, svc.store, svc.deny, svc.secrets)
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: httpx.AnonymousAuthenticator{}, Authorizer: Matrix{}})
	Routes(router, h)
	srv := httptest.NewServer(router)
	defer srv.Close()

	type answer struct {
		status int
		body   string
		took   time.Duration
	}
	ask := func(path, email string) answer {
		start := time.Now()
		resp, err := http.Post(srv.URL+path, "application/json", strings.NewReader(`{"email":"`+email+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		delete(body, "meta") // request ids differ per call
		b, _ := json.Marshal(body)
		return answer{resp.StatusCode, string(b), time.Since(start)}
	}
	for _, path := range []string{"/v1/auth/password/forgot", "/v1/auth/email/resend"} {
		a, b := ask(path, known), ask(path, unknown)
		if a.status != b.status || a.body != b.body {
			t.Errorf("%s: known %d %s, unknown %d %s; want the same answer", path, a.status, a.body, b.status, b.body)
		}
		for _, x := range []answer{a, b} {
			if x.took < svc.linkEmailDelay {
				t.Errorf("%s answered in %v, under the uniform %v", path, x.took, svc.linkEmailDelay)
			}
		}
	}
}

// TestIntegrationStaffInviteGoesOnlyToTheInvitedAccount: the invitation
// email's address comes from the invited account's own row, the email quotes
// nothing the inviter typed, and one account gets at most three invitations a
// day.
func TestIntegrationStaffInviteGoesOnlyToTheInvitedAccount(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	svc, captured, worker := emailTestService(t, pool, inserter, NewRateLimiter(nil, nil))

	email := "new-staff-" + uuid.NewString()[:8] + "@halalgoes.test"
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO staff_profile (account_id, full_name, status) VALUES ($1, 'Visit https://evil.example', 'INVITED')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'ADMIN', 'GLOBAL')`, id); err != nil {
		t.Fatal(err)
	}
	// Other suites list staff on this database; leave nothing behind.
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM notification_delivery WHERE notification_id IN (SELECT id FROM notification WHERE account_id = $1)`,
			`DELETE FROM notification WHERE account_id = $1`,
			`DELETE FROM credential_token WHERE account_id = $1`,
			`DELETE FROM account_role WHERE account_id = $1`,
			`DELETE FROM staff_profile WHERE account_id = $1`,
			`DELETE FROM account WHERE id = $1`,
		} {
			if _, err := pool.Exec(context.Background(), q, id); err != nil {
				t.Logf("cleanup: %v", err)
			}
		}
	})
	invite := func() error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if err := svc.InviteStaff(ctx, tx, notify.StaffInvitation{AccountID: id, PlatformRole: "ADMIN"}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	for i := 0; i < staffInvitesPerTarget; i++ {
		if err := invite(); err != nil {
			t.Fatalf("invitation %d: %v", i+1, err)
		}
	}
	if err := invite(); !errors.Is(err, notify.ErrInviteLimited) {
		t.Fatalf("invitation %d: err = %v, want notify.ErrInviteLimited", staffInvitesPerTarget+1, err)
	}

	rows, err := pool.Query(ctx, `
		SELECT j.args FROM notification n
		  JOIN river_job j ON j.kind = 'notify_deliver' AND j.args->>'notification_id' = n.id::text
		 WHERE n.account_id = $1 AND n.kind = $2 ORDER BY n.created_at LIMIT 1`, id, string(notify.KindStaffInvite))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil || len(raw) != 1 {
		t.Fatalf("queued invitation jobs: %d, %v", len(raw), err)
	}
	var args notify.DeliverArgs
	if err := json.Unmarshal(raw[0], &args); err != nil {
		t.Fatal(err)
	}
	if err := worker.Work(ctx, &river.Job[notify.DeliverArgs]{
		JobRow: &rivertype.JobRow{ID: 1, Kind: args.Kind(), Attempt: 1, State: rivertype.JobStateRunning}, Args: args,
	}); err != nil {
		t.Fatal(err)
	}
	if len(captured.sent) != 1 || captured.sent[0].to != email {
		t.Fatalf("invitation went to %v, want only %s", captured.sent, email)
	}
	e := captured.sent[0].msg.Email
	if strings.Contains(e.HTML+e.Text+e.Subject, "evil.example") {
		t.Error("the invitee's name, typed by the inviter, reached the email")
	}
	if !strings.Contains(e.Text, "https://admin.halalgoes.test/accept-invite?token=") {
		t.Errorf("no invitation link to the admin app:\n%s", e.Text)
	}
}
