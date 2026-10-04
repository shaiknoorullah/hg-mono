package emailtmpl

import (
	"strings"
	"testing"
)

// sample fills every declared variable with a value that is plain text, so
// anything left looking like a template action afterwards is a slot that was
// never filled.
func sample(vars []string) map[string]string {
	out := make(map[string]string, len(vars))
	for _, v := range vars {
		out[v] = "value-for-" + v
	}
	if _, ok := out["ActionURL"]; ok {
		out["ActionURL"] = "https://partners.example.com/next"
	}
	return out
}

// TestEveryTemplateRendersWithEverySlotFilled is the golden rule for the
// exported templates (docs/spec/01-platform.md, "P-26 — SMS and email",
// acceptance criterion 1: no unresolved variables): each one renders, and no
// "{{", "}}" or "<no value>" survives in the subject, the HTML or the text.
func TestEveryTemplateRendersWithEverySlotFilled(t *testing.T) {
	set, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(set.Names()) < 15 {
		t.Fatalf("only %d templates loaded: %v", len(set.Names()), set.Names())
	}
	for _, name := range set.Names() {
		vars, _ := set.Vars(name)
		out, err := set.Render(name, sample(vars))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		for part, s := range map[string]string{"subject": out.Subject, "html": out.HTML, "text": out.Text} {
			for _, bad := range []string{"{{", "}}", "<no value>"} {
				if strings.Contains(s, bad) {
					t.Errorf("%s %s still contains %q", name, part, bad)
				}
			}
			if s == "" {
				t.Errorf("%s %s is empty", name, part)
			}
		}
		for _, v := range vars {
			want := sample(vars)[v]
			if !strings.Contains(out.Subject+out.HTML+out.Text, want) {
				t.Errorf("%s: the value of %s does not appear in the email", name, v)
			}
		}
	}
}

// TestRenderRefusesAnUnfilledSlot: a missing or empty variable is an error,
// never an email with a hole in it; so is a variable the template does not use.
func TestRenderRefusesAnUnfilledSlot(t *testing.T) {
	set := MustLoad()
	vars := sample([]string{"ActionURL", "ExpiresAt"})

	missing := map[string]string{"ActionURL": vars["ActionURL"]}
	if _, err := set.Render("password_reset", missing); err == nil || !strings.Contains(err.Error(), "ExpiresAt is missing") {
		t.Fatalf("missing var: err = %v, want ExpiresAt is missing", err)
	}
	empty := map[string]string{"ActionURL": vars["ActionURL"], "ExpiresAt": "  "}
	if _, err := set.Render("password_reset", empty); err == nil {
		t.Fatal("empty var rendered, want an error")
	}
	extra := map[string]string{"ActionURL": vars["ActionURL"], "ExpiresAt": "x", "Token": "secret"}
	if _, err := set.Render("password_reset", extra); err == nil || !strings.Contains(err.Error(), "Token is not used") {
		t.Fatalf("extra var: err = %v, want Token is not used", err)
	}
	if _, err := set.Render("no_such_template", vars); err == nil {
		t.Fatal("unknown template rendered, want an error")
	}
}

// TestValuesAreEscaped: a restaurant name or an admin's reason is text, never
// markup, and a link that is not http(s) cannot become a live javascript: URL.
func TestValuesAreEscaped(t *testing.T) {
	set := MustLoad()
	out, err := set.Render("restaurant_application_rejected", map[string]string{
		"RestaurantName": "<script>alert(1)</script>\r\nBcc: someone@example.com",
		"ActionURL":      "javascript:alert(1)",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if strings.Contains(out.HTML, "<script>alert(1)</script>") {
		t.Error("restaurant name was rendered as markup")
	}
	if strings.Contains(out.HTML, `href="javascript:`) {
		t.Error("a javascript: link survived in the HTML")
	}
	if strings.ContainsAny(out.Subject, "\r\n") {
		t.Errorf("subject %q spans lines", out.Subject)
	}
}
