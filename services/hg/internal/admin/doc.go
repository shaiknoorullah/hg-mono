// Package admin owns the staff surface: onboarding queues, halal verification,
// partner approval, order lookup and refunds.
//
// Responsibility: everything a human operator does to the platform, and the
// append-only record of them doing it.
//
// Spec:
//
//   - docs/spec/05-admin.md — the 42 admin features; the V0 seven are staff
//     sign-in + RBAC, the onboarding queue, the halal 7-check verification,
//     restaurant approve/reject, rider approve/reject, menu creation on behalf,
//     and order lookup + refund.
//   - docs/spec/01-platform.md §P-35 — the append-only audit trail. Every
//     privileged action carries before/after, and an authorization denial at
//     chain stage 11 or 14 emits an authz.denied row with subject_id set.
//
// The halal verification is the platform's reason to exist, so its checks are
// not advisory. Check H2_ISSUER_ACCEPTED fails until the accepted certifying
// bodies are seeded, which means **no restaurant can be certified until the
// client supplies that list** (blocking decision O-02). A HalalIssuingBody is
// promoted PROPOSED → ACCEPTED only by a super admin.
//
// Separation of duties: SUPER_ADMIN holds every action; ADMIN holds all except
// admin.grant_role, platform_config.write and payout_config.write; SUPPORT_AGENT
// holds read actions plus refund.request (admin-approved above a threshold) and
// order.annotate. Granting a role is itself an audited action held only by
// SUPER_ADMIN (I-05.3), and self-approval is refused outright.
//
// TODO: refund liability allocation (O-04) is server config, not contract — the
// reason-code → RefundLiabilitySplit mapping is computed at authorisation and
// stored.
package admin
