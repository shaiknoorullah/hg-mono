---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: Order Handling

This playbook scripts the end-to-end order processing lifecycle for restaurant operators, covering arrival, timer constraints, acceptance, rejection, prep, and tamper-evident packaging seal binding.

---

## 1. Live Order Arrival & Alert

1. **Setup command** (terminal):
   ```bash
   # amina places an order at Bismillah Grill (the scenario has no persona flag)
   cd services/hg && make dev-scenario s=new-order
   ```
2. **Browser action**:
   - Open `/orders` signed in as `bismillah-grill@seed.hg` / `Seed!2026`.
   - Do not click anything: the queue updates by itself from the realtime socket, and every 7 seconds even when the socket is down. **Refresh** stays available as a manual option.
3. **Visible assertion**:
   - Without a click, within 7 seconds, a new order card appears displaying the order code (e.g. `#HG-…`), customer name, delivery destination, and ordered items.
   - A 180-second countdown timer is active (enforcing [Platform Invariant 4](../../../AGENTS.md#3-non-negotiable-invariants) — non-terminal states have a deadline).
   - An attention ring highlights newly arrived orders.

---

## 2. Order Acceptance

1. **Setup command**:
   - Ensure an order in `RESTAURANT_PENDING` is visible on the screen.
2. **Browser action**:
   - Click the **Accept** button on the order card.
3. **Visible assertion**:
   - The order card transitions from `RESTAURANT_PENDING` to the **Preparing** status chip.
   - The primary action changes to **Mark ready for pickup**.
   - Estimated pickup time is rendered based on average prep duration.

---

## 3. Tamper-Evident Package Seal Binding

1. **Setup command**:
   - Ensure the order is in `PREPARING` or `READY_FOR_PICKUP`.
2. **Browser action**:
   - Locate the **Package seal** entry row on the order card.
   - Type a pre-printed bag seal code (e.g. `SEAL-8821`).
   - Click **Seal**.
3. **Visible assertion**:
   - The dev world issues no physical seals, so the bind is refused, as in the [journey playbook](journey.md): the field shows `No such seal code for this restaurant.` and the card is **not** marked `Sealed ·`.
   - The order continues without a seal. With a seal issued to the restaurant, the card would show `Sealed · SEAL-8821` with a tinted success badge (never solid green, per [Design Rule 10](../../../AGENTS.md#3-non-negotiable-invariants)).

---

## 4. Mark Ready for Pickup

1. **Setup command**:
   - Ensure the kitchen has completed cooking and packing.
2. **Browser action**:
   - Click **Mark ready for pickup**.
3. **Visible assertion**:
   - The order status chip updates to **Ready for pickup**.
   - The card remains in the kitchen section until the assigned rider arrives and confirms handover.

---

## 5. Order Rejection (Capacity / Item Unavailable)

1. **Setup command**:
   ```bash
   # amina has one active order at a time: reset clears the order from steps 1-4
   cd services/hg && make dev-reset && make dev-scenario s=new-order
   ```
2. **Browser action**:
   - If the console signed you out after the reset, sign in again as `bismillah-grill@seed.hg` / `Seed!2026`.
   - Wait for the incoming order to appear on `/orders` by itself (at most 7 seconds).
   - Click **Reject**.
   - In the confirmation dialog, select a reason: `KITCHEN_AT_CAPACITY` or `ITEM_UNAVAILABLE`.
   - Click **Confirm rejection**.
3. **Visible assertion**:
   - The order disappears from the live queue.
   - Server immediately voids the customer's payment pre-authorisation without captured charges.
