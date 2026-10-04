---
covers: []
reviewed: 2026-09-28
---

# Decision: surface the certificate's slaughter method

_Sep 2026, client-confirmed. Raised by the Gate B objection map; requires schema, contract, admin
and app changes. **Not shippable on the marketing site until the field exists.**_

## Why

The Halal Monitoring Authority — one of our three accepted issuing bodies (`S-11`) — named this as
the trust-breaking detail, in the CBC Marketplace investigation of 18 Oct 2024:

> "if they're being fed something that's machine cut, but it was presented as hand, it's going to
> be a big violation of their trust. And for them they feel that now it's also going to impede on
> their relationship with God"
> — Imam Omar Subedar, HMA

The same investigation found **four of ten** locations could not say whether their meat was hand-
or machine-slaughtered, or gave wrong information. It is the third-ranked unanswered objection in
`docs/marketing/objection-map.md`.

Our check `H6_SCOPE_SUFFICIENT` covers scope generically. Method is not captured anywhere:
`halal_certificate` carries `certificate_number`, `issuing_body_id`, `certified_legal_name`,
`certified_address`, `scope`, `issued_on`, `expires_on` — and nothing else.

## The decision

**Record the slaughter method the certificate states, and show it. Never infer it, never rank it.**

This is reporting, not adjudication. Certifying bodies differ on machine slaughter and that
disagreement is theological, not ours to settle. We say what the certificate says.

## What it must not become

Two invariants govern this and neither bends:

- **Invariant #8 — a missing field renders no badge, never an optimistic one.** If the certificate
  does not state a method, the restaurant page shows **nothing**. Not "unknown", not "not
  specified", not a neutral chip — nothing. An absent value must not become a visible claim, and a
  visible "unknown" invites the reader to fill it in themselves.
- **Never issue a religious ruling.** We do not mark hand slaughter as better, sort by it, filter
  by it as a quality signal, or let it affect ranking. If a customer wants to filter, that is a
  later decision requiring its own entry — not something to add casually because the field exists.

## What it requires

| Layer | Change |
|---|---|
| Schema | `halal_certificate.slaughter_method` — **nullable** enum. NULL is the normal case, not an error. |
| Enum | `HAND`, `MACHINE`, `MIXED`, `NOT_STATED`. `NOT_STATED` means the reviewer read the certificate and it is silent; NULL means nobody has looked yet. **These are different and must not be merged.** |
| Contract | `contracts/openapi.yaml` first, then clients regenerate — the repo rule is the contract changes deliberately, never trails the code. |
| Admin | Captured at certificate review, beside the seven checks. It is **not an eighth check** — it does not gate approval and cannot fail a certificate. |
| Customer app | Restaurant page, next to the certification panel. Rendered only when a method is recorded. |
| Marketing site | One FAQ line. **Blocked until the field ships** — see below. |

## Blocked for marketing until the field exists

The copy deck carries a drafted FAQ answer for this, marked not-publishable in its claims
register. Writing "we record whether the meat is hand- or machine-slaughtered" before the column
exists is precisely the overclaim the register is there to prevent — and doing it on this topic, of
all topics, would be the worst possible place to be caught out.

Sequence: schema → contract → admin capture → app display → **then** the FAQ line goes live.

## Open

- Does `MIXED` need a free-text qualifier? A certificate covering two suppliers with different
  methods is real and one enum value may flatten it.
- Backfill: existing seeded certificates have no method. They stay NULL and show nothing, which is
  correct behaviour, not a data gap to fix.
