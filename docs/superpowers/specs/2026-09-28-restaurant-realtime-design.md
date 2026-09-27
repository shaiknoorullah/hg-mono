# Restaurant app — live updates and rider map

**Status:** design approved 2026-09-28 · **Kind:** product feature (`apps/restaurant`)
**Companion spec:** [`2026-09-28-devworld-harness-design.md`](2026-09-28-devworld-harness-design.md) — the dev/QA harness used for this feature's end-to-end acceptance.

## 1. Problem

The restaurant web app never updates by itself. The order queue neither polls nor listens: a new order appears only when the operator presses **Refresh** — on a screen whose whole job is to catch a 180-second acceptance window. Offers that expire or are withdrawn stay on screen; changes made on another tablet do not appear; nothing shows a rider approaching.

The backend already publishes everything needed (`contracts/websocket.md`): a single-use ticket (`POST /v1/realtime/ticket`), the `restaurant:{restaurant_id}` channel (offers, offer expired/withdrawn, accepted, rejected, status changed, payout updated) and `order:{order_id}` channels (state changes, dispatch assigned, ETA updates, coarse `rider.location`). No app consumes them today except the admin map's REST read.

Four smaller defects sit in the same code and are fixed here:

- the queue renders the same order more than once when the response repeats an ID;
- the shell's role label shows "CUSTOMER" (it reads a default, not the principal's restaurant role);
- Accept / Reject / Ready give no visible confirmation;
- an offer shown as Expired still offers Accept.

## 2. Goals and non-goals

**Goals**

1. New offers, expiries, withdrawals and state changes appear without Refresh.
2. The operator can see the assigned rider approach: name, vehicle, pickup ETA, arrival, and a coarse position on a small map.
3. The app stays correct when events are lost or Redis is flushed.
4. The four defects above are fixed.

**Non-goals**

- Customer, rider or admin realtime — each has its own issue.
- Any backend change. The contract already carries every event used here.
- Dev tooling. Seeding, scenarios and the journey simulator are the companion spec.

## 3. Connection

`RealtimeProvider`, mounted once per signed-in session in `apps/restaurant/src/lib/realtime.ts` (+ a `useRealtime()` hook):

1. `POST /v1/realtime/ticket` → open the socket with the single-use ticket.
2. Subscribe `restaurant:{restaurantId}`, plus `order:{id}` for each order currently rendered (subscribe on mount, unsubscribe on unmount).
3. On close: reconnect with capped exponential backoff and a **fresh** ticket (tickets are single-use; reuse writes a `realtime.ticket_reuse` audit event). After reconnecting, refetch everything on screen — events missed while disconnected are not replayed.
4. The sidebar's static "Live" label becomes a real indicator: **Live** / **Reconnecting…** / **Offline**. Per `02-components.md` (order card `stale` state): if the socket has been down more than 45 s, a banner above the queue says so and cards dim 10% — a stale queue must announce itself.

## 4. Events are signals; REST is truth

An event never patches local state from its payload. It invalidates and refetches the affected resource:

| Event | Refetch / effect |
|---|---|
| `restaurant.order_offered` | order queue; sound + highlight on the new card |
| `restaurant.order_offer_expired` / `_withdrawn` | order queue; toast with the reason |
| `restaurant.order_accepted` / `_rejected` | that order (fan-out from another tablet) |
| `order.state_changed`, `dispatch.assigned`, `order.eta_updated` | that order |
| `restaurant.status_changed` | availability (Hours page toggle) |
| `restaurant.payout_updated` | payouts |
| `rider.location` | the only payload rendered directly — the map circle's position (§5) |

Why: it keeps the app correct when Redis is flushed or events are dropped (the repo's disposable-Redis rule), and it follows the contract's rule that money, distance and ETA are never derived from event payloads.

Accessibility (`04-accessibility.md` §4): a live refetch never moves focus. New offers are announced politely through a live region; the sound is a second channel, never the only one.

## 5. Rider map

On orders with an assigned rider (READY_FOR_PICKUP and the approach to pickup), a small map shows the restaurant and the rider's **coarse** position, drawn as a ~100 m translucent circle rather than a pin: the restaurant's projection of `rider.location` is rounded to about 100 m, and a pin would claim precision it does not have.

Alongside the map: rider first name, vehicle, pickup ETA (from `order.eta_updated` / `dispatch.assigned`, never computed), and **Rider arrived** when that state arrives.

Engine and styles follow `apps/admin/src/components/LiveMapBox.tsx` (`mapbox-gl`, `VITE_MAPBOX_TOKEN`). Without a token the map renders its empty state and the text facts still show. Colours obey the halal colour rules: no solid green outside `color.halal.*`.

## 6. Defect fixes

- **Duplicates** — the queue dedupes by order ID before rendering. Defensive: the backend should never repeat an ID (the mock fixture that does is a separate bug), and a kitchen must never see one order twice.
- **Role label** — reads the principal's restaurant-scoped role (`RESTAURANT_OWNER` / `_MANAGER` / `_STAFF`).
- **Action feedback** — Accept / Reject / Ready show a toast and the card transitions to its new state.
- **Expired offers** — an offer past `expires_at` renders no Accept; Reject/Dismiss only.

## 7. Verification

1. **Vitest** (few, high-value): (a) `restaurant.order_offered` triggers a queue refetch; (b) a reconnect uses a fresh ticket and triggers a full refetch; (c) a response with a repeated ID renders one card.
2. **Development loop against the mock** — the mock plays scripted realtime sequences: `ws://localhost:4010/v1/ws?ticket=dev&scenario=<name>` with `realtime_order_happy_path`, `realtime_order_restaurant_rejects`, `realtime_order_timeout_no_rider`, `realtime_rider_reassigned` and `realtime_gap_and_resume` (the reconnect path). The feature can be built without the harness.
3. **End-to-end acceptance with the harness** — `make dev-scenario s=journey` against the real backend: the offer appears without Refresh, Accept confirms, the rider circle moves, "Rider arrived" shows, the order leaves the queue on pickup. Run in the user's Chrome via Claude in Chrome. When this lands, the harness playbook steps that say "press Refresh" are rewritten to "appears without Refresh".

## 8. Dependencies

- Builds and unit-tests independently of the harness (mock WebSocket playback, §7.2).
- End-to-end acceptance (§7.3) needs harness stage 3 (journey simulator).
- `HG_CORS_ALLOWED_ORIGINS` must include `http://localhost:5183`; the realtime ticket call is a normal REST call and is subject to it.
