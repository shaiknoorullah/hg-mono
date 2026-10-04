package riderview

import "testing"

func TestApproximateAreaRoundsToAboutAKilometre(t *testing.T) {
	lat, lng := ApproximateArea(43.6532157, -79.3831846)
	if lat != 43.65 || lng != -79.38 {
		t.Fatalf("ApproximateArea = %v,%v, want 43.65,-79.38", lat, lng)
	}
	// A point already on the grid stays where it is.
	if lat, lng := ApproximateArea(43.65, -79.38); lat != 43.65 || lng != -79.38 {
		t.Fatalf("ApproximateArea of a grid point = %v,%v", lat, lng)
	}
}

func TestStreetLevelDropsTheCivicNumber(t *testing.T) {
	for in, want := range map[string]string{
		"88 Harbour St":   "Harbour St",
		"12A King St W":   "King St W",
		"1203-45 Bay St":  "Bay St",
		"45 1/2 Main St":  "Main St",
		"123 4th Ave":     "4th Ave",
		"  7 Queen St E ": "Queen St E",
		"88":              "",
		"Harbour St":      "Harbour St",
		"RR 2 Highway 7":  "RR 2 Highway 7",
		"":                "",
	} {
		if got := StreetLevel(in); got != want {
			t.Errorf("StreetLevel(%q) = %q, want %q", in, got, want)
		}
	}
}
