// Package emailtmpl renders HalalGoes transactional emails from the static
// templates exported by packages/emails (React Email). The exported files are
// committed under templates/ and embedded here, so the binary needs no Node at
// runtime: the HTML part renders with html/template, the plain-text part and
// the subject with text/template.
//
// Each template declares its variables in templates/manifest.json. Render
// refuses a call that leaves a declared variable missing or empty, or passes
// one the template does not use, so an email never goes out with an unfilled
// "{{.Name}}" slot or with a value nobody meant to print
// (docs/spec/01-platform.md, "P-26 — SMS and email", acceptance criterion 1:
// every template renders with no unresolved variables).
//
// Values are plain strings the caller formatted already: money from integer
// cents, 12-hour times, dates. html/template escapes them for the HTML part, so
// a restaurant name or an admin's reason can never inject markup, and a link
// that is not http(s) renders as a harmless "#ZgotmplZ".
//
// To change a template, edit packages/emails and run
// `pnpm --filter @hg/emails build`; never edit templates/ by hand.
package emailtmpl

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	htmltemplate "html/template"
	"sort"
	"strings"
	texttemplate "text/template"
	"text/template/parse"
)

//go:embed templates/*.html templates/*.txt templates/manifest.json
var files embed.FS

// Rendered is one email ready to hand to a provider.
type Rendered struct {
	Subject string
	HTML    string
	Text    string
}

// ErrUnknownTemplate is returned for a name the manifest does not list.
var ErrUnknownTemplate = errors.New("emailtmpl: unknown template")

// Set is every exported template, parsed once at boot.
type Set struct {
	byName map[string]*entry
}

type entry struct {
	name    string
	vars    []string
	subject *texttemplate.Template
	html    *htmltemplate.Template
	text    *texttemplate.Template
}

type manifest struct {
	Templates []struct {
		Name    string   `json:"name"`
		Subject string   `json:"subject"`
		Vars    []string `json:"vars"`
	} `json:"templates"`
}

// Load parses every template in the embedded manifest and checks that each
// one's slots are exactly its declared variables.
func Load() (*Set, error) {
	raw, err := files.ReadFile("templates/manifest.json")
	if err != nil {
		return nil, fmt.Errorf("emailtmpl: read manifest: %w", err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("emailtmpl: parse manifest: %w", err)
	}
	s := &Set{byName: make(map[string]*entry, len(m.Templates))}
	for _, t := range m.Templates {
		e := &entry{name: t.Name, vars: append([]string(nil), t.Vars...)}
		htmlSrc, err := files.ReadFile("templates/" + t.Name + ".html")
		if err != nil {
			return nil, fmt.Errorf("emailtmpl: %s: %w", t.Name, err)
		}
		textSrc, err := files.ReadFile("templates/" + t.Name + ".txt")
		if err != nil {
			return nil, fmt.Errorf("emailtmpl: %s: %w", t.Name, err)
		}
		if e.subject, err = texttemplate.New(t.Name + ".subject").Option("missingkey=error").Parse(t.Subject); err != nil {
			return nil, fmt.Errorf("emailtmpl: %s subject: %w", t.Name, err)
		}
		if e.html, err = htmltemplate.New(t.Name + ".html").Option("missingkey=error").Parse(string(htmlSrc)); err != nil {
			return nil, fmt.Errorf("emailtmpl: %s html: %w", t.Name, err)
		}
		if e.text, err = texttemplate.New(t.Name + ".txt").Option("missingkey=error").Parse(string(textSrc)); err != nil {
			return nil, fmt.Errorf("emailtmpl: %s text: %w", t.Name, err)
		}

		used := map[string]bool{}
		collectFields(e.subject.Tree.Root, used)
		collectFields(e.html.Tree.Root, used)
		collectFields(e.text.Tree.Root, used)
		declared := map[string]bool{}
		for _, v := range e.vars {
			declared[v] = true
		}
		for v := range used {
			if !declared[v] {
				return nil, fmt.Errorf("emailtmpl: %s uses {{.%s}}, which the manifest does not declare", t.Name, v)
			}
		}
		for v := range declared {
			if !used[v] {
				return nil, fmt.Errorf("emailtmpl: %s declares %s but never uses it", t.Name, v)
			}
		}
		s.byName[t.Name] = e
	}
	return s, nil
}

// MustLoad is Load for process boot, where a broken embedded template is a
// build defect, not a runtime condition.
func MustLoad() *Set {
	s, err := Load()
	if err != nil {
		panic(err)
	}
	return s
}

// Names lists every template, sorted.
func (s *Set) Names() []string {
	out := make([]string, 0, len(s.byName))
	for n := range s.byName {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Vars lists a template's declared variables.
func (s *Set) Vars(name string) ([]string, bool) {
	e, ok := s.byName[name]
	if !ok {
		return nil, false
	}
	return append([]string(nil), e.vars...), true
}

// Render fills one template. vars must hold exactly the template's declared
// variables, each non-empty.
func (s *Set) Render(name string, vars map[string]string) (Rendered, error) {
	e, ok := s.byName[name]
	if !ok {
		return Rendered{}, fmt.Errorf("%w %q", ErrUnknownTemplate, name)
	}
	var problems []string
	declared := make(map[string]bool, len(e.vars))
	for _, v := range e.vars {
		declared[v] = true
		if strings.TrimSpace(vars[v]) == "" {
			problems = append(problems, v+" is missing")
		}
	}
	for k := range vars {
		if !declared[k] {
			problems = append(problems, k+" is not used by this template")
		}
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		return Rendered{}, fmt.Errorf("emailtmpl: %s: %s", name, strings.Join(problems, "; "))
	}

	var subj, html, text bytes.Buffer
	if err := e.subject.Execute(&subj, vars); err != nil {
		return Rendered{}, fmt.Errorf("emailtmpl: %s subject: %w", name, err)
	}
	if err := e.html.Execute(&html, vars); err != nil {
		return Rendered{}, fmt.Errorf("emailtmpl: %s html: %w", name, err)
	}
	if err := e.text.Execute(&text, vars); err != nil {
		return Rendered{}, fmt.Errorf("emailtmpl: %s text: %w", name, err)
	}
	// A subject is one header line: a value with a line break in it (an
	// admin-typed reason, say) must not split it.
	subject := strings.Join(strings.Fields(subj.String()), " ")
	return Rendered{Subject: subject, HTML: html.String(), Text: text.String()}, nil
}

// collectFields records every {{.Name}} field a parsed template reads.
func collectFields(n parse.Node, into map[string]bool) {
	switch n := n.(type) {
	case *parse.ListNode:
		if n == nil {
			return
		}
		for _, c := range n.Nodes {
			collectFields(c, into)
		}
	case *parse.ActionNode:
		collectFields(n.Pipe, into)
	case *parse.PipeNode:
		if n == nil {
			return
		}
		for _, c := range n.Cmds {
			collectFields(c, into)
		}
	case *parse.CommandNode:
		for _, a := range n.Args {
			collectFields(a, into)
		}
	case *parse.FieldNode:
		if len(n.Ident) > 0 {
			into[n.Ident[0]] = true
		}
	case *parse.IfNode:
		collectFields(n.Pipe, into)
		collectFields(n.List, into)
		collectFields(n.ElseList, into)
	case *parse.RangeNode:
		collectFields(n.Pipe, into)
		collectFields(n.List, into)
		collectFields(n.ElseList, into)
	case *parse.WithNode:
		collectFields(n.Pipe, into)
		collectFields(n.List, into)
		collectFields(n.ElseList, into)
	}
}
