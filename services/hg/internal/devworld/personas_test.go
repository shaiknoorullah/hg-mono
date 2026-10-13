package devworld

import (
	"encoding/base32"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorldLiteralsAreInTheSQL(t *testing.T) {
	root, err := migrationsRoot()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "devworld", "001_personas.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	if strings.Contains(sql, "+goose") {
		t.Fatal("devworld SQL must not be a goose migration")
	}
	if !strings.Contains(sql, "BEGIN;") || !strings.Contains(sql, "COMMIT;") {
		t.Fatal("devworld SQL must be one transaction so certificate checks commit together")
	}
	for _, id := range World {
		for _, lit := range []string{id.AccountID, id.RestaurantID, id.Email, id.Phone} {
			if lit == "" {
				continue
			}
			if !strings.Contains(sql, lit) {
				t.Errorf("SQL is missing %s (%s)", lit, id.Slug)
			}
		}
	}
	if !strings.Contains(sql, BismillahRestaurantID) {
		t.Fatal("SQL is missing the bismillah restaurant id")
	}
}

func TestAdminTOTPSecretIsStable(t *testing.T) {
	a, err := AdminTOTPSecret(AdminEmail)
	if err != nil {
		t.Fatal(err)
	}
	b, err := AdminTOTPSecret("  " + strings.ToUpper(AdminEmail) + " ")
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatal("totp secret changed for the same email")
	}
	raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(a)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 20 {
		t.Fatalf("secret length %d", len(raw))
	}
	other, err := AdminTOTPSecret("support-seed@seed.hg")
	if err != nil {
		t.Fatal(err)
	}
	if other == a {
		t.Fatal("different emails derived the same secret")
	}
}
