package realtime

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// These tests pin the socket caps from contracts/websocket.md "Limits" and the
// fix for issue #288 (https://github.com/shaiknoorullah/hg-mono/issues/288):
// one account must not be able to fill a replica and lock everyone else out,
// and no way out of the upgrade may leak a slot. None needs Postgres or Redis:
// tickets come from fakeUpgradeStore and request counts from countingLimiter.

func discardLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// counts reads the replica's slot counts for one account and one session.
func counts(gw *Gateway, accountID, sessionID string) (total, account, session int) {
	gw.slots.mu.Lock()
	defer gw.slots.mu.Unlock()
	return gw.slots.total, gw.slots.perAccount[accountID], gw.slots.perSession[sessionID]
}

// hold takes and binds a lease as a live socket would, released at cleanup.
func hold(t *testing.T, gw *Gateway, accountID, sessionID string) *socketLease {
	t.Helper()
	l, ok := gw.admit()
	if !ok {
		t.Fatalf("replica refused a socket for %s", accountID)
	}
	if err := l.bind(accountID, sessionID); err != nil {
		l.release()
		t.Fatalf("bind %s/%s: %v", accountID, sessionID, err)
	}
	t.Cleanup(l.release)
	return l
}

// TestSocketCapAdmitsUpToTheLimit pins the per-replica socket cap: exactly
// MaxSockets slots, and a released slot is usable again. A leaked slot would
// make the replica refuse every socket for good.
func TestSocketCapAdmitsUpToTheLimit(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{MaxSockets: 2})
	first, ok1 := gw.admit()
	_, ok2 := gw.admit()
	if !ok1 || !ok2 {
		t.Fatal("the first two sockets were refused under a cap of 2")
	}
	if _, ok := gw.admit(); ok {
		t.Fatal("a third socket was admitted under a cap of 2")
	}
	first.release()
	if _, ok := gw.admit(); !ok {
		t.Fatal("a released slot was not reusable")
	}
}

// TestSocketLeaseGivesBackExactlyWhatItTook pins the accounting itself: an
// account and a session are capped separately, a refused bind keeps only the
// replica slot, a second release of the same lease changes nothing, and the
// counts return to zero with nothing left in the maps.
func TestSocketLeaseGivesBackExactlyWhatItTook(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{MaxSockets: 10, MaxSocketsPerAccount: 3, MaxSocketsPerSession: 2})
	var leases []*socketLease
	take := func(account, session string) error {
		l, ok := gw.admit()
		if !ok {
			t.Fatal("replica refused a socket well under its cap")
		}
		err := l.bind(account, session)
		if err != nil {
			l.release()
		} else {
			leases = append(leases, l)
		}
		return err
	}

	if take("a", "a1") != nil || take("a", "a1") != nil {
		t.Fatal("two sockets on one session were refused under a session cap of 2")
	}
	if err := take("a", "a1"); !errors.Is(err, errSessionAtLimit) {
		t.Fatalf("third socket on one session: err %v, want the session cap", err)
	}
	if err := take("a", "a2"); err != nil {
		t.Fatalf("a second session of the account was refused: %v", err)
	}
	if err := take("a", "a3"); !errors.Is(err, errAccountAtLimit) {
		t.Fatalf("fourth socket for the account: err %v, want the account cap", err)
	}
	if total, acct, sess := counts(gw, "a", "a1"); total != 3 || acct != 3 || sess != 2 {
		t.Fatalf("after two refusals: total %d, account %d, session %d; want 3, 3, 2", total, acct, sess)
	}

	leases[0].release()
	leases[0].release() // a second release must not give back a slot it no longer holds
	if total, acct, sess := counts(gw, "a", "a1"); total != 2 || acct != 2 || sess != 1 {
		t.Fatalf("after one release twice: total %d, account %d, session %d; want 2, 2, 1", total, acct, sess)
	}
	for _, l := range leases {
		l.release()
	}
	gw.slots.mu.Lock()
	defer gw.slots.mu.Unlock()
	if gw.slots.total != 0 || len(gw.slots.perAccount) != 0 || len(gw.slots.perSession) != 0 {
		t.Fatalf("after every release: total %d, %d accounts, %d sessions; want all zero",
			gw.slots.total, len(gw.slots.perAccount), len(gw.slots.perSession))
	}
}

