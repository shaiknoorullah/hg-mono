package files

import (
	"strings"
	"testing"
)

func testBuckets() Buckets {
	return Buckets{KYC: "hg-kyc", POD: "hg-pod", Media: "hg-media", Exports: "hg-exports", Tmp: "hg-tmp"}
}

// Keys are server-generated, unguessable, and never contain a client filename.
func TestBuildKeyKYC(t *testing.T) {
	k, err := buildKey(PurposeKYC, keyInputs{subjectType: "RESTAURANT", subjectID: "r1", docType: "HALAL_CERTIFICATE"}, "application/pdf")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(k, "restaurant/r1/halal_certificate/") || !strings.HasSuffix(k, ".pdf") {
		t.Errorf("unexpected KYC key: %s", k)
	}
}

func TestBuildKeyPOD(t *testing.T) {
	k, err := buildKey(PurposePOD, keyInputs{orderID: "o1"}, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(k, "/o1/") || !strings.HasSuffix(k, ".jpg") {
		t.Errorf("unexpected POD key: %s", k)
	}
}

// A content type outside a purpose's allow-list is refused before any object is
// allocated.
func TestBuildKeyRejectsBadContentType(t *testing.T) {
	if _, err := buildKey(PurposeKYC, keyInputs{subjectType: "RIDER", subjectID: "x", docType: "GENERIC"}, "application/x-msdownload"); err == nil {
		t.Error("an executable content type should be refused for KYC")
	}
	if _, err := buildKey(PurposeMenu, keyInputs{menuItemID: "m1"}, "application/pdf"); err == nil {
		t.Error("a PDF should be refused for a menu image")
	}
}

// bucketFor routes each purpose to the correct private/public bucket.
func TestBucketFor(t *testing.T) {
	b := testBuckets()
	cases := map[Purpose]string{
		PurposeKYC: "hg-kyc", PurposePOD: "hg-pod", PurposeMenu: "hg-media",
		PurposeAvatar: "hg-tmp", PurposeExport: "hg-exports",
	}
	for p, want := range cases {
		got, ok := bucketFor(p, b)
		if !ok || got != want {
			t.Errorf("bucketFor(%s) = %q,%v want %q", p, got, ok, want)
		}
	}
}

// ULIDs are 26 chars, Crockford base32, monotonic-ish (time-prefixed) and unique.
func TestULID(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		u := newULID()
		if len(u) != 26 {
			t.Fatalf("ULID length %d, want 26: %q", len(u), u)
		}
		for _, c := range u {
			if !strings.ContainsRune(crockford, c) {
				t.Fatalf("ULID has non-Crockford char %q in %q", c, u)
			}
		}
		if seen[u] {
			t.Fatalf("ULID collision: %q", u)
		}
		seen[u] = true
	}
}

// Only a client-uploadable purpose is Valid; EXPORT is server-generated only.
func TestPurposeValid(t *testing.T) {
	if PurposeExport.Valid() {
		t.Error("EXPORT must not be client-uploadable")
	}
	for _, p := range []Purpose{PurposeKYC, PurposeMenu, PurposePOD, PurposeAvatar} {
		if !p.Valid() {
			t.Errorf("%s should be uploadable", p)
		}
	}
}

func TestHexDecode(t *testing.T) {
	good := strings.Repeat("a1", 32) // 64 chars
	if _, err := hexDecode(good); err != nil {
		t.Errorf("valid sha256 rejected: %v", err)
	}
	if _, err := hexDecode("tooshort"); err == nil {
		t.Error("short hex should be rejected")
	}
	if _, err := hexDecode(strings.Repeat("A1", 32)); err == nil {
		t.Error("uppercase hex should be rejected (contract requires lowercase)")
	}
}
