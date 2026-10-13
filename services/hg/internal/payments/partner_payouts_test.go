package payments

import (
	"context"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// A partner's payout account and what they are paid: the Stripe Connect
// onboarding (docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding
// and payouts (Canada)"), the rider's earnings summary (D-27) and payout
// history, read only by their owner. Runs on a database of its own, on
// HG_TEST_POSTGRES_DSN's server or in a throwaway container (payoutTestDB), so
// the weekly coverage scan runs it too.

func TestConnectOnboarding_ApprovedPartnerGetsOneAccountAndStripesLink(t *testing.T) {
	db := payoutTestDB(t)
	ctx := context.Background()
	rider := seedRider(t, db)
	// An approved rider whose only step left is the payout account.
	mustExec(t, db, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, approved_at)
		VALUES ($1, 'Amina', 'Rider', '1990-01-01', 'PAYOUT_PENDING', now())`, rider)

	var created, links int
	var linkReturn, linkRefresh string
	stripe := &mockStripe{
		ConnectFn: func(in CreateConnectInput) (*StripeAccount, error) {
			created++
			return &StripeAccount{ID: "acct_" + in.OwnerID[:8], DetailsSubmitted: true, PayoutsEnabled: true,
				EventuallyDue: []string{"individual.verification.document"}}, nil
		},
		AccountLinkFn: func(_, ret, ref string) (*StripeAccountLink, error) {
			links++
			linkReturn, linkRefresh = ret, ref
			return &StripeAccountLink{URL: "https://connect.stripe.test/setup/e/abc", ExpiresAt: 1_900_000_000}, nil
		},
	}
	svc := NewService(NewRepo(db), stripe, config.Stripe{}, nil)

	// Before anything: the "start" state, not a 404, with empty lists.
	st, err := svc.GetConnectStatus(ctx, "RIDER", rider)
	if err != nil || st.PayoutsEnabled || st.StripeAccountID != nil || st.Requirements.CurrentlyDue == nil ||
		st.Requirements.PastDue == nil || st.PayoutInterval != "WEEKLY" {
		t.Fatalf("status before onboarding: %+v err=%v; want not ready, empty lists, WEEKLY", st, err)
	}
	_, err = svc.CreateOnboardingLink(ctx, "RIDER", rider)
	wantDomainErr(t, err, string(CodeStepNotAvailable))

	// Not approved: refused before Stripe is asked.
	_, err = svc.CreateConnectAccount(ctx, "RIDER", rider, "", false, "connect:"+rider)
	wantDomainErr(t, err, string(CodeStepNotAvailable))
	if created != 0 {
		t.Fatalf("an unapproved partner reached Stripe %d times", created)
	}

	// Approved: one Express account, however often the partner taps.
	first, err := svc.CreateConnectAccount(ctx, "RIDER", rider, "", true, "connect:"+rider)
	if err != nil || first.StripeAccountID == nil || !first.PayoutsEnabled {
		t.Fatalf("create: %+v err=%v", first, err)
	}
	again, err := svc.CreateConnectAccount(ctx, "RIDER", rider, "", true, "connect:"+rider+":retry")
	if err != nil || created != 1 || *again.StripeAccountID != *first.StripeAccountID {
		t.Fatalf("second create: %+v err=%v created=%d; want the same account, Stripe asked once", again, err, created)
	}
	// Payouts enabled was the rider's last step: they may now go online.
	var state, status string
	if err := db.QueryRow(ctx, `SELECT onboarding_state::text, account_status::text FROM rider_profile WHERE account_id = $1`,
		rider).Scan(&state, &status); err != nil {
		t.Fatal(err)
	}
	if state != "ACTIVE" || status != "ACTIVE" {
		t.Fatalf("rider after the payout account: %s/%s, want ACTIVE/ACTIVE", state, status)
	}
	// Stripe's requirement lists reach the partner verbatim.
	st, err = svc.GetConnectStatus(ctx, "RIDER", rider)
	if err != nil || len(st.Requirements.EventuallyDue) != 1 || st.Requirements.EventuallyDue[0] != "individual.verification.document" {
		t.Fatalf("status after onboarding: %+v err=%v", st, err)
	}

	// The hosted link's return and refresh URLs are the server's, never the
	// client's; with none configured there is no link.
	_, err = svc.CreateOnboardingLink(ctx, "RIDER", rider)
	wantDomainErr(t, err, string(CodeStepNotAvailable))
	svc.cfg = config.Stripe{ConnectReturnURL: "https://partners.halalgoes.test/connect/return",
		ConnectRefreshURL: "https://partners.halalgoes.test/connect/refresh"}
	link, err := svc.CreateOnboardingLink(ctx, "RIDER", rider)
	if err != nil || link.URL != "https://connect.stripe.test/setup/e/abc" || links != 1 ||
		linkReturn != svc.cfg.ConnectReturnURL || linkRefresh != svc.cfg.ConnectRefreshURL {
		t.Fatalf("link: %+v err=%v return=%q refresh=%q", link, err, linkReturn, linkRefresh)
	}
	if exp, err := time.Parse(time.RFC3339, link.ExpiresAt); err != nil || exp.Unix() != 1_900_000_000 {
		t.Fatalf("link expiry %q, want Stripe's, in RFC 3339", link.ExpiresAt)
	}
}

func TestRiderEarningsAndPayouts_OwnersOnly(t *testing.T) {
	db := payoutTestDB(t)
	ctx := context.Background()
	svc := NewService(NewRepo(db), nil, config.Stripe{}, nil)
	rider := seedRider(t, db)

	t.Run("the summary is zero-filled and validated", func(t *testing.T) {
		_, err := svc.EarningsSummary(ctx, rider, "YEAR", "", time.Now().AddDate(0, 0, -7), time.Now())
		wantDomainErr(t, err, "VALIDATION_FAILED")

		// No earnings yet: one empty bucket per day, so a chart cannot lie by
		// omission, and the next payout on Monday's run.
		to := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
		sum, err := svc.EarningsSummary(ctx, rider, "DAY", "", to.AddDate(0, 0, -7), to)
		if err != nil || len(sum.Buckets) != 7 || sum.Total.GrossCents != 0 || sum.Currency != "CAD" || sum.NextPayoutAt == nil {
			t.Fatalf("empty week: %+v err=%v; want 7 empty days in CAD and a next payout", sum, err)
		}
		next, err := time.Parse(time.RFC3339, *sum.NextPayoutAt)
		if err != nil || next.In(mustToronto(t)).Weekday() != time.Monday {
			t.Fatalf("next payout %q: want a Monday in Toronto", *sum.NextPayoutAt)
		}
		weeks, err := svc.EarningsSummary(ctx, rider, "WEEK", "", to.AddDate(0, 0, -7*8), to)
		if err != nil || len(weeks.Buckets) != 8 {
			t.Fatalf("eight weeks: %d buckets err=%v", len(weeks.Buckets), err)
		}
	})

	t.Run("a payout is its owner's alone", func(t *testing.T) {
		// One week's earnings paid out by Monday's run, as in production.
		owner, other := addPartner(t, db, PayeeRider, true), addPartner(t, db, PayeeRider, true)
		earn(t, db, owner, 1149, toronto(2026, 8, 12, 12, 0))
		runAt(t, newTestRunner(db, newStripeTransfers(), 30), toronto(2026, 8, 17, 10, 0))

		mine, err := svc.ListPayouts(ctx, ListPayoutsFilter{OwnerType: PayeeRider, OwnerID: owner.ID})
		if err != nil || len(mine) != 1 || mine[0].AmountCents != 1149 {
			t.Fatalf("owner's payouts: %+v err=%v; want one of CAD 11.49", mine, err)
		}
		_, err = svc.GetPayoutDetail(ctx, PayeeRider, other.ID, mine[0].ID)
		wantDomainErr(t, err, httpxNotFound)
		if theirs, err := svc.ListPayouts(ctx, ListPayoutsFilter{OwnerType: PayeeRider, OwnerID: other.ID}); err != nil || len(theirs) != 0 {
			t.Fatalf("another rider's payouts: %+v err=%v; want none", theirs, err)
		}
		detail, err := svc.GetPayoutDetail(ctx, PayeeRider, owner.ID, mine[0].ID)
		if err != nil || detail.ID != mine[0].ID || detail.Entries == nil {
			t.Fatalf("owner's payout detail: %+v err=%v", detail, err)
		}
	})
}

func mustToronto(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("America/Toronto")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}
