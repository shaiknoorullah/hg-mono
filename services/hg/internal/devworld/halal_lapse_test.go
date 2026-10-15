package devworld

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// The lapse runs the expiry job on a database, so both guards must hold before
// the first connection or request: a non-local API, a non-local environment and
// a non-local database are each refused.
func TestHalalScenariosRefuseAnythingNotLocal(t *testing.T) {
	rec := &countingTransport{}
	cases := []struct{ name, base, env, dsn, want string }{
		{"remote api", "https://api.halalgoes.com", "local", "postgres://u:p@127.0.0.1:5432/hg", "refuses API host"},
		{"staging", "http://127.0.0.1:8080", "staging", "postgres://u:p@127.0.0.1:5432/hg", "refuses HG_ENV"},
		{"remote db", "http://127.0.0.1:8080", "local", "postgres://u:p@db.halalgoes.com:5432/hg", "refuses database host"},
	}
	for _, scenario := range []string{"halal-lapse", "halal-renew"} {
		for _, c := range cases {
			t.Run(scenario+"/"+c.name, func(t *testing.T) {
				t.Setenv("HG_ENV", c.env)
				t.Setenv("HG_POSTGRES_DSN", c.dsn)
				prev := http.DefaultTransport
				http.DefaultTransport = rec
				defer func() { http.DefaultTransport = prev }()
				err := RunScenario(context.Background(), c.base, scenario)
				if err == nil || !strings.Contains(err.Error(), c.want) {
					t.Fatalf("got %v, want %q", err, c.want)
				}
				if rec.n != 0 {
					t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
				}
			})
		}
	}
}
