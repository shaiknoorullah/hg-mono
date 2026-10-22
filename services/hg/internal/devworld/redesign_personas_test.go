package devworld

import (
	"context"
	"os"
	"regexp"
	"strings"
	"testing"
)

// Every number a persona or a test signs in with is in the fictional 555-01xx
// block, and the local fixed-code range the API accepts a fixed code for
// (internal/auth/testcode.go).
var fixedCodePhone = regexp.MustCompile(`^\+155501001[0-9]{2}$`)

func TestEveryPersonaPhoneIsInTheFictionalFixedCodeRange(t *testing.T) {
	for _, id := range World {
		if id.Phone != "" && !fixedCodePhone.MatchString(id.Phone) {
			t.Errorf("%s: phone %s is outside +15550100100 to +15550100199", id.Slug, id.Phone)
		}
	}
	if !fixedCodePhone.MatchString(UnregisteredPhone) {
		t.Errorf("the first-run phone %s is outside +15550100100 to +15550100199", UnregisteredPhone)
	}
}

func TestPersonaPhonesAndIDsAreUnique(t *testing.T) {
	seen := map[string]string{}
	for _, id := range World {
		for _, v := range []string{id.AccountID, id.Phone, id.Email} {
			if v == "" {
				continue
			}
			if other, dup := seen[v]; dup {
				t.Errorf("%s and %s share %s", other, id.Slug, v)
			}
			seen[v] = id.Slug
		}
	}
}

// The first-run sign-in needs a number nothing seeded: no persona has it, no
// SQL file mentions it, and no onboarding scenario hands it out.
func TestUnregisteredPhoneIsNeverSeeded(t *testing.T) {
	for _, id := range World {
		if id.Phone == UnregisteredPhone {
			t.Fatalf("%s has the first-run phone", id.Slug)
		}
	}
	root, err := migrationsRoot()
	if err != nil {
		t.Fatal(err)
	}
	files, err := personaSQLFiles(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		// Comments may name the number; a statement may not.
		for _, line := range strings.Split(string(raw), "\n") {
			if i := strings.Index(line, "--"); i >= 0 {
				line = line[:i]
			}
			if strings.Contains(line, UnregisteredPhone) {
				t.Errorf("%s seeds the first-run phone", path)
			}
		}
	}
}

func TestRedesignPersonasAreSeeded(t *testing.T) {
	for _, slug := range []string{
		"customer-suspended", "customer-banned", "customer-flagged",
		"rider-payout", "rider-history", "rider-suspended", "rider-flagged",
	} {
		who, err := identity(slug)
		if err != nil {
			t.Errorf("%s is not in the world: %v", slug, err)
			continue
		}
		if who.Phone == "" || who.Email != "" {
			t.Errorf("%s signs in by phone only, got phone %q email %q", slug, who.Phone, who.Email)
		}
	}
	for _, c := range RedesignCustomers {
		if _, err := identity(c.Slug); err != nil {
			t.Errorf("%v", err)
		}
	}
}

// The persona SQL writes the suspended and banned accounts in their state and
// the flagged ones ACTIVE, for the scenarios to act on.
func TestRedesignPersonaSQLStates(t *testing.T) {
	root, err := migrationsRoot()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(root + "/devworld/040_redesign_personas.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, want := range []string{
		"'+15550100103', NULL, now(), 'SUSPENDED'",
		"'+15550100104', NULL, now(), 'BANNED'",
		"'+15550100105', NULL, now(), 'ACTIVE'",
		"'ACTIVE', 'SUSPENDED', 'OFFLINE'", // rider-suspended
		"'rider-suspended'",
		"'acct_test_devworld_riderpayout'",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("040_redesign_personas.sql lacks %q", want)
		}
	}
	for _, banned := range []string{"INSERT INTO \"order\"", "INSERT INTO payment", "INSERT INTO ledger", "INSERT INTO earning", "INSERT INTO payout"} {
		if strings.Contains(sql, banned) {
			t.Errorf("040_redesign_personas.sql writes %q; orders, money and ledger rows come from the API", banned)
		}
	}
}

func TestAccountActionsTargetTheirOwnPersonas(t *testing.T) {
	for name, a := range map[string]accountAction{
		"rider-suspend": riderSuspend, "rider-reinstate": riderReinstate,
		"customer-suspend": customerSuspend, "customer-reinstate": customerReinstate,
	} {
		if !knownScenario(name) {
			t.Errorf("%s is not in the catalogue", name)
		}
		if _, err := identity(a.slug); err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !strings.HasSuffix(a.slug, "-flagged") {
			t.Errorf("%s acts on %s; only the flagged personas may change state", name, a.slug)
		}
		if strings.Count(a.path, "%s") != 1 || !strings.HasSuffix(a.path, "/account-actions") {
			t.Errorf("%s: path %q", name, a.path)
		}
		if len(a.reasonText) < 10 || len(a.reasonText) > 1000 {
			t.Errorf("%s: reason text is %d characters, the contract wants 10 to 1000", name, len(a.reasonText))
		}
		if (a.action == "SUSPEND") != (a.want == "SUSPENDED") || (a.action == "REINSTATE") != (a.want == "ACTIVE") {
			t.Errorf("%s: %s should not lead to %s", name, a.action, a.want)
		}
	}
	if !strings.HasPrefix(riderSuspend.path, "/v1/admin/riders/") || !strings.HasPrefix(customerSuspend.path, "/v1/admin/customers/") {
		t.Error("the rider and customer actions use each other's route")
	}
}

