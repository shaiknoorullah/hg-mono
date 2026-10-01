# Admin order-detail view (with live tracking)

_HalalGoes — admin console. Opens when an admin clicks an order row in the orders grid
(LyteNyte). The single place an admin sees everything about one order and can act on it or
reach any party. Captured Aug 2026 from product direction._

## Trigger & layout

- **From:** a row in the orders **LyteNyte** grid → order detail.
- **Form:** a **full detail view** (dedicated route, deep-linkable `/orders/:code`), not a
  cramped drawer — there's a lot here and admins share links during incidents. Two columns on
  wide screens: **left = live map + parties**, **right = timeline + money + items + actions**.
- Ships **empty / loading / error** states (repo rule).

## The live-tracking map box (the ask)

> **2026-10-01:** Mapbox is SaaS, which [the self-hosted, open-source rule](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)
> now rules out. Replacing it is tracked in [#199](https://github.com/shaiknoorullah/hg-mono/issues/199).

- **Engine:** `mapbox-gl-js` (admin web), brand-tinted **hg-light / hg-dark** styles.
- **On the map:** restaurant pin, **rider live position (moving)**, customer/destination pin, the
  active route line (**crimson** — brand; the *only* green on the map is the verified-halal
  restaurant pin, per the halal-green reservation), the current leg (to-pickup vs to-dropoff),
  heading, and a prominent **ETA + `deadline_at` countdown**.
- **Live:** rider location + state stream over the existing **WebSocket** realtime channel;
  falls back to last-known + timestamp if the rider is offline. Redis-flush safe (position is
  ephemeral; last-known persists).
- **Expand:** the box opens to a larger map with full detail when clicked.

## Parties & contacts (all three)

Admin can see and **reach any party**:
- **Customer** — name, phone, delivery address, order history count.
- **Restaurant** — name, phone, address, **halal certification status** (cool-slate if expired,
  never red), current prep state.
- **Rider** — name, phone, vehicle, rating, current availability/leg.

Contact affordances (call / message). **Privacy:** admin PII access is **audited** (who viewed
which order's contacts, when); prefer proxy/click-to-call over raw numbers where the proxy
service exists. KYC docs are never shown here — this is operational contact, not identity review.

## The rest of the detail

- **Header:** order code, **state pill** (+ dispatch sub-state), placed-at, `deadline_at`
  countdown for the current non-terminal state.
- **Timeline:** every state transition with timestamps (placed → accepted → captured → assigned
  → picked up → delivered), plus dispatch waves/offers and any escalation (`NO_RIDER_FOUND`).
- **Items:** lines, modifiers, special instructions.
- **Money:** subtotal / delivery / service / tax / tip / total — all `*_cents`, decomposing to
  zero residual (the ledger view); **payment status** (authorised / captured / void).
- **Actions (tie to admin features):** contact party, cancel / refund (A-33 / A-35), reassign or
  re-dispatch rider, escalate. Every action audited.

## Backend

Extends the existing `getOrderAdmin` (already returns delivery_address, masked rider,
dispatch_state). Additionally needs: parties' contact fields, the full state-transition
timeline, money breakdown + payment status, and the **rider live-location stream** on the WS
channel. Money in `int64` cents throughout. No new writes to `order.state` from here (P-14 —
only the orders module transitions state; admin actions go through its API).
