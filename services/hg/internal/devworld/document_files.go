package devworld

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Files for the seeded documents. The persona SQL and the catalogue insert a
// stored_object row for every seeded document and halal certificate, in the
// private KYC bucket, but no file. SeedDocumentFiles generates a small
// placeholder for each row, marked as not a real document, uploads it at the
// row's object key and sets the row's size and checksum to match, so an
// admin's download link and a customer's "View certificate" open a file.
//
// The bucket stays private: KYC documents and certificates are only ever read
// through short-lived presigned URLs (AGENTS.md "Non-negotiable invariants").
// A bucket that allows anonymous reads is refused, not written to.

// seededFile is one stored_object row the dev world inserted without a file.
type seededFile struct {
	id, bucket, key, contentType string
	subject, docType, number     string
}

// seededFilesQuery lists every seeded document row: the dev world's object keys
// outside the menu pictures, with what the placeholder should say.
const seededFilesQuery = `
	SELECT so.id::text, so.bucket, so.object_key, so.content_type,
	       COALESCE(r.display_name, NULLIF(trim(rp.first_name || ' ' || rp.last_name), ''), ''),
	       COALESCE(kd.restaurant_doc_type::text, kd.rider_doc_type::text, ''),
	       COALESCE(kd.certificate_number, '')
	  FROM stored_object so
	  LEFT JOIN kyc_document kd ON kd.stored_object_id = so.id
	  LEFT JOIN restaurant r ON kd.subject_type = 'RESTAURANT' AND r.id = kd.subject_id
	  LEFT JOIN rider_profile rp ON kd.subject_type = 'RIDER' AND rp.account_id = kd.subject_id
	 WHERE so.object_key LIKE 'devworld/%' AND so.purpose <> 'MENU_IMAGE'
	 ORDER BY so.object_key`

