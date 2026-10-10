package orders

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// refusingQuerier fails the test if the developer clock reaches the database.
type refusingQuerier struct{ t *testing.T }

func (r refusingQuerier) QueryRow(context.Context, string, ...any) pgx.Row {
	r.t.Fatal("the developer clock reached the database outside HG_ENV=local")
	return nil
}

// Outside local the developer clock refuses before any query, whoever calls it.
func TestDevClockRefusesOutsideLocal(t *testing.T) {
	for _, env := range []string{"production", "staging", ""} {
		t.Setenv("HG_ENV", env)
		_, err := BringDeadlineForward(context.Background(), refusingQuerier{t}, "order", "CREATED", "EXPIRE_PAYMENT", time.Second)
		if !errors.Is(err, ErrDevClockNotLocal) {
			t.Errorf("HG_ENV=%q: got %v, want ErrDevClockNotLocal", env, err)
		}
	}
}

// Only the dev world calls the developer clock: no server package does.
func TestOnlyDevworldCallsTheDevClock(t *testing.T) {
	root := moduleRoot(t)
	fset := token.NewFileSet()
	err := walkProductionGo(root, func(path, rel string) error {
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if ok && sel.Sel.Name == "BringDeadlineForward" && !strings.HasPrefix(filepath.ToSlash(rel), "internal/devworld/") {
				t.Errorf("%s calls the developer clock; only internal/devworld may", fset.Position(sel.Pos()))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The server binary does not link the dev world, so it cannot reach the clock.
func TestServerBinaryDoesNotLinkDevworld(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not on PATH")
	}
	cmd := exec.Command("go", "list", "-deps", "./cmd/hg")
	cmd.Dir = moduleRoot(t)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list -deps ./cmd/hg: %v", err)
	}
	for _, pkg := range strings.Fields(string(out)) {
		if strings.HasSuffix(pkg, "/internal/devworld") {
			t.Errorf("cmd/hg links %s, which calls the developer clock", pkg)
		}
	}
}
