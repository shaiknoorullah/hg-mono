// Package money holds the integer-cents money primitives that every price in
// the orders module is built from. There is no float anywhere in this package
// and none is ever introduced (G-2): an Amount is int64 minor units, and a Rate
// is an exact rational, never a float64.
//
// Two operations need rules (P-12):
//
//   - MulRate: apply a rational rate to an amount, rounding half away from zero
//     so that (-a).MulRate(r) == -(a.MulRate(r)) (I-12.4). Symmetry matters
//     because a full refund must reverse the original charge exactly.
//   - Allocate: split a rounded total across weighted parts by largest
//     remainder, so the parts sum to the target exactly (I-12.1), deterministic
//     for the same inputs and order (I-12.2).
package money

import (
	"fmt"
	"math/big"
	"sort"
	"strings"
)

// Amount is a signed count of minor currency units (cents). Positive for a
// charge, negative for a reversal.
type Amount int64

// Cents returns the raw int64 count.
func (a Amount) Cents() int64 { return int64(a) }

// Add returns a+b, keeping arithmetic on the Amount type so a stray float can
// never enter a monetary path.
func (a Amount) Add(b Amount) Amount { return a + b }

// Sub subtracts b from a.
func (a Amount) Sub(b Amount) Amount { return a - b }

// Mul multiplies an amount by an integer quantity (e.g. line total = unit ×
// quantity). Quantity is an int, never a rate.
func (a Amount) Mul(qty int) Amount { return a * Amount(qty) }

// Neg returns the additive inverse.
func (a Amount) Neg() Amount { return -a }

// Rate is an exact non-negative rational, Num/Den, with Den > 0. Tax rates and
// fee rates are read from the database as numeric(12,8) and parsed into a Rate,
// never a float64 (I-11.3).
type Rate struct {
	Num int64
	Den int64
}

// RateFromDecimalString parses a decimal string such as "0.13000000" into an
// exact Rate. The denominator is a power of ten sized to the number of
// fractional digits, so "0.13" becomes 13/100 and "0.09975" becomes 9975/100000.
//
// It rejects anything that is not a plain non-negative decimal: no exponent, no
// sign, no thousands separators. A rate is data from the tax table, and the tax
// table is trusted to store plain decimals.
func RateFromDecimalString(s string) (Rate, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Rate{}, fmt.Errorf("money: empty rate string")
	}
	if strings.ContainsAny(s, "eE+-") {
		return Rate{}, fmt.Errorf("money: rate %q must be a plain non-negative decimal", s)
	}
	intPart, fracPart, hasFrac := strings.Cut(s, ".")
	if intPart == "" {
		intPart = "0"
	}
	digits := intPart + fracPart
	if digits == "" {
		return Rate{}, fmt.Errorf("money: rate %q has no digits", s)
	}
	num, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return Rate{}, fmt.Errorf("money: rate %q is not a decimal", s)
	}
	den := big.NewInt(1)
	if hasFrac {
		den.Exp(big.NewInt(10), big.NewInt(int64(len(fracPart))), nil)
	}
	// Reduce so equal rates compare equal and the numbers stay small.
	g := new(big.Int).GCD(nil, nil, new(big.Int).Abs(num), den)
	if g.Sign() != 0 {
		num.Div(num, g)
		den.Div(den, g)
	}
	if !num.IsInt64() || !den.IsInt64() {
		return Rate{}, fmt.Errorf("money: rate %q does not fit in int64/int64 after reduction", s)
	}
	return Rate{Num: num.Int64(), Den: den.Int64()}, nil
}

// IsZero reports whether the rate is exactly zero.
func (r Rate) IsZero() bool { return r.Num == 0 }

// String renders the rate back to a decimal string for the wire. The contract
// requires the rate as a string precisely so no client parses it into a float
// and multiplies money by it.
func (r Rate) String() string {
	if r.Den <= 0 {
		return "0"
	}
	rat := new(big.Rat).SetFrac(big.NewInt(r.Num), big.NewInt(r.Den))
	s := rat.FloatString(8)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(s, "0")
		s = strings.TrimRight(s, ".")
	}
	if s == "" {
		s = "0"
	}
	return s
}

