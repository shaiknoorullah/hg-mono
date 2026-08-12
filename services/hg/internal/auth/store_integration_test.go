package auth

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// openTestPool connects to the DSN in HG_TEST_POSTGRES_DSN, skipping with a
// clear message when it is unset. The database is assumed already migrated
// (services/hg/migrations). These tests never mutate the schema.
func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("skipping integration test: HG_TEST_POSTGRES_DSN is not set " +
			"(set it to a migrated Postgres DSN to run auth store integration tests)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// uniquePhone returns an E.164 number unlikely to collide across test runs.
func uniquePhone() string {
	n := time.Now().UnixNano() % 1_000_000_0
	return "+1416" + pad7(n)
}

func pad7(n int64) string {
	s := ""
	for i := 0; i < 7; i++ {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func TestIntegrationOTPChallengeLifecycle(t *testing.T) {
	pool := openTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()
	phone := uniquePhone()
	pepper := []byte("integration-test-pepper-1234")

	code, _ := GenerateOTPCode()
	hash := HMACCode(code, pepper)
	ch, err := s.InsertChallenge(ctx, phone, "SIGN_IN", hash, nil, nil)
	if err != nil {
		t.Fatalf("InsertChallenge: %v", err)
	}

	// Wrong code charges an attempt and reports the remainder.
	wrong := HMACCode("000000", pepper)
	if wrong[0] == hash[0] { // astronomically unlikely to matter; keep test deterministic
		wrong[0] ^= 0xff
	}
	out, err := s.ConsumeChallenge(ctx, ch.ID, wrong)
	if err != nil {
		t.Fatalf("ConsumeChallenge wrong: %v", err)
	}
	if out.Consumed || out.InvalidOrExpired {
		t.Fatalf("wrong code outcome = %+v, want incorrect", out)
	}
	if out.AttemptsRemaining != 4 {
		t.Fatalf("attempts remaining = %d, want 4", out.AttemptsRemaining)
	}

	// Correct code consumes.
	out, err = s.ConsumeChallenge(ctx, ch.ID, hash)
	if err != nil {
		t.Fatalf("ConsumeChallenge correct: %v", err)
	}
	if !out.Consumed || out.Phone != phone {
		t.Fatalf("correct code outcome = %+v, want consumed", out)
	}

	// A second consume of the now-consumed challenge is invalid.
	out, err = s.ConsumeChallenge(ctx, ch.ID, hash)
	if err != nil {
		t.Fatalf("ConsumeChallenge replay: %v", err)
	}
	if !out.InvalidOrExpired {
		t.Fatalf("replay outcome = %+v, want invalid/expired", out)
	}
}

func TestIntegrationFindOrCreateByPhone(t *testing.T) {
	pool := openTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()
	phone := uniquePhone()

	acct, isNew, err := s.FindOrCreateByPhone(ctx, phone, "CUSTOMER")
	if err != nil {
		t.Fatalf("FindOrCreateByPhone create: %v", err)
	}
	if !isNew {
		t.Fatal("first call should create a new account")
	}
	if acct.Status != "ACTIVE" || acct.PhoneVerifiedAt == nil {
		t.Fatalf("new account = %+v, want ACTIVE and phone verified", acct)
	}

	// Second call reuses the account (I-01.1) and does not create a second.
	again, isNew, err := s.FindOrCreateByPhone(ctx, phone, "CUSTOMER")
	if err != nil {
		t.Fatalf("FindOrCreateByPhone reuse: %v", err)
	}
	if isNew || again.ID != acct.ID {
		t.Fatalf("second call created a new account (%v) — I-01.1 violated", isNew)
	}

	grants, err := s.RolesFor(ctx, acct.ID)
	if err != nil {
		t.Fatalf("RolesFor: %v", err)
	}
	if len(grants) != 1 || grants[0].Role != "CUSTOMER" {
		t.Fatalf("grants = %+v, want one CUSTOMER grant", grants)
	}
}

func TestIntegrationSessionRotateAndReuse(t *testing.T) {
	pool := openTestPool(t)
	s := NewStore(pool)
	ctx := context.Background()
	phone := uniquePhone()

	acct, _, err := s.FindOrCreateByPhone(ctx, phone, "CUSTOMER")
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	grants, _ := s.RolesFor(ctx, acct.ID)

	_, hash1, _ := NewRefreshToken()
	sess, err := s.CreateSession(ctx, NewSessionParams{
		AccountID:   acct.ID,
		AMR:         "otp",
		Roles:       grants,
		Client:      "customer-app",
		RefreshHash: hash1,
		IdleExpires: time.Now().Add(24 * time.Hour),
		AbsExpires:  time.Now().Add(72 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Rotate once: a fresh session in the same family, old marked rotated.
	_, hash2, _ := NewRefreshToken()
	newSess, err := s.RotateSession(ctx, sess, hash2,
		time.Now().Add(24*time.Hour), time.Now().Add(72*time.Hour), grants)
	if err != nil {
		t.Fatalf("RotateSession: %v", err)
	}
	if newSess.FamilyID != sess.FamilyID {
		t.Fatal("rotated session left the family")
	}

	// The old token is now rotated; presenting it again is reuse.
	old, err := s.SessionByRefreshHash(ctx, hash1)
	if err != nil {
		t.Fatalf("SessionByRefreshHash old: %v", err)
	}
	if old.RotatedAt == nil {
		t.Fatal("old session was not marked rotated")
	}

	// Revoking the family must revoke both.
	if err := s.RevokeFamily(ctx, sess.FamilyID, "reuse_detected"); err != nil {
		t.Fatalf("RevokeFamily: %v", err)
	}
	after, _ := s.SessionByID(ctx, newSess.ID)
	if after.RevokedAt == nil {
		t.Fatal("family revocation did not revoke the successor session")
	}
}