// TestFullReplicaClosesUpgradeWithTryAgainLater pins the refusal a client sees
// on a full replica: the handshake completes and the first frame is a close
// with 1013 (try again later) and reason at_capacity (contracts/websocket.md
// "Close codes"), so a browser can read why and retry on the other replica.
func TestFullReplicaClosesUpgradeWithTryAgainLater(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{MaxSockets: 1})
	full, ok := gw.admit()
	if !ok {
		t.Fatal("could not fill the replica")
	}
	defer full.release()
	srv, done := serveUpgrades(t, NewHandler(nil, gw, discardLog(), nil, nil))

	code, reason := dialUpgrade(t, srv, "")
	<-done
	if code != CloseTryAgainLater || reason != reasonAtCapacity {
		t.Fatalf("close = %d %q, want %d %q", code, reason, CloseTryAgainLater, reasonAtCapacity)
	}
	if total, _, _ := counts(gw, "", ""); total != 1 {
		t.Fatalf("refused upgrade left %d slots taken, want 1", total)
	}
}

// TestOneAccountCannotLockOthersOut is issue #288: an account at its cap is
// refused with 1013 connection_limit while a second account still gets
// through, and once one of the first account's sockets closes it can connect
// again. "Gets through" means the upgrade passed every cap and reached
// registration, which the fake store then fails, so the server closes that
// socket too and its slots must come back.
func TestOneAccountCannotLockOthersOut(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{MaxSockets: 10, MaxSocketsPerAccount: 2, MaxSocketsPerSession: 2})
	store := newFakeUpgradeStore()
	h := NewHandler(nil, gw, discardLog(), nil, nil)
	h.upgrades = store
	srv, done := serveUpgrades(t, h)

	first := hold(t, gw, "acct-a", "sess-a1")
	hold(t, gw, "acct-a", "sess-a2")

	code, reason := dialUpgrade(t, srv, store.ticket("acct-a", "sess-a3"))
	<-done
	if code != CloseTryAgainLater || reason != reasonConnectionLimit {
		t.Fatalf("account over its cap: close = %d %q, want %d %q", code, reason, CloseTryAgainLater, reasonConnectionLimit)
	}

	code, reason = dialUpgrade(t, srv, store.ticket("acct-b", "sess-b1"))
	<-done
	if code != CloseNormal || reason != "registration failed" || !store.registered("acct-b") {
		t.Fatalf("second account: close = %d %q, registered %v; want it past the caps and into registration",
			code, reason, store.registered("acct-b"))
	}
	if total, acct, _ := counts(gw, "acct-a", ""); total != 2 || acct != 2 {
		t.Fatalf("after one refusal and one closed socket: total %d, account a %d; want 2 and 2 (only the held sockets)", total, acct)
	}
	if _, acct, sess := counts(gw, "acct-b", "sess-b1"); acct != 0 || sess != 0 {
		t.Fatalf("the second account's closed socket left account %d, session %d slots taken", acct, sess)
	}

	first.release() // one of account a's sockets closes
	code, reason = dialUpgrade(t, srv, store.ticket("acct-a", "sess-a3"))
	<-done
	if code != CloseNormal || !store.registered("acct-a") {
		t.Fatalf("after a socket closed: close = %d %q; want account a past the caps again", code, reason)
	}
}

