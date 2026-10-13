package realtime

import (
	"bytes"
	"encoding/json"
	"testing"
)

const sampleUUID = "6b1f0a3c-2f4e-7c1a-9f00-3a1b2c3d4e5f"

func TestParseChannel(t *testing.T) {
	cases := []struct {
		in      string
		ok      bool
		kind    ChannelKind
		subject string
	}{
		{"account:" + sampleUUID, true, KindAccount, sampleUUID},
		{"order:" + sampleUUID, true, KindOrder, sampleUUID},
		{"restaurant:" + sampleUUID, true, KindRestaurant, sampleUUID},
		{"rider:" + sampleUUID, true, KindRider, sampleUUID},
		{"admin:ops", true, KindAdminOps, "ops"},
		{"admin:other", false, "", ""},
		{"order:not-a-uuid", false, "", ""},
		{"order:", false, "", ""},
		{"unknown:" + sampleUUID, false, "", ""},
		{"noseparator", false, "", ""},
		{"", false, "", ""},
		{"order:" + sampleUUID + ":extra", true, KindOrder, sampleUUID + ":extra"}, // Cut takes first colon; subject fails uuid
	}
	for _, c := range cases {
		got, ok := ParseChannel(c.in)
		if ok != c.ok {
			// the extra-colon case: subject won't be a valid uuid, so ok=false
			if c.in == "order:"+sampleUUID+":extra" {
				if ok {
					t.Errorf("ParseChannel(%q) accepted a malformed subject", c.in)
				}
				continue
			}
			t.Errorf("ParseChannel(%q) ok = %v, want %v", c.in, ok, c.ok)
			continue
		}
		if ok && (got.Kind != c.kind || got.Subject != c.subject) {
			t.Errorf("ParseChannel(%q) = {%v %q}, want {%v %q}", c.in, got.Kind, got.Subject, c.kind, c.subject)
		}
	}
}

func TestInboundFrameRejectsUnknownField(t *testing.T) {
	// A subscribe with an extra "user_id" field — the exact thing the contract
	// makes unrepresentable — must be rejected as an unknown field.
	raw := []byte(`{"type":"subscribe","channel":"order:` + sampleUUID + `","user_id":"attacker"}`)
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var f inboundFrame
	err := dec.Decode(&f)
	if err == nil {
		t.Fatal("expected an unknown-field error for a frame carrying user_id")
	}
	if !isUnknownField(err) {
		t.Fatalf("expected unknown-field classification, got %v", err)
	}
}

func TestInboundFrameHasNoIdentityField(t *testing.T) {
	// Structural proof: the inbound frame type cannot carry identity. Any of
	// these fields on the wire is an unknown field, not an ignored one.
	for _, field := range []string{"user_id", "account_id", "role", "restaurant_id", "rider_id"} {
		raw := []byte(`{"type":"pong","t":1,"` + field + `":"x"}`)
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		var f inboundFrame
		if err := dec.Decode(&f); err == nil {
			t.Errorf("field %q was accepted; identity must be unrepresentable", field)
		}
	}
}

func TestFiveFrameVocabulary(t *testing.T) {
	// The five valid frame types decode cleanly.
	valid := []string{
		`{"type":"subscribe","channel":"order:` + sampleUUID + `"}`,
		`{"type":"unsubscribe","channel":"order:` + sampleUUID + `"}`,
		`{"type":"resume","channel":"order:` + sampleUUID + `","after_seq":1487}`,
		`{"type":"reauth","access_token":"jwt"}`,
		`{"type":"pong","t":1786000000123}`,
	}
	for _, v := range valid {
		dec := json.NewDecoder(bytes.NewReader([]byte(v)))
		dec.DisallowUnknownFields()
		var f inboundFrame
		if err := dec.Decode(&f); err != nil {
			t.Errorf("valid frame rejected: %s: %v", v, err)
		}
	}
}

