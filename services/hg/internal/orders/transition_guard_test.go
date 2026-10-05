package orders

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The one file allowed to write order.state. The platform spec makes one
// function own every order transition and bans `UPDATE "order" SET state`
// anywhere else (docs/spec/01-platform.md, "P-14 — Order lifecycle states and
// transitions"). A second writer skips the transition table, the deadline
// table, the order_transition row and the realtime event and notification; the
// restaurant's accept, reject and mark-ready did exactly that
// (https://github.com/shaiknoorullah/hg-mono/issues/337).
const orderStateWriter = "internal/orders/transition.go"

var (
	// updateOrderSQL finds an UPDATE of the "order" table and captures its SET
	// list, up to the clause that ends it.
	updateOrderSQL = regexp.MustCompile(`(?is)\bUPDATE\s+(?:ONLY\s+)?(?:"?public"?\.)?"order"(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\s+(.*?)(?:\bWHERE\b|\bFROM\b|\bRETURNING\b|$)`)
	// assignsState finds an assignment to the state column in a SET list:
	// `state =`, `"state" =` or `o.state =`, but not `state_since =`.
	assignsState = regexp.MustCompile(`(?i)(?:^|[\s,(])(?:[a-z_][a-z0-9_]*\.)?"?state"?\s*=`)
)

// writesOrderState reports whether a SQL string assigns order.state.
func writesOrderState(sql string) bool {
	for _, m := range updateOrderSQL.FindAllStringSubmatch(sql, -1) {
		if assignsState.MatchString(m[1]) {
			return true
		}
	}
	return false
}

// orderStateWrites parses one Go file and returns the line of every string
// literal, or constant concatenation of literals, that writes order.state.
func orderStateWrites(t *testing.T, fset *token.FileSet, filename string, src any) []int {
	t.Helper()
	f, err := parser.ParseFile(fset, filename, src, parser.SkipObjectResolution)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	var lines []int
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.BinaryExpr:
			// "UPDATE \"order\" " + "SET state = …" is one query.
			if s, ok := constString(x); ok {
				if writesOrderState(s) {
					lines = append(lines, fset.Position(x.Pos()).Line)
				}
				return false
			}
		case *ast.BasicLit:
			if s, ok := constString(x); ok && writesOrderState(s) {
				lines = append(lines, fset.Position(x.Pos()).Line)
			}
		}
		return true
	})
	return lines
}

// constString folds a string literal, or a + chain of them, to its value.
func constString(e ast.Expr) (string, bool) {
	switch x := e.(type) {
	case *ast.BasicLit:
		if x.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(x.Value)
		return s, err == nil
	case *ast.ParenExpr:
		return constString(x.X)
	case *ast.BinaryExpr:
		if x.Op != token.ADD {
			return "", false
		}
		l, ok := constString(x.X)
		if !ok {
			return "", false
		}
		r, ok := constString(x.Y)
		return l + r, ok
	}
	return "", false
}

// moduleRoot walks up from the test's directory to the go.mod of services/hg.
func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found above the test directory")
		}
		dir = parent
	}
}

// TestOnlyTransitionWritesOrderState fails when any production Go file other
// than the transition function's own writes order.state directly.
func TestOnlyTransitionWritesOrderState(t *testing.T) {
	root := moduleRoot(t)
	fset := token.NewFileSet()
	var offenders []string
	scanned := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if path != root && (strings.HasPrefix(name, ".") || name == "vendor" || name == "testdata" || name == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		scanned++
		if rel == orderStateWriter {
			return nil
		}
		for _, line := range orderStateWrites(t, fset, path, nil) {
			offenders = append(offenders, rel+":"+strconv.Itoa(line))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	if scanned < 100 {
		t.Fatalf("scanned only %d Go files under %s; the guard is not looking at the service", scanned, root)
	}
	if len(offenders) > 0 {
		t.Fatalf("order.state is written outside %s; move these through orders.Store.Transition or TransitionInTx:\n  %s",
			orderStateWriter, strings.Join(offenders, "\n  "))
	}

	// The allowed writer must itself still be found, or the pattern has gone
	// blind and the check above proves nothing.
	if lines := orderStateWrites(t, fset, filepath.Join(root, orderStateWriter), nil); len(lines) == 0 {
		t.Fatalf("the guard no longer recognises the state write in %s", orderStateWriter)
	}
}

// TestOrderStateGuardCatchesDirectWrites pins the detector on the shapes a
// direct write takes, including the one the restaurant used before
// https://github.com/shaiknoorullah/hg-mono/issues/337, and on the order
// writes that are not state changes.
func TestOrderStateGuardCatchesDirectWrites(t *testing.T) {
	const src = "package x\n" +
		"const restaurantAccept = `\n\t\tUPDATE \"order\" SET\n\t\t\tstate='PREPARING', state_since=now(),\n\t\t\tdeadline_at=$2\n\t\tWHERE id=$1`\n" + // line 2
		"const adminCancel = `UPDATE \"order\"\n   SET state               = 'CANCELLED',\n       cancelled_at = now()\n WHERE id = $1`\n" + // line 7
		"const aliased = `UPDATE \"order\" o SET deadline_at = NULL, o.state = $2 WHERE o.id = $1`\n" + // line 11
		"const quoted = `update public.\"order\" set \"state\"=$1`\n" + // line 12
		"var split = \"UPDATE \\\"order\\\" \" +\n\t\"SET state = $1 WHERE id = $2\"\n" + // line 13
		"const deadlineOnly = `UPDATE \"order\" SET deadline_at=$2, state_since=now() WHERE id=$1`\n" +
		"const stateInWhere = `UPDATE \"order\" SET promised_ready_at=$2 WHERE id=$1 AND state = 'PREPARING'`\n" +
		"const otherTable = `UPDATE assignment SET state = $2 WHERE id = $1`\n" +
		"const read = `SELECT state FROM \"order\" WHERE id = $1`\n"

	got := orderStateWrites(t, token.NewFileSet(), "x.go", src)
	want := []int{2, 7, 11, 12, 13}
	if len(got) != len(want) {
		t.Fatalf("flagged lines %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("flagged lines %v, want %v", got, want)
		}
	}
}