func listSeededFiles(ctx context.Context, conn *pgx.Conn) ([]seededFile, error) {
	rows, err := conn.Query(ctx, seededFilesQuery)
	if err != nil {
		return nil, fmt.Errorf("devworld: list seeded documents: %w", err)
	}
	defer rows.Close()
	var out []seededFile
	for rows.Next() {
		var f seededFile
		if err := rows.Scan(&f.id, &f.bucket, &f.key, &f.contentType, &f.subject, &f.docType, &f.number); err != nil {
			return nil, fmt.Errorf("devworld: scan seeded document: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// localObjectStore returns a client for the local object store, or a reason to
// skip: HG_MINIO_ENDPOINT unset, or a host that is not this machine or the
// compose service. It never reaches a remote store.
func localObjectStore() (*minio.Client, string) {
	endpoint := strings.TrimSpace(os.Getenv("HG_MINIO_ENDPOINT"))
	if endpoint == "" {
		return nil, "HG_MINIO_ENDPOINT is not set"
	}
	host := endpoint
	if h, _, err := net.SplitHostPort(endpoint); err == nil {
		host = h
	}
	if host != "minio" && !LocalDBHost(host) {
		return nil, fmt.Sprintf("object store %q is not local", host)
	}
	creds := credentials.NewStaticV4(os.Getenv("HG_MINIO_ACCESS_KEY"), os.Getenv("HG_MINIO_SECRET_KEY"), "")
	client, err := minio.New(endpoint, &minio.Options{Creds: creds, Secure: os.Getenv("HG_MINIO_USE_SSL") == "true"})
	if err != nil {
		return nil, err.Error()
	}
	return client, ""
}

// privateBucket reports why a bucket must not receive documents: missing,
// unreachable, or readable without a signature.
func privateBucket(ctx context.Context, client *minio.Client, bucket string) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ok, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Sprintf("bucket %s is not reachable: %v", bucket, err)
	}
	if !ok {
		return fmt.Sprintf("bucket %s does not exist", bucket)
	}
	policy, err := client.GetBucketPolicy(ctx, bucket)
	if err != nil {
		return fmt.Sprintf("bucket %s policy unreadable: %v", bucket, err)
	}
	if strings.Contains(policy, `"*"`) {
		return fmt.Sprintf("bucket %s allows anonymous access; documents must stay private", bucket)
	}
	return ""
}

// SeedDocumentFiles uploads a generated placeholder for every seeded document
// row and makes the row's size and checksum match it. Like the pictures, an
// unset or non-local object store, or a missing or public bucket, skips the
// step with a message instead of failing the reset; Verify then lists the
// files that are missing.
func SeedDocumentFiles(ctx context.Context, dsn string) error {
	client, why := localObjectStore()
	if client == nil {
		fmt.Fprintf(os.Stderr, "devworld: document files skipped (%s)\n", why)
		return nil
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	files, err := listSeededFiles(ctx, conn)
	if err != nil {
		return err
	}

	checked := map[string]string{}
	var uploaded int
	for _, f := range files {
		reason, seen := checked[f.bucket]
		if !seen {
			reason = privateBucket(ctx, client, f.bucket)
			checked[f.bucket] = reason
			if reason != "" {
				fmt.Fprintf(os.Stderr, "devworld: document files skipped for %s (%s)\n", f.bucket, reason)
			}
		}
		if reason != "" {
			continue
		}
		body := placeholderDocument(f)
		if _, err := client.PutObject(ctx, f.bucket, f.key, bytes.NewReader(body), int64(len(body)),
			minio.PutObjectOptions{ContentType: f.contentType}); err != nil {
			return fmt.Errorf("devworld: upload %s/%s: %w", f.bucket, f.key, err)
		}
		sum := sha256.Sum256(body)
		if _, err := conn.Exec(ctx, `UPDATE stored_object SET byte_size = $2, sha256 = $3 WHERE id = $1`,
			f.id, len(body), sum[:]); err != nil {
			return fmt.Errorf("devworld: record %s: %w", f.key, err)
		}
		uploaded++
	}
	fmt.Fprintf(os.Stderr, "devworld: document files %d of %d uploaded to private storage\n", uploaded, len(files))
	return nil
}

// verifyDocumentFiles prints how many seeded documents have their file in
// storage and names the missing ones. Storage is optional for a reset, so a
// missing file is reported, not returned as a problem.
func verifyDocumentFiles(ctx context.Context, conn *pgx.Conn, out io.Writer) error {
	files, err := listSeededFiles(ctx, conn)
	if err != nil {
		return err
	}
	client, why := localObjectStore()
	if client == nil {
		fmt.Fprintf(out, "document files: not checked (%s)\n", why)
		return nil
	}
	var missing []string
	for _, f := range files {
		statCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		info, err := client.StatObject(statCtx, f.bucket, f.key, minio.StatObjectOptions{})
		cancel()
		if err != nil || info.Size <= 0 {
			missing = append(missing, f.bucket+"/"+f.key)
		}
	}
	fmt.Fprintf(out, "document files: %d of %d in storage\n", len(files)-len(missing), len(files))
	if len(missing) > 0 {
		fmt.Fprintf(out, "document files missing (run make dev-reset with the local object store up): %s\n",
			strings.Join(missing, ", "))
	}
	return nil
}

// placeholderDocument returns a file of the row's content type: a one-page PDF
// for documents and certificates, a plain picture for an image row.
func placeholderDocument(f seededFile) []byte {
	switch f.contentType {
	case "image/png":
		return placeholderPNG(f.key, 0)
	case "image/jpeg":
		img := image.NewRGBA(image.Rect(0, 0, 320, 200))
		for i := range img.Pix {
			img.Pix[i] = 0xE8
		}
		img.SetRGBA(0, 0, color.RGBA{0, 0, 0, 255})
		var buf bytes.Buffer
		_ = jpeg.Encode(&buf, img, nil)
		return buf.Bytes()
	}
	lines := []string{
		"HalalGoes dev world",
		"Not a real document. Generated by make dev-reset for local development.",
		"",
	}
	if f.subject != "" {
		lines = append(lines, "Subject: "+f.subject)
	}
	if f.docType != "" {
		lines = append(lines, "Document type: "+f.docType)
	}
	if f.number != "" {
		lines = append(lines, "Certificate number: "+f.number)
	}
	lines = append(lines, "Object: "+f.bucket+"/"+f.key)
	return onePagePDF(lines)
}

// onePagePDF writes a minimal PDF 1.4 with one Letter page of Helvetica text.
func onePagePDF(lines []string) []byte {
	var content bytes.Buffer
	content.WriteString("BT /F1 12 Tf 72 720 Td 16 TL\n")
	for _, l := range lines {
		fmt.Fprintf(&content, "(%s) Tj T*\n", pdfEscape(l))
	}
	content.WriteString("ET\n")

	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", content.Len(), content.String()),
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for i, o := range objects {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return b.Bytes()
}

// pdfEscape keeps a line inside a PDF string literal: printable ASCII only,
// with the delimiters escaped.
func pdfEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '(' || r == ')' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r >= 0x20 && r < 0x7f:
			b.WriteRune(r)
		default:
			b.WriteByte('?')
		}
	}
	return b.String()
}
