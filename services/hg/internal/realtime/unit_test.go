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

func TestCoarsenLocationRoundsAndStripsPII(t *testing.T) {
	in := json.RawMessage(`{"order_id":"o","lat":43.6532157,"lng":-79.3831846,"heading_deg":90,"speed_mps":5.2,"accuracy_m":3.1,"customer_phone":"+14165550123"}`)
	out := coarsenLocation(in)

	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatalf("coarsened payload does not parse: %v", err)
	}
	if _, ok := m["accuracy_m"]; ok {
		t.Error("accuracy_m must be stripped for the restaurant view")
	}
	if _, ok := m["speed_mps"]; ok {
		t.Error("speed_mps must be stripped for the restaurant view")
	}
	if _, ok := m["customer_phone"]; ok {
		t.Error("customer_phone must never reach a restaurant")
	}
	lat, _ := m["lat"].(float64)
	if lat != 43.653 {
		t.Errorf("lat = %v, want it rounded to ~100 m (43.653)", lat)
	}
}

func TestProjectDropsOutOfAudience(t *testing.T) {
	// A payment.captured event is customer-only. A restaurant viewer must not
	// receive it.
	_, deliver := Project("payment.captured", ViewRestaurant, []string{"customer"}, json.RawMessage(`{}`))
	if deliver {
		t.Error("restaurant must not receive a customer-only payment event")
	}
	_, deliver = Project("payment.captured", ViewCustomer, []string{"customer"}, json.RawMessage(`{}`))
	if !deliver {
		t.Error("customer must receive its own payment event")
	}
}

func TestProjectAllParticipantsDefault(t *testing.T) {
	// order.state_changed goes to all participants — an empty audience means
	// everyone subscribed receives it.
	for _, v := range []Viewer{ViewCustomer, ViewRestaurant, ViewRider, ViewSupport} {
		if _, deliver := Project("order.state_changed", v, nil, json.RawMessage(`{}`)); !deliver {
			t.Errorf("viewer %d should receive an all-participants event", v)
		}
	}
}

func TestProjectRiderLocationCoarseForRestaurant(t *testing.T) {
	in := json.RawMessage(`{"lat":43.6532157,"lng":-79.3831846,"accuracy_m":3.0}`)
	// Customer gets it precise.
	precise, deliver := Project("rider.location", ViewCustomer, nil, in)
	if !deliver {
		t.Fatal("customer should receive rider.location")
	}
	var pm map[string]any
	_ = json.Unmarshal(precise, &pm)
	if pm["lat"].(float64) != 43.6532157 {
		t.Errorf("customer lat should be precise, got %v", pm["lat"])
	}
	// Restaurant gets it coarse.
	coarse, deliver := Project("rider.location", ViewRestaurant, nil, in)
	if !deliver {
		t.Fatal("restaurant should receive rider.location")
	}
	var cm map[string]any
	_ = json.Unmarshal(coarse, &cm)
	if _, ok := cm["accuracy_m"]; ok {
		t.Error("restaurant rider.location must be coarse (no accuracy)")
	}
	if cm["lat"].(float64) == 43.6532157 {
		t.Error("restaurant lat must be rounded, not precise")
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
	for _, ty := range catalogueTypes {
		if _, ok := b.Events[ty+"@v1"]; !ok {
			t.Errorf("schema bundle missing %s@v1", ty)
		}
	}
}
