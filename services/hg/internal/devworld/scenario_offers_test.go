package devworld

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// The offer scenarios sign riders in and put them online, so they refuse an
// API that is not on this machine before the first request.
func TestOfferScenariosRefuseNonLocalAPIBeforeAnyRequest(t *testing.T) {
	rec := &countingTransport{}
	prev := http.DefaultTransport
	http.DefaultTransport = rec
	t.Cleanup(func() { http.DefaultTransport = prev })

	for _, name := range []string{"offer-reject", "offer-ignored", "offer-race", "no-rider"} {
		err := RunScenario(context.Background(), "https://api.halalgoes.com", name)
		if err == nil || !strings.Contains(err.Error(), "refuses API host") {
			t.Errorf("%s: got %v, want a refusal of the API host", name, err)
		}
	}
	if rec.n != 0 {
		t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
	}
}

// offer-race passes only when exactly one accept wins and the other is refused
// with an offer conflict.
func TestRaceOutcomeNeedsExactlyOneWinner(t *testing.T) {
	taken := &apiError{Status: http.StatusConflict, Code: "OFFER_ALREADY_TAKEN"}
	withdrawn := &apiError{Status: http.StatusConflict, Code: "OFFER_WITHDRAWN"}
	cancelled := &apiError{Status: http.StatusConflict, Code: "ORDER_CANCELLED"}

	if w, l, err := raceOutcome(nil, taken); err != nil || w != 0 || l != 1 {
		t.Fatalf("first wins: got %d %d %v", w, l, err)
	}
	if w, l, err := raceOutcome(withdrawn, nil); err != nil || w != 1 || l != 0 {
		t.Fatalf("second wins: got %d %d %v", w, l, err)
	}
	for name, pair := range map[string][2]error{
		"two winners":     {nil, nil},
		"no winner":       {taken, withdrawn},
		"wrong refusal":   {nil, cancelled},
		"transport error": {errors.New("connection reset"), nil},
	} {
		if _, _, err := raceOutcome(pair[0], pair[1]); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}
