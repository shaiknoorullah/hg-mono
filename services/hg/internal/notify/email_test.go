package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify/emailtmpl"
)

// fakeResend is an httptest stand-in for Resend's POST /emails that keeps
// Resend's idempotency promise: a request whose Idempotency-Key it has seen
// answers with the first email's id and sends nothing new. sent counts the
// emails that would really have reached an inbox. No test talks to Resend.
type fakeResend struct {
	*httptest.Server
	mu       sync.Mutex
	sent     int
	requests int
	keys     []string
	byKey    map[string]string
	// loseFirstReply: the first email is accepted, but the reply is a 500,
	// as when a response is lost after the provider has already sent.
	loseFirstReply bool
	delay          time.Duration
}

func newFakeResend(t *testing.T) *fakeResend {
	t.Helper()
	f := &fakeResend{byKey: map[string]string{}}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emails" || r.Header.Get("Authorization") != "Bearer re_test_key" {
			http.Error(w, `{"name":"missing_api_key"}`, http.StatusUnauthorized)
			return
		}
		if f.delay > 0 {
			time.Sleep(f.delay)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.requests++
		key := r.Header.Get("Idempotency-Key")
		f.keys = append(f.keys, key)
		id, seen := f.byKey[key]
		if key == "" {
			seen = false // no key, no protection: every request sends
		}
		if !seen {
			f.sent++
			id = "email-" + uuid.NewString()
			f.byKey[key] = id
			if f.loseFirstReply && f.sent == 1 {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"name":"internal_server_error","message":"reply lost"}`))
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeResend) counts() (sent, requests int, keys []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sent, f.requests, append([]string(nil), f.keys...)
}

func (f *fakeResend) sender() *ResendSender {
	return &ResendSender{APIKey: "re_test_key", From: "HalalGoes <notifications@halalgoes.test>", BaseURL: f.URL}
}

func testRenderer() *EmailRenderer {
	return &EmailRenderer{
		Templates: emailtmpl.MustLoad(),
		Links:     Links{Restaurant: "https://partners.halalgoes.test", Admin: "https://admin.halalgoes.test"},
	}
}

func emailWorker(pool DB, sender EmailSender, lookup AccountLookup) *DeliveryWorker {
	return &DeliveryWorker{
		DB: pool, Repo: NewRepo(),
		Notifier: NewNotifier().Register(ChannelEmail, EmailAdapter{EmailSender: sender}),
		Accounts: lookup, Emails: testRenderer(),
	}
}

func deliveriesOn(t *testing.T, pool DB, id uuid.UUID, ch Channel) []Delivery {
	t.Helper()
	all, err := NewRepo().ListDeliveries(context.Background(), pool, id)
	if err != nil {
		t.Fatalf("list deliveries: %v", err)
	}
	var out []Delivery
	for _, d := range all {
		if d.Channel == ch {
			out = append(out, d)
		}
	}
	return out
}

// TestAllowListBlocksARealAddressOutsideProduction is the rule that dev never
// messages a real person (issue #235): with a real Resend key configured, an
// address that is not on the allow-list never reaches Resend and is recorded
// SUPPRESSED, while an allow-listed one is sent.
func TestAllowListBlocksARealAddressOutsideProduction(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	resend := newFakeResend(t)
	guard := AllowListSender{Next: resend.sender(), Allow: MustAllowList("@halalgoes.test", "owner@example.com")}
	w := emailWorker(pool, guard, NoAccountLookup{})

	send := func(to string) uuid.UUID {
		account := insertAccount(t, pool, "")
		n, err := PasswordReset(LinkEmail{
			AccountID: account, Role: RoleRestaurant, To: to, Token: "tok-" + uuid.NewString(),
			TokenID: uuid.NewString(), ExpiresAt: time.Now().Add(30 * time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
		id, _, err := w.Repo.InsertNotification(ctx, pool, n)
		if err != nil {
			t.Fatal(err)
		}
		if err := w.Work(ctx, fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels, Overrides: n.Overrides}, 1)); err != nil {
			t.Fatalf("Work(%s): %v", to, err)
		}
		return id
	}

	blocked := send("someone.real@gmail.com")
	if sent, requests, _ := resend.counts(); sent != 0 || requests != 0 {
		t.Fatalf("a real address reached Resend: sent=%d requests=%d", sent, requests)
	}
	d := deliveriesOn(t, pool, blocked, ChannelEmail)
	if len(d) != 1 || d[0].State != DeliverySuppressed || d[0].SuppressReason != "NOT_ON_ALLOW_LIST" {
		t.Fatalf("blocked delivery = %+v, want one SUPPRESSED NOT_ON_ALLOW_LIST row", d)
	}

	allowed := send("Dev.Tester@HalalGoes.test")
	if sent, _, _ := resend.counts(); sent != 1 {
		t.Fatalf("allow-listed address: sent=%d, want 1", sent)
	}
	d = deliveriesOn(t, pool, allowed, ChannelEmail)
	if len(d) != 1 || d[0].State != DeliverySent || !strings.HasPrefix(d[0].ProviderMessageID, "email-") || d[0].Provider != "resend" {
		t.Fatalf("allowed delivery = %+v, want one SENT row with Resend's id", d)
	}
}

// TestEmailIsSentOnceWhenTheWorkerRunsTwice is idempotency per notification
// row: the provider sends the email but the reply is lost, River retries the
// job, two copies of the job then race each other, and a third runs after the
// email is recorded. Resend must send exactly one email, and every request
// must carry the same idempotency key.
func TestEmailIsSentOnceWhenTheWorkerRunsTwice(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	resend := newFakeResend(t)
	resend.loseFirstReply = true

	account := insertAccount(t, pool, "")
	lookup := NewFakeAccountLookup()
	lookup.Set(account, AccountTargets{Email: "owner@halalgoes.test"})
	n, err := RestaurantApplicationDecided(RestaurantApplicationDecision{
		AccountID: account, RestaurantID: uuid.New(), RestaurantName: "Al-Noor Grill",
		Decision: DecisionApprove, ReasonText: "Every check passed.", DecidedAt: time.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepo()
	id, _, err := repo.InsertNotification(ctx, pool, n)
	if err != nil {
		t.Fatal(err)
	}
	job := func(attempt int) *river.Job[DeliverArgs] {
		return fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels}, attempt)
	}

	// Run 1: Resend sends, the reply is lost, the job fails for a retry.
	if err := emailWorker(pool, resend.sender(), lookup).Work(ctx, job(1)); err == nil {
		t.Fatal("run 1 returned nil after a 500, want an error so River retries")
	} else if IsPermanent(err) {
		t.Fatalf("run 1: a 500 was treated as permanent: %v", err)
	}

	// Runs 2 and 3 race: one holds the lease and resends with the same key
	// (Resend answers with the first email's id); the other is snoozed.
	resend.delay = 150 * time.Millisecond
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := emailWorker(pool, resend.sender(), lookup)
			w.LeaseOwner = "racer-" + string(rune('a'+i))
			errs[i] = w.Work(ctx, job(2))
		}(i)
	}
	wg.Wait()
	var snoozed, ok int
	for _, err := range errs {
		var snooze *river.JobSnoozeError
		switch {
		case err == nil:
			ok++
		case errors.As(err, &snooze):
			snoozed++
		default:
			t.Fatalf("racing run: %v", err)
		}
	}
	if ok < 1 {
		t.Fatalf("racing runs: ok=%d snoozed=%d, want one to deliver", ok, snoozed)
	}

	// Run 4: after the email is recorded SENT, nothing is sent again.
	resend.delay = 0
	if err := emailWorker(pool, resend.sender(), lookup).Work(ctx, job(3)); err != nil {
		t.Fatalf("run 4: %v", err)
	}

	sent, requests, keys := resend.counts()
	if sent != 1 {
		t.Fatalf("Resend sent %d emails, want exactly 1", sent)
	}
	for _, k := range keys {
		if k != id.String()+":EMAIL" {
			t.Fatalf("idempotency keys %v, want every one to be %s:EMAIL", keys, id)
		}
	}
	if requests != 2 {
		t.Errorf("%d requests reached Resend, want 2 (run 1, then one racer): the lease keeps the racers to one", requests)
	}
	var sentRows int
	for _, d := range deliveriesOn(t, pool, id, ChannelEmail) {
		if d.State == DeliverySent {
			sentRows++
		}
	}
	if sentRows != 1 {
		t.Errorf("%d SENT email deliveries recorded, want 1", sentRows)
	}
}

// TestAProviderRejectionIsNotRetried: a 422 from Resend is permanent, so the
// job is cancelled rather than retried eleven more times.
func TestAProviderRejectionIsNotRetried(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	rejecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"name":"validation_error","message":"Invalid to field"}`))
	}))
	defer rejecting.Close()

	account := insertAccount(t, pool, "")
	n, err := PasswordReset(LinkEmail{AccountID: account, Role: RoleAdmin, To: "not-an-inbox@halalgoes.test",
		Token: "tok", TokenID: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := NewRepo().InsertNotification(ctx, pool, n)
	if err != nil {
		t.Fatal(err)
	}
	sender := &ResendSender{APIKey: "k", From: "HalalGoes <n@halalgoes.test>", BaseURL: rejecting.URL}
	err = emailWorker(pool, sender, NoAccountLookup{}).Work(ctx, fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels, Overrides: n.Overrides}, 1))
	var cancel *river.JobCancelError
	if !errors.As(err, &cancel) {
		t.Fatalf("Work = %v, want a JobCancel for a permanent rejection", err)
	}
	d := deliveriesOn(t, pool, id, ChannelEmail)
	if len(d) != 1 || d[0].State != DeliveryFailed || d[0].ErrorCode != "PROVIDER_REJECTED" {
		t.Fatalf("delivery = %+v, want one FAILED PROVIDER_REJECTED row", d)
	}
}

