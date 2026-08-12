package admin

import (
	"testing"
	"time"
)

func mustDate(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		t.Fatalf("bad date %q: %v", s, err)
	}
	return d
}

// H5 is server-computed and non-overridable: it must fail an expired certificate,
// a reversed date range, and one inside the minimum-remaining-days guard, and
// pass a comfortably-valid one.
func TestComputeH5(t *testing.T) {
	now := mustDate(t, "2026-08-12")
	cases := []struct {
		name    string
		issued  string
		expires string
		minDays int
		want    string
	}{
		{"comfortably valid", "2026-01-01", "2027-01-01", 30, ResultPass},
		{"already expired", "2025-01-01", "2026-08-01", 30, ResultFail},
		{"expires today", "2026-01-01", "2026-08-12", 30, ResultFail},
		{"inside the 30-day guard", "2026-01-01", "2026-08-30", 30, ResultFail},
		{"just outside the guard", "2026-01-01", "2026-09-12", 30, ResultPass},
		{"reversed dates", "2027-01-01", "2026-01-01", 30, ResultFail},
		{"zero guard, valid tomorrow", "2026-01-01", "2026-08-13", 0, ResultPass},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			iss := mustDate(t, c.issued)
			exp := mustDate(t, c.expires)
			got := computeH5(certFacts{issuedOn: &iss, expiresOn: &exp, minRemainingDays: c.minDays, now: now})
			if got != c.want {
				t.Errorf("computeH5(%s..%s, min=%d) = %s, want %s", c.issued, c.expires, c.minDays, got, c.want)
			}
		})
	}
}

// H5 with no dates yet is NOT_ASSESSED, not a spurious FAIL.
func TestComputeH5NotAssessedWithoutDates(t *testing.T) {
	if got := computeH5(certFacts{now: time.Now()}); got != ResultNotAssessed {
		t.Errorf("computeH5 with no dates = %s, want NOT_ASSESSED", got)
	}
}

// H7 fails when a duplicate approved certificate already exists for the same
// issuing body and number.
func TestComputeH7(t *testing.T) {
	if got := computeH7(certFacts{duplicateExists: true}); got != ResultFail {
		t.Errorf("computeH7(duplicate) = %s, want FAIL", got)
	}
	if got := computeH7(certFacts{duplicateExists: false}); got != ResultPass {
		t.Errorf("computeH7(unique) = %s, want PASS", got)
	}
}

// H2 passes only when the issuing body is ACCEPTED at review time.
func TestComputeH2(t *testing.T) {
	if got := computeH2(certFacts{issuerAccepted: true}); got != ResultPass {
		t.Errorf("computeH2(accepted) = %s, want PASS", got)
	}
	if got := computeH2(certFacts{issuerAccepted: false}); got != ResultFail {
		t.Errorf("computeH2(not accepted) = %s, want FAIL", got)
	}
}

// H6 passes only for whole-establishment and kitchen-only scopes at V0.
func TestComputeH6(t *testing.T) {
	cases := map[string]string{
		ScopeWholeEstablishment: ResultPass,
		ScopeKitchenOnly:        ResultPass,
		ScopeSpecificMenuItems:  ResultFail,
		ScopeSupplierChainOnly:  ResultFail,
		"":                      ResultNotAssessed,
	}
	for scope, want := range cases {
		if got := computeH6(certFacts{scope: scope}); got != want {
			t.Errorf("computeH6(%q) = %s, want %s", scope, got, want)
		}
	}
}

// The two hard checks are exactly H5 and H7 — nothing else is non-overridable.
func TestNonOverridable(t *testing.T) {
	for _, k := range AllCheckKeys {
		want := k == CheckDatesValid || k == CheckUniqueNotReused
		if NonOverridable(k) != want {
			t.Errorf("NonOverridable(%s) = %v, want %v", k, NonOverridable(k), want)
		}
	}
}

// The closed checklist is exactly seven keys, in canonical order.
func TestChecklistIsSeven(t *testing.T) {
	if len(AllCheckKeys) != 7 {
		t.Fatalf("checklist has %d keys, want 7", len(AllCheckKeys))
	}
	if AllCheckKeys[0] != CheckLegibleComplete || AllCheckKeys[6] != CheckUniqueNotReused {
		t.Errorf("checklist order is not H1..H7: %v", AllCheckKeys)
	}
}

// computedResults leaves the purely-human checks NOT_ASSESSED (the server has
// nothing to compare against) and computes the four evaluable ones.
func TestComputedResultsShape(t *testing.T) {
	iss := mustDate(t, "2026-01-01")
	exp := mustDate(t, "2027-01-01")
	f := certFacts{
		issuedOn: &iss, expiresOn: &exp, issuerAccepted: true,
		scope: ScopeWholeEstablishment, duplicateExists: false,
		minRemainingDays: 30, now: mustDate(t, "2026-08-12"),
	}
	got := computedResults(f)
	if got[CheckLegibleComplete] != ResultNotAssessed || got[CheckNameMatch] != ResultNotAssessed || got[CheckAddressMatch] != ResultNotAssessed {
		t.Errorf("human-judgement checks should be NOT_ASSESSED: %v", got)
	}
	if got[CheckIssuerAccepted] != ResultPass || got[CheckDatesValid] != ResultPass ||
		got[CheckScopeSufficient] != ResultPass || got[CheckUniqueNotReused] != ResultPass {
		t.Errorf("auto checks should all PASS for a valid cert: %v", got)
	}
}
