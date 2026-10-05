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
   # Dispatch a new customer checkout to the active restaurant
   cmd/devworld scenario new-order --persona bismillah-grill
   ```
2. **Browser action**:
   - Open `/orders` as the active restaurant operator.
   - Note: If live socket updates are not connected in your environment, click **Refresh**.
3. **Visible assertion**:
   - A new order card appears displaying the order code (e.g. `#HG-…`), customer name, delivery destination, and ordered items.
   - A 180-second countdown timer is active (enforcing [Platform Invariant 4](../../spec/01-platform.md#non-negotiable-invariants) — non-terminal states have a deadline).
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
   - Click **Bind seal**.
3. **Visible assertion**:
   - A success confirmation displays `Sealed · SEAL-8821` with a tinted success badge (never solid green, per [Design Rule 10](../../../AGENTS.md#3-non-negotiable-invariants)).
   - The chain-of-custody seal is now bound on the server for rider pickup scan.

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
   cmd/devworld scenario new-order --persona bismillah-grill
   ```
2. **Browser action**:
   - Refresh `/orders` to display the incoming order.
   - Click **Reject**.
   - In the confirmation dialog, select a reason: `KITCHEN_AT_CAPACITY` or `ITEM_UNAVAILABLE`.
   - Click **Confirm rejection**.
3. **Visible assertion**:
   - The order disappears from the live queue.
   - Server immediately voids the customer's payment pre-authorisation without captured charges.
