package devworld

import (
	"bytes"
	"context"
	"crypto/sha256"
	"image/jpeg"
	"strings"
	"testing"
)

func TestProofJPEG(t *testing.T) {
	a, sumA, err := proofJPEG()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) < 1024 {
		t.Fatalf("len %d", len(a))
	}
	if a[0] != 0xFF || a[1] != 0xD8 || a[2] != 0xFF {
		t.Fatalf("magic %x", a[:3])
	}
	if sha256.Sum256(a) != sumA {
		t.Fatal("checksum does not match the bytes")
	}
	if _, err := jpeg.Decode(bytes.NewReader(a)); err != nil {
		t.Fatal(err)
	}
	b, sumB, err := proofJPEG()
	if err != nil {
		t.Fatal(err)
	}
	if sumA != sumB || !bytes.Equal(a, b) {
		t.Fatal("jpeg is not stable")
	}
}

func TestRedactSecrets(t *testing.T) {
	in := "key sk_test_abc rk_live_def whsec_ghi pi_abc_secret_def and pi_xyz"
	got := redactSecrets(in)
	for _, secret := range []string{"sk_test_abc", "rk_live_def", "whsec_ghi", "pi_abc_secret_def", "pi_abc", "pi_xyz", "_secret_"} {
		if strings.Contains(got, secret) {
			t.Fatalf("left %q in %q", secret, got)
		}
	}
}

func TestPaymentIntentID(t *testing.T) {
	id, err := paymentIntentID("pi_abc_secret_def")
	if err != nil || id != "pi_abc" {
		t.Fatalf("id %q err %v", id, err)
	}
	for _, bad := range []string{"not-a-secret", "pi_only", "seti_abc_secret_def"} {
		if _, err := paymentIntentID(bad); err == nil || strings.Contains(err.Error(), bad) {
			t.Fatalf("accepted %q (%v)", bad, err)
		}
	}
}

func TestConfirmTestCardRefusesLiveKey(t *testing.T) {
	t.Setenv("HG_STRIPE_SECRET_KEY", "sk_live_notreal")
	t.Setenv("STRIPE_SECRET_KEY", "")
	err := confirmTestCard(context.Background(), "pi_abc_secret_def")
	if err == nil || strings.Contains(err.Error(), "sk_live") || strings.Contains(err.Error(), "pi_abc") {
		t.Fatal(err)
	}
}

func TestConfirmTestCardSkipsWithoutKey(t *testing.T) {
	t.Setenv("HG_STRIPE_SECRET_KEY", "")
	t.Setenv("STRIPE_SECRET_KEY", "")
	if err := confirmTestCard(context.Background(), "pi_abc_secret_def"); err != nil {
		t.Fatal(err)
	}
}
