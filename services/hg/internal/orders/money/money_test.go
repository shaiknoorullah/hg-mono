package money

import (
	"math/rand"
	"testing"
)

func TestRateFromDecimalString(t *testing.T) {
	cases := []struct {
		in       string
		num, den int64
		wantErr  bool
	}{
		{"0.13000000", 13, 100, false},
		{"0.13", 13, 100, false},
		{"0.09975", 399, 4000, false}, // 9975/100000 reduced
		{"0.05", 1, 20, false},
		{"0.00000000", 0, 1, false},
		{"0", 0, 1, false},
		{"1", 1, 1, false},
		{".5", 1, 2, false},
		{"", 0, 0, true},
		{"1e-2", 0, 0, true},
		{"-0.13", 0, 0, true},
		{"abc", 0, 0, true},
	}
	for _, c := range cases {
		r, err := RateFromDecimalString(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("RateFromDecimalString(%q): want error, got %v", c.in, r)
			}
			continue
		}
		if err != nil {
			t.Errorf("RateFromDecimalString(%q): unexpected error %v", c.in, err)
			continue
		}
		if r.Num != c.num || r.Den != c.den {
			t.Errorf("RateFromDecimalString(%q) = %d/%d, want %d/%d", c.in, r.Num, r.Den, c.num, c.den)
		}
	}
}

func TestRateString(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"0.13000000", "0.13"},
		{"0.05", "0.05"},
		{"0.09975", "0.09975"},
		{"0", "0"},
	} {
		r, err := RateFromDecimalString(c.in)
		if err != nil {
			t.Fatal(err)
		}
		if got := r.String(); got != c.want {
			t.Errorf("Rate(%q).String() = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMulRateHalfUp(t *testing.T) {
	r13, _ := RateFromDecimalString("0.13")
	// $88.35 × 13% = $11.4855 → rounds to 1149 (half-up on the .5).
	if got := Amount(8835).MulRate(r13); got != 1149 {
		t.Errorf("8835 × 0.13 = %d, want 1149", got)
	}
	// Acceptance P-12.1: $10.005 of computed tax → half-up. 100050 × (1/1000)
	// = 100.05 exact; use the documented raw 1000.5 case: 20010 × 0.05 = 1000.5.
	r05, _ := RateFromDecimalString("0.05")
	if got := Amount(20010).MulRate(r05); got != 1001 {
		t.Errorf("20010 × 0.05 = %d, want 1001 (half up)", got)
	}
}

func TestMulRateSymmetry(t *testing.T) {
	// I-12.4: (-a).MulRate(r) == -(a.MulRate(r)) for all a, r.
	rates := []string{"0.13", "0.05", "0.09975", "0.14", "0.15", "0.07", "0.06"}
	rng := rand.New(rand.NewSource(42))
	for _, rs := range rates {
		r, err := RateFromDecimalString(rs)
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5000; i++ {
			a := Amount(rng.Int63n(10_000_000))
			pos := a.MulRate(r)
			neg := a.Neg().MulRate(r)
			if neg != pos.Neg() {
				t.Fatalf("symmetry broke: rate %s a=%d pos=%d neg=%d", rs, a, pos, neg)
			}
		}
	}
}

func TestAllocateSumsExactly(t *testing.T) {
	// I-12.1: Σ Allocate(t, w) == t for all inputs. Property test.
	rng := rand.New(rand.NewSource(7))
	for i := 0; i < 200_000; i++ {
		n := 1 + rng.Intn(6)
		weights := make([]Amount, n)
		for j := range weights {
			weights[j] = Amount(rng.Intn(5000))
		}
		total := Amount(rng.Intn(20000) - 5000) // allow negative totals
		parts := Allocate(total, weights)
		var sum Amount
		for _, p := range parts {
			sum += p
		}
		if sum != total {
			t.Fatalf("Allocate(%d, %v) = %v sums to %d", total, weights, parts, sum)
		}
	}
}

func TestAllocateLargestRemainder(t *testing.T) {
	// P-12 acceptance 2: $10.00 across three lines of $3.33, $3.33, $3.34.
	parts := Allocate(1000, []Amount{333, 333, 334})
	want := []Amount{333, 333, 334}
	for i := range want {
		if parts[i] != want[i] {
			t.Fatalf("Allocate(1000, ...) = %v, want %v", parts, want)
		}
	}
}

func TestAllocateDeterministic(t *testing.T) {
	weights := []Amount{100, 100, 100}
	a := Allocate(10, weights)
	b := Allocate(10, weights)
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("Allocate not deterministic: %v vs %v", a, b)
		}
	}
	// Remainder cents go to the earliest indices on a tie.
	if a[0] != 4 || a[1] != 3 || a[2] != 3 {
		t.Fatalf("tie-break wrong: %v, want [4 3 3]", a)
	}
}

func TestClamp(t *testing.T) {
	if Clamp(5, 1, 10) != 5 || Clamp(0, 1, 10) != 1 || Clamp(99, 1, 10) != 10 {
		t.Fatal("Clamp bounds wrong")
	}
}
