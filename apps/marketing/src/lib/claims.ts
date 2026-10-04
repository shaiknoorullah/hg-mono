/**
 * Every factual claim the marketing site makes, with its provenance.
 *
 * WHY THIS FILE EXISTS
 * The product's single claim is halal verification. A marketing page that
 * overstates — even slightly, even in a direction that flatters us — is an
 * argument against the product in a way it would not be for anyone else. So no
 * component is allowed to hard-code an assertion about what we do, what we
 * charge, or where we operate. It imports one from here, and every entry below
 * carries the file and decision that backs it.
 *
 * THE RULE: if you cannot put a `source:` on it, it does not go on the page.
 *
 * Claims that were proposed during creative work and are NOT supported by the
 * repo are listed at the bottom under REJECTED, with the reason, so nobody
 * re-introduces them later.
 *
 * Copy that is *voice* rather than *claim* lives in `audiences.ts` (the Gate B
 * deck transcribed). The split is: audiences.ts decides how we say it, this file
 * decides whether we are allowed to say it at all. When the two disagree, this
 * file wins and audiences.ts changes.
 */

/** The seven mandatory checks. Closed set, halal_checklist_version = 1.
 *  source: docs/spec/05-admin.md:971-985 · contracts/openapi.yaml:6460-6472 (HalalCheckKey)
 *          services/hg/migrations/00009_halal.sql:93-118
 *  Approval requires all seven PASS. H5 and H7 are computed by the server and
 *  cannot be overridden by any human — that is enforced in the database, not by
 *  policy, which is why we are willing to print it. */
export const CHECKS = [
  {
    key: 'H1_LEGIBLE_COMPLETE',
    title: 'The document is readable, whole, and unaltered',
    body: 'Every page present, nothing obscured, no sign the certificate has been edited. A person looks at the scan.',
    by: 'human',
  },
  {
    key: 'H2_ISSUER_ACCEPTED',
    title: 'The issuer is one we accept',
    body: 'The certifying body is on our accepted registry at the moment of review — and we print its name on the listing, so you can judge the issuer for yourself.',
    by: 'both',
  },
  {
    key: 'H3_NAME_MATCH',
    title: 'The certificate names this business',
    body: 'The legal name on the certificate is the restaurant’s registered legal name, or a recorded alias of it. Not a parent brand.',
    by: 'human',
  },
  {
    key: 'H4_ADDRESS_MATCH',
    title: 'The certificate covers this address',
    body: 'The certified address matches the premises being listed — or the certificate explicitly names multiple premises and this is one of them.',
    by: 'human',
  },
  {
    key: 'H5_DATES_VALID',
    title: 'It is in force today, with time left on it',
    body: 'Issued in the past, and not expiring within our minimum remaining window. The server computes this. No admin can wave it through.',
    by: 'system',
  },
  {
    key: 'H6_SCOPE_SUFFICIENT',
    title: 'It covers the food, not just the supplier',
    body: 'The scope has to cover the whole establishment or the kitchen. A certificate that only covers a meat supplier fails this check — it is the exact thing that gets mistaken for a restaurant being certified.',
    by: 'human',
  },
  {
    key: 'H7_UNIQUE_NOT_REUSED',
    title: 'It has not been used by anyone else',
    body: 'The certificate number is not already approved for a different restaurant. Also computed by the server, also not overridable.',
    by: 'system',
  },
] as const satisfies readonly {
  key: string;
  title: string;
  body: string;
  by: 'human' | 'system' | 'both';
}[];

export type Check = (typeof CHECKS)[number];

/** Accepted certifying bodies. Seeded registry, extensible at runtime by a super
 *  admin — not a closed set, and not a ranking.
 *  source: docs/decisions/README.md:26 (S-11) · services/hg/migrations/seed/002_halal_issuing_bodies.sql:26-48
 *  Names are VERBATIM from the seed. The HFSAA note is the seed's own wording —
 *  we print it rather than hiding it, because an American body on an Ontario
 *  page is exactly the kind of detail this brand has to be first to mention. */
