// Package config owns the process's entire relationship with its environment.
//
// Responsibility: read every environment variable exactly once, at boot, into a
// typed struct; refuse to boot when a required variable is missing or when a
// value is structurally wrong. Nothing else in the binary may call os.Getenv —
// a value that is not on Config does not exist.
//
// This implements ground rule G-7 ("Fail loud on config") from
// docs/spec/01-platform.md §0:
//
//	The binary refuses to boot if any required env var is missing, if any
//	configured host resolves to localhost/127.0.0.1 while HG_ENV != local, or
//	if a startup self-probe fails.
//
// The failure mode this exists to delete: the previous system's cache was
// hardcoded to localhost:6379. It worked on a laptop and silently degraded to
// "no cache, no rate limit" in Docker, because a zero value is indistinguishable
// from a deliberate one. Here a missing variable is a non-zero exit with the
// variable's name in the message, and every load error is reported at once
// rather than one boot attempt at a time.
//
// Secrets (secrets.go): every name in SecretSettings may be given as NAME_FILE,
// the path of a file holding the value, so that production keeps secrets out of
// the container's environment (issue #309:
// https://github.com/shaiknoorullah/hg-mono/issues/309). Outside HG_ENV=local a
// secret file readable by its group or everyone, or a secret still set to a
// deploy/.env.example placeholder, is refused (issue #316:
// https://github.com/shaiknoorullah/hg-mono/issues/316). No secret value, file
// content or length is ever written to an error, a warning or the log.
//
// TODO(siblings): as modules land, extend Config with their required variables
// and add them to deploy/.env.example in the same commit — P-27 notes that a CI
// check parses both files and fails on a name mismatch (the MINIO_ACCESS_SECRET
// vs MINIO_SECRET_KEY class of bug). Still to add: Stripe keys and webhook
// secret (P-16/P-17), JWT signing keys (P-04), SMS/push provider credentials
// (P-25/P-26), rate-limit and dispatch tunables (P-38/P-32).
package config
