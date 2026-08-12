// Package files owns MinIO object lifecycle: presigned uploads, downloads and
// document retention.
//
// Responsibility: hand out short-lived presigned URLs, generate every object
// key server-side, and keep private buckets private.
//
// Spec: docs/spec/01-platform.md
//
//   - P-27 Bucket layout and private-by-default. Five buckets; only hg-media is
//     public-read. The boot-time privacy probe lives in internal/store and
//     refuses to start a process whose private buckets are anonymously readable
//     or writable — the previous platform kept restaurant licences, owner IDs
//     and halal certificates in a bucket that was world-readable *and*
//     world-writable, and its own files module was commented out with mismatched
//     env var names.
//   - P-28 Presigned upload and download
//   - P-29 Document lifecycle, review and retention
//
// Object keys are server-generated and unguessable; clients never choose a key,
// a bucket or a filename:
//
//	hg-kyc/{subject_type}/{subject_id}/{doc_type}/{ulid}{ext}
//	hg-pod/{yyyy}/{mm}/{order_id}/{ulid}.jpg
//	hg-media/menu-item/{menu_item_id}/{ulid}_{variant}.webp
//
// Retention: hg-kyc 7 years after account closure with versioning on; hg-pod 90
// days; hg-exports 30 days; hg-tmp a 24 h lifecycle rule.
//
// TODO: env var names are asserted at boot against the compose file by a CI
// check that parses both — the exact class of bug that made MinIO unreachable
// before (MINIO_ACCESS_SECRET versus MINIO_SECRET_KEY). deploy/.env.example and
// internal/config must stay in step.
package files
