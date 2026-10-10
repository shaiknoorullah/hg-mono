package devworld

import "testing"

func TestAllowReset(t *testing.T) {
	ok := []string{
		"postgres://hg:hg@127.0.0.1:5432/hg?sslmode=disable",
		"postgres://hg:hg@localhost:55432/hg?sslmode=disable",
		"postgres://hg:hg@[::1]:5432/hg?sslmode=disable",
		"postgres://hg:hg@postgres:5432/hg?sslmode=disable",
		"postgres://hg@/hg?host=/tmp",
	}
	for _, dsn := range ok {
		if err := AllowReset("local", dsn); err != nil {
			t.Errorf("local %s: %v", dsn, err)
		}
	}

	refused := []struct{ env, dsn string }{
		{"", "postgres://hg:hg@127.0.0.1:5432/hg?sslmode=disable"},
		{"staging", "postgres://hg:hg@127.0.0.1:5432/hg?sslmode=disable"},
		{"production", "postgres://hg:hg@127.0.0.1:5432/hg?sslmode=disable"},
		{"prod", "postgres://hg:hg@127.0.0.1:5432/hg?sslmode=disable"},
		{"local", "postgres://hg:hg@api.halalgoes.com:5432/hg?sslmode=disable"},
		{"local", "postgres://hg:hg@10.0.0.8:5432/hg?sslmode=disable"},
		{"production", "postgres://hg:hg@postgres:5432/hg?sslmode=disable"},
	}
	for _, tc := range refused {
		if err := AllowReset(tc.env, tc.dsn); err == nil {
			t.Errorf("expected refusal for env=%q dsn=%s", tc.env, tc.dsn)
		}
	}
}

func TestAllowAPI(t *testing.T) {
	ok := []string{
		"http://localhost:8080",
		"http://127.0.0.1:8080/",
		"http://[::1]:8080",
		"http://api:8080",
		"http://traefik",
	}
	for _, u := range ok {
		if err := AllowAPI(u); err != nil {
			t.Errorf("%s: %v", u, err)
		}
	}
	refused := []string{
		"https://api.halalgoes.com",
		"http://10.0.0.8:8080",
		"http://localhost.example.com",
		"http://api.staging.internal",
		"localhost:8080", // no scheme: no host to check
		"",
	}
	for _, u := range refused {
		if err := AllowAPI(u); err == nil {
			t.Errorf("expected refusal for %q", u)
		}
	}
}
