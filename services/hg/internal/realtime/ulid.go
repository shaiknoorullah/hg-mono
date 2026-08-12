package realtime

import (
	"crypto/rand"
	"encoding/binary"
	mrand "math/rand/v2"
	"time"
)

// crockford is the Crockford base32 alphabet used by ULID (no I, L, O, U). This
// mirrors internal/httpx's generator: every realtime event id is a ULID (G-8),
// and clients deduplicate on it (§2, §6).
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newEventULID returns a 26-character ULID for a realtime event id. It is
// time-sortable, which keeps the event log's ids ordered the same way as its
// seq. Dependency-free by design, matching httpx.NewULID.
func newEventULID() string {
	ms := uint64(time.Now().UTC().UnixMilli())

	var entropy [10]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		binary.BigEndian.PutUint64(entropy[0:8], mrand.Uint64())
		binary.BigEndian.PutUint16(entropy[8:10], uint16(mrand.Uint32()))
	}

	var id [26]byte
	for i := 9; i >= 0; i-- {
		id[i] = crockford[ms&0x1f]
		ms >>= 5
	}
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
