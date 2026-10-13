package realtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"gopkg.in/yaml.v3"
)

// These tests hold the Go catalogue (events.go, wire.go, catalogue.go, schema.go) to the
// contract it implements, so neither can drift without a failing test
// (https://github.com/shaiknoorullah/hg-mono/issues/247):
//
//   - every event type in contracts/websocket.md section 4 is in the catalogue
//     and nothing else is, on the channel family the contract names;
//   - every payload's field names, at every depth, match the contract's table;
//   - a field the contract types as an openapi.yaml enum lists exactly that
//     enum's values, an inline closed set lists exactly those strings, and a
//     field the contract marks "| null" is nullable;
//   - every role the contract puts in an event's audience gets a serializer,
//     and no role outside it does (support and admin see everything, section 5);
//   - every event in the contract's realtime fixtures validates against the
//     schema GET /v1/realtime/schema serves;
//   - no handover code can reach a rider, or any order-channel subscriber.

const contractsDir = "../../../../contracts"

// mdField is one field of a contract payload, parsed from its `{...}` text.
type mdField struct {
	name     string
	nested   map[string]mdField // object or array-of-object members
	enumName string             // an identifier naming an openapi.yaml enum
	literals []string           // an inline closed set: "a" | "b"
	nullable bool
}

// mdEvent is one row of the contract's event tables.
type mdEvent struct {
	typ      string
	kind     ChannelKind
	audience string
	fields   map[string]mdField
}

func readContract(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(contractsDir, name))
	if err != nil {
		t.Fatalf("read contract %s: %v", name, err)
	}
	return b
}

// parseCatalogue reads the event tables of contracts/websocket.md sections 4.2
// to 4.7.
func parseCatalogue(t *testing.T) []mdEvent {
	t.Helper()
	md := string(readContract(t, "websocket.md"))
	section := regexp.MustCompile("^### 4\\.([2-7]) ")
	row := regexp.MustCompile("^\\| `([a-z_]+\\.[a-z_]+)` \\|")
	var out []mdEvent
	cur := ""
	for _, line := range strings.Split(md, "\n") {
		if m := section.FindStringSubmatch(line); m != nil {
			cur = m[1]
			continue
		}
		if strings.HasPrefix(line, "## ") {
			cur = ""
		}
		m := row.FindStringSubmatch(line)
		if cur == "" || m == nil {
			continue
		}
		cells := splitRow(line)
		ev := mdEvent{typ: m[1]}
		switch cur {
		case "2", "3":
			ev.kind, ev.audience = KindOrder, cells[1]
		case "4":
			ev.kind, ev.audience = KindRestaurant, cells[1]
		case "5":
			ev.audience = cells[2]
			if strings.Contains(cells[1], "rider:") {
				ev.kind = KindRider
			} else {
				ev.kind = KindOrder
			}
		case "6":
			ev.kind, ev.audience = KindAccount, "self"
		case "7":
			ev.kind, ev.audience = KindAdminOps, "support"
		}
		data := cells[len(cells)-1]
		i := strings.Index(data, "`{")
		if i < 0 {
			t.Fatalf("%s: no `{...}` payload in %q", ev.typ, data)
		}
		body := data[i+1:]
		body = body[:strings.Index(body, "`")]
		ev.fields = parseObject(t, ev.typ, body)
		out = append(out, ev)
	}
	if len(out) == 0 {
		t.Fatal("parsed no events from contracts/websocket.md")
	}
	return out
}

// splitRow splits a markdown table row on unescaped pipes.
func splitRow(line string) []string {
	line = strings.ReplaceAll(line, `\|`, "\x00")
	parts := strings.Split(strings.Trim(line, "|"), "|")
	for i, p := range parts {
		parts[i] = strings.TrimSpace(strings.ReplaceAll(p, "\x00", "|"))
	}
	return parts
}