// TestSlotsComeBackAfterAFailedHandshake pins the error paths after admit: a
// ticket that resolves but a handshake that fails, and an upgrade with no
// ticket at all, must each give back every slot. Under caps of 1 a single
// leaked slot would refuse the final upgrade.
func TestSlotsComeBackAfterAFailedHandshake(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{MaxSockets: 1, MaxSocketsPerAccount: 1, MaxSocketsPerSession: 1})
	store := newFakeUpgradeStore()
	h := NewHandler(nil, gw, discardLog(), nil, nil)
	h.upgrades = store

	// The ticket resolves and the account and session are bound, then the
	// request turns out not to be a WebSocket handshake.
	rec := httptest.NewRecorder()
	h.Upgrade(rec, httptest.NewRequest(http.MethodGet, "/v1/ws?ticket="+store.ticket("acct-a", "sess-a1"), nil))
	if store.consumedCount() != 1 {
		t.Fatal("the ticket was never resolved, so the handshake failure was not reached")
	}
	if total, acct, sess := counts(gw, "acct-a", "sess-a1"); total != 0 || acct != 0 || sess != 0 {
		t.Fatalf("after a failed handshake: total %d, account %d, session %d; want all zero", total, acct, sess)
	}

	rec = httptest.NewRecorder()
	h.Upgrade(rec, httptest.NewRequest(http.MethodGet, "/v1/ws", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("upgrade without a ticket: status %d, want 401", rec.Code)
	}

	srv, done := serveUpgrades(t, h)
	code, reason := dialUpgrade(t, srv, store.ticket("acct-a", "sess-a1"))
	<-done
	if code != CloseNormal || !store.registered("acct-a") {
		t.Fatalf("after the failures: close = %d %q; want the account past every cap of 1", code, reason)
	}
}

// TestUpgradeAttemptsAreLimitedPerSlash64 pins the per-address attempt cap.
// An IPv6 caller can send from any address in its /64, so the whole /64 shares
// one budget, while the next /64 and an IPv4 caller keep their own. A refused
// attempt never reaches the ticket lookup.
func TestUpgradeAttemptsAreLimitedPerSlash64(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{UpgradesPerAddress: 2})
	store := newFakeUpgradeStore()
	h := NewHandler(nil, gw, discardLog(), nil, newCountingLimiter())
	h.upgrades = store

	attempt := func(remoteAddr, ticket string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/v1/ws?ticket="+ticket, nil)
		r.RemoteAddr = remoteAddr
		rec := httptest.NewRecorder()
		h.Upgrade(rec, r)
		return rec
	}
	// Two attempts from different addresses in 2001:db8:1:2::/64 use its budget.
	// They carry unknown tickets, so they are refused 401 after the lookup.
	for _, addr := range []string{"[2001:db8:1:2::1]:4000", "[2001:db8:1:2::2]:4001"} {
		if rec := attempt(addr, "unknown"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt from %s within the budget: status %d, want 401", addr, rec.Code)
		}
	}

	lookups := store.consumedCount()
	rec := attempt("[2001:db8:1:2:ffff:ffff:ffff:ffff]:4002", store.ticket("acct-a", "sess-a1"))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "60" {
		t.Fatalf("third attempt from the same /64: status %d, Retry-After %q; want 429 and 60",
			rec.Code, rec.Header().Get("Retry-After"))
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error.Code != string(httpx.CodeRateLimited) {
		t.Fatalf("refusal body %s: want error code %s", rec.Body.String(), httpx.CodeRateLimited)
	}
	if store.consumedCount() != lookups {
		t.Fatal("a refused attempt still looked up its ticket")
	}

	for _, addr := range []string{"[2001:db8:1:3::1]:4000", "203.0.113.7:4000"} {
		if rec := attempt(addr, "unknown"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt from %s, another caller: status %d, want 401", addr, rec.Code)
		}
	}
}

// TestTicketMintsAreLimitedPerSession pins the per-session mint cap: a
// session over its budget gets 429 before anything is minted, and another
// session keeps its own budget. The requests omit X-HG-Client, so one within
// the budget stops at the 400 that follows the limit check, before Postgres.
func TestTicketMintsAreLimitedPerSession(t *testing.T) {
	gw := NewGateway(nil, nil, discardLog(), nil, Limits{TicketsPerSession: 1})
	h := NewHandler(nil, gw, discardLog(), nil, newCountingLimiter())
	mint := func(sessionID string) int {
		r := httptest.NewRequest(http.MethodPost, "/v1/realtime/ticket", nil)
		r = r.WithContext(httpx.WithPrincipalForTest(r.Context(), httpx.Principal{AccountID: "acct-a", SessionID: sessionID}))
		rec := httptest.NewRecorder()
		h.CreateTicket(rec, r)
		return rec.Code
	}
	if got := mint("sess-1"); got != http.StatusBadRequest {
		t.Fatalf("first mint for a session: status %d, want it past the limit (400 for the missing header)", got)
	}
	if got := mint("sess-1"); got != http.StatusTooManyRequests {
		t.Fatalf("second mint for the session: status %d, want 429", got)
	}
	if got := mint("sess-2"); got != http.StatusBadRequest {
		t.Fatalf("first mint for another session: status %d, want it past the limit", got)
	}
}

