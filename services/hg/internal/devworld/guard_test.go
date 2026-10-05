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
