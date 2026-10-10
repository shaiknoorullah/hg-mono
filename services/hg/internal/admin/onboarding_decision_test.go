package admin

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// An application decision end to end, as the partner lives it
// (docs/spec/05-admin.md, "A-18" for restaurants and "A-23" for riders): the
// live blockers, the decision and everything written with it in one
// transaction (state, transition, audit, the partner's realtime event and
// email), and the hand-over to the payout account step. Runs on a database of
// its own, on HG_TEST_POSTGRES_DSN's server or in a throwaway container, so
// the weekly coverage scan, which has no shared database, runs it too.

// sentDecisions records the decision emails a decision enqueues.
type sentDecisions struct {
	mu   sync.Mutex
	sent []notify.New
}

func (s *sentDecisions) Enqueue(_ context.Context, _ pgx.Tx, n notify.New) (notify.EnqueueResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, n)
	return notify.EnqueueResult{Queued: true}, nil
}

func (s *sentDecisions) to(accountID string) []notify.New {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []notify.New
	for _, n := range s.sent {
		if n.AccountID.String() == accountID {
			out = append(out, n)
		}
	}
	return out
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func text(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) string {
	t.Helper()
	var s *string
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if s == nil {
		return ""
	}
	return *s
}

// onboardingEvents is the onboarding.state_changed events on an account's
// channel, as "from>to".
func onboardingEvents(t *testing.T, pool *pgxpool.Pool, accountID string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT coalesce(payload->>'from', '') || '>' || (payload->>'to')
		  FROM realtime_event WHERE channel = $1 AND type = 'onboarding.state_changed' ORDER BY seq`,
		realtime.AccountChannel(accountID))
	if err != nil {
		t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestOnboardingDecisions(t *testing.T) {
	ctx := context.Background()
	pool := testseed.MigratedDatabase(t, "hg_admin_onboarding")
	emails := &sentDecisions{}
	repo := NewRepo(pool).WithNotifications(emails, nil)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-onboarding"}
	at := time.Now().UTC()

	t.Run("an unknown application is not found", func(t *testing.T) {
		const none = "01999999-9999-7999-8999-999999999999"
		if _, err := repo.GetRestaurantApplication(ctx, none, 30, at); !errors.Is(err, ErrNotFound) {
			t.Errorf("restaurant review screen: %v, want ErrNotFound", err)
		}
		if _, err := repo.DecideRestaurantApplication(ctx, actor, none, "APPROVE", "ALL_CHECKS_PASSED", "fine", 30, at); !errors.Is(err, ErrNotFound) {
			t.Errorf("restaurant decision: %v, want ErrNotFound", err)
		}
		if _, err := repo.GetRiderApplication(ctx, none, at); !errors.Is(err, ErrNotFound) {
			t.Errorf("rider review screen: %v, want ErrNotFound", err)
		}
		if _, err := repo.DecideRiderApplication(ctx, actor, none, "APPROVE", "ALL_CHECKS_PASSED", "fine", at); !errors.Is(err, ErrNotFound) {
			t.Errorf("rider decision: %v, want ErrNotFound", err)
		}
	})

	t.Run("a restaurant is approved only when every check is met, then waits for its payout account", func(t *testing.T) {
		blocked := seedRestaurantApplication(t, ctx, pool, sa, false)
		screen, err := repo.GetRestaurantApplication(ctx, blocked, 30, at)
		if err != nil {
			t.Fatal(err)
		}
		// Four documents in review and no approved certificate: five blockers.
		if len(screen.blockers) != len(requiredRestaurantDocs)+1 {
			t.Fatalf("blockers = %v; want each unapproved document and the missing halal certificate", screen.blockers)
		}
		_, err = repo.DecideRestaurantApplication(ctx, actor, blocked, "APPROVE", "ALL_CHECKS_PASSED", "Looks good.", 30, at)
		var pe preconditionError
		if !errors.As(err, &pe) || len(pe.Blockers) != len(screen.blockers) {
			t.Fatalf("approving a blocked application: %v; want the same live blockers", err)
		}
		if got := text(t, pool, `SELECT onboarding_state::text FROM restaurant WHERE id = $1`, blocked); got != "DOCUMENTS_REVIEW" {
			t.Fatalf("a refused approval moved the restaurant to %s", got)
		}
		if n := count(t, pool, `SELECT count(*) FROM audit_event WHERE subject_id = $1`, blocked); n != 0 {
			t.Fatalf("a refused approval wrote %d audit rows", n)
		}

		ready := seedRestaurantApplication(t, ctx, pool, sa, true)
		owner := text(t, pool, `INSERT INTO account (email, status) VALUES ('owner-'||md5(random()::text)||'@hg.test', 'ACTIVE') RETURNING id::text`)
		if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`, owner, ready); err != nil {
			t.Fatal(err)
		}
		const reason = "Your certificate and documents all check out."
		decided, err := repo.DecideRestaurantApplication(ctx, actor, ready, "APPROVE", "ALL_CHECKS_PASSED", reason, 30, at)
		if err != nil {
			t.Fatalf("approve: %v", err)
		}
		if decided.profile.OnboardingState != "PAYOUT_PENDING" || decided.profile.AccountState == "LIVE" || decided.certID == nil {
			t.Fatalf("after approval: state %s, account %s, cert %v; want PAYOUT_PENDING, not live, the certificate shown",
				decided.profile.OnboardingState, decided.profile.AccountState, decided.certID)
		}
		if got := text(t, pool, `SELECT decided_by::text FROM restaurant_application WHERE restaurant_id = $1`, ready); got != sa {
			t.Errorf("decided_by = %q, want the signed-in admin", got)
		}
		if n := count(t, pool, `SELECT count(*) FROM restaurant_onboarding_transition
		     WHERE restaurant_id = $1 AND from_state = 'DOCUMENTS_REVIEW' AND to_state = 'DOCUMENTS_APPROVED'
		       AND actor_kind = 'ADMIN' AND actor_account_id = $2`, ready, sa); n != 1 {
			t.Errorf("%d DOCUMENTS_REVIEW→DOCUMENTS_APPROVED transitions by the admin, want 1", n)
		}
		if n := count(t, pool, `SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = 'restaurant.approve'`, ready); n != 1 {
			t.Errorf("%d restaurant.approve audit rows, want 1", n)
		}
		// The owner hears it twice over, in the decision's transaction: their
		// account channel, and an email carrying the admin's reason verbatim.
		if got := onboardingEvents(t, pool, owner); len(got) == 0 || got[0] != "DOCUMENTS_REVIEW>DOCUMENTS_APPROVED" {
			t.Errorf("owner's onboarding events = %v; want DOCUMENTS_REVIEW>DOCUMENTS_APPROVED first", got)
		}
		if sent := emails.to(owner); len(sent) != 1 || sent[0].Kind != notify.KindRestaurantApplicationApproved {
			t.Errorf("owner's decision emails = %+v, want one", sent)
		}

		// A second decision is refused.
		if _, err := repo.DecideRestaurantApplication(ctx, actor, ready, "REJECT", "OTHER", "Changed my mind.", 30, at); !errors.Is(err, ErrAlreadyDecided) {
			t.Fatalf("second decision: %v, want ErrAlreadyDecided", err)
		}

		// The payout account is the next step: once Stripe enables payouts the
		// restaurant moves on to its menu.
		if _, err := pool.Exec(ctx, `
			INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
			VALUES ('RESTAURANT', $1, $2, true, true)`, ready, "acct_"+ready); err != nil {
			t.Fatal(err)
		}
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return restaurant.RecomputeOnboarding(ctx, tx, ready) }); err != nil {
			t.Fatal(err)
		}
		if got := text(t, pool, `SELECT onboarding_state::text FROM restaurant WHERE id = $1`, ready); got != "MENU_PENDING" {
			t.Fatalf("after the payout account: %s, want MENU_PENDING", got)
		}
	})

	t.Run("requesting changes sends a restaurant back with its reason", func(t *testing.T) {
		id := seedRestaurantApplication(t, ctx, pool, sa, false)
		decided, err := repo.DecideRestaurantApplication(ctx, actor, id, "REQUEST_CHANGES", "DOCUMENTS_INSUFFICIENT",
			"The food safety certificate is unreadable.", 30, at)
		if err != nil || decided.profile.OnboardingState != "DOCUMENTS_REJECTED" {
			t.Fatalf("request changes: %+v err=%v; want DOCUMENTS_REJECTED", decided.profile, err)
		}
		if got := text(t, pool, `SELECT reject_reason_code::text FROM restaurant_application WHERE restaurant_id = $1`, id); got != "DOCUMENTS_INSUFFICIENT" {
			t.Errorf("stored reason = %q", got)
		}
		if n := count(t, pool, `SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = 'restaurant.request_changes'`, id); n != 1 {
			t.Errorf("%d restaurant.request_changes audit rows, want 1", n)
		}
	})

	t.Run("a rider under 18 on the decision date is never approved", func(t *testing.T) {
		// Nineteen today, so the schema admits them; the decision is dated ten
		// years back, when they were nine. The age is the server's, from the
		// date of birth, and no reviewer can override it.
		id := seedRiderApplication(t, ctx, pool, sa, 19)
		if _, err := repo.DecideRiderApplication(ctx, actor, id, "APPROVE", "ALL_CHECKS_PASSED", "Welcome.", at.AddDate(-10, 0, 0)); !errors.Is(err, ErrAgeNotMet) {
			t.Fatalf("approving an under-18 rider: %v, want ErrAgeNotMet", err)
		}
		if n := count(t, pool, `SELECT count(*) FROM rider_application WHERE account_id = $1 AND decided_at IS NOT NULL`, id); n != 0 {
			t.Fatal("a refused approval recorded a decision")
		}
	})

	t.Run("a rider with no approved document is blocked", func(t *testing.T) {
		id := seedRiderApplication(t, ctx, pool, sa, 25)
		if _, err := pool.Exec(ctx, `UPDATE kyc_document SET state = 'REJECTED', rejection_reason_code = 'ILLEGIBLE' WHERE subject_id = $1`, id); err != nil {
			t.Fatal(err)
		}
		_, err := repo.DecideRiderApplication(ctx, actor, id, "APPROVE", "ALL_CHECKS_PASSED", "Welcome.", at)
		var pe preconditionError
		if !errors.As(err, &pe) || len(pe.Blockers) != 1 {
			t.Fatalf("approving with no approved document: %v; want one blocker", err)
		}
	})

	t.Run("a rejected rider keeps the reason and is not approved", func(t *testing.T) {
		id := seedRiderApplication(t, ctx, pool, sa, 25)
		decided, err := repo.DecideRiderApplication(ctx, actor, id, "REJECT", "ILLEGIBLE", "The photo of your licence is blurred.", at)
		if err != nil || decided.profile.OnboardingState != "DOCUMENTS_REJECTED" {
			t.Fatalf("reject: %+v err=%v", decided.profile, err)
		}
		if got := text(t, pool, `SELECT reject_reason_code::text || '|' || review_note FROM rider_application WHERE account_id = $1`, id); got != "ILLEGIBLE|The photo of your licence is blurred." {
			t.Errorf("stored decision = %q", got)
		}
		if got := text(t, pool, `SELECT approved_at::text FROM rider_profile WHERE account_id = $1`, id); got != "" {
			t.Errorf("a rejected rider has approved_at %s", got)
		}
		if got := onboardingEvents(t, pool, id); len(got) != 1 || got[0] != "DOCUMENTS_REVIEW>DOCUMENTS_REJECTED" {
			t.Errorf("rider's onboarding events = %v", got)
		}
		if sent := emails.to(id); len(sent) != 1 || sent[0].Kind != notify.KindRiderApplicationRejected {
			t.Errorf("rider's decision emails = %+v, want one", sent)
		}
	})

	t.Run("a rider whose payouts are already on goes straight to ACTIVE", func(t *testing.T) {
		id := seedRiderApplication(t, ctx, pool, sa, 25)
		if _, err := pool.Exec(ctx, `
			INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
			VALUES ('RIDER', $1, $2, true, true)`, id, "acct_"+id); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.DecideRiderApplication(ctx, actor, id, "APPROVE", "ALL_CHECKS_PASSED", "Welcome aboard.", at); err != nil {
			t.Fatalf("approve: %v", err)
		}
		got := text(t, pool, `SELECT onboarding_state::text || '|' || account_status::text || '|' || approved_by::text
		                        FROM rider_profile WHERE account_id = $1`, id)
		if got != "ACTIVE|ACTIVE|"+sa {
			t.Fatalf("rider after approval = %q, want ACTIVE|ACTIVE|<the admin>", got)
		}
		if n := count(t, pool, `SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = 'rider.approve'`, id); n != 1 {
			t.Errorf("%d rider.approve audit rows, want 1", n)
		}
	})

	t.Run("an unknown decision writes nothing", func(t *testing.T) {
		id := seedRiderApplication(t, ctx, pool, sa, 25)
		if _, err := repo.DecideRiderApplication(ctx, actor, id, "MAYBE", "", "Hmm.", at); err == nil {
			t.Fatal("decision MAYBE was accepted")
		}
		if n := count(t, pool, `SELECT count(*) FROM rider_application WHERE account_id = $1 AND decided_at IS NOT NULL`, id); n != 0 {
			t.Fatal("an unknown decision was recorded")
		}
	})
}
