# Restaurant Playbook: End-to-End Live Journey

This playbook walks an operator and an automation agent through a complete live order journey using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md).

---

## 1. Journey Initiation

1. **Setup command** (terminal):
   ```bash
   # Launch the journey scenario with manual restaurant participation
   cmd/devworld scenario journey --auto=none --speed=1x
   ```
2. **Browser action**:
   - Open `/orders` on the partner console.
   - Wait for the simulated customer checkout.
   - Note: If WebSocket realtime is connecting, the card arrives automatically; otherwise, press **Refresh**.
3. **Visible assertion**:
   - Order `#HG-…` appears with customer details and line items.
   - Countdown timer begins counting down from 180 seconds.

---

## 2. Kitchen Acceptance

1. **Browser action**:
   - Click **Accept** within 180 seconds.
2. **Visible assertion**:
   - Order status transitions to **Preparing**.
   - Terminal runner reports `restaurant accepted; dispatching rider`.

---

## 3. Preparation & Seal Binding

1. **Browser action**:
   - Enter tamper-evident seal code `SEAL-1001` in the **Package seal** field.
   - Click **Bind**.
2. **Visible assertion**:
   - Seal code is bound to the order with confirmation text.
   - Terminal runner notes `seal SEAL-1001 registered for pickup verification`.

---

## 4. Kitchen Ready

1. **Browser action**:
   - Click **Mark ready for pickup**.
2. **Visible assertion**:
   - Order status transitions to **Ready for pickup**.
   - Rider route simulation approaches the restaurant location.

---

## 5. Rider Handover & Completion

1. **Browser action**:
   - Keep `/orders` open (or press Refresh after simulated rider arrival).
2. **Visible assertion**:
   - Once the rider confirms pickup via seal verification, the order transitions to **Picked up** and leaves the kitchen queue.
   - The simulator completes delivery at the customer address and logs `DELIVERED`.
