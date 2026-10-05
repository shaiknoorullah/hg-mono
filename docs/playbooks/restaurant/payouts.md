---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: Weekly Payouts & Balance

This playbook tests the partner payouts interface, verifying weekly cadence, financial privacy, and status indicators.

---

## 1. Payout Cadence and Schedule Display

1. **Browser action**:
   - Sign in as the restaurant owner.
   - Open `/payouts`.
2. **Visible assertion**:
   - Header displays **Payouts**.
   - Subtitle reads: `Weekly, every Monday, automatic — no minimum balance required.` (confirming [Platform Rule P-19](../../spec/01-platform.md#p-19--stripe-connect-onboarding-and-payouts-canada)).
   - Action button **Refresh** is present.

---

## 2. Empty State Handling

1. **Setup command** (terminal):
   ```bash
   # Persona with no settlement history yet
   cmd/devworld totp payout-todo
   ```
2. **Browser action**:
   - Sign in as a newly approved partner without completed settlement cycles.
   - Open `/payouts`.
3. **Visible assertion**:
   - Empty state illustration with title **No payouts yet**.
   - Description explains: `Your first weekly payout appears here once you've completed orders in a settlement window.`

---

## 3. Payout Settlement History & Status Tones

1. **Browser action**:
   - Sign in as `owner@restaurant.ca` (established partner with order history).
   - Open `/payouts`.
2. **Visible assertion**:
   - Settlement table renders columns: **Period**, **Orders**, **Amount**, and **Status**.
   - Completed disbursements render with `Transferred` or `Paid` status chips using the neutral/accent tone.
   - Any held funds render with a `Held` status chip in the warning tone.
   - In accordance with [Design Invariant 10](../../../AGENTS.md#3-non-negotiable-invariants), no payout state chip renders solid halal green (green is reserved strictly for halal certification claims).
