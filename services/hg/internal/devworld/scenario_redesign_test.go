package devworld

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// redesignScenarios are the scenarios added for the redesign journeys.
var redesignScenarios = []string{
	"offer-to-rider", "restaurant-timeout", "admin-cancel", "pickup-lapse",
	"pickup-lapse-cancelled", "cert-lapse-mid-order", "order-completed",
}

// clockScenarios move a clock in the local database.
var clockScenarios = []string{
	"restaurant-timeout", "pickup-lapse", "pickup-lapse-cancelled",
	"cert-lapse-mid-order", "order-completed",
}

func refuseRequests(t *testing.T) *countingTransport {
	t.Helper()
	rec := &countingTransport{}
	prev := http.DefaultTransport
	http.DefaultTransport = rec
	t.Cleanup(func() { http.DefaultTransport = prev })
	return rec
}

func TestEveryScenarioIsListedWithWhatItLeaves(t *testing.T) {
	if len(scenarioSummaries) != len(ScenarioNames) {
		t.Fatalf("%d summaries for %d scenarios", len(scenarioSummaries), len(ScenarioNames))
	}
	seen := map[string]bool{}
	for _, name := range ScenarioNames {
		if seen[name] {
			t.Fatalf("%s listed twice", name)
		}
		seen[name] = true
		if strings.TrimSpace(scenarioSummaries[name]) == "" {
			t.Errorf("%s has no summary for `scenario list`", name)
		}
	}
	for _, name := range redesignScenarios {
		if !knownScenario(name) {
			t.Errorf("%s is not in the catalogue", name)
		}
	}
}

// Every listed name reaches its own scenario: with the guards satisfied and
// every request refused, none answers "unknown scenario".
func TestEveryListedScenarioIsDispatched(t *testing.T) {
	refuseRequests(t)
	t.Setenv("HG_ENV", "local")
	t.Setenv("HG_POSTGRES_DSN", "postgres://hg:hg@127.0.0.1:1/hg?sslmode=disable&connect_timeout=1")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, name := range ScenarioNames {
		err := RunScenario(ctx, "http://127.0.0.1:1", name)
		if err == nil {
			t.Errorf("%s succeeded with every request refused", name)
			continue
		}
		if strings.Contains(err.Error(), "unknown scenario") {
			t.Errorf("%s is listed but not dispatched: %v", name, err)
		}
	}
}

func TestRedesignScenariosRefuseNonLocalAPIBeforeAnyRequest(t *testing.T) {
	rec := refuseRequests(t)
	t.Setenv("HG_ENV", "local")
	t.Setenv("HG_POSTGRES_DSN", "postgres://hg:hg@127.0.0.1:5432/hg")
	for _, name := range redesignScenarios {
		err := RunScenario(context.Background(), "https://api.halalgoes.com", name)
		if err == nil || !strings.Contains(err.Error(), "refuses API host") {
			t.Fatalf("%s: got %v, want a refusal of the API host", name, err)
		}
	}
	if rec.n != 0 {
		t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
	}
}

func TestClockScenariosRefuseNonLocalDatabaseBeforeAnyRequest(t *testing.T) {
	rec := refuseRequests(t)
	for _, tc := range []struct{ env, dsn, want string }{
		{"local", "postgres://hg:hg@db.halalgoes.com:5432/hg", "refuses database host"},
		{"production", "postgres://hg:hg@127.0.0.1:5432/hg", "refuses HG_ENV"},
		{"", "postgres://hg:hg@127.0.0.1:5432/hg", "refuses HG_ENV"},
	} {
		t.Setenv("HG_ENV", tc.env)
		t.Setenv("HG_POSTGRES_DSN", tc.dsn)
		for _, name := range clockScenarios {
			err := RunScenario(context.Background(), "http://127.0.0.1:8080", name)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("%s with HG_ENV=%q: got %v, want %q", name, tc.env, err, tc.want)
			}
		}
	}
	if rec.n != 0 {
		t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
	}
}

func TestClockMovesRefuseNonLocalDatabase(t *testing.T) {
	t.Setenv("HG_ENV", "local")
	t.Setenv("HG_POSTGRES_DSN", "postgres://hg:hg@10.0.0.5:5432/hg")
	ctx := context.Background()
	if _, err := bringDeadlineForward(ctx, "o", statePending, "RESTAURANT_TIMEOUT", time.Second); err == nil || !strings.Contains(err.Error(), "refuses database host") {
		t.Fatalf("deadline: got %v", err)
	}
	if _, err := lapseCertificate(ctx, bismillahCertificateID); err == nil || !strings.Contains(err.Error(), "refuses database host") {
		t.Fatalf("certificate: got %v", err)
	}
	if _, err := readOrderClock(ctx, "o"); err == nil || !strings.Contains(err.Error(), "refuses database host") {
		t.Fatalf("read: got %v", err)
	}
}

// A deadline is only ever brought forward; the guard answers before the
// database is reached.
func TestDeadlineIsNeverPushedBack(t *testing.T) {
	t.Setenv("HG_ENV", "local")
	t.Setenv("HG_POSTGRES_DSN", "postgres://hg:hg@127.0.0.1:1/hg")
	_, err := bringDeadlineForward(context.Background(), "o", statePending, "RESTAURANT_TIMEOUT", -time.Second)
	if err == nil || !strings.Contains(err.Error(), "only ever brought forward") {
		t.Fatalf("got %v", err)
	}
}

func TestStatesMatchesOnlyTheNamedStates(t *testing.T) {
	usable := states(statePending, statePreparing)
	for state, want := range map[string]bool{
		statePending: true, statePreparing: true, stateReady: false, "CANCELLED": false, "": false,
	} {
		if got := usable(state); got != want {
			t.Errorf("%q: got %t, want %t", state, got, want)
		}
	}
}

func TestBismillahCertificateIsTheSeededOne(t *testing.T) {
	root, err := migrationsRoot()
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(root, "devworld", "001_personas.sql"))
	if err != nil {
		t.Fatal(err)
	}
	raw := string(b)
	i := strings.Index(raw, bismillahCertificateID)
	if i < 0 || !strings.Contains(raw[i:i+400], BismillahRestaurantID) {
		t.Fatal("the bismillah certificate id is not the one reset seeds for bismillah-grill")
	}
}
