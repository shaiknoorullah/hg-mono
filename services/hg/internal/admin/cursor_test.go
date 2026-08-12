package admin

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestCursorRoundTrip(t *testing.T) {
	got := encodeCursor("Halal Monitoring Authority", "70a88526-42e0-459a-a3cc-3331d203a835")
	r := httptest.NewRequest("GET", "/x?cursor="+got, nil)
	sv, id, ok := decodeCursor(r)
	if !ok {
		t.Fatal("decodeCursor failed on a value it encoded")
	}
	if *sv != "Halal Monitoring Authority" || *id != "70a88526-42e0-459a-a3cc-3331d203a835" {
		t.Errorf("round trip lost data: %q %q", *sv, *id)
	}
}

func TestTimeCursorRoundTrip(t *testing.T) {
	when := time.Date(2026, 8, 12, 18, 42, 11, 412000000, time.UTC)
	got := encodeTimeCursor(when, "abc")
	r := httptest.NewRequest("GET", "/x?cursor="+got, nil)
	tv, id, ok := decodeTimeCursor(r)
	if !ok || tv == nil {
		t.Fatal("decodeTimeCursor failed")
	}
	if !tv.Equal(when) || *id != "abc" {
		t.Errorf("time cursor round trip lost data: %v %v", tv, id)
	}
}

func TestDecodeCursorAbsentIsOK(t *testing.T) {
	r := httptest.NewRequest("GET", "/x", nil)
	sv, id, ok := decodeCursor(r)
	if !ok || sv != nil || id != nil {
		t.Errorf("absent cursor should be (nil,nil,true), got (%v,%v,%v)", sv, id, ok)
	}
}

func TestDecodeCursorMalformed(t *testing.T) {
	r := httptest.NewRequest("GET", "/x?cursor=!!!not-base64!!!", nil)
	if _, _, ok := decodeCursor(r); ok {
		t.Error("malformed cursor should be rejected")
	}
}

func TestValidateTranscription(t *testing.T) {
	good := halalTranscriptionInput{
		CertificateNumber: "HMA-ON-43563", IssuingBodyID: "x", CertifiedLegalName: "K",
		CertifiedAddress: "A", Scope: ScopeWholeEstablishment, IssuedOn: "2026-01-01", ExpiresOn: "2027-01-01",
	}
	if f := validateTranscription(good); f != "" {
		t.Errorf("good input rejected on field %q", f)
	}
	bad := good
	bad.Scope = "NONSENSE"
	if validateTranscription(bad) != "scope" {
		t.Error("invalid scope should be rejected")
	}
	bad = good
	bad.CertificateNumber = ""
	if validateTranscription(bad) != "certificate_number" {
		t.Error("empty certificate_number should be rejected")
	}
}
