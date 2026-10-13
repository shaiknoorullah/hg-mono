package payments

import (
	"fmt"
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

// stripeImport matches a stripe-go import path; the group is the subpackage,
// empty for the root package.
var stripeImport = regexp.MustCompile(`^github\.com/stripe/stripe-go(?:/v\d+)?(?:/(.+))?$`)

// TestStripeIsReachedOnlyThroughTheKeyedClient fails when any Go file in the
// service, tests included, can reach Stripe other than through a client.API
// built with the secret key.
//
// stripe-go's resource packages (setupintent, account, transfer and the rest)
// expose package-level functions that read the global stripe.Key, which nothing
// sets, so a call made through one goes out with no key and Stripe answers 401
// (https://github.com/shaiknoorullah/hg-mono/issues/338). The rule here is
// therefore about imports: from stripe-go, only the root package (types and
// helpers), client (the keyed client) and webhook (signature checks, no API
// call) may be imported, and nothing may read or set stripe.Key.
func TestStripeIsReachedOnlyThroughTheKeyedClient(t *testing.T) {
	root := moduleRoot(t)
	fset := token.NewFileSet()
	var problems []string
	sawClient := false
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && (d.Name() == "vendor" || d.Name() == "testdata" || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		at := func(p token.Pos) string {
			pos := fset.Position(p)
			rel, _ := filepath.Rel(root, pos.Filename)
			return fmt.Sprintf("%s:%d", rel, pos.Line)
		}
		rootNames := map[string]bool{} // what this file calls stripe-go's root package
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			m := stripeImport.FindStringSubmatch(p)
			if m == nil {
				continue
			}
			switch m[1] {
			case "":
				name := "stripe"
				if imp.Name != nil {
					name = imp.Name.Name
				}
				rootNames[name] = true
			case "client":
				sawClient = true
			case "webhook":
			default:
				problems = append(problems, fmt.Sprintf("%s imports %s: call Stripe through the keyed client "+
					"(liveStripe.api, a client.API) instead", at(imp.Pos()), p))
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Key" {
				return true
			}
			if x, ok := sel.X.(*ast.Ident); ok && rootNames[x.Name] {
				problems = append(problems, fmt.Sprintf("%s uses the global %s.Key: pass the key to client.New instead",
					at(sel.Pos()), x.Name))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
	if !sawClient {
		t.Fatalf("no file under %s imports stripe-go's client package, so this check found nothing to check", root)
	}
	for _, p := range problems {
		t.Error(p)
	}
}

// moduleRoot is the directory holding this service's go.mod.
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
			t.Fatal("no go.mod above the test's directory")
		}
		dir = parent
	}
}
