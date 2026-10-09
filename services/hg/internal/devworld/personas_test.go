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
	files, err := personaSQLFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	var all strings.Builder
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		one := string(raw)
		if strings.Contains(one, "+goose") {
			t.Fatalf("%s must not be a goose migration", filepath.Base(path))
		}
		if !strings.Contains(one, "BEGIN;") || !strings.Contains(one, "COMMIT;") {
			t.Fatalf("%s must be one transaction so its rows commit together", filepath.Base(path))
		}
		all.WriteString(one)
	}
	sql := all.String()
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
