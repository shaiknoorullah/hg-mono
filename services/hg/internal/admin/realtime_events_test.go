package admin

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// An admin's decision and document review reach the people they are about,
// on their own account channels, in the decision's transaction (issue #376;
// contracts/websocket.md section 4.6): the restaurant's owners and managers,
// never its other staff, and the rider. A rider is not told document by
// document: only the application decision reaches them.

func seedRestaurantPerson(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restaurantID, role string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('p-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, $2, 'RESTAURANT', $3)`, id, role, restaurantID); err != nil {
		t.Fatalf("seed role: %v", err)
	}
	return id
}

type onboardingMove struct {
	SubjectType string  `json:"subject_type"`
	SubjectID   string  `json:"subject_id"`
	From        *string `json:"from"`
	To          string  `json:"to"`
}

func onboardingMoves(t *testing.T, pool *pgxpool.Pool, accountID string) []string {
	t.Helper()
	var out []string
	for _, e := range realtimetest.Events(t, pool, realtime.AccountChannel(accountID), "onboarding.state_changed") {
		var m onboardingMove
		if err := json.Unmarshal(e.Payload, &m); err != nil {
			t.Fatal(err)
		}
		from := "-"
		if m.From != nil {
			from = *m.From
		}
		out = append(out, m.SubjectType+":"+from+"->"+m.To)
	}
	return out
}

func TestRealtime_RestaurantDecisionAndDocumentReview(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-rt"}
	at := time.Now().UTC()

	approvable := seedRestaurantApplication(t, ctx, pool, sa, true)
	owner := seedRestaurantPerson(t, ctx, pool, approvable, "RESTAURANT_OWNER")
	manager := seedRestaurantPerson(t, ctx, pool, approvable, "RESTAURANT_MANAGER")
	staff := seedRestaurantPerson(t, ctx, pool, approvable, "RESTAURANT_STAFF")
	if _, err := repo.DecideRestaurantApplication(ctx, actor, approvable, "APPROVE", "ALL_CHECKS_PASSED",
		"All the checks pass here.", 30, at); err != nil {
		t.Fatalf("approve: %v", err)
	}
	want := []string{"RESTAURANT:DOCUMENTS_REVIEW->DOCUMENTS_APPROVED", "RESTAURANT:DOCUMENTS_APPROVED->PAYOUT_PENDING"}
	for _, who := range []string{owner, manager} {
		if got := onboardingMoves(t, pool, who); !slices.Equal(got, want) {
			t.Errorf("onboarding events = %v, want %v", got, want)
		}
	}
	if got := realtimetest.Events(t, pool, realtime.AccountChannel(staff)); len(got) != 0 {
		t.Errorf("other staff got %v, want nothing", realtimetest.Types(got))
	}

	inReview := seedRestaurantApplication(t, ctx, pool, sa, false)
	reviewOwner := seedRestaurantPerson(t, ctx, pool, inReview, "RESTAURANT_OWNER")
	var docID string
	if err := pool.QueryRow(ctx, `SELECT id FROM kyc_document WHERE subject_id = $1 ORDER BY created_at LIMIT 1`,
		inReview).Scan(&docID); err != nil {
		t.Fatal(err)
	}
	code, note := "ILLEGIBLE", "internal: the scan is a photo of a screen"
	if _, err := repo.ReviewDocument(ctx, actor, docID, "RESTAURANT", "REJECT", &code, &note, true); err != nil {
		t.Fatalf("review: %v", err)
	}
	events := realtimetest.Events(t, pool, realtime.AccountChannel(reviewOwner))
	if !slices.Equal(realtimetest.Types(events), []string{"document.review_state_changed"}) {
		t.Fatalf("owner got %v, want one document.review_state_changed", realtimetest.Types(events))
	}
	var reviewed struct {
		DocumentID string  `json:"document_id"`
		State      string  `json:"state"`
		Reason     *string `json:"reason"`
	}
	if err := json.Unmarshal(events[0].Payload, &reviewed); err != nil {
		t.Fatal(err)
	}
	if reviewed.DocumentID != docID || reviewed.State != "REJECTED" || reviewed.Reason == nil || *reviewed.Reason != code {
		t.Errorf("document.review_state_changed = %+v, want %s REJECTED for %s", reviewed, docID, code)
	}
	if strings.Contains(string(events[0].Payload), "photo of a screen") {
		t.Errorf("the reviewer's note reached the restaurant: %s", events[0].Payload)
	}
}

func TestRealtime_RiderDecision(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-rt-r"}

	rider := seedRiderApplication(t, ctx, pool, sa, 25)
	if _, err := pool.Exec(ctx, `UPDATE kyc_document SET state = 'IN_REVIEW', reviewed_by = NULL, reviewed_at = NULL,
		deadline_at = now() + interval '72 hours', deadline_action = 'ESCALATE' WHERE subject_id = $1`, rider); err != nil {
		t.Fatal(err)
	}
	var docID string
	if err := pool.QueryRow(ctx, `SELECT id FROM kyc_document WHERE subject_id = $1`, rider).Scan(&docID); err != nil {
		t.Fatal(err)
	}
	code := "ILLEGIBLE"
	if _, err := repo.ReviewDocument(ctx, actor, docID, "RIDER", "REJECT", &code, nil, true); err != nil {
		t.Fatalf("review: %v", err)
	}
	if got := realtimetest.Events(t, pool, realtime.AccountChannel(rider)); len(got) != 0 {
		t.Fatalf("a document review reached the rider: %v; only the decision may", realtimetest.Types(got))
	}
	if _, err := repo.DecideRiderApplication(ctx, actor, rider, "REQUEST_CHANGES", "ILLEGIBLE",
		"Please resubmit the document.", time.Now().UTC()); err != nil {
		t.Fatalf("decide: %v", err)
	}
	if got := onboardingMoves(t, pool, rider); !slices.Equal(got, []string{"RIDER:DOCUMENTS_REVIEW->DOCUMENTS_REJECTED"}) {
		t.Errorf("onboarding events = %v, want RIDER DOCUMENTS_REVIEW -> DOCUMENTS_REJECTED", got)
	}
}
