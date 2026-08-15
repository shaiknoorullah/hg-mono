# Handoff verification — QR + tamper-evident seal

_Halal Goes. Verifiable chain of custody from kitchen to door: prove the **right** order moved to
the **right** rider and **right** customer, and that it was **never opened** in transit. Extends
the product's core claim — halal verification — from the certificate to the physical package.
Captured Aug 2026 from product direction._

## The two guarantees

1. **Identity** — the rider picked up the *correct* order; it was delivered to the *correct*
   customer. (Solves: no way today to prove pickup/delivery or that the right parcel moved.)
2. **Integrity** — the package was **sealed at the kitchen and still sealed at the door**. A broken
   seal is visible and recorded. (The halal-trust payload: verified-halal food, untampered.)

Receipts stay; this is **in addition** to them.

## The seal (physical) + QR (digital)

- A **tamper-evident label** (VOID-if-removed material) is applied **across the package opening**
  at the kitchen. Printed on it is a **unique QR**.
- **Binding model (recommended): scan-to-bind pre-coded seals.** Restaurants get rolls of seals,
  each with a unique code; at packing, the restaurant **scans the seal to bind it to the order**
  (no thermal printer needed — low friction for small kitchens). _Alternative:_ backend generates
  a QR the restaurant prints onto a seal (needs a printer).
- The QR encodes a **signed token** — EdDSA-signed (same keys as auth), payload
  `{order_id, seal_id, nonce}`. Signed ⇒ **unforgeable and offline-verifiable**; bound to the
  order ⇒ **can't be moved to another order**; single-use per step ⇒ **no replay**. No price, no
  PII in the code.

## Flow

**1 · Seal (restaurant, at "ready")**
Restaurant packs → scans/apply seal → order marked `SEALED`. Seal bound to order.

**2 · Pickup (rider ↔ restaurant)**
Rider **scans the seal QR**. Server verifies signature **and** that the token's order == the
rider's assigned order → **correct order confirmed**. Rider attests **seal intact** (checkbox).
This proof accompanies the `PICKED_UP` transition. (Optional mutual step: restaurant scans a
rider code — confirms correct rider.)

**3 · Delivery (rider ↔ customer)**
**Customer scans the seal QR** in their app (proves *right customer* — their app knows their
order) **and confirms the seal is intact** before accepting. Proof accompanies `DELIVERED`.
- Relationship to existing **proof-of-delivery OTP**: QR is primary for *identity + integrity*;
  the **OTP remains the recipient-proof fallback** (customer without a working scanner, or
  no-contact drop). Photo fallback stays as dispute evidence.
- **Broken seal** → customer taps "seal tampered" → order is **not** auto-failed; it opens the
  **dispute/refund flow (A-33/A-35)** with the scan history + photo as evidence. Money was
  captured on acceptance, so this is a dispute, not a failed payment.

## Data model

- **`package_seal`** — `seal_id`, `order_id`, `signed_token`, `bound_at`, `status`
  (`ISSUED → BOUND → PICKUP_VERIFIED → DELIVERY_VERIFIED | TAMPER_REPORTED`).
- **`handoff_event`** (append-only, auditable chain of custody) — `order_id`, `type`
  (`SEAL|PICKUP|DELIVERY`), `actor` (restaurant/rider/customer), `at`, `seal_intact` bool,
  `geo`, `method` (`QR|OTP|PHOTO`). This is the evidence trail for disputes.

## Security & invariants

- **Server verifies, client scans.** The scan sends the token to the server; server checks the
  EdDSA signature + order/rider/customer match + single-use nonce. Deny-by-default.
- **Bound + single-use + signed** makes forgery, reuse, and swapping-to-another-order
  unrepresentable — same "make the bug impossible" discipline as the CHECK/ledger constraints.
- Scans are **proofs**, not state writes — they call the orders API which owns the transition
  (P-14). PICKED_UP/DELIVERED can be gated on a valid proof.
- **Offline resilience:** the signature verifies offline for instant rider feedback; the state
  transition syncs when back online (position/scan queue). Redis-flush safe (proofs live in
  Postgres).
- No PII/price in the QR; handoff geo/photos are private-bucket + presigned, like KYC (invariant #7).

## Halal tie-in (why this matters beyond fraud)

The seal is the physical end of the halal chain: certificate verified (admin) → badge (app) →
**sealed at the halal kitchen → intact at the door**. Marketed as "sealed halal, verified to your
door." Never framed with red/haram language on a broken seal — it's "seal check failed, we'll make
it right," routed to disputes.

## Phasing

- **v1 (software):** the QR identity verification (correct order at pickup/delivery) + handoff
  event log + dispute-on-tamper. Buildable now; strengthens the weak spot (no pickup/delivery proof).
- **v1.x (ops):** roll out the physical **tamper-evident seal stock** + the scan-to-bind flow to
  restaurants. Software supports it from day one; the label supply chain is the gating ops piece.
