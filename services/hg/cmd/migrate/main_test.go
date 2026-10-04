package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func envFrom(m map[string]string) (func(string) string, []string) {
	var environ []string
	for k, v := range m {
		environ = append(environ, k+"="+v)
	}
	return func(k string) string { return m[k] }, environ
}

func writeSecret(t *testing.T, value string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "postgres_dsn")
	if err := os.WriteFile(p, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, mode); err != nil {
		t.Fatal(err)
	}
	return p
}

const testDSN = "postgres://hg:s3cret-pw@postgres:5432/hg?sslmode=disable"

// The connection string comes from the file and reaches goose as
// GOOSE_DBSTRING; the _FILE variable does not.
func TestGooseEnvReadsTheFile(t *testing.T) {
	p := writeSecret(t, testDSN+"\n", 0o400)
	getenv, environ := envFrom(map[string]string{
		"GOOSE_DRIVER":        "postgres",
		"GOOSE_DBSTRING_FILE": p,
	})
	env, warning, err := gooseEnv(getenv, environ)
	if err != nil {
		t.Fatalf("gooseEnv: %v", err)
	}
	if warning != "" {
		t.Errorf("unexpected warning for a 0400 file: %s", warning)
	}
	if !slices.Contains(env, "GOOSE_DBSTRING="+testDSN) {
		t.Errorf("GOOSE_DBSTRING was not set from the file, trailing newline trimmed")
	}
	if !slices.Contains(env, "GOOSE_DRIVER=postgres") {
		t.Errorf("the rest of the environment was not passed through")
	}
	for _, kv := range env {
		if strings.HasPrefix(kv, "GOOSE_DBSTRING_FILE=") {
			t.Errorf("GOOSE_DBSTRING_FILE was passed on to goose")
		}
	}
}

func TestGooseEnvRefusesBothAndLooseFiles(t *testing.T) {
	loose := writeSecret(t, testDSN, 0o644)
	tight := writeSecret(t, testDSN, 0o400)
	for name, m := range map[string]map[string]string{
		"both set":                     {"GOOSE_DBSTRING": testDSN, "GOOSE_DBSTRING_FILE": tight},
		"world-readable, HG_ENV unset": {"GOOSE_DBSTRING_FILE": loose},
		"world-readable, production":   {"GOOSE_DBSTRING_FILE": loose, "HG_ENV": "production"},
		"missing file":                 {"GOOSE_DBSTRING_FILE": filepath.Join(t.TempDir(), "nope")},
	} {
		t.Run(name, func(t *testing.T) {
			getenv, environ := envFrom(m)
			_, _, err := gooseEnv(getenv, environ)
			if err == nil {
				t.Fatal("accepted")
			}
			if strings.Contains(err.Error(), "s3cret-pw") {
				t.Errorf("the error carries the password: %v", err)
			}
		})
	}
}

// Without a file nothing changes, so the dev stack's GOOSE_DBSTRING still works.
func TestGooseEnvPassesTheVariableThrough(t *testing.T) {
	getenv, environ := envFrom(map[string]string{"GOOSE_DBSTRING": testDSN})
	env, _, err := gooseEnv(getenv, environ)
	if err != nil {
		t.Fatalf("gooseEnv: %v", err)
	}
	if !slices.Equal(env, environ) {
		t.Errorf("environment changed without a _FILE variable")
	}
}
