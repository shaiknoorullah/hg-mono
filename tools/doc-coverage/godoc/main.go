// Command godoc lists every exported Go identifier under a directory and
// whether it carries a doc comment. It applies the same rule as revive's
// `exported` check: top-level funcs, methods on exported receivers, types,
// consts and vars; a doc comment on a parenthesised const/var/type block
// covers every name in it; package main, tests and generated files are
// skipped.
//
// Usage: go run . <root> [<root>...]  — prints a JSON array on stdout.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Item is one exported identifier.
type Item struct {
	File       string `json:"file"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Documented bool   `json:"documented"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: godoc <root>...")
		os.Exit(2)
	}
	items := []Item{}
	for _, root := range os.Args[1:] {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				name := d.Name()
				if path != root && (name == "vendor" || name == "testdata" || strings.HasPrefix(name, ".")) {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || strings.HasSuffix(path, ".gen.go") {
				return nil
			}
			found, err := scan(path)
			if err != nil {
				return err
			}
			items = append(items, found...)
			return nil
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].File != items[j].File {
			return items[i].File < items[j].File
		}
		return items[i].Name < items[j].Name
	})
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	if err := enc.Encode(items); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func scan(path string) ([]Item, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	if f.Name.Name == "main" || ast.IsGenerated(f) {
		return nil, nil
	}
	file := filepath.ToSlash(path)
	var out []Item
	add := func(name, kind string, doc *ast.CommentGroup) {
		out = append(out, Item{File: file, Name: name, Kind: kind, Documented: hasText(doc)})
	}
	for _, decl := range f.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if !d.Name.IsExported() {
				continue
			}
			if d.Recv == nil {
				add(d.Name.Name, "func", d.Doc)
				continue
			}
			recv := receiverName(d.Recv.List[0].Type)
			if recv == "" || !ast.IsExported(recv) {
				continue
			}
			add(recv+"."+d.Name.Name, "method", d.Doc)
		case *ast.GenDecl:
			if d.Tok == token.IMPORT {
				continue
			}
			grouped := d.Lparen.IsValid()
			for _, spec := range d.Specs {
				switch s := spec.(type) {
				case *ast.TypeSpec:
					if !s.Name.IsExported() {
						continue
					}
					doc := s.Doc
					if !hasText(doc) {
						doc = d.Doc
					}
					add(s.Name.Name, "type", doc)
				case *ast.ValueSpec:
					doc := s.Doc
					if !hasText(doc) && (!grouped || hasText(d.Doc)) {
						doc = d.Doc
					}
					for _, n := range s.Names {
						if n.IsExported() {
							add(n.Name, d.Tok.String(), doc)
						}
					}
				}
			}
		}
	}
	return out, nil
}

func receiverName(expr ast.Expr) string {
	for {
		switch e := expr.(type) {
		case *ast.StarExpr:
			expr = e.X
		case *ast.IndexExpr:
			expr = e.X
		case *ast.IndexListExpr:
			expr = e.X
		case *ast.Ident:
			return e.Name
		default:
			return ""
		}
	}
}

func hasText(doc *ast.CommentGroup) bool {
	return doc != nil && strings.TrimSpace(doc.Text()) != ""
}