// fakeUpgradeStore resolves tickets it issued and records registrations, which
// it then fails: without Postgres there is nothing to serve a socket from, and
// the upgrade's registration error path closes the socket with 1000.
type fakeUpgradeStore struct {
	mu       sync.Mutex
	tickets  map[string]TicketPrincipal
	consumed int
	accounts map[string]bool
}

func newFakeUpgradeStore() *fakeUpgradeStore {
	return &fakeUpgradeStore{tickets: map[string]TicketPrincipal{}, accounts: map[string]bool{}}
}

func (f *fakeUpgradeStore) ticket(accountID, sessionID string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw := newEventULID()
	f.tickets[raw] = TicketPrincipal{AccountID: accountID, SessionID: sessionID, RolesSnapshot: json.RawMessage(`["CUSTOMER"]`)}
	return raw
}

func (f *fakeUpgradeStore) ConsumeTicket(_ context.Context, raw string) (TicketPrincipal, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.consumed++
	p, ok := f.tickets[raw]
	if !ok {
		return TicketPrincipal{}, errors.New("unknown ticket")
	}
	delete(f.tickets, raw)
	return p, nil
}

func (f *fakeUpgradeStore) AuditTicketReuse(context.Context, string, string) error { return nil }

func (f *fakeUpgradeStore) RegisterConnection(_ context.Context, accountID, _, _ string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.accounts[accountID] = true
	return "", errors.New("no Postgres in this test")
}

func (f *fakeUpgradeStore) consumedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.consumed
}

func (f *fakeUpgradeStore) registered(accountID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.accounts[accountID]
}

// countingLimiter is auth.RateLimiter's fixed window without Redis: each call
// counts against the name and subject, and a count over limit is refused. The
// window never rolls over within a test.
type countingLimiter struct {
	mu sync.Mutex
	n  map[string]int64
}

func newCountingLimiter() *countingLimiter { return &countingLimiter{n: map[string]int64{}} }

func (l *countingLimiter) Allow(_ context.Context, name, subject string, limit int64, _ time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := name + ":" + subject
	l.n[key]++
	return l.n[key] <= limit, nil
}

// serveUpgrades serves h.Upgrade and signals done each time a handler returns,
// so a test reads the slot counts only after the upgrade's deferred release.
func serveUpgrades(t *testing.T, h *Handler) (*httptest.Server, <-chan struct{}) {
	t.Helper()
	done := make(chan struct{}, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() { done <- struct{}{} }()
		h.Upgrade(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, done
}

// dialUpgrade performs a raw WebSocket handshake for ticket and returns the
// close code and reason of the first frame, which must be a close.
func dialUpgrade(t *testing.T, srv *httptest.Server, ticket string) (uint16, string) {
	t.Helper()
	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	path := "/v1/ws"
	if ticket != "" {
		path += "?ticket=" + ticket
	}
	// The handshake nonce is any 16 bytes, base64-encoded (RFC 6455).
	nonce := base64.StdEncoding.EncodeToString([]byte("capacity-test-16"))
	_, err = io.WriteString(conn, "GET "+path+" HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: "+nonce+"\r\n\r\n")
	if err != nil {
		t.Fatalf("write handshake: %v", err)
	}

	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatalf("read handshake response: %v", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", resp.StatusCode)
	}
	op, body, err := readServerFrame(br)
	if err != nil || op != opClose || len(body) < 2 {
		t.Fatalf("first frame: op %d, err %v; want a close frame", op, err)
	}
	return binary.BigEndian.Uint16(body), string(body[2:])
}
