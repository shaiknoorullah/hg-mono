// Package realtimetest is for tests of the modules that produce realtime
// events: it reads what a change wrote on a channel and holds every event to
// the contract, the way a client receives it.
package realtimetest

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// Events returns the events of the given types on channel, in seq order (all
// of them when no type is given). Each is checked against the schema
// GET /v1/realtime/schema serves for its type, as every role that receives it
// gets it through the per-role projection; an event no role receives fails
// the test.
func Events(t testing.TB, pool *pgxpool.Pool, channel string, types ...string) []realtime.StoredEvent {
	t.Helper()
	all, _, err := realtime.NewStore(pool, "test").Replay(context.Background(), channel, 0)
	if err != nil {
		t.Fatalf("replay %s: %v", channel, err)
	}
	var out []realtime.StoredEvent
	for _, e := range all {
		if len(types) > 0 && !slices.Contains(types, e.Type) {
			continue
		}
		Validate(t, e)
		out = append(out, e)
	}
	return out
}

// Validate checks one stored event against its contract schema for every
// role that receives it.
func Validate(t testing.TB, e realtime.StoredEvent) {
	t.Helper()
	raw, err := json.Marshal(realtime.SchemaFor(e.Type))
	if err != nil {
		t.Fatal(err)
	}
	schema := openapi3.NewSchema()
	if err := schema.UnmarshalJSON(raw); err != nil {
		t.Fatalf("compile %s schema: %v", e.Type, err)
	}
	delivered := 0
	for _, v := range realtime.Viewers() {
		out, ok := realtime.Project(e.Type, v, e.Audience, e.Payload)
		if !ok {
			continue
		}
		delivered++
		var val any
		if err := json.Unmarshal(out, &val); err != nil {
			t.Fatal(err)
		}
		if err := schema.VisitJSON(val); err != nil {
			t.Errorf("%s (seq %d) for %s violates its contract schema: %v\n%s", e.Type, e.Seq, v, err, out)
		}
	}
	if delivered == 0 {
		t.Errorf("%s (seq %d) reaches no viewer", e.Type, e.Seq)
	}
}

// Types lists the events' types, in order.
func Types(events []realtime.StoredEvent) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Type
	}
	return out
}