export const ISSUERS = [
  {
    abbr: 'HMA',
    sub: 'Canada',
    name: 'Halal Monitoring Authority (HMA Canada)',
    where: 'Ontario, Canada',
    url: 'https://hmacanada.org',
  },
  {
    abbr: 'ISNA',
    sub: 'Canada',
    name: 'Islamic Society of North America Canada (ISNA Canada)',
    where: 'Ontario, Canada',
    url: 'https://isnacanada.com',
  },
  {
    abbr: 'HFSAA',
    sub: null,
    name: 'Halal Food Standards Alliance of America (HFSAA)',
    where: 'United States — certificates issued to Canadian establishments are accepted',
    url: null,
  },
] as const satisfies readonly {
  abbr: string;
  sub: string | null;
  name: string;
  where: string;
  url: string | null;
}[];

export type Issuer = (typeof ISSUERS)[number];

/** The four customer-visible halal states. Computed, never stored.
 *  source: contracts/openapi.yaml:6428-6445 (HalalDisplayState)
 *  Invariant #8 — a missing value renders NO badge, never an optimistic one.
 *  Invariant #9 — never red for a halal state.
 *  Badge label is FIXED COPY: "Halal certified". Not "Halal", not "100% Halal",
 *  not "Verified halal". source: docs/spec/02-customer.md:355 (C-12 R7) */
export const STATES = [
  {
    state: 'certified',
    label: 'Halal certified',
    body: 'A current certificate is on file, a person has checked it against all seven points, and the record says who checked it and when.',
    mono: 'RECORD SHOWN ON THE LISTING',
  },
  {
    state: 'expired',
    label: 'Expired',
    body: 'The restaurant comes off the app until it is renewed. An expired certificate means our information has lapsed — not that anything is wrong with the food. There is no grace period.',
    mono: 'DELISTED WITHIN 60 SECONDS',
  },
  {
    state: 'review',
    label: 'Under review',
    body: 'We have the paperwork and we have not finished checking it. Nothing is ever auto-approved on a timer.',
    mono: 'NOT VISIBLE TO CUSTOMERS',
  },
  {
    state: 'none',
    label: 'No record',
    body: 'If we have not read a certificate, you see nothing at all. Never a maybe, never an optimistic badge.',
    mono: 'NO BADGE RENDERED',
  },
] as const satisfies readonly {
  state: 'certified' | 'expired' | 'review' | 'none';
  label: string;
  body: string;
  mono: string;
}[];

export type HalalState = (typeof STATES)[number]['state'];

/** The standing disclaimer. FIXED COPY — do not reword.
 *  source: docs/spec/02-customer.md:355 (C-12 R7) · contracts/openapi.yaml:7756-7759
 *          services/hg/internal/catalog/halal.go:51-58 (+ a test that pins it) */
export const DISCLAIMER =
  'Certification verified by HalalGoes on the date shown on each listing. HalalGoes does not itself certify food.';

/** The CBC Marketplace investigation. Independently verified against the
 *  Radio-Canada English syndication before use — every number below is quoted
 *  from the article, not paraphrased upward.
 *  source: https://www.cbc.ca/news/marketplace/marketplace-halal-1.7352621
 *          "Fast-food chains serving up halal food with a side of
 *           misinformation, expired certificates", 18 October 2024 */
export const CBC = {
  date: '18 October 2024',
  url: 'https://www.cbc.ca/news/marketplace/marketplace-halal-1.7352621',
  locations: 10,
  claimedCertified: 6,
  expiredShown: 8,
} as const;

/** Money. All decided; none of it is a promotional offer.
 *  commission   0% at launch, per-restaurant and switchable — S-01,
 *               docs/decisions/README.md:13 · seed/003_pricing_and_settings.sql:36
 *  serviceFee   mechanism built, set to $0.00 — R-07, docs/decisions/README.md:42
 *  tip          100% to the rider. Invariant I-13.5, docs/spec/01-platform.md:2785;
 *               contracts/openapi.yaml:4275, :8256; and docs/spec/02-customer.md:969
 *               REQUIRES this be stated in the UI next to the control.
 *  deliveryFee  $2.99 base + $1.00/km, capped at $15.00 — S-02, and 100% of it
 *               goes to the rider — S-03, docs/decisions/README.md:14-15
 *  payouts      weekly, every Monday — S-04, docs/decisions/README.md:16
 *  shownFirst   the amount displayed is the amount charged — C-22,
 *               docs/spec/02-customer.md:590-594 · contracts/openapi.yaml:8259
 *  noPaidRank   a restaurant cannot pay for or influence feed position —
 *               docs/spec/03-restaurant.md:2346 */
