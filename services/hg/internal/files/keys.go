package files

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"
)

// Object keys are server-generated and unguessable; clients never choose a key,
// a bucket or a filename (P-27):
//
//	hg-kyc/{subject_type}/{subject_id}/{doc_type}/{ulid}{ext}
//	hg-pod/{yyyy}/{mm}/{order_id}/{ulid}.jpg
//	hg-media/menu-item/{menu_item_id}/{ulid}_{variant}.webp
//	hg-tmp/avatar/{account_id}/{ulid}{ext}
//	hg-exports/{yyyy}/{mm}/{ulid}.{ext}
//
// The purpose selects the bucket, the accepted content types and the size cap
// (P-28); a client cannot upload to a bucket its role has no business in.

// Purpose is the StoredObjectPurpose enum. EXPORT is server-generated only — no
// client upload path allocates it.
type Purpose string

const (
	PurposeKYC    Purpose = "KYC_DOCUMENT"
	PurposeMenu   Purpose = "MENU_IMAGE"
	PurposePOD    Purpose = "POD"
	PurposeAvatar Purpose = "AVATAR"
	PurposeExport Purpose = "EXPORT"
)

// Valid reports whether a purpose is one a client may request an upload for.
func (p Purpose) Valid() bool {
	switch p {
	case PurposeKYC, PurposeMenu, PurposePOD, PurposeAvatar:
		return true
	}
	return false
}

// contentRule is the accepted content types and the max byte size for a purpose.
type contentRule struct {
	types   map[string]string // content-type -> file extension
	maxSize int64
}

// rules is the per-purpose content policy (P-28). A content type outside the set,
// or a size over the cap, is refused before any object is allocated.
var rules = map[Purpose]contentRule{
	PurposeKYC: {
		types:   map[string]string{"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"},
		maxSize: 15 << 20,
	},
	PurposeMenu: {
		types:   map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"},
		maxSize: 8 << 20,
	},
	// Delivery photos are shrunk on the phone before upload. A full-resolution
	// camera photo is several MiB, slow on a rider's mobile data, and a photo
	// that proves a bag was left at a door needs no more than about 1 MiB.
	PurposePOD: {
		types:   map[string]string{"image/jpeg": ".jpg", "image/webp": ".webp"},
		maxSize: 1 << 20,
	},
	PurposeAvatar: {
		types:   map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"},
		maxSize: 4 << 20,
	},
}

// extFor returns the file extension for a content type under a purpose, and
// whether the content type is accepted for that purpose.
func extFor(p Purpose, contentType string) (string, bool) {
	r, ok := rules[p]
	if !ok {
		return "", false
	}
	ext, ok := r.types[contentType]
	return ext, ok
}

// maxSizeFor returns the byte-size cap for a purpose.
func maxSizeFor(p Purpose) int64 {
	if r, ok := rules[p]; ok {
		return r.maxSize
	}
	return 0
}

// bucketFor returns the bucket a purpose lives in.
func bucketFor(p Purpose, b Buckets) (string, bool) {
	switch p {
	case PurposeKYC:
		return b.KYC, true
	case PurposePOD:
		return b.POD, true
	case PurposeMenu:
		return b.Media, true
	case PurposeAvatar:
		// Avatars land in hg-tmp until confirmed, then are promoted; the tmp
		// bucket carries a 24h lifecycle rule so an unconfirmed avatar is reaped.
		return b.Tmp, true
	case PurposeExport:
		return b.Exports, true
	}
	return "", false
}

// Buckets mirrors config.Buckets so this package does not import config for a
// value type; the caller passes the resolved names.
type Buckets struct {
	KYC     string
	POD     string
	Media   string
	Exports string
	Tmp     string
}

// keyInputs carries the identifiers a key is built from. Only the ones a purpose
// needs are consulted.
type keyInputs struct {
	subjectType string
	subjectID   string
	docType     string
	orderID     string
	menuItemID  string
	accountID   string
}

// buildKey generates the server-owned object key for a purpose. It never
// incorporates a client-supplied filename.
func buildKey(p Purpose, in keyInputs, contentType string) (string, error) {
	ext, ok := extFor(p, contentType)
	if !ok {
		return "", fmt.Errorf("content type %q not accepted for %s", contentType, p)
	}
	u := newULID()
	switch p {
	case PurposeKYC:
		st := strings.ToLower(in.subjectType)
		dt := strings.ToLower(in.docType)
		return fmt.Sprintf("%s/%s/%s/%s%s", st, in.subjectID, dt, u, ext), nil
	case PurposePOD:
		now := time.Now().UTC()
		return fmt.Sprintf("%04d/%02d/%s/%s.jpg", now.Year(), int(now.Month()), in.orderID, u), nil
	case PurposeMenu:
		return fmt.Sprintf("menu-item/%s/%s_orig%s", in.menuItemID, u, ext), nil
	case PurposeAvatar:
		return fmt.Sprintf("avatar/%s/%s%s", in.accountID, u, ext), nil
	}
	return "", fmt.Errorf("no key layout for purpose %s", p)
}

// --- ULID ---

// crockford is the Crockford base32 alphabet ULID uses.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newULID mints a lexicographically-sortable 26-char ULID (48-bit ms timestamp +
// 80 bits of randomness), so keys sort by creation time and never collide.
func newULID() string {
	var b [16]byte
	ms := uint64(time.Now().UTC().UnixMilli())
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	_, _ = rand.Read(b[6:])

	var out [26]byte
	// Encode 128 bits as 26 base32 chars (the last char carries 2 bits).
	out[0] = crockford[(b[0]&224)>>5]
	out[1] = crockford[b[0]&31]
	out[2] = crockford[(b[1]&248)>>3]
	out[3] = crockford[((b[1]&7)<<2)|((b[2]&192)>>6)]
	out[4] = crockford[(b[2]&62)>>1]
	out[5] = crockford[((b[2]&1)<<4)|((b[3]&240)>>4)]
	out[6] = crockford[((b[3]&15)<<1)|((b[4]&128)>>7)]
	out[7] = crockford[(b[4]&124)>>2]
	out[8] = crockford[((b[4]&3)<<3)|((b[5]&224)>>5)]
	out[9] = crockford[b[5]&31]
	out[10] = crockford[(b[6]&248)>>3]
	out[11] = crockford[((b[6]&7)<<2)|((b[7]&192)>>6)]
	out[12] = crockford[(b[7]&62)>>1]
	out[13] = crockford[((b[7]&1)<<4)|((b[8]&240)>>4)]
	out[14] = crockford[((b[8]&15)<<1)|((b[9]&128)>>7)]
	out[15] = crockford[(b[9]&124)>>2]
	out[16] = crockford[((b[9]&3)<<3)|((b[10]&224)>>5)]
	out[17] = crockford[b[10]&31]
	out[18] = crockford[(b[11]&248)>>3]
	out[19] = crockford[((b[11]&7)<<2)|((b[12]&192)>>6)]
	out[20] = crockford[(b[12]&62)>>1]
	out[21] = crockford[((b[12]&1)<<4)|((b[13]&240)>>4)]
	out[22] = crockford[((b[13]&15)<<1)|((b[14]&128)>>7)]
	out[23] = crockford[(b[14]&124)>>2]
	out[24] = crockford[((b[14]&3)<<3)|((b[15]&224)>>5)]
	out[25] = crockford[b[15]&31]
	return string(out[:])
}
