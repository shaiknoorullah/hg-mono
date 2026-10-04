// Package halalexpiry keeps every restaurant's halal state true as the calendar
// moves: it lapses certificates on the day after they expire, delists the
// restaurant, and sends the renewal reminders.
//
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/252. Before it,
// restaurant.halal_status was recomputed only when someone wrote the
// certificate row, so a certificate that expired overnight kept its badge.
//
// Spec: docs/spec/05-admin.md, "A-17 — Halal certificate expiry monitoring and
// lapse handling"; the loop is the certificate half of the hourly "Expiry
// sweeps" in docs/spec/01-platform.md, "P-39 — Background runtime (deadline
// runner, outbox relay, schedulers)".
//
// # What one pass does, per restaurant, in one transaction
//
//  1. Moves every APPROVED certificate whose last valid day (expires_on, or a
//     super admin's grace_until) is before the restaurant's local date to
//     EXPIRED, and tells the owner and managers once.
//  2. Calls halal_refresh_restaurant_status(restaurant, at), which derives the
//     displayed state (CERTIFIED, EXPIRING_SOON from 30 days out, EXPIRED,
//     UNVERIFIED) and keeps the listing in step: an expired certificate delists
//     a LIVE restaurant with the reason HALAL_CERTIFICATE_EXPIRED; a valid one
//     removes the reason and relists. The certificate trigger calls the same
//     function, so approving a renewal relists in the approval's transaction
//     (migrations/00029_halal_certificate_expiry.sql). A LIVE restaurant with
//     an EXPIRED halal state is refused by a CHECK constraint.
//  3. Sends the renewal reminder that is due: 30, 14, 7 and 1 days before
//     expiry (docs/decisions/README.md, "Settled — redesign decisions (owner,
//     2026-09-28)"). Each threshold is sent once per certificate, enforced by
//     the unique (certificate, days_before) row in halal_certificate_reminder.
//     After a gap in runs only the nearest threshold is sent: a "30 days" note
//     with 6 days left would be wrong.
//
// The messages go through the notification outbox (package notify): the
// notification row and its delivery job are written in the same transaction
// as the change, to the restaurant's owner and manager accounts, on the email
// and in-app channels. The in-app row is the record; email delivery is a fake
// sender until real email lands
// (https://github.com/shaiknoorullah/hg-mono/issues/59), and the full set of
// non-order messages is https://github.com/shaiknoorullah/hg-mono/issues/248.
//
// # Fail closed
//
// A missing halal field renders no badge, never an optimistic one (AGENTS.md,
// "Non-negotiable invariants"). Only an admin-verified certificate's own dates
// decide: a pending upload's claimed expiry never extends anything. A NULL,
// zero or past instant, a NULL or unknown restaurant, a NULL date or an
// unknown status is refused or lands on EXPIRED, never on a badge; an unknown
// timezone takes the latest date anywhere (UTC+14). A failure to send a
// message or to suspend never undoes the expiry: those run in savepoints after
// the halal state has changed.
//
// # Time
//
// Every date is the restaurant's local date (restaurant.timezone) at an
// explicit instant. RunAt takes that instant, so tests and the dev controls
// (https://github.com/shaiknoorullah/hg-mono/issues/235) can run the job "as
// of" any date from now on (never the past: that could only revive a lapse). Run uses the injected clock (WithClock) and wakes just after
// midnight in Toronto, when certificates lapse, and at least hourly.
//
// # Two replicas
//
// A pass holds a session advisory lock, so one replica works at a time and the
// other skips. Underneath, each restaurant is claimed with FOR UPDATE SKIP
// LOCKED, a certificate moves APPROVED to EXPIRED only once, and reminders are
// unique rows, so running the pass twice, or on both replicas, has the effect
// of running it once. Every pass is recorded in job_run.
//
// # Not decided, so not invented
//
// Whether a restaurant is also suspended some days after its certificate
// expired is an open owner question
// (https://github.com/shaiknoorullah/hg-mono/issues/164). Config
// SuspendAfterExpiredDays leaves it off by default, which is what the
// specification documents today: delisted, not suspended.
package halalexpiry
