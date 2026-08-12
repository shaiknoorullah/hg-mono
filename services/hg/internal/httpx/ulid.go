package httpx

import (
	crand "crypto/rand"
	"encoding/binary"
	"math/rand/v2"
	"time"
)

// crockford is the Crockford base32 alphabet used by ULID: no I, L, O or U.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// NewULID returns a 26-character ULID: 48 bits of millisecond timestamp then 80
// bits of randomness, Crockford base32, lexicographically sortable by time.
//
// G-8 makes ULIDs the type of every externally visible correlation identifier —
// request_id, event id, idempotency record — while row primary keys are UUIDv7.
// This is deliberately dependency-free: a request id generator is not worth a
// module in go.mod.
func NewULID() string {
	return newULIDAt(time.Now())
}

func newULIDAt(t time.Time) string {
	ms := uint64(t.UTC().UnixMilli())

	var entropy [10]byte
	if _, err := crand.Read(entropy[:]); err != nil {
		// A request id must never be the reason a request fails. Fall back to
		// the runtime's per-thread PRNG, which is seeded independently.
		binary.BigEndian.PutUint64(entropy[0:8], rand.Uint64())
		binary.BigEndian.PutUint16(entropy[8:10], uint16(rand.Uint32()))
	}

	var id [26]byte
	// 48-bit timestamp → 10 characters.
	for i := 9; i >= 0; i-- {
		id[i] = crockford[ms&0x1f]
		ms >>= 5
	}
	// 80-bit entropy → 16 characters, 5 bits at a time, most significant first.
	var acc uint64
	var bits uint
	pos := 10
	for _, b := range entropy {
		acc = acc<<8 | uint64(b)
		bits += 8
		for bits >= 5 {
			bits -= 5
			id[pos] = crockford[(acc>>bits)&0x1f]
			pos++
		}
	}
	return string(id[:])
}

// validULID reports whether s could have come from NewULID. Used to decide
// whether an inbound X-Request-ID may be adopted rather than replaced.
func validULID(s string) bool {
	if len(s) != 26 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'A' && c <= 'Z':
			if c == 'I' || c == 'L' || c == 'O' || c == 'U' {
				return false
			}
		default:
			return false
		}
	}
	return true
}