// splitTop splits s on sep where not nested inside braces, brackets or quotes.
func splitTop(s string, sep rune) []string {
	var out []string
	depth, start, quoted := 0, 0, false
	for i, r := range s {
		switch {
		case r == '"':
			quoted = !quoted
		case quoted:
		case r == '{' || r == '[':
			depth++
		case r == '}' || r == ']':
			depth--
		case r == sep && depth == 0:
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
}

var identRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)

// parseObject parses "{a, b: T, c: {d}, e: [{f}], g: "x" | "y", h: T | null}".
func parseObject(t *testing.T, where, s string) map[string]mdField {
	t.Helper()
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "{") || !strings.HasSuffix(s, "}") {
		t.Fatalf("%s: not an object: %q", where, s)
	}
	fields := map[string]mdField{}
	for _, part := range splitTop(s[1:len(s)-1], ',') {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, typ, _ := strings.Cut(part, ":")
		f := mdField{name: strings.TrimSpace(name)}
		for _, alt := range splitTop(typ, '|') {
			alt = strings.TrimSpace(alt)
			switch {
			case alt == "":
			case alt == "null":
				f.nullable = true
			case strings.HasPrefix(alt, "{"):
				f.nested = parseObject(t, where+"."+f.name, alt)
			case strings.HasPrefix(alt, "[{"):
				f.nested = parseObject(t, where+"."+f.name, alt[1:len(alt)-1])
			case strings.HasPrefix(alt, `"`):
				f.literals = append(f.literals, strings.Trim(alt, `"`))
			case identRe.MatchString(alt):
				f.enumName = alt
			}
		}
		fields[f.name] = f
	}
	return fields
}

