package accountstate

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// TestOnlyTheOwnersWriteAnAccountsState: in the Go code, only the owners named in
// principals.go write an account's state or its history. Migration 00035 refuses
// any other path when it runs; this names the file at review time, and catches a
// path that would write a history row itself and so skip the two-step sign-in
// check, which only ApplyAccountAction can make.
func TestOnlyTheOwnersWriteAnAccountsState(t *testing.T) {
	const admin = "internal/admin/store_account_state.go"
	owners := map[string][]string{
		"restaurant.account_state":     {admin, "internal/restaurant/onboarding_state.go"},
		"restaurant.delist_reasons":    {admin, "internal/restaurant/onboarding_state.go"},
		"rider_profile.account_status": {admin},
		"account.status":               {admin},
		"account_state_event":          {admin},
	}
	update := regexp.MustCompile(`(?is)\bUPDATE\s+"?(restaurant|rider_profile|account)"?(?:\s+(?:AS\s+)?\w+)?\s+SET\s+(.*?)(?:\bWHERE\b|\bRETURNING\b|\bFROM\b|$)`)
	column := regexp.MustCompile(`(?i)(?:^|[\s,(])(account_state|delist_reasons|account_status|status)\s*=`)
	insert := regexp.MustCompile(`(?is)\bINSERT\s+INTO\s+account_state_event\b`)

	root := filepath.Join("..", "..")
	found := map[string][]string{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			s, err := strconv.Unquote(lit.Value)
			if err != nil {
				return true
			}
			for _, m := range update.FindAllStringSubmatch(s, -1) {
				for _, c := range column.FindAllStringSubmatch(m[2], -1) {
					col := strings.ToLower(c[1])
					table := strings.ToLower(m[1])
					switch {
					case table == "restaurant" && (col == "account_state" || col == "delist_reasons"),
						table == "rider_profile" && col == "account_status",
						table == "account" && col == "status":
						found[table+"."+col] = append(found[table+"."+col], rel)
					}
				}
			}
			if insert.MatchString(s) {
				found["account_state_event"] = append(found["account_state_event"], rel)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for what, files := range found {
		for _, file := range files {
			allowed := false
			for _, o := range owners[what] {
				allowed = allowed || o == file
			}
			if !allowed {
				t.Errorf("%s writes %s; only %v may (see principals.go, and migration 00035 refuses it at run time)",
					file, what, owners[what])
			}
		}
	}
	// The scan must still see the owners, or it has stopped working.
	for what, want := range owners {
		for _, o := range want {
			seen := false
			for _, f := range found[what] {
				seen = seen || f == o
			}
			if !seen {
				t.Errorf("the scan no longer finds %s writing %s; fix the scan or the owner list", o, what)
			}
		}
	}
}