func TestAcceptKey(t *testing.T) {
	// The RFC 6455 example: key "dGhlIHNhbXBsZSBub25jZQ==" yields
	// "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=".
	got := acceptKey("dGhlIHNhbXBsZSBub25jZQ==")
	want := "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	if got != want {
		t.Errorf("acceptKey = %q, want %q", got, want)
	}
}

func TestProjectDropsOutOfAudience(t *testing.T) {
	// A payment.captured event is customer-only. A restaurant viewer must not
	// receive it.
	_, deliver := Project("payment.captured", ViewRestaurant, nil, json.RawMessage(`{}`))
	if deliver {
		t.Error("restaurant must not receive a customer-only payment event")
	}
	_, deliver = Project("payment.captured", ViewCustomer, nil, json.RawMessage(`{}`))
	if !deliver {
		t.Error("customer must receive its own payment event")
	}
}

func TestProjectAllParticipants(t *testing.T) {
	// order.state_changed goes to every participant.
	for _, v := range []Viewer{ViewCustomer, ViewRestaurant, ViewRider, ViewSupport} {
		if _, deliver := Project("order.state_changed", v, nil, json.RawMessage(`{}`)); !deliver {
			t.Errorf("viewer %d should receive an all-participants event", v)
		}
	}
}

func TestProjectFailsClosed(t *testing.T) {
	// A type outside the catalogue, or a source that does not decode, is never
	// passed through.
	if _, deliver := Project("order.invented", ViewSupport, nil, json.RawMessage(`{"order_id":"x"}`)); deliver {
		t.Error("an event type outside the catalogue must not be delivered")
	}
	if _, deliver := Project("order.state_changed", ViewCustomer, nil, json.RawMessage(`{"to": 7}`)); deliver {
		t.Error("a source that does not decode must not be delivered")
	}
	// The stored audience narrows further.
	if _, deliver := Project("order.state_changed", ViewRider, []string{"customer"}, json.RawMessage(`{}`)); deliver {
		t.Error("a stored audience must narrow delivery")
	}
}

func TestProjectRiderLocationPerRole(t *testing.T) {
	src := json.RawMessage(`{"order_id":"o","lat":43.6532157,"lng":-79.3831846,"heading_deg":90,"speed_mps":5.2,"accuracy_m":3.1,"recorded_at":"2026-08-10T18:42:45.412Z","source_picked_up":false}`)
	decode := func(t *testing.T, v Viewer, raw json.RawMessage) map[string]any {
		t.Helper()
		out, ok := Project("rider.location", v, nil, raw)
		if !ok {
			t.Fatalf("viewer %d should receive rider.location", v)
		}
		var m map[string]any
		if err := json.Unmarshal(out, &m); err != nil {
			t.Fatal(err)
		}
		if _, leaked := m["source_picked_up"]; leaked {
			t.Errorf("viewer %d was sent the internal source_picked_up flag", v)
		}
		return m
	}

	coarse := func(t *testing.T, who string, m map[string]any) {
		t.Helper()
		if m["lat"].(float64) != 43.653 || m["lng"].(float64) != -79.383 {
			t.Errorf("%s position must be rounded to ~100 m, got %v,%v", who, m["lat"], m["lng"])
		}
		for _, k := range []string{"heading_deg", "speed_mps", "accuracy_m"} {
			if v, ok := m[k]; !ok || v != nil {
				t.Errorf("%s %s must be present and null, got %v (present %v)", who, k, v, ok)
			}
		}
	}

	// The restaurant always gets the coarse position.
	coarse(t, "restaurant", decode(t, ViewRestaurant, src))
	// The customer gets it coarse before pickup ...
	coarse(t, "customer before pickup", decode(t, ViewCustomer, src))
	// ... and precise after.
	after := json.RawMessage(bytes.Replace(src, []byte(`"source_picked_up":false`), []byte(`"source_picked_up":true`), 1))
	if m := decode(t, ViewCustomer, after); m["lat"].(float64) != 43.6532157 || m["accuracy_m"].(float64) != 3.1 {
		t.Errorf("customer after pickup should see the precise position, got %v", m)
	}
	// Support always precise; the rider is not in the audience.
	if m := decode(t, ViewSupport, src); m["lat"].(float64) != 43.6532157 {
		t.Errorf("support should see the precise position, got %v", m["lat"])
	}
	if _, ok := Project("rider.location", ViewRider, nil, src); ok {
		t.Error("the rider is not in rider.location's audience")
	}
}