func TestAccountScenariosRefuseAnUnreachableAPI(t *testing.T) {
	refuseRequests(t)
	for _, name := range []string{"rider-suspend", "rider-reinstate", "customer-suspend", "customer-reinstate"} {
		err := RunScenario(context.Background(), "http://127.0.0.1:1", name)
		if err == nil || strings.Contains(err.Error(), "unknown scenario") {
			t.Errorf("%s: got %v, want a failed sign-in", name, err)
		}
	}
}

func TestJourneyRiderDefaultsToRiderSim(t *testing.T) {
	if got := (JourneyOptions{}).riderSlug(); got != "rider-sim" {
		t.Fatalf("default rider is %q", got)
	}
	if got := (JourneyOptions{Rider: "rider-payout"}).riderSlug(); got != "rider-payout" {
		t.Fatalf("rider is %q", got)
	}
	for _, slug := range riderSlugs {
		if _, err := identity(slug); err != nil {
			t.Errorf("%v", err)
		}
	}
}

// amina's three saved addresses (migrations/devworld/001_personas.sql and
// 020_customer_addresses.sql), for the range checks below.
var aminaAddressPoints = map[string][2]float64{
	"Home":    {43.6825, -79.3300},
	"Work":    {43.6457, -79.3866},
	"Cottage": {45.3269, -79.2163},
}

func TestStateRestaurantsAreInTheStatesTheAppsNeed(t *testing.T) {
	if len(StateRestaurants) != 4 {
		t.Fatalf("%d state restaurants, want 4", len(StateRestaurants))
	}
	seen := map[string]bool{}
	for _, c := range Catalogue {
		seen[c.Slug], seen[c.ID], seen[c.OwnerID] = true, true, true
	}
	for _, id := range World {
		seen[id.Slug], seen[id.AccountID], seen[id.RestaurantID] = true, true, true
	}
	by := map[string]CatalogueRestaurant{}
	for _, r := range StateRestaurants {
		by[r.Slug] = r
		for _, v := range []string{r.Slug, r.ID, r.OwnerID} {
			if seen[v] {
				t.Errorf("%s: %s is already used", r.Slug, v)
			}
			seen[v] = true
		}
		if !strings.HasSuffix(r.Email(), "@seed.hg") {
			t.Errorf("%s: owner %s is not a dev world account, so no tablet beats for it", r.Slug, r.Email())
		}
		if r.Persona || r.CertDays < 60 {
			t.Errorf("%s: must be created here with a certificate that is nowhere near expiring", r.Slug)
		}
	}

	if r := by["last-light-bakehouse"]; r.Hours != hoursNone {
		t.Errorf("last-light-bakehouse hours %q, want none", r.Hours)
	}
	if r := by["blank-slate-grill"]; len(r.Categories) != 0 || r.Hours != hoursAllDay {
		t.Errorf("blank-slate-grill must be open with no menu: %d categories, hours %q", len(r.Categories), r.Hours)
	}
	if r := by["lost-paper-diner"]; !r.CertFileMissing || certKeyPrefix(r) == certKeyPrefix(CatalogueRestaurant{}) {
		t.Error("lost-paper-diner must keep its certificate object outside the uploaded prefix")
	}
	for _, r := range StateRestaurants {
		if r.Slug != "lost-paper-diner" && r.CertFileMissing {
			t.Errorf("%s has no certificate file", r.Slug)
		}
	}

	rouge := by["rouge-valley-roti"]
	for name, p := range aminaAddressPoints {
		if d := metresBetween(rouge.Lat, rouge.Lng, p[0], p[1]); d <= deliveryRadiusM {
			t.Errorf("rouge-valley-roti is %.0f m from amina's %s, inside the %d m delivery radius", d, name, deliveryRadiusM)
		}
	}
	for _, pt := range customerPoints {
		if d := metresBetween(rouge.Lat, rouge.Lng, pt[0], pt[1]); d <= deliveryRadiusM {
			t.Errorf("rouge-valley-roti is %.0f m from %v, inside the %d m delivery radius", d, pt, deliveryRadiusM)
		}
	}
	for _, r := range StateRestaurants {
		if r.Slug == rouge.Slug {
			continue
		}
		near := false
		for _, pt := range customerPoints {
			if metresBetween(r.Lat, r.Lng, pt[0], pt[1]) <= deliveryRadiusM {
				near = true
			}
		}
		if !near {
			t.Errorf("%s is out of range of the default address and downtown; only rouge-valley-roti may be", r.Slug)
		}
	}
}

func TestAllRestaurantsIsTheCatalogueThenTheStates(t *testing.T) {
	all := AllRestaurants()
	if len(all) != len(Catalogue)+len(StateRestaurants) {
		t.Fatalf("%d restaurants, want %d", len(all), len(Catalogue)+len(StateRestaurants))
	}
	if all[0].Slug != Catalogue[0].Slug || all[len(all)-1].Slug != StateRestaurants[len(StateRestaurants)-1].Slug {
		t.Fatal("AllRestaurants is not the catalogue followed by the state restaurants")
	}
	// The catalogue's own list is not touched: its promises are about the
	// marketplace.
	if len(Catalogue) < 12 || len(Catalogue) > 16 {
		t.Fatalf("catalogue has %d restaurants", len(Catalogue))
	}
}