// openapiEnums reads every enum schema in contracts/openapi.yaml.
func openapiEnums(t *testing.T) map[string][]string {
	t.Helper()
	var doc struct {
		Components struct {
			Schemas map[string]struct {
				Enum []string `yaml:"enum"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(readContract(t, "openapi.yaml"), &doc); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	out := map[string][]string{}
	for name, s := range doc.Components.Schemas {
		if len(s.Enum) > 0 {
			out[name] = s.Enum
		}
	}
	return out
}

func sorted(in []string) []string {
	out := slices.Clone(in)
	sort.Strings(out)
	return out
}

// schemaEnum returns a schema's enum members, without null.
func schemaEnum(s map[string]any) []string {
	var out []string
	enum, _ := s["enum"].([]any)
	for _, v := range enum {
		if str, ok := v.(string); ok {
			out = append(out, str)
		}
	}
	return sorted(out)
}

func schemaNullable(s map[string]any) bool {
	switch ty := s["type"].(type) {
	case string:
		return ty == "null"
	case []any:
		return slices.Contains(ty, any("null"))
	}
	return false
}

// objectProps returns the properties of an object schema, or of an array's
// object items.
func objectProps(s map[string]any) map[string]any {
	if items, ok := s["items"].(map[string]any); ok {
		s = items
	}
	props, _ := s["properties"].(map[string]any)
	return props
}

func compareFields(t *testing.T, where string, md map[string]mdField, props map[string]any, enums map[string][]string) {
	t.Helper()
	var mdKeys, goKeys []string
	for k := range md {
		mdKeys = append(mdKeys, k)
	}
	for k := range props {
		goKeys = append(goKeys, k)
	}
	if !slices.Equal(sorted(mdKeys), sorted(goKeys)) {
		t.Errorf("%s: fields differ\n contract: %v\n go:       %v", where, sorted(mdKeys), sorted(goKeys))
		return
	}
	for name, f := range md {
		s := props[name].(map[string]any)
		path := where + "." + name
		if f.nullable && !schemaNullable(s) {
			t.Errorf("%s: the contract allows null; the Go type does not", path)
		}
		if f.nested != nil {
			compareFields(t, path, f.nested, objectProps(s), enums)
		}
		if len(f.literals) > 0 && !slices.Equal(schemaEnum(s), sorted(f.literals)) {
			t.Errorf("%s: closed set %v, Go lists %v", path, sorted(f.literals), schemaEnum(s))
		}
		if want, ok := enums[f.enumName]; ok && !slices.Equal(schemaEnum(s), sorted(want)) {
			t.Errorf("%s: %s is %v in openapi.yaml, Go lists %v", path, f.enumName, sorted(want), schemaEnum(s))
		}
	}
}

func TestCatalogueMatchesContract(t *testing.T) {
	md := parseCatalogue(t)
	enums := openapiEnums(t)

	var mdTypes []string
	for _, ev := range md {
		mdTypes = append(mdTypes, ev.typ)
		s, ok := byType[ev.typ]
		if !ok {
			t.Errorf("%s is in contracts/websocket.md but not in the catalogue", ev.typ)
			continue
		}
		if s.kind != ev.kind {
			t.Errorf("%s: contract channel %s, catalogue %s", ev.typ, ev.kind, s.kind)
		}
		compareFields(t, ev.typ, ev.fields, objectProps(schemaFor(s.wire)), enums)
	}
	if got := CatalogueTypes(); !slices.Equal(sorted(got), sorted(mdTypes)) {
		t.Errorf("catalogue types differ from the contract\n contract: %v\n go:       %v", sorted(mdTypes), sorted(got))
	}
}

// audienceExceptions are the catalogue entries whose audience deliberately
// differs from the contract's table, with the reason.
var audienceExceptions = map[string]string{
	// The contract's audience is the restaurant OWNER; restaurant:{id} cannot
	// tell an owner from other staff yet, so no staff member gets it.
	"restaurant.payout_updated": "owner-only, not yet distinguishable",
}

func TestCatalogueAudiencesMatchContract(t *testing.T) {
	for _, ev := range parseCatalogue(t) {
		s := byType[ev.typ]
		if s == nil {
			continue // reported by TestCatalogueMatchesContract
		}
		want := map[Viewer]bool{}
		aud := strings.ToLower(ev.audience)
		if strings.Contains(aud, "all participants") {
			want[ViewCustomer], want[ViewRestaurant], want[ViewRider] = true, true, true
		}
		if strings.Contains(aud, "customer") {
			want[ViewCustomer] = true
		}
		if strings.Contains(aud, "restaurant") {
			want[ViewRestaurant] = true
		}
		if strings.Contains(aud, "rider") {
			if s.kind == KindRider {
				want[ViewRiderSelf] = true
			} else {
				want[ViewRider] = true
			}
		}
		if strings.Contains(aud, "support") || strings.Contains(aud, "admin") {
			want[ViewSupport] = true
		}
		if aud == "self" {
			want[ViewAccountOwner] = true
		}
		if _, ok := audienceExceptions[ev.typ]; ok {
			continue
		}
		for v := range want {
			if _, ok := allowList[v][ev.typ]; !ok {
				t.Errorf("%s: the contract's audience %q includes %s, whose allow-list has no serializer for it", ev.typ, ev.audience, v)
			}
		}
		for v, serializers := range allowList {
			if _, ok := serializers[ev.typ]; ok && !want[v] && v != ViewSupport {
				t.Errorf("%s: %s has a serializer but is not in the contract's audience %q", ev.typ, v, ev.audience)
			}
		}
		// Support sees the order, restaurant, rider and admin channels; the
		// account channel is its owner's alone.
		if _, ok := allowList[ViewSupport][ev.typ]; ok && s.kind == KindAccount {
			t.Errorf("%s: support has a serializer for an account-channel event", ev.typ)
		}
	}
	// A client secret is a token: only the paying customer receives it.
	for v, serializers := range allowList {
		if _, ok := serializers["payment.action_required"]; ok && v != ViewCustomer {
			t.Errorf("payment.action_required must reach only the customer; %s has a serializer: it carries a client secret", v)
		}
	}
}

func TestEnumListsMatchOpenAPI(t *testing.T) {
	enums := openapiEnums(t)
	for typ, values := range enumValues {
		if typ.PkgPath() != reflect.TypeFor[Timestamp]().PkgPath() {
			want, ok := enums[typ.Name()]
			if !ok {
				t.Errorf("%s: no enum of that name in openapi.yaml", typ.Name())
				continue
			}
			if !slices.Equal(sorted(values), sorted(want)) {
				t.Errorf("%s: openapi.yaml lists %v, schema.go lists %v", typ.Name(), sorted(want), sorted(values))
			}
		}
	}
}

// compile turns a bundle schema into a kin-openapi schema validator.
func compile(t *testing.T, s map[string]any) *openapi3.Schema {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	out := openapi3.NewSchema()
	if err := out.UnmarshalJSON(b); err != nil {
		t.Fatalf("compile schema: %v", err)
	}
	return out
}

// validatePayload checks one payload against the schema the bundle serves.
func validatePayload(t *testing.T, eventType string, payload json.RawMessage) error {
	t.Helper()
	schema := schemaBundle().Events[eventType+"@v1"]
	if schema == nil {
		t.Fatalf("schema bundle has no %s@v1", eventType)
	}
	var v any
	if err := json.Unmarshal(payload, &v); err != nil {
		t.Fatalf("%s payload is not JSON: %v", eventType, err)
	}
	return compile(t, schema).VisitJSON(v)
}

func TestContractFixturesValidateAgainstSchema(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(contractsDir, "fixtures", "realtime", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no realtime fixtures found: %v", err)
	}
	seen := 0
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var fx struct {
			Tags    []string `json:"tags"`
			Payload []struct {
				Seq  int64           `json:"seq"`
				Type string          `json:"type"`
				V    int             `json:"v"`
				Data json.RawMessage `json:"data"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(raw, &fx); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		// A fixture tagged forward-compat carries frames a client must ignore
		// (contracts/websocket.md section 2): a type the bundle does not
		// serve, or a version above 1. Those frames are skipped, and the
		// fixture must contain at least one, so the tag cannot hide drift in a
		// frame the bundle does serve.
		forwardCompat := slices.Contains(fx.Tags, "forward-compat")
		ignored := 0
		for _, ev := range fx.Payload {
			if ev.Seq == 0 {
				continue // control frames carry seq 0 and are not in the bundle
			}
			if forwardCompat && (ev.V > 1 || schemaBundle().Events[ev.Type+"@v1"] == nil) {
				ignored++
				continue
			}
			seen++
			if err := validatePayload(t, ev.Type, ev.Data); err != nil {
				t.Errorf("%s: %s fixture does not validate: %v", filepath.Base(f), ev.Type, err)
			}
		}
		if forwardCompat && ignored == 0 {
			t.Errorf("%s: tagged forward-compat but every frame is in the bundle", filepath.Base(f))
		}
	}
	if seen == 0 {
		t.Fatal("no catalogue events in the realtime fixtures")
	}
}

// handoverCodeFields are the two handover codes and the old delivery OTP. A
// rider types each one in, so none may ever be sent to a rider; and since a
// rider subscribes to order:{id}, none may be on that channel at all
// (https://github.com/shaiknoorullah/hg-mono/pull/290, contracts/websocket.md
// section 5; security review on
// https://github.com/shaiknoorullah/hg-mono/issues/183).
var handoverCodeFields = []string{"pickup_code", "delivery_code", "otp_code"}

func schemaHasField(s map[string]any, names []string) (string, bool) {
	props := objectProps(s)
	for k, v := range props {
		if slices.Contains(names, k) {
			return k, true
		}
		if sub, ok := v.(map[string]any); ok {
			if name, ok := schemaHasField(sub, names); ok {
				return k + "." + name, true
			}
		}
	}
	return "", false
}

func TestNoHandoverCodeReachesARider(t *testing.T) {
	riderRoles := []Viewer{ViewRider, ViewRiderSelf}
	for _, s := range catalogue {
		toRider := s.kind == KindOrder || s.kind == KindRider
		for _, v := range riderRoles {
			if _, ok := allowList[v][s.typ]; ok {
				toRider = true
			}
		}
		if !toRider {
			continue
		}
		if name, ok := schemaHasField(schemaFor(s.wire), handoverCodeFields); ok {
			t.Errorf("%s carries %s, and reaches a rider or order:{id}", s.typ, name)
		}
		// Nor may the source a rider's serializer reads hold one: a code that
		// is never stored on these channels cannot be sent on them.
		if name, ok := schemaHasField(schemaFor(s.source), handoverCodeFields); ok {
			t.Errorf("%s stores %s in a payload a rider's serializer reads", s.typ, name)
		}
	}
	// Every type a rider's serializer can return, too.
	for _, v := range riderRoles {
		for typ, p := range allowList[v] {
			for _, out := range p.outs {
				if name, ok := schemaHasField(schemaFor(out), handoverCodeFields); ok {
					t.Errorf("the %s serializer for %s returns %s, which carries %s", v, typ, out, name)
				}
			}
		}
	}
}
