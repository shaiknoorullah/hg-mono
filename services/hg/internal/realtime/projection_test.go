package realtime

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

// These tests hold the per-role projection to failing closed (security review
// of https://github.com/shaiknoorullah/hg-mono/issues/247; contracts/websocket.md
// section 5, "Per-role projection rules"):
//
//   - every serializer's output validates against the contract's schema;
//   - a serializer builds a new value of its own type, never the source;
//   - a field that no serializer names never reaches anyone, however it got
//     into the stored source — the check fails for a deny-list;
//   - no rider projection ever carries a handover code;
//   - an unknown role gets nothing, and an event type without a serializer is
//     dropped for every role.

// probePrefix marks every value the leak probes plant in a source record.
const probePrefix = "PROBE-SECRET-"

// probeKeys are planted at every level of a stored source: the handover codes
// a rider must never see, and a field no contract version has, standing for one
// a producer adds to its source tomorrow.
var probeKeys = append(slices.Clone(handoverCodeFields), "unlisted_future_field")

// fullSource builds a source record of type t with every field set, so a
// serializer that drops a field it should send, or sends one it should not,
// shows. flag sets every bool, which is what picks between two serializers
// (either, catalogue.go), so running both flags covers both.
func fullSource(t reflect.Type, flag bool) reflect.Value {
	v := reflect.New(t).Elem()
	fill(v, "src", flag)
	return v
}

func fill(v reflect.Value, name string, flag bool) {
	t := v.Type()
	switch {
	case t == timestampType:
		v.Set(reflect.ValueOf(At(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))))
		return
	case t == withheldType:
		return
	}
	if values, ok := enumValues[t]; ok {
		v.SetString(values[0])
		return
	}
	switch t.Kind() {
	case reflect.Pointer:
		p := reflect.New(t.Elem())
		fill(p.Elem(), name, flag)
		v.Set(p)
	case reflect.String:
		v.SetString("value-" + name)
	case reflect.Bool:
		v.SetBool(flag)
	case reflect.Int, reflect.Int32, reflect.Int64:
		v.SetInt(7)
	case reflect.Float32, reflect.Float64:
		v.SetFloat(43.6532157)
	case reflect.Slice:
		s := reflect.MakeSlice(t, 1, 1)
		fill(s.Index(0), name, flag)
		v.Set(s)
	case reflect.Struct:
		for i := 0; i < t.NumField(); i++ {
			if f := t.Field(i); f.IsExported() {
				fill(v.Field(i), f.Name, flag)
			}
		}
	default:
		panic("fill: unhandled " + t.String())
	}
}

// plantProbes adds every probe key, with a probe value, to every object of a
// decoded JSON document.
func plantProbes(doc any) {
	switch d := doc.(type) {
	case map[string]any:
		for _, v := range d {
			plantProbes(v)
		}
		for _, k := range probeKeys {
			d[k] = probePrefix + k
		}
	case []any:
		for _, v := range d {
			plantProbes(v)
		}
	}
}

