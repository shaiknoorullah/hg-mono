package auth

import (
	"sort"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestMatrixGolden pins the role→action map so any permission change is a visible
// diff (P-05 acceptance #1). Update the golden set deliberately when the matrix
// changes.
func TestMatrixGolden(t *testing.T) {
	golden := map[httpx.Action]struct{}{
		ActionSessionReadSelf:   {},
		ActionSessionRevokeSelf: {},
		platformDepsRead:        {},
	}
	got := AllActions()
	if len(got) != len(golden) {
		t.Fatalf("matrix has %d actions, golden has %d", len(got), len(golden))
	}
	for a := range golden {
		if _, ok := got[a]; !ok {
			t.Errorf("golden action %q missing from matrix", a)
		}
	}
	var names []string
	for a := range got {
		names = append(names, string(a))
	}
	sort.Strings(names)
	t.Logf("matrix actions: %v", names)
}

func TestMatrixRoleHasAction(t *testing.T) {
	m := Matrix{}
	if !m.RoleHasAction([]httpx.Role{httpx.RoleCustomer}, ActionSessionReadSelf) {
		t.Error("CUSTOMER should hold session.read_self")
	}
	if m.RoleHasAction([]httpx.Role{httpx.RoleCustomer}, platformDepsRead) {
		t.Error("CUSTOMER must not hold platform_deps.read")
	}
	if !m.RoleHasAction([]httpx.Role{httpx.RoleAdmin}, platformDepsRead) {
		t.Error("ADMIN should hold platform_deps.read")
	}
	if m.RoleHasAction(nil, ActionSessionReadSelf) {
		t.Error("no roles must grant nothing")
	}
}

// TestEveryRouteActionIsInMatrix is I-05.1 for this module: every non-public
// route's declared action exists in the matrix.
func TestEveryRouteActionIsInMatrix(t *testing.T) {
	declared := []httpx.Action{ActionSessionReadSelf, ActionSessionRevokeSelf}
	all := AllActions()
	for _, a := range declared {
		if _, ok := all[a]; !ok {
			t.Errorf("route action %q is not present in the matrix for any role", a)
		}
	}
}
