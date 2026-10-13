package realtime

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

// A producer may narrow an event's audience below the role's allow-list
// (realtime_event.audience; contracts/websocket.md section 5, "Per-role
// projection rules"). The stored list is a second gate: it can only narrow.
// For every event and every role allowed it, the role's own token or "all"
// lets it through, and a list of only the other roles' tokens keeps it out.
func TestAStoredAudienceOnlyNarrows(t *testing.T) {
	tokens := []string{"customer", "restaurant", "rider", "support", "self"}
	for _, v := range Viewers() {
		own := audienceToken(v)
		if own == "" {
			t.Fatalf("role %s has no audience token: no stored audience could ever name it", v)
		}
		others := slices.DeleteFunc(slices.Clone(tokens), func(s string) bool { return s == own })
		for typ := range allowList[v] {
			src := storedSource(t, byType[typ].source, true)
			for _, audience := range [][]string{nil, {own}, {"all"}, {"support", own}} {
				if _, why := project(typ, v, audience, src); why != delivered {
					t.Errorf("%s with stored audience %v: %s, want delivered", typ, audience, why)
				}
			}
			if out, why := project(typ, v, others, src); why != storedAudience || out != nil {
				t.Errorf("%s reached %s through stored audience %v (%s); want it held back", typ, v, others, why)
			}
		}
	}
	// The account and rider channels' owners share one token: an account event
	// narrowed to "self" never reaches the customer of an order.
	src := storedSource(t, byType["notification.created"].source, true)
	if _, ok := Project("notification.created", ViewAccountOwner, []string{"self"}, src); !ok {
		t.Error(`notification.created narrowed to "self" did not reach the account's owner`)
	}
	if _, why := project("order.state_changed", ViewCustomer, []string{"self"},
		storedSource(t, byType["order.state_changed"].source, true)); why != storedAudience {
		t.Errorf(`order.state_changed narrowed to "self" reached the customer (%s)`, why)
	}
}

// Every drop reason has its own name in the warning log, so a fault reads as
// what it is.
func TestDropReasonsHaveDistinctLogNames(t *testing.T) {
	seen := map[string]dropReason{}
	for _, r := range []dropReason{delivered, notInAudience, unknownViewer, unknownEvent, badSource, storedAudience} {
		name := r.String()
		if name == "unknown" {
			t.Errorf("drop reason %d has no log name", r)
		}
		if prev, dup := seen[name]; dup {
			t.Errorf("drop reasons %d and %d are both logged as %q", prev, r, name)
		}
		seen[name] = r
	}
	if got := dropReason(99).String(); got != "unknown" {
		t.Errorf("an out-of-range reason logs as %q, want unknown", got)
	}
}

// SchemaFor is how producers' tests (realtimetest) validate what they emit: it
// must be the schema getRealtimeSchema serves for the type, and nothing for a
// type the binary does not send, so an invented event cannot pass.
func TestSchemaForIsTheServedSchema(t *testing.T) {
	bundle := schemaBundle()
	for _, typ := range CatalogueTypes() {
		got, err := json.Marshal(SchemaFor(typ))
		if err != nil {
			t.Fatal(err)
		}
		want, err := json.Marshal(bundle.Events[typ+"@v1"])
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("SchemaFor(%q) differs from the served %s@v1", typ, typ)
		}
	}
	for _, typ := range []string{"order.from_a_newer_contract", "order.invented", ""} {
		if s := SchemaFor(typ); s != nil {
			t.Errorf("SchemaFor(%q) = %v, want nil for a type not in the catalogue", typ, s)
		}
	}
}

// The schema names exactly the keys encoding/json writes for a payload: a field
// it skips ("-", unexported) is not demanded, and an untagged field goes by its
// Go name. A schema that disagreed would make every client reject a valid frame,
// or accept one carrying a field nobody reviewed.
func TestSchemaNamesExactlyTheEncodedKeys(t *testing.T) {
	type payload struct {
		OrderID  string  `json:"order_id"`
		Note     *string `json:"note,omitempty"`
		Internal string  `json:"-"`
		secret   string
		Untagged bool
		Ratio    float64 `json:"ratio"`
	}
	raw, err := json.Marshal(payload{Note: new(string), secret: "x"})
	if err != nil {
		t.Fatal(err)
	}
	var encoded map[string]any
	if err := json.Unmarshal(raw, &encoded); err != nil {
		t.Fatal(err)
	}
	schema := schemaFor(reflect.TypeFor[payload]())
	props, _ := schema["properties"].(map[string]any)
	for k := range encoded {
		if _, ok := props[k]; !ok {
			t.Errorf("encoded key %q is not in the schema", k)
		}
	}
	for k := range props {
		if _, ok := encoded[k]; !ok {
			t.Errorf("schema names %q, which encoding/json never writes", k)
		}
	}
	if note, _ := props["note"].(map[string]any); !reflect.DeepEqual(note["type"], []any{"string", "null"}) {
		t.Errorf("a pointer field's type = %v, want string or null", note["type"])
	}
	if schema["additionalProperties"] != false {
		t.Error("a payload object must be closed")
	}

	// A Go type the generator cannot describe fails loudly at startup rather
	// than serving a schema that admits anything.
	defer func() {
		if recover() == nil {
			t.Error("a map field produced a schema; want a panic")
		}
	}()
	schemaFor(reflect.TypeFor[map[string]string]())
}
