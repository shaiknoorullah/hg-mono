package config

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Every setting the API reads must reach its container. deploy/docker-compose.yml passes
// the API an explicit list (the `x-api-env` block), not the whole .env, so a setting
// missing from that list is silently unset in every deployed stack: on 5 Oct 2026 the
// Stripe, Twilio and tax settings were, and payments answered 503 on the server.
func TestComposePassesEverySettingTheAPIReads(t *testing.T) {
	setting := regexp.MustCompile(`"(HG_[A-Z0-9_]+)"`)
	read := map[string]bool{}
	sources, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	cmd, err := filepath.Glob(filepath.Join("..", "..", "cmd", "hg", "*.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range append(sources, cmd...) {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range setting.FindAllStringSubmatch(string(b), -1) {
			read[m[1]] = true
		}
	}
	if len(read) == 0 {
		t.Fatal("found no HG_ settings in the config sources; the test is reading the wrong files")
	}

	compose, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "deploy", "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	block := apiEnvBlock(string(compose))
	if block == "" {
		t.Fatal("deploy/docker-compose.yml has no `x-api-env: &api-env` block")
	}
	passed := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s+(HG_[A-Z0-9_]+):`).FindAllStringSubmatch(block, -1) {
		passed[m[1]] = true
	}

	var missing []string
	for k := range read {
		if !passed[k] {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("the API reads these settings but deploy/docker-compose.yml never passes them to it "+
			"(add each to the x-api-env block as `KEY: ${KEY:-}`): %s", strings.Join(missing, ", "))
	}
}

// apiEnvBlock returns the indented lines under `x-api-env: &api-env`.
func apiEnvBlock(compose string) string {
	lines := strings.Split(compose, "\n")
	var out []string
	in := false
	for _, l := range lines {
		if strings.HasPrefix(l, "x-api-env:") {
			in = true
			continue
		}
		if in {
			if l != "" && !strings.HasPrefix(l, " ") && !strings.HasPrefix(l, "#") {
				break
			}
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}
