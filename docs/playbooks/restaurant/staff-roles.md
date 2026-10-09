---
covers: []
reviewed: 2026-10-09
---

# Restaurant Playbook: Staff Roles & Financial Privacy

This playbook tests role-based permission boundaries across Owner, Manager, and Staff roles, verifying that financial and administrative endpoints are strictly partitioned.

---

## 1. Owner Role: Full Operational and Financial Access

1. **Setup command** (terminal, from `services/hg`):
   ```bash
   make dev-reset
   ```
   Every login below uses the password `Seed!2026` and no authenticator code.
2. **Browser action**:
   - Sign in as the restaurant owner (`bismillah-grill@seed.hg`).
   - Navigate to `/payouts`.
3. **Visible assertion**:
   - Header **Payouts** is visible with weekly settlement details.
   - Payout history table lists completed, transferred, or pending weekly settlements.
4. **Browser action**:
   - Navigate to `/staff`.
5. **Visible assertion**:
   - Staff member list is displayed with role assignment controls and an "Invite staff" action.

---

## 2. Manager Role: Operations Permitted, Payouts Restricted

1. **Browser action**:
   - Sign in as the manager (`bismillah-manager@seed.hg`).
   - Verify ability to view `/orders`, update `/menu`, and edit `/hours`.
   - Navigate to `/payouts`.
2. **Visible assertion**:
   - The payouts table is **not shown**.
   - Screen displays the financial privacy state:
     > **Payouts are visible to the account owner**
     > "Your role (manager) can run the kitchen, but weekly payout history is restricted to the restaurant's owner account for financial-privacy reasons."
   - Demonstrates that permission enforcement is a clear informational boundary, not an unhandled error.

---

## 3. Staff Role: Kitchen Operations Only

1. **Browser action**:
   - Sign in as kitchen staff (`bismillah-staff@seed.hg`).
   - Navigate to `/orders`.
2. **Visible assertion**:
   - Live orders are visible with Accept and Ready controls.
   - Administrative settings (`/staff`, `/payouts`) are hidden from navigation and direct URL visits are blocked with appropriate permissions feedback.