// recordingSender is an EmailSender that only remembers who it was asked to
// email.
type recordingSender struct {
	mu sync.Mutex
	to []string
}

func (r *recordingSender) SendEmail(_ context.Context, to string, _ Message) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.to = append(r.to, to)
	return "sent", nil
}

// TestAllowListRejectsADisplayNameTrick: an address is parsed once, and the
// allow-list and the provider see the same canonical string. A value that one
// parser reads as the allowed address and another reads as someone else's —
// a display name, a comment, a list, a header injection — is refused outright
// and never reaches the provider.
func TestAllowListRejectsADisplayNameTrick(t *testing.T) {
	next := &recordingSender{}
	guard := AllowListSender{Next: next, Allow: MustAllowList("ok@halalgoes.test")}
	msg := Message{Email: &RenderedEmail{Subject: "s", Text: "t"}}

	for _, trick := range []string{
		"victim@evil.example <ok@halalgoes.test>",
		"ok@halalgoes.test <victim@evil.example>",
		`"ok@halalgoes.test" <victim@evil.example>`,
		"victim@evil.example (ok@halalgoes.test)",
		"ok@halalgoes.test, victim@evil.example",
		"ok@halalgoes.test\r\nBcc: victim@evil.example",
		"ok@halalgoes.test\nvictim@evil.example",
		"<ok@halalgoes.test>",
		`"victim@evil.example"@halalgoes.test`,
		"ök@halalgoes.test",
	} {
		_, err := guard.SendEmail(context.Background(), trick, msg)
		if err == nil || !IsPermanent(err) {
			t.Errorf("%q: err = %v, want a permanent invalid-address error", trick, err)
		}
	}
	if len(next.to) != 0 {
		t.Fatalf("tricks reached the provider: %v", next.to)
	}

	// The canonical form is what gets checked and what gets sent: case and
	// IDNA differences in the domain do not matter.
	if _, err := guard.SendEmail(context.Background(), "  ok@HalalGoes.TEST ", msg); err != nil {
		t.Fatalf("allowed address: %v", err)
	}
	if len(next.to) != 1 || next.to[0] != "ok@halalgoes.test" {
		t.Fatalf("provider got %v, want the canonical ok@halalgoes.test", next.to)
	}
	if _, err := guard.SendEmail(context.Background(), "someone@else.test", msg); err == nil {
		t.Fatal("an address off the list was sent")
	} else if reason, ok := suppressedReason(err); !ok || reason != "NOT_ON_ALLOW_LIST" {
		t.Fatalf("off-list address: err = %v, want SUPPRESSED NOT_ON_ALLOW_LIST", err)
	}

	if got, err := CanonicalEmail("user@Bücher.Example"); err != nil || got != "user@xn--bcher-kva.example" {
		t.Errorf("CanonicalEmail IDNA = %q, %v; want user@xn--bcher-kva.example", got, err)
	}
	idn := MustAllowList("@bücher.example")
	if c, _ := CanonicalEmail("a@XN--BCHER-KVA.example"); !idn.Permits(c) {
		t.Error("the allow-list did not match the same domain written in punycode")
	}
}
