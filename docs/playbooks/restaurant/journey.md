---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: End-to-End Live Journey

This playbook walks an operator and an automation agent through a complete live order journey using the [dev world simulator](../../superpowers/specs/2026-09-28-devworld-harness-design.md#63-journey). It describes today's behaviour: the queue does not update live yet, so some steps press **Refresh**.

Terminal commands run from `services/hg`. The browser is the restaurant console on `http://localhost:5183`.

---

## 0. Setup

1. **Setup command** (terminal, repository root):
   ```bash
   apps/restaurant/.claude/skills/run-restaurant/driver.sh --backend local up
   ```
   It starts the Go stack with `make up` if `http://localhost:8080/health/ready` does not answer, runs `make dev-reset`, then starts the console on `:5183` against it.
2. **Browser action**:
   - Open `http://localhost:5183/login` and sign in as `bismillah-grill@seed.hg` with password `Seed!2026`.
   - Open `/orders`.
3. **Visible assertion**:
   - **Live orders** is empty.

---

## 1. Journey Initiation

1. **Setup command** (terminal, leave it running):
   ```bash
   make dev-journey          # route=short speed=1x auto=none: the restaurant steps are yours
   ```
2. **Browser action**:
   - Press **Refresh**.
3. **Visible assertion**:
   - Terminal prints `placed  HG-XXXXXX  RESTAURANT_PENDING`, then `waiting  HG-XXXXXX  RESTAURANT_PENDING`.
   - A card `#HG-XXXXXX` appears with the same code. It shows `Amina R.`, `Toronto`, `1× Chicken Karahi  $18.99`, **You earn** `$18.99`, and **Reject** and **Accept** buttons.
   - The clock chip counts down from `3:00`.

---

## 2. Kitchen Acceptance

1. **Browser action**:
   - Click **Accept** before the clock runs out.
2. **Visible assertion**:
   - The card's chip reads **Preparing**, with a **Mark ready for pickup** button and a seal code field.
   - Terminal prints `waiting  HG-XXXXXX  PREPARING`.

---

## 3. Package Seal (refused in the dev world)

The dev world issues no physical seals, so every seal code is refused. The journey continues without one.

1. **Browser action**:
   - Type `SEAL-1001` in the seal code field and click **Seal**.
2. **Visible assertion**:
   - The field shows `No such seal code for this restaurant.` The card is **not** marked `Sealed ·`.

---

## 4. Kitchen Ready

1. **Browser action**:
   - Click **Mark ready for pickup**.
2. **Visible assertion**:
   - The card's chip reads **Ready for pickup**.
   - Terminal prints `waiting  HG-XXXXXX  READY_FOR_PICKUP`, then `rider left to a person  <order id>  READY_FOR_PICKUP`, and `make dev-journey` exits 0.

---

## 5. Rider Handover & Completion

1. **Setup command** (terminal):
   ```bash
   make dev-journey auto=all speed=4x   # reuses the ready order and drives rider-sim
   ```
2. **Visible assertion** (terminal):
   - `using  HG-XXXXXX  READY_FOR_PICKUP`, then `rider was not online before the order was ready; waiting for a later sweep`, then `offer …`, `assignment …`, `assignment  EN_ROUTE_TO_PICKUP`, `assignment  ARRIVED_AT_PICKUP`.
   - `seal refused  http 404  SEAL_NOT_FOUND` (no seal, as in step 3), then `assignment  PICKED_UP`.
   - `assignment  DELIVERED`. About two minutes later it prints `state  HG-XXXXXX  COMPLETED`, then `receipt  http 200`, `rating  http 200`, `restaurant  http 200  COMPLETED` and `refund  http 201 …`, and exits 0.
3. **Browser action**:
   - Press **Refresh**.
4. **Visible assertion**:
   - Today the card stays on **Live orders** with the chip `COMPLETED` and no buttons. The order list ignores its state filter ([#601](https://github.com/shaiknoorullah/hg-mono/issues/601)). Once that is fixed, the order leaves the queue at pickup.