export const MONEY = {
  commissionAtLaunch: '0%',
  serviceFee: '$0.00',
  tipToRider: '100%',
  deliveryFeeToRider: '100%',
  deliveryBase: '$2.99',
  deliveryPerKm: '$1.00',
  payoutDay: 'Monday',
} as const;

/** Where we operate. The decided unit is the PROVINCE of Ontario.
 *  source: docs/decisions/README.md:68 (O-05, settled) ·
 *          seed/003_pricing_and_settings.sql:60 (served_provinces)
 *  NOTE: "GTA" / "Toronto" is NOT a decided launch area. Say Ontario. */
export const PLACE = { province: 'Ontario', country: 'Canada' } as const;

/** Chain of custody. The seal binds to ONE order at the kitchen; the rider's
 *  scan at pickup and at delivery are what gate the state transitions.
 *  source: contracts/openapi.yaml:112-117, :5514-5525 (bindPackageSeal),
 *          :5563-5577 (scanPickup), :5619-5632 (scanDelivery),
 *          :5675-5686 (reportTamper) · docs/design/handoff-verification.md:15
 *  CAREFUL: a broken seal does NOT block pickup or delivery and never
 *  auto-fails the order or the payment. The CUSTOMER files a tamper report,
 *  never the rider. Do not overstate this on the page. */
export const SEAL = [
  {
    step: 'AT THE KITCHEN',
    title: 'The kitchen seals the bag.',
    body: 'A tamper-evident label goes across the opening as they finish packing, and it is bound to your order alone. A seal never moves between orders.',
  },
  {
    step: 'AT PICKUP',
    title: 'Your rider scans it on collection.',
    body: 'The scan is what moves the order to picked up. Each code works once — a second use is rejected by the database, not by a check somebody might skip.',
  },
  {
    step: 'AT YOUR DOOR',
    title: 'It is scanned again when it reaches you.',
    body: 'If a seal arrives broken you can report it with a photo, and the whole scan trail goes to a person to sort out.',
  },
] as const;

/** How the waitlist may contact somebody, and why it is not a text message.
 *
 *  O-03 (A2P 10DLC / SMS sender registration) is OPEN and blocked on a human —
 *  source: docs/decisions/README.md, "Blocked on a human". Until it closes there
 *  is no approved sender, so "we'll text you at launch" is a promise we cannot
 *  keep. Every track therefore collects an EMAIL address, and every reassurance
 *  says email. When O-03 closes, this constant and the tracks' form copy change
 *  together, in one commit, and not before.
 *
 *  This is also why the server action discards a phone number rather than
 *  storing one it has no lawful sender for. */
export const WAITLIST_CHANNEL = 'email' as const;

/* ───────────────────────────────────────────────────────────────────────────
   REJECTED — proposed during creative work, NOT supported by the repo.
   Listed so they do not come back.

   "IFANCC"                     — not in spec, decisions, contract or seed. The
                                  accepted registry is S-11's three bodies.
   "Greater Toronto Area"       — the decided launch unit is the province of
                                  Ontario (O-05). No city or neighbourhood is
                                  decided, so no neighbourhood may be named.
   "Launch partners pay 0%"     — commission is 0% AT LAUNCH and switchable
                                  (S-01). There is no partner programme, no
                                  promotional window and no founding-member tier.
   "60 days' notice before the
    rate changes"               — no notice period exists anywhere.
   "No contract, no exclusivity" — neither is specified. Do not claim. (This one
                                  HAD shipped in the restaurant track's form and
                                  FAQ; it was removed when this register landed.)
   "No setup fee"               — no fee schedule for onboarding exists either
                                  way, so its absence is not a claim we can make.
   "Live in two working days"   — the 2-business-day review SLA is an internal,
                                  breachable, configurable target, never a promise.
   "A broken seal gets you a
    refund"                     — contradicted twice in the contract.
   "Your tip is untaxed"        — tip taxation is still an open decision. Only
                                  "100% reaches the rider" is settled.
   "We'll text you at launch"   — O-03 is open; there is no approved SMS sender.
                                  See WAITLIST_CHANNEL above.
   Any tax-inclusive claim      — O-01 (supplier position) is still open.
   Any refund guarantee/window  — O-04 is an internal ledger rule, not policy.
   ─────────────────────────────────────────────────────────────────────────── */
