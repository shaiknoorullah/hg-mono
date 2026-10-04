package retention

import (
	"regexp"
	"strings"
	"testing"
)

// The ledger, orders, the audit trail and KYC records are kept for years by
// law and are never the retention sweep's to delete (docs/spec/01-platform.md,
// "P-13 — The ledger and the zero-residual invariant", "P-35 — Append-only
// audit trail", "P-29 — Document lifecycle, review and retention"; customer
// orders 7 years in docs/spec/02-customer.md). Money records go with them:
// payments, refunds and payouts.
var protectedPrefixes = []string{
	"ledger", "order", "audit", "deadline_audit", "kyc", "stored_object",
	"payment", "refund", "payout", "earning", "connect_account", "reconciliation",
}

var deleteTarget = regexp.MustCompile(`^\s*DELETE FROM\s+("?[a-z_]+"?)\s`)

// TestRulesNeverDeleteFromProtectedTables pins what the sweep may never touch:
// each rule is exactly one DELETE, its target is the table it is named for,
// and that table is not a protected one.
func TestRulesNeverDeleteFromProtectedTables(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range rules {
		m := deleteTarget.FindStringSubmatch(r.sql)
		if m == nil {
			t.Errorf("rule %q: sql is not a single DELETE FROM <table>: %s", r.table, r.sql)
			continue
		}
		target := strings.Trim(m[1], `"`)
		if target != r.table {
			t.Errorf("rule %q deletes from %q", r.table, target)
		}
		if strings.Count(strings.ToUpper(r.sql), "DELETE") != 1 {
			t.Errorf("rule %q: more than one DELETE in one statement", r.table)
		}
		for _, p := range protectedPrefixes {
			if strings.HasPrefix(target, p) {
				t.Errorf("rule %q deletes from %q, which is protected (%q…)", r.table, target, p)
			}
		}
		if r.keep <= 0 {
			t.Errorf("rule %q keeps rows for %v; a retention period must be positive", r.table, r.keep)
		}
		if seen[r.table] {
			t.Errorf("rule %q appears twice", r.table)
		}
		seen[r.table] = true
	}
}
