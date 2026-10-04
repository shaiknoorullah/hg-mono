package files

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
)

// An upload link works only for the bytes the client declared, and it names the
// public host a phone can reach: a link for a 1 MiB JPEG cannot push a 9 MiB PDF
// (docs/spec/01-platform.md, "P-28 — Presigned upload and download"), and a
// link for minio:9000 cannot be used from a phone at all. Issue #203.
//
// The signer is the one production builds, so this pins both the signed header
// set and the host; the store enforces the rest when it checks the signature.
func TestUploadLinkSignsDeclaredHeadersForThePublicHost(t *testing.T) {
	signer, err := store.NewSigner(config.MinIO{
		Endpoint:       "minio:9000",
		AccessKey:      "hgminio",
		SecretKey:      "hgminiosecret",
		Region:         "ca-central-1",
		PresignBaseURL: "https://files.halalgoes.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	sha := sha256.Sum256([]byte("a delivery photo"))
	u, headers, err := presignUpload(context.Background(), signer,
		"hg-pod", "2026/10/o1/01J.jpg", "image/jpeg", 1<<20, sha[:])
	if err != nil {
		t.Fatal(err)
	}

	if u.Scheme != "https" || u.Host != "files.halalgoes.com" || !strings.HasPrefix(u.Path, "/hg-pod/") {
		t.Errorf("link is %s; want https://files.halalgoes.com/hg-pod/…, signed for the public host", u)
	}
	// Signing only the host (what PresignedPutObject does) lets one link upload
	// any bytes of any size and type.
	if got, want := u.Query().Get("X-Amz-SignedHeaders"), "content-length;content-type;host;x-amz-checksum-sha256"; got != want {
		t.Errorf("signed headers = %q, want %q", got, want)
	}
	want := map[string]string{
		"Content-Type":          "image/jpeg",
		"Content-Length":        "1048576",
		"x-amz-checksum-sha256": base64.StdEncoding.EncodeToString(sha[:]),
	}
	for k, v := range want {
		if headers[k] != v {
			t.Errorf("required header %s = %q, want %q (the client must send what was signed)", k, headers[k], v)
		}
	}
	if len(headers) != len(want) {
		t.Errorf("required headers = %v; a header the client is told to send but that is not signed proves nothing", headers)
	}

	// The signer never talks to the store, so a server-side call cannot leave
	// the internal network by way of the public host.
	if _, err := signer.ListBuckets(context.Background()); err == nil {
		t.Error("the signing client sent a request; it must only sign")
	}
}
