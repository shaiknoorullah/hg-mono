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

// writes names the SQL that writes an account's state or its history: an UPDATE
// of restaurant.account_state or delist_reasons, rider_profile.account_status or
// account.status, an INSERT naming one of those columns, or an INSERT into
// account_state_event.
func writes(sql string) []string {
	var out []string
	update := regexp.MustCompile(`(?is)\bUPDATE\s+"?(restaurant|rider_profile|account)"?(?:\s+(?:AS\s+)?\w+)?\s+SET\s+(.*?)(?:\bWHERE\b|\bRETURNING\b|\bFROM\b|$)`)
	insert := regexp.MustCompile(`(?is)\bINSERT\s+INTO\s+"?(restaurant|rider_profile|account)"?\s*\(([^)]*)\)`)
	column := regexp.MustCompile(`(?i)(?:^|[\s,(])(account_state|delist_reasons|account_status|status|status_reason)\s*(?:=|,|$)`)
	state := map[string]map[string]bool{
		"restaurant":    {"account_state": true, "delist_reasons": true},
		"rider_profile": {"account_status": true},
		"account":       {"status": true, "status_reason": true},
	}
	for _, re := range []*regexp.Regexp{update, insert} {
		for _, m := range re.FindAllStringSubmatch(sql, -1) {
			table := strings.ToLower(m[1])
			for _, c := range column.FindAllStringSubmatch(m[2], -1) {
				if col := strings.ToLower(c[1]); state[table][col] {
					out = append(out, table+"."+col)
				}
			}
		}
	}
	if regexp.MustCompile(`(?is)\bINSERT\s+INTO\s+account_state_event\b`).MatchString(sql) {
		out = append(out, "account_state_event")
	}
	return out
}

// TestNoGoCodeWritesAnAccountsState: no Go file writes an account's state or its
// history. Migration 00035 makes the database functions (account_state_apply and
// the system principals' functions) the only writers and refuses the application
// role anything else; this names an offending file at review time.
func TestNoGoCodeWritesAnAccountsState(t *testing.T) {
	// The scan still sees a write.
	for _, sql := range []string{
		`UPDATE restaurant r SET is_accepting_orders = false, account_state = 'SUSPENDED' WHERE r.id = $1`,
		`UPDATE account SET status='BANNED' WHERE id=$1`,
		`INSERT INTO rider_profile (account_id, account_status) VALUES ($1, 'ACTIVE')`,
		`INSERT INTO account_state_event (subject_type) VALUES ('RIDER')`,
	} {
		if len(writes(sql)) == 0 {
			t.Fatalf("the scan no longer sees a write in %q", sql)
		}
	}
	if w := writes(`UPDATE account SET email = $2, status_note = $3 WHERE id = $1`); len(w) != 0 {
		t.Fatalf("the scan sees a write where there is none: %v", w)
	}

	root := filepath.Join("..", "..")
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
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			if s, err := strconv.Unquote(lit.Value); err == nil {
				for _, w := range writes(s) {
					t.Errorf("%s writes %s; only the database functions of migration 00035 may", filepath.ToSlash(rel), w)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
