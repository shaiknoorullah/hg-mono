package devworld

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestRunScenarioRejectsUnknownName(t *testing.T) {
	err := RunScenario(context.Background(), "http://127.0.0.1:1", "not-a-scenario")
	if err == nil || !strings.Contains(err.Error(), "unknown scenario") {
		t.Fatalf("got %v", err)
	}
}

func TestRunScenarioRequiresBaseURL(t *testing.T) {
	err := RunScenario(context.Background(), "  ", "new-order")
	if err == nil || !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("got %v", err)
	}
}

type countingTransport struct{ n int }

func (c *countingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.n++
	return nil, errors.New("devworld test: no request may leave")
}

func TestOnboardingScenariosRefuseNonLocalAPIBeforeAnyRequest(t *testing.T) {
	for _, name := range []string{"onboard-restaurant", "onboard-rider", "onboard-admin"} {
		t.Run(name, func(t *testing.T) {
			rec := &countingTransport{}
			prev := http.DefaultTransport
			http.DefaultTransport = rec
			defer func() { http.DefaultTransport = prev }()

			err := RunScenario(context.Background(), "https://api.halalgoes.com", name)
			if err == nil || !strings.Contains(err.Error(), "refuses API host") {
				t.Fatalf("got %v, want a refusal of the API host", err)
			}
			if rec.n != 0 {
				t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
			}
		})
	}
}