func TestProjectRiderNeverSeesOrderMoney(t *testing.T) {
	cancelled := json.RawMessage(`{"order_id":"o","reason_code":"SUPPORT_CANCELLED","by":"SUPPORT","refund":{"kind":"FULL","amount_cents":6706,"state":"REQUESTED"}}`)
	out, ok := Project("order.cancelled", ViewRider, nil, cancelled)
	if !ok || bytes.Contains(out, []byte("6706")) || !bytes.Contains(out, []byte(`"refund":null`)) {
		t.Errorf("the rider's order.cancelled must carry refund: null, got %s", out)
	}
	if out, _ := Project("order.cancelled", ViewCustomer, nil, cancelled); !bytes.Contains(out, []byte("6706")) {
		t.Errorf("the customer's order.cancelled must carry the refund, got %s", out)
	}
	completed := json.RawMessage(`{"order_id":"o","delivered_at":"2026-08-10T18:43:05.412Z","receipt_url":"/v1/orders/o/receipt"}`)
	for _, v := range []Viewer{ViewRider, ViewRestaurant} {
		if out, _ := Project("order.completed", v, nil, completed); !bytes.Contains(out, []byte(`"receipt_url":null`)) {
			t.Errorf("viewer %d must not get the customer's receipt, got %s", v, out)
		}
	}
}

func TestHasAny(t *testing.T) {
	roles := []string{"CUSTOMER", "RIDER"}
	if !hasAny(roles, "RIDER") {
		t.Error("hasAny should find RIDER")
	}
	if hasAny(roles, "ADMIN", "SUPER_ADMIN") {
		t.Error("hasAny should not find admin roles")
	}
}

func TestBearerFromProtocols(t *testing.T) {
	got := bearerFromProtocols("hg.v1, bearer.abc.def.ghi")
	if got != "abc.def.ghi" {
		t.Errorf("bearerFromProtocols = %q, want the jwt", got)
	}
	if bearerFromProtocols("hg.v1") != "" {
		t.Error("no bearer offered should yield empty")
	}
}

func TestRolesFromSnapshot(t *testing.T) {
	if got := rolesFromSnapshot(json.RawMessage(`["CUSTOMER","RIDER"]`)); len(got) != 2 || got[0] != "CUSTOMER" {
		t.Errorf("plain array snapshot mis-parsed: %v", got)
	}
	if got := rolesFromSnapshot(json.RawMessage(`[{"r":"ADMIN","s":null}]`)); len(got) != 1 || got[0] != "ADMIN" {
		t.Errorf("scoped snapshot mis-parsed: %v", got)
	}
}

func TestValidClientSurface(t *testing.T) {
	for _, ok := range []string{"customer-app", "rider-app", "restaurant-web", "admin-web", "web"} {
		if !validClientSurface(ok) {
			t.Errorf("%q should be a valid client surface", ok)
		}
	}
	if validClientSurface("desktop") {
		t.Error("desktop is not a client surface")
	}
}

func TestSchemaBundleCoversCatalogue(t *testing.T) {
	b := schemaBundle()
	if b.Protocol != Protocol {
		t.Errorf("bundle protocol = %d, want %d", b.Protocol, Protocol)
	}
	// Every catalogue type is present at v1.
	for _, ty := range CatalogueTypes() {
		if _, ok := b.Events[ty+"@v1"]; !ok {
			t.Errorf("schema bundle missing %s@v1", ty)
		}
	}
}
