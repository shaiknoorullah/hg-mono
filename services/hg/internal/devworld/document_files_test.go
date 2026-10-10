package devworld

import (
	"bytes"
	"regexp"
	"strconv"
	"testing"
)

// The placeholder must open in a PDF reader: every xref offset points at its
// object, and startxref points at the xref table.
func TestOnePagePDFOffsets(t *testing.T) {
	pdf := placeholderDocument(seededFile{
		bucket: "hg-kyc", key: "devworld/DW-X-0001.pdf", contentType: "application/pdf",
		subject: "Bismillah (Grill)", docType: "HALAL_CERTIFICATE", number: "DW-X-0001",
	})
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4\n")) || !bytes.HasSuffix(pdf, []byte("%%EOF\n")) {
		t.Fatalf("not a PDF envelope: %q", pdf[:20])
	}
	if !bytes.Contains(pdf, []byte(`Bismillah \(Grill\)`)) {
		t.Fatal("parentheses in the subject are not escaped")
	}
	start := regexp.MustCompile(`startxref\n(\d+)\n`).FindSubmatch(pdf)
	xref, _ := strconv.Atoi(string(start[1]))
	if !bytes.HasPrefix(pdf[xref:], []byte("xref\n")) {
		t.Fatalf("startxref %d does not point at the xref table", xref)
	}
	entries := regexp.MustCompile(`(\d{10}) 00000 n `).FindAllSubmatch(pdf, -1)
	if len(entries) != 5 {
		t.Fatalf("want 5 objects, got %d", len(entries))
	}
	for i, e := range entries {
		off, _ := strconv.Atoi(string(e[1]))
		want := strconv.Itoa(i+1) + " 0 obj\n"
		if !bytes.HasPrefix(pdf[off:], []byte(want)) {
			t.Fatalf("object %d offset %d points at %q", i+1, off, pdf[off:off+10])
		}
	}
}

func TestPlaceholderDocumentFollowsContentType(t *testing.T) {
	png := placeholderDocument(seededFile{key: "devworld/x.png", contentType: "image/png"})
	if !bytes.HasPrefix(png, []byte("\x89PNG")) {
		t.Fatal("image/png row did not get a PNG")
	}
	jpg := placeholderDocument(seededFile{key: "devworld/x.jpg", contentType: "image/jpeg"})
	if !bytes.HasPrefix(jpg, []byte{0xFF, 0xD8}) {
		t.Fatal("image/jpeg row did not get a JPEG")
	}
}