// storedSource is the source record as realtime_event.payload would hold it,
// with the probes planted.
func storedSource(t *testing.T, src reflect.Type, flag bool) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(fullSource(src, flag).Interface())
	if err != nil {
		t.Fatal(err)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	plantProbes(doc)
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// leaks reports every key of a projected payload, at any depth, that the
// contract does not list for the event, and every probe value in it.
func leaks(contract map[string]mdField, out json.RawMessage) []string {
	var doc any
	if err := json.Unmarshal(out, &doc); err != nil {
		return []string{"not JSON: " + err.Error()}
	}
	var found []string
	var walk func(any, map[string]mdField, string)
	walk = func(node any, fields map[string]mdField, path string) {
		switch n := node.(type) {
		case map[string]any:
			for k, v := range n {
				f, listed := fields[k]
				if !listed {
					found = append(found, path+k+" (not in the contract)")
					continue
				}
				walk(v, f.nested, path+k+".")
			}
		case []any:
			for _, v := range n {
				walk(v, fields, path)
			}
		case string:
			if strings.HasPrefix(n, probePrefix) {
				found = append(found, strings.TrimSuffix(path, ".")+" = "+n)
			}
		}
	}
	walk(doc, contract, "")
	sort.Strings(found)
	return found
}

// contractFields maps each event type to the contract's field tree.
func contractFields(t *testing.T) map[string]map[string]mdField {
	t.Helper()
	out := map[string]map[string]mdField{}
	for _, ev := range parseCatalogue(t) {
		out[ev.typ] = ev.fields
	}
	return out
}

// forEachSerializer runs f for every (role, event type) the allow-list names,
// in a stable order.
func forEachSerializer(t *testing.T, f func(t *testing.T, v Viewer, typ string, p projector)) {
	for _, v := range Viewers() {
		types := make([]string, 0, len(allowList[v]))
		for typ := range allowList[v] {
			types = append(types, typ)
		}
		sort.Strings(types)
		for _, typ := range types {
			t.Run(v.String()+"/"+typ, func(t *testing.T) { f(t, v, typ, allowList[v][typ]) })
		}
	}
}

func TestEveryRoleIsInTheAllowList(t *testing.T) {
	for _, v := range Viewers() {
		if len(allowList[v]) == 0 {
			t.Errorf("%s has no serializers", v)
		}
	}
	for v := range allowList {
		if !slices.Contains(Viewers(), v) {
			t.Errorf("the allow-list has a role Viewers() does not list: %s", v)
		}
	}
	if _, ok := allowList[ViewNone]; ok {
		t.Error("the allow-list must have no entry for ViewNone")
	}
}

func TestEveryProjectionValidatesAgainstTheContract(t *testing.T) {
	served := map[string]bool{}
	forEachSerializer(t, func(t *testing.T, v Viewer, typ string, _ projector) {
		served[typ] = true
		for _, flag := range []bool{true, false} {
			out, ok := Project(typ, v, nil, storedSource(t, byType[typ].source, flag))
			if !ok {
				t.Fatalf("%s should receive %s", v, typ)
			}
			if err := validatePayload(t, typ, out); err != nil {
				t.Errorf("%s's %s does not validate against the contract schema: %v\n%s", v, typ, err, out)
			}
		}
	})
	// Every event type in the catalogue reaches someone, so every one is
	// validated above.
	for _, typ := range CatalogueTypes() {
		if !served[typ] {
			t.Errorf("%s has no serializer for any role", typ)
		}
	}
}

func TestSerializersBuildTheirOwnType(t *testing.T) {
	forEachSerializer(t, func(t *testing.T, v Viewer, typ string, p projector) {
		s := byType[typ]
		for _, out := range p.outs {
			// A serializer that returned its source would forward every field
			// the source ever gains.
			if out == p.src || out == s.source {
				t.Errorf("the %s serializer for %s returns its source type %s", v, typ, out)
			}
			// A role's type has exactly the contract payload's fields: a role
			// that may not see one has it Withheld, never absent or extra.
			if diff := sameFields(out, s.wire, ""); len(diff) > 0 {
				t.Errorf("the %s serializer for %s returns %s, whose fields differ from the contract's: %v", v, typ, out, diff)
			}
		}
	})
}

// sameFields compares a role's type with the contract payload type, field by
// field and level by level. A Withheld field stands for the whole of the
// contract field, nested members included.
func sameFields(role, wire reflect.Type, path string) []string {
	deref := func(t reflect.Type) reflect.Type {
		for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice {
			t = t.Elem()
		}
		return t
	}
	role, wire = deref(role), deref(wire)
	if role == withheldType || role.Kind() != reflect.Struct || role == timestampType {
		return nil
	}
	if wire.Kind() != reflect.Struct || wire == timestampType {
		return []string{path + " is an object only in the role's type"}
	}
	fields := func(t reflect.Type) map[string]reflect.Type {
		m := map[string]reflect.Type{}
		for i := 0; i < t.NumField(); i++ {
			if name, ok := jsonName(t.Field(i)); ok {
				m[name] = t.Field(i).Type
			}
		}
		return m
	}
	rf, wf := fields(role), fields(wire)
	var diff []string
	for name, rt := range rf {
		wt, ok := wf[name]
		if !ok {
			diff = append(diff, path+name+" is not in the contract")
			continue
		}
		diff = append(diff, sameFields(rt, wt, path+name+".")...)
	}
	for name := range wf {
		if _, ok := rf[name]; !ok {
			diff = append(diff, path+name+" is missing")
		}
	}
	sort.Strings(diff)
	return diff
}

func TestNoProjectionSendsAFieldNoSerializerNames(t *testing.T) {
	contract := contractFields(t)
	forEachSerializer(t, func(t *testing.T, v Viewer, typ string, _ projector) {
		for _, flag := range []bool{true, false} {
			out, ok := Project(typ, v, nil, storedSource(t, byType[typ].source, flag))
			if !ok {
				t.Fatalf("%s should receive %s", v, typ)
			}
			if found := leaks(contract[typ], out); len(found) > 0 {
				t.Errorf("%s's %s sends what no serializer names: %v\n%s", v, typ, found, out)
			}
		}
	})
}

// TestLeakCheckCatchesADenyList proves the check above has teeth: a projection
// that copies the stored source and deletes the fields it knows to be secret —
// a deny-list — passes the field it did not know about, and the check catches
// it.
func TestLeakCheckCatchesADenyList(t *testing.T) {
	contract := contractFields(t)
	denyList := func(raw json.RawMessage) json.RawMessage {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		for _, secret := range handoverCodeFields {
			delete(m, secret)
		}
		out, _ := json.Marshal(m)
		return out
	}
	out := denyList(storedSource(t, byType["order.state_changed"].source, true))
	if found := leaks(contract["order.state_changed"], out); !slices.ContainsFunc(found, func(s string) bool {
		return strings.HasPrefix(s, "unlisted_future_field")
	}) {
		t.Fatalf("the leak check missed a deny-list projection; found only %v", found)
	}
}

func TestNoRiderProjectionCarriesAHandoverCode(t *testing.T) {
	for _, v := range []Viewer{ViewRider, ViewRiderSelf} {
		for typ := range allowList[v] {
			for _, flag := range []bool{true, false} {
				out, ok := Project(typ, v, nil, storedSource(t, byType[typ].source, flag))
				if !ok {
					t.Fatalf("%s should receive %s", v, typ)
				}
				for _, code := range handoverCodeFields {
					if strings.Contains(string(out), `"`+code+`"`) || strings.Contains(string(out), probePrefix+code) {
						t.Errorf("%s's %s carries %s: %s", v, typ, code, out)
					}
				}
			}
		}
	}
	// And no event on order:{id}, whichever role it goes to: the rider is
	// subscribed there (contracts/websocket.md section 5).
	for _, v := range Viewers() {
		for typ := range allowList[v] {
			if byType[typ].kind != KindOrder {
				continue
			}
			out, _ := Project(typ, v, nil, storedSource(t, byType[typ].source, true))
			for _, code := range handoverCodeFields {
				if strings.Contains(string(out), code) {
					t.Errorf("%s's %s on order:{id} carries %s: %s", v, typ, code, out)
				}
			}
		}
	}
}

func TestAnUnknownRoleGetsNothing(t *testing.T) {
	roles := []Viewer{ViewNone, Viewer(-1), Viewer(len(Viewers()) + 1), Viewer(1 << 20)}
	for _, typ := range CatalogueTypes() {
		src := storedSource(t, byType[typ].source, true)
		for _, v := range roles {
			if out, why := project(typ, v, nil, src); why != unknownViewer || out != nil {
				t.Errorf("role %s got %s for %s (%s): an unknown role must get nothing", v, out, typ, why)
			}
			// No stored audience can let it in either.
			if _, ok := Project(typ, v, []string{"all", "customer", "support", "self"}, src); ok {
				t.Errorf("role %s got %s through a stored audience", v, typ)
			}
		}
	}
}

func TestAnEventTypeWithoutASerializerIsDropped(t *testing.T) {
	src := json.RawMessage(`{"order_id":"o","at":"2026-10-06T12:00:00.000Z","pickup_code":"4821"}`)

	// A type this binary has never heard of — including one a newer contract
	// adds, like order.rider_arrived — is sent to no role.
	for _, typ := range []string{"order.rider_arrived", "order.invented", ""} {
		for _, v := range Viewers() {
			if out, why := project(typ, v, nil, src); why != unknownEvent || out != nil {
				t.Errorf("%s got %q for %s (%s), want it dropped", v, out, typ, why)
			}
		}
	}

	// A type added to the catalogue later, with no serializers yet, is dropped
	// for every role: being in the catalogue is not being in the allow-list.
	const added = "order.added_later"
	byType[added] = &spec{typ: added, kind: KindOrder,
		source: reflect.TypeFor[OrderNoteAdded](), wire: reflect.TypeFor[orderNoteAddedWire]()}
	t.Cleanup(func() { delete(byType, added) })
	for _, v := range Viewers() {
		if out, why := project(added, v, nil, src); why != unknownEvent || out != nil {
			t.Errorf("%s got %q for %s (%s), want it dropped", v, out, added, why)
		}
	}

	// A role with serializers for other events, but none for this one, gets
	// nothing for it.
	if out, why := project("payment.captured", ViewRider, nil, src); why != notInAudience || out != nil {
		t.Errorf("the rider got %q for payment.captured (%s), want it dropped", out, why)
	}
	if out, why := project("order.note_added", ViewCustomer, nil, src); why != notInAudience || out != nil {
		t.Errorf("the customer got %q for order.note_added (%s), want it dropped", out, why)
	}
}

func TestADropThatFailsClosedIsLogged(t *testing.T) {
	for why, want := range map[dropReason]bool{
		delivered: false, notInAudience: false, storedAudience: false,
		unknownViewer: true, unknownEvent: true, badSource: true,
	} {
		if got := why.failedClosed(); got != want {
			t.Errorf("%s.failedClosed() = %v, want %v", why, got, want)
		}
	}
	if _, why := project("order.state_changed", ViewCustomer, nil, json.RawMessage(`{"to": 7}`)); why != badSource {
		t.Errorf("an undecodable source = %s, want %s", why, badSource)
	}
}

func TestViewerNamesAreDistinct(t *testing.T) {
	seen := map[string]Viewer{}
	for _, v := range append(Viewers(), ViewNone) {
		name := v.String()
		if prev, dup := seen[name]; dup {
			t.Errorf("%d and %d are both named %q", prev, v, name)
		}
		seen[name] = v
	}
	if got := Viewer(99).String(); got != fmt.Sprintf("unknown(%d)", 99) {
		t.Errorf("Viewer(99).String() = %q", got)
	}
}