// MulRate applies the rate to the amount and rounds half away from zero, using
// only integer arithmetic (P-12). Overflow is avoided by computing in big.Int:
// amount × Num can exceed int64 for large carts, and silently wrapping would be
// a money bug of exactly the kind this package exists to prevent.
func (a Amount) MulRate(r Rate) Amount {
	if r.Den <= 0 {
		panic(fmt.Sprintf("money: invalid rate denominator %d", r.Den))
	}
	if a == 0 || r.Num == 0 {
		return 0
	}
	num := new(big.Int).Mul(big.NewInt(int64(a)), big.NewInt(r.Num))
	den := big.NewInt(r.Den)

	// Round half away from zero: add sign*den/2 before the truncating divide.
	half := new(big.Int).Rsh(den, 1) // den/2, den>0
	if num.Sign() < 0 {
		num.Sub(num, half)
	} else {
		num.Add(num, half)
	}
	q := new(big.Int).Quo(num, den) // truncated toward zero
	if !q.IsInt64() {
		panic(fmt.Sprintf("money: rate application overflowed int64: %s×%d/%d", q.String(), r.Num, r.Den))
	}
	return Amount(q.Int64())
}

// Clamp returns a bounded to [lo, hi]. lo must be <= hi.
func Clamp(a, lo, hi Amount) Amount {
	if a < lo {
		return lo
	}
	if a > hi {
		return hi
	}
	return a
}

// Allocate splits total across len(weights) parts proportionally to the
// weights, using largest-remainder rounding so the parts sum to total exactly
// (I-12.1). Ties in the remainder are broken by ascending index (I-12.2),
// matching the spec's "ascending line_no" rule when the caller passes lines in
// line order.
//
// total may be negative (a refund apportionment); the sign is carried through
// so the parts sum to a negative total exactly. When every weight is zero the
// total is spread as evenly as possible from the front, which keeps the sum
// exact rather than dropping cents.
func Allocate(total Amount, weights []Amount) []Amount {
	n := len(weights)
	out := make([]Amount, n)
	if n == 0 {
		return out
	}

	var sumW int64
	for _, w := range weights {
		if w < 0 {
			// A weight is a share basis and is never negative; treat as zero
			// rather than letting a negative weight distort the allocation.
			w = 0
		}
		sumW += int64(w)
	}

	if sumW == 0 {
		// No basis to weight by: spread evenly, remainder to the front parts.
		base := int64(total) / int64(n)
		rem := int64(total) - base*int64(n) // signed remainder
		step := int64(1)
		if rem < 0 {
			step = -1
			rem = -rem
		}
		for i := 0; i < n; i++ {
			out[i] = Amount(base)
		}
		for i := int64(0); i < rem; i++ {
			out[i] += Amount(step)
		}
		return out
	}

	// Exact share = total × w / sumW, floored toward negative infinity so the
	// remainders are all in [0, sumW); distribute the leftover cents to the
	// largest remainders. Work in big.Int to stay exact and overflow-free.
	bigTotal := big.NewInt(int64(total))
	bigSum := big.NewInt(sumW)

	type part struct {
		idx       int
		remainder *big.Int // numerator of the fractional remainder over sumW
	}
	parts := make([]part, 0, n)
	var allocated int64
	for i, w := range weights {
		if w < 0 {
			w = 0
		}
		prod := new(big.Int).Mul(bigTotal, big.NewInt(int64(w)))
		q := new(big.Int)
		rem := new(big.Int)
		q.DivMod(prod, bigSum, rem) // Euclidean: 0 <= rem < sumW even for negative prod
		out[i] = Amount(q.Int64())
		allocated += q.Int64()
		parts = append(parts, part{idx: i, remainder: rem})
	}

	leftover := int64(total) - allocated // >= 0 with Euclidean flooring
	sort.SliceStable(parts, func(a, b int) bool {
		c := parts[a].remainder.Cmp(parts[b].remainder)
		if c != 0 {
			return c > 0
		}
		return parts[a].idx < parts[b].idx
	})
	for i := int64(0); i < leftover && i < int64(len(parts)); i++ {
		out[parts[i].idx]++
	}
	return out
}
