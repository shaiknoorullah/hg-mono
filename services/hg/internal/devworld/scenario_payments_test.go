package devworld

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestMoneyScenariosRefuseNonLocalAPIBeforeAnyRequest(t *testing.T) {
	rec := &countingTransport{}
	prev := http.DefaultTransport
	http.DefaultTransport = rec
	defer func() { http.DefaultTransport = prev }()

	for _, name := range []string{"payment-failed", "payment-unpaid", "capture-fails", "payout-run"} {
		err := RunScenario(context.Background(), "https://api.halalgoes.com", name)
		if err == nil || !strings.Contains(err.Error(), "refuses API host") {
			t.Fatalf("%s: got %v, want a refusal of the API host", name, err)
		}
	}
	if rec.n != 0 {
		t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
	}
}
