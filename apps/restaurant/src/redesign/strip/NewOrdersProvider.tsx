/**
 * The new orders waiting for an answer (RESTAURANT_PENDING), one copy per console shell
 * (manifest §3 WP3, spec specs/wp3-strip.md). The strip, the offer and decline panels, the
 * go-live gate and the rail badge all read this one store. This is the 180-second revenue
 * path: every rule here exists because getting it wrong loses an order or charges twice.
 *
 * Sources (spec §10):
 * - `listRestaurantOrders?state=RESTAURANT_PENDING` on load, every 10 s while the socket is
 *   not open, and on a `refetch` signal. The server ignores `state` (#601), so rows outside
 *   RESTAURANT_PENDING are dropped here too;
 * - realtime `restaurant:{id}`: `order_offered` (a tile at once, then `getRestaurantOrder`
 *   fills it), `order_offer_expired`, `order_offer_withdrawn`, `order_accepted`,
 *   `order_rejected`.
 *
 * Accept sends `{prep_eta_minutes}` only (never `accepted_note`) with an Idempotency-Key made
 * once per order and reused on every retry. Countdowns are `deadline_at` minus `serverNow()`.
 * One order alert loop rings while any order is waiting, once the go-live gate's gesture
 * has armed it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HgApiError, idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { eventOfType, usePolling, useRealtimeChannel, useRealtimeStatus, type ChannelSignal } from '@hg/ui-web/live';
import { useOrderAlert, usePageAnnouncer, useToast } from '../ds';
import { client } from '../data/client';
import { call } from '../data/call';
import { serverNow } from '../data/serverClock';
import { useConsole } from '../data/console';
import { useAvailability } from '../data/availability';
import { errorCode } from '../data/useServerResource';
import { formatTime } from '../format/time';
import { publishWaitingCount } from '../shell/waiting';
import { DEFAULT_PREP_MINUTES, PREP_MAX, PREP_MIN, reasonLabel, type Outcome } from './copy';
import { OfferAnnouncer, newOrdersMessage } from './announcements';
import { chimeUrl } from './chime';
import { useHeartbeat } from '../data/heartbeat';

export type OrderView = Schema['OrderRestaurantView'];

export type OfferPhase = 'live' | 'accepting' | 'accept-failed' | 'unavailable' | 'ended';

export interface Offer {
  id: string;
  code: string;
  /** Epoch ms of `deadline_at`. */
  deadlineAt: number;
  /** The full restaurant view; null until `getRestaurantOrder` answers (Offer-loading). */
  order: OrderView | null;
  /** From the realtime frame, until the view arrives. */
  firstName: string | null;
  itemCount: number;
  prep: number;
  phase: OfferPhase;
  outcome: Outcome | null;
  endedAt: number | null;
  /** The server's message for RESTAURANT_UNAVAILABLE. */
  failure: string | null;
  /** One key per accept intent, reused on every retry. */
  acceptKey: string | null;
  /** The accept was sent while the live connection was coming back. */
  viaReconnect: boolean;
  addedAt: number;
}

export type GateState = 'pending' | 'denied' | 'passed';
export type SoundState = ReturnType<typeof useOrderAlert>['soundState'];

export interface OutOfStockItem {
  menuItemId: string;
  label: string;
}

export type RejectResult = { ok: true } | { ok: false; kind: 'too-late' | 'ended' | 'failed' };

export interface NewOrdersApi {
  status: 'loading' | 'ready' | 'error';
  /** Every offer in the strip (live and ended), soonest deadline first. */
  offers: Offer[];
  liveCount: number;
  get: (id: string | null) => Offer | null;
  connection: { reconnecting: boolean; offline: boolean; restDown: boolean };
  accept: (id: string) => void;
  setPrep: (id: string, minutes: number) => void;
  remove: (id: string) => void;
  reject: (id: string, body: Schema['OrderRejectInput'], key: string) => Promise<RejectResult>;
  /** Mark out of stock after a decline; resolves to the items that failed. */
  markOutOfStock: (items: readonly OutOfStockItem[]) => Promise<OutOfStockItem[]>;
  /** Open in the shell panel (`?panel=offer|decline&order=ID`). */
  open: (id: string, kind: 'offer' | 'decline') => void;
  /** Close the shell panel and return focus to the order's tile, else the "New orders" heading. */
  closePanel: (id: string | null) => void;
  /**
   * True only for an order this screen accepted: the one removal after which focus may move on
   * to the next live tile (spec §8). Every other removal sends focus to the heading (§5 rule 4).
   */
  acceptedHere: (id: string) => boolean;
  panel: { kind: 'offer' | 'decline'; orderId: string } | null;
  gate: GateState;
  goLive: () => Promise<void>;
  goLiveWithoutNotifications: () => void;
  checkNotificationsAgain: () => void;
  sound: { state: SoundState; rearm: () => void };
}

const NewOrdersContext = createContext<NewOrdersApi | null>(null);

export function useNewOrders(): NewOrdersApi {
  const ctx = useContext(NewOrdersContext);
  if (!ctx) throw new Error('useNewOrders must be used inside <NewOrdersProvider>');
  return ctx;
}

export const POLL_MS = 10_000;
const OUTCOME_LEAVES_MS = 60_000;
/** Grace after `deadline_at` before the strip calls an order timed out on its own. */
const EXPIRY_GRACE_MS = 1_000;
const LIVE_PHASES: readonly OfferPhase[] = ['live', 'accepting', 'accept-failed', 'unavailable'];

export function isLive(o: Offer): boolean {
  return LIVE_PHASES.includes(o.phase);
}

function itemsOf(order: OrderView): number {
  return order.lines.reduce((n, l) => n + l.quantity, 0);
}

function fromOrder(order: OrderView, prep = DEFAULT_PREP_MINUTES): Offer {
  return {
    id: order.id,
    code: order.code,
    deadlineAt: order.deadline_at ? Date.parse(order.deadline_at) : serverNow(),
    order,
    firstName: null,
    itemCount: itemsOf(order),
    prep,
    phase: 'live',
    outcome: null,
    endedAt: null,
    failure: null,
    acceptKey: null,
    viaReconnect: false,
    addedAt: Date.now(),
  };
}

/**
 * Focus the order's tile, else the strip's "New orders" heading. Only an accept from this
 * screen (`advance`) may land on the next live tile: anywhere else a stray A would accept an
 * order the user never moved to (spec §4 note, §5 rule 4, §8 focus placement).
 */
export function focusStripTarget(id: string | null, opts: { advance?: boolean } = {}, attempt = 0): void {
  // The strip leaves its compact row once the panel's URL change has rendered: wait for the
  // tiles to be back (a few frames at most) before choosing.
  const anyTile = document.querySelector<HTMLElement>('[data-offer-tile]');
  if (!anyTile && attempt < 10 && document.querySelector('#new-orders [data-compact]')) {
    window.setTimeout(() => focusStripTarget(id, opts, attempt + 1), 30);
    return;
  }
  const tile = id ? document.querySelector<HTMLElement>(`[data-offer-tile][data-offer-id="${id}"]`) : null;
  const next = opts.advance ? document.querySelector<HTMLElement>('[data-offer-tile][data-live="true"]') : null;
  const target = tile ?? next ?? document.querySelector<HTMLElement>('#new-orders h2');
  target?.focus();
}

export function NewOrdersProvider({ children }: { children: ReactNode }) {
  const { core, timezone } = useConsole();
  const { refresh: refreshAvailability } = useAvailability();
  const restaurantId = core.data?.restaurantId ?? null;
  const toast = useToast();
  const { announce } = usePageAnnouncer();
  const realtime = useRealtimeStatus();
  const [params, setParams] = useSearchParams();

  const offersRef = useRef<Record<string, Offer>>({});
  const [, setVersion] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [restDown, setRestDown] = useState(false);
  const finished = useRef(new Set<string>());
  const acceptedHere = useRef(new Set<string>());
  const declinedHere = useRef(new Set<string>());
  /**
   * Orders this screen sent an accept for whose outcome is not known (in flight, or the
   * response was lost). An `order_accepted` frame or a re-read that finds the order accepted
   * is then this screen's accept, never "accepted on another screen" and never a timeout.
   */
  const acceptUncertain = useRef(new Set<string>());
  /** `order_accepted` arrived while this screen's accept was still in flight. */
  const acceptFrameSeen = useRef(new Set<string>());
  /** Declines in flight from this screen; `order_rejected` for them is this screen's own. */
  const rejecting = useRef(new Set<string>());
  const rejectFrameSeen = useRef(new Set<string>());
  /** Accept-failed orders past their deadline being re-read before they are called timed out. */
  const expiring = useRef(new Set<string>());
  const announcer = useRef(new OfferAnnouncer());
  const hadOpen = useRef(false);

  const panelKind = params.get('panel');
  const panelOrder = params.get('order');
  const panel: NewOrdersApi['panel'] =
    (panelKind === 'offer' || panelKind === 'decline') && panelOrder ? { kind: panelKind, orderId: panelOrder } : null;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  // Set once `closePanel` is defined below; the ending paths above it close through this.
  const closePanelRef = useRef<(id: string | null, opts?: { advance?: boolean }) => void>(() => {});

  const commit = useCallback((next: Record<string, Offer>) => {
    offersRef.current = next;
    setVersion((v) => v + 1);
  }, []);
  const patch = useCallback(
    (id: string, change: Partial<Offer>) => {
      const cur = offersRef.current[id];
      if (!cur) return;
      commit({ ...offersRef.current, [id]: { ...cur, ...change } });
    },
    [commit],
  );
  const drop = useCallback(
    (id: string) => {
      if (!offersRef.current[id]) return;
      const next = { ...offersRef.current };
      delete next[id];
      finished.current.add(id);
      announcer.current.forget(id);
      commit(next);
    },
    [commit],
  );

  // ── connection ────────────────────────────────────────────────────────────────────────
  if (realtime === 'open') hadOpen.current = true;
  const reconnecting = hadOpen.current && (realtime === 'reconnecting' || realtime === 'connecting');
  const offline = hadOpen.current && realtime === 'offline';
  const connRef = useRef({ reconnecting, offline });
  connRef.current = { reconnecting, offline };

  // ── ending an order ───────────────────────────────────────────────────────────────────
  const end = useCallback(
    (id: string, outcome: Outcome) => {
      const o = offersRef.current[id];
      if (!o || o.phase === 'ended') return;
      patch(id, { phase: 'ended', outcome, endedAt: Date.now() });
      const openHere = panelRef.current?.orderId === id;
      // With its panel open, the panel's alert notice is the only speaker for that order.
      if (!openHere && (outcome === 'timed-out' || outcome === 'too-late')) announce(`${o.code} timed out. The customer was not charged.`, 'polite');
      if (outcome === 'timed-out' || outcome === 'too-late') void refreshAvailability();
    },
    [patch, announce, refreshAvailability],
  );

  const goneElsewhere = useCallback(
    (id: string, how: 'accepted' | 'declined', reasonCode?: string) => {
      const o = offersRef.current[id];
      if (!o) return;
      drop(id);
      if (panelRef.current?.orderId === id) closePanelRef.current(null);
      if (how === 'accepted') {
        toast.show({ variant: 'info', title: `${o.code} was accepted on another screen`, description: 'It’s in progress. Nothing else to do here.' });
        announce(`${o.code} was accepted on another screen.`, 'polite');
      } else {
        const label = reasonCode ? reasonLabel(reasonCode) : null;
        toast.show({
          variant: 'info',
          title: `${o.code} was declined on another screen`,
          description: `${label ? `Reason given: ${label}. ` : ''}The customer was not charged. It’s in History.`,
        });
        announce(`${o.code} was declined on another screen.`, 'polite');
      }
    },
    [drop, toast, announce],
  );

  /** This screen's accept went through (from its response, or a re-read after a lost one). */
  const confirmAccepted = useCallback(
    (id: string, order: OrderView | null) => {
      const o = offersRef.current[id];
      acceptedHere.current.add(id);
      acceptUncertain.current.delete(id);
      acceptFrameSeen.current.delete(id);
      if (!o) return;
      const wasOpen = panelRef.current?.orderId === id;
      drop(id);
      const ready = order?.promised_ready_at ? formatTime(order.promised_ready_at, timezone) : null;
      if (o.viaReconnect) {
        toast.show({ variant: 'success', title: `${o.code} accepted`, description: 'It’s in progress. The live connection is still coming back.' });
      } else {
        toast.show({
          variant: 'success',
          title: ready ? `${o.code} accepted · ready by ${ready}` : `${o.code} accepted`,
          description: 'It’s at the top of In progress.',
        });
      }
      announce(ready ? `${o.code} accepted, ready by ${ready}.` : `${o.code} accepted.`, 'polite');
      if (wasOpen) closePanelRef.current(null, { advance: true });
    },
    [drop, toast, announce, timezone],
  );

  /** The order left RESTAURANT_PENDING somewhere else: show what really happened. */
  const resolveFromOrder = useCallback(
    (order: OrderView) => {
      const o = offersRef.current[order.id];
      if (!o) return;
      switch (order.state) {
        case 'RESTAURANT_PENDING':
          patch(order.id, { order, deadlineAt: order.deadline_at ? Date.parse(order.deadline_at) : o.deadlineAt });
          return;
        case 'REJECTED':
          if (declinedHere.current.has(order.id) || rejecting.current.has(order.id)) drop(order.id);
          else goneElsewhere(order.id, 'declined');
          return;
        case 'CANCELLED':
          end(order.id, serverNow() >= o.deadlineAt ? 'timed-out' : 'withdrawn');
          return;
        case 'FAILED':
          end(order.id, 'withdrawn');
          return;
        default:
          if (acceptedHere.current.has(order.id)) drop(order.id);
          else if (acceptUncertain.current.has(order.id)) confirmAccepted(order.id, order);
          else goneElsewhere(order.id, 'accepted');
      }
    },
    [patch, drop, end, goneElsewhere, confirmAccepted],
  );

  /** The order as the server has it now; null when it can't be read. */
  const reread = useCallback(async (id: string): Promise<OrderView | null> => {
    try {
      return (await call(client.GET('/v1/restaurant/orders/{orderId}', { params: { path: { orderId: id } } }))) as unknown as OrderView;
    } catch {
      return null;
    }
  }, []);

  const resolve = useCallback(
    async (id: string) => {
      const order = await reread(id);
      if (order) resolveFromOrder(order);
      /* else: the next poll tries again */
    },
    [reread, resolveFromOrder],
  );

  /**
   * An accept-failed order reached its deadline on this clock. The lost response may have
   * been a success (the order is PREPARING and paid): re-read before calling it timed out.
   */
  const expireAfterCheck = useCallback(
    async (id: string) => {
      if (expiring.current.has(id)) return;
      expiring.current.add(id);
      try {
        const order = await reread(id);
        if (order && order.state !== 'RESTAURANT_PENDING') resolveFromOrder(order);
        else end(id, 'timed-out');
      } finally {
        expiring.current.delete(id);
      }
    },
    [reread, resolveFromOrder, end],
  );

  /** Fill a tile that came from the socket (earnings, name, area, note). */
  const fill = useCallback(
    async (id: string) => {
      try {
        const order = (await call(client.GET('/v1/restaurant/orders/{orderId}', { params: { path: { orderId: id } } }))) as unknown as OrderView;
        if (order.state === 'RESTAURANT_PENDING') {
          const o = offersRef.current[id];
          if (o) patch(id, { order, itemCount: itemsOf(order), deadlineAt: order.deadline_at ? Date.parse(order.deadline_at) : o.deadlineAt });
        } else resolveFromOrder(order);
      } catch {
        /* the tile keeps its frame data; Accept works before the rest arrives */
      }
    },
    [patch, resolveFromOrder],
  );

  const announceAdded = useCallback(
    (added: Offer[]) => {
      const now = serverNow();
      added.forEach((o) => announcer.current.seen({ ...o, live: true }, now));
      const msg = newOrdersMessage(
        added.map((o) => ({ code: o.code, items: o.itemCount, deadlineAt: o.deadlineAt })),
        now,
      );
      if (msg) announce(msg, 'polite');
    },
    [announce],
  );

  // ── the pending list ──────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    let rows: OrderView[];
    try {
      rows = (await call(client.GET('/v1/restaurant/orders', { params: { query: { state: ['RESTAURANT_PENDING'], limit: 50 } } }))) as unknown as OrderView[];
    } catch {
      setStatus((s) => (s === 'loading' ? 'error' : s));
      setRestDown(true);
      return;
    }
    setRestDown(false);
    setStatus('ready');
    // #601: the server ignores `state`; never show a row that is not waiting for an answer.
    const pending = rows.filter((r) => r.state === 'RESTAURANT_PENDING');
    const now = serverNow();
    const next = { ...offersRef.current };
    const added: Offer[] = [];
    for (const row of pending) {
      const cur = next[row.id];
      if (cur) {
        if (isLive(cur)) next[row.id] = { ...cur, order: row, itemCount: itemsOf(row), deadlineAt: row.deadline_at ? Date.parse(row.deadline_at) : cur.deadlineAt };
        continue;
      }
      if (finished.current.has(row.id)) continue;
      const offer = fromOrder(row);
      if (offer.deadlineAt <= now) continue; // already past its deadline: the server is ending it
      next[row.id] = offer;
      added.push(offer);
    }
    commit(next);
    if (added.length) announceAdded(added);
    // A waiting order the server no longer lists ended somewhere else: find out how.
    const listed = new Set(pending.map((r) => r.id));
    for (const o of Object.values(next)) {
      if ((o.phase === 'live' || o.phase === 'accept-failed' || o.phase === 'unavailable') && !listed.has(o.id) && o.addedAt < startedAt) {
        void resolve(o.id);
      }
    }
  }, [commit, announceAdded, resolve]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll whenever the socket is not open (and until the first load succeeds).
  usePolling(refresh, POLL_MS, realtime !== 'open' || status === 'error', { immediate: false });

  // The socket came (back): catch up on anything missed while it was down.
  const prevRealtime = useRef(realtime);
  useEffect(() => {
    if (realtime === 'open' && prevRealtime.current !== 'open' && status !== 'loading') void refresh();
    prevRealtime.current = realtime;
  }, [realtime, status, refresh]);

  // ── realtime ──────────────────────────────────────────────────────────────────────────
  const onSignal = (signal: ChannelSignal) => {
    if (signal.kind === 'refetch') {
      void refresh();
      return;
    }
    const offered = eventOfType(signal, 'restaurant.order_offered');
    if (offered) {
      const d = offered.data;
      if (offersRef.current[d.order_id] || finished.current.has(d.order_id)) return;
      const deadlineAt = Date.parse(d.deadline_at);
      const prep = Math.min(PREP_MAX, Math.max(PREP_MIN, d.prep_eta_suggestion_min || DEFAULT_PREP_MINUTES));
      const offer: Offer = {
        id: d.order_id,
        code: d.code,
        deadlineAt,
        order: null,
        firstName: d.customer_first_name || null,
        itemCount: d.lines.reduce((n, l) => n + l.qty, 0),
        prep,
        phase: 'live',
        outcome: null,
        endedAt: null,
        failure: null,
        acceptKey: null,
        viaReconnect: false,
        addedAt: Date.now(),
      };
      commit({ ...offersRef.current, [offer.id]: offer });
      announceAdded([offer]);
      void fill(offer.id);
      return;
    }
    const expired = eventOfType(signal, 'restaurant.order_offer_expired');
    if (expired) {
      end(expired.data.order_id, 'timed-out');
      return;
    }
    const withdrawn = eventOfType(signal, 'restaurant.order_offer_withdrawn');
    if (withdrawn) {
      end(withdrawn.data.order_id, withdrawn.data.reason === 'payment_failed' ? 'withdrawn-payment' : 'withdrawn');
      return;
    }
    const accepted = eventOfType(signal, 'restaurant.order_accepted');
    if (accepted) {
      const id = accepted.data.order_id;
      if (acceptedHere.current.has(id)) return;
      // In flight from this screen: the accept response decides, but remember the frame in
      // case that response is lost (the frame can arrive before it, or without it).
      if (offersRef.current[id]?.phase === 'accepting') {
        acceptFrameSeen.current.add(id);
        return;
      }
      // This screen's earlier accept had no answer: it went through after all.
      if (acceptUncertain.current.has(id)) {
        confirmAccepted(id, null);
        return;
      }
      goneElsewhere(id, 'accepted');
      return;
    }
    const rejected = eventOfType(signal, 'restaurant.order_rejected');
    if (rejected) {
      const id = rejected.data.order_id;
      if (declinedHere.current.has(id)) return;
      // Sent from this screen and still in flight: the frame can beat the response.
      if (rejecting.current.has(id)) {
        rejectFrameSeen.current.add(id);
        return;
      }
      goneElsewhere(id, 'declined', rejected.data.reason_code);
    }
  };
  useRealtimeChannel(restaurantId ? `restaurant:${restaurantId}` : null, onSignal);

  // ── the clock: local expiry, outcome tiles leaving, announcer thresholds ───────────────
  const anyOffers = Object.keys(offersRef.current).length > 0;
  const tickRef = useRef<() => void>(() => {});
  tickRef.current = () => {
    const now = serverNow();
    for (const o of Object.values(offersRef.current)) {
      if (o.phase === 'accept-failed' && now >= o.deadlineAt + EXPIRY_GRACE_MS) void expireAfterCheck(o.id);
      else if ((o.phase === 'live' || o.phase === 'unavailable') && now >= o.deadlineAt + EXPIRY_GRACE_MS) end(o.id, 'timed-out');
      else if (o.phase === 'ended' && o.outcome !== 'capture-failed' && o.endedAt !== null && Date.now() - o.endedAt >= OUTCOME_LEAVES_MS) {
        if (panelRef.current?.orderId !== o.id) drop(o.id);
      }
    }
    const said = announcer.current.tick(
      Object.values(offersRef.current).map((o) => ({ id: o.id, code: o.code, deadlineAt: o.deadlineAt, live: isLive(o) && o.phase !== 'accepting' })),
      now,
    );
    said.forEach((a) => announce(a.message, a.politeness));
  };
  useEffect(() => {
    if (!anyOffers) return;
    const id = window.setInterval(() => tickRef.current(), 1000);
    return () => window.clearInterval(id);
  }, [anyOffers]);

  // ── panels ────────────────────────────────────────────────────────────────────────────
  const open = useCallback(
    (id: string, kind: 'offer' | 'decline') => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('panel', kind);
          next.set('order', id);
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  const closePanel = useCallback(
    (id: string | null, opts: { advance?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('panel');
          next.delete('order');
          return next;
        },
        { replace: true },
      );
      window.setTimeout(() => focusStripTarget(id, opts), 0);
    },
    [setParams],
  );
  closePanelRef.current = closePanel;

  // ── accept ────────────────────────────────────────────────────────────────────────────
  const accept = useCallback(
    async (id: string) => {
      const o = offersRef.current[id];
      if (!o || (o.phase !== 'live' && o.phase !== 'accept-failed')) return;
      const key = o.acceptKey ?? idempotencyKey();
      const viaReconnect = connRef.current.reconnecting || connRef.current.offline;
      patch(id, { phase: 'accepting', acceptKey: key, viaReconnect });
      acceptUncertain.current.add(id);
      try {
        const order = (await call(
          client.POST('/v1/restaurant/orders/{orderId}/accept', {
            params: { path: { orderId: id }, header: { 'Idempotency-Key': key } },
            // The prep time only: never `accepted_note` (owner decision, no note with an acceptance).
            body: { prep_eta_minutes: o.prep },
          }),
        )) as unknown as OrderView;
        confirmAccepted(id, order);
      } catch (e) {
        const code = errorCode(e);
        if (code === 'OFFER_EXPIRED' || code === 'CAPTURE_FAILED' || code === 'RESTAURANT_UNAVAILABLE') {
          acceptUncertain.current.delete(id);
          acceptFrameSeen.current.delete(id);
        }
        if (code === 'OFFER_EXPIRED') end(id, 'too-late');
        else if (code === 'CAPTURE_FAILED') end(id, 'capture-failed');
        else if (code === 'RESTAURANT_UNAVAILABLE') {
          patch(id, { phase: 'unavailable', failure: isApiError(e) ? (e as HgApiError).message : null });
        } else {
          // ILLEGAL_TRANSITION, IDEMPOTENCY_KEY_REUSE, a network error, a 5xx, a timeout: the
          // accept may have gone through with its response lost. Read the order before saying
          // it failed; the tile keeps "Confirming" meanwhile.
          const now = await reread(id);
          if (now && now.state !== 'RESTAURANT_PENDING') resolveFromOrder(now);
          else if (!now && acceptFrameSeen.current.has(id)) confirmAccepted(id, null);
          // Still waiting. After ILLEGAL_TRANSITION the next press is a new intent (new key).
          else if (now && code === 'ILLEGAL_TRANSITION') patch(id, { phase: 'live', acceptKey: null, order: now });
          else if (now) patch(id, { phase: 'accept-failed', viaReconnect, order: now });
          else patch(id, { phase: 'accept-failed', viaReconnect });
        }
      }
    },
    [patch, end, reread, resolveFromOrder, confirmAccepted],
  );

  const setPrep = useCallback(
    (id: string, minutes: number) => patch(id, { prep: Math.min(PREP_MAX, Math.max(PREP_MIN, Math.round(minutes))) }),
    [patch],
  );

  // ── decline ───────────────────────────────────────────────────────────────────────────
  const reject = useCallback(
    async (id: string, body: Schema['OrderRejectInput'], key: string): Promise<RejectResult> => {
      const declined = (): RejectResult => {
        declinedHere.current.add(id);
        drop(id);
        return { ok: true };
      };
      rejecting.current.add(id);
      try {
        await call(client.POST('/v1/restaurant/orders/{orderId}/reject', { params: { path: { orderId: id }, header: { 'Idempotency-Key': key } }, body }));
        return declined();
      } catch (e) {
        const code = errorCode(e);
        if (code === 'OFFER_EXPIRED') {
          end(id, 'timed-out');
          return { ok: false, kind: 'too-late' };
        }
        // The decline may have gone through with its response lost: the frame, or a re-read,
        // says so before the form claims it failed.
        if (rejectFrameSeen.current.has(id)) return declined();
        const now = await reread(id);
        if (now?.state === 'REJECTED') return declined();
        if (now && now.state !== 'RESTAURANT_PENDING') {
          resolveFromOrder(now);
          return { ok: false, kind: 'ended' };
        }
        return { ok: false, kind: 'failed' };
      } finally {
        rejecting.current.delete(id);
        rejectFrameSeen.current.delete(id);
      }
    },
    [drop, end, reread, resolveFromOrder],
  );

  const markOutOfStock = useCallback(async (items: readonly OutOfStockItem[]) => {
    const failed: OutOfStockItem[] = [];
    for (const item of items) {
      try {
        await call(
          client.PUT('/v1/restaurant/menu/items/{itemId}/availability', {
            params: { path: { itemId: item.menuItemId } },
            // "Until closing" needs the next closing time, which no restaurant-side field gives
            // yet (spec §13 Q2, #312 `next_closing`): null (until changed) meanwhile.
            body: { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null },
          }),
        );
      } catch {
        failed.push(item);
      }
    }
    return failed;
  }, []);

  // ── sound and the go-live gate ────────────────────────────────────────────────────────
  const [gate, setGate] = useState<GateState>('pending');
  const [armAttempted, setArmAttempted] = useState(false);
  const all = Object.values(offersRef.current).sort((a, b) => a.deadlineAt - b.deadlineAt);
  const liveOffers = all.filter(isLive);
  const liveKey = liveOffers.map((o) => o.id).join(',');
  const notification = useMemo(
    () => ({ title: 'New order', body: `${liveOffers.length} waiting`, tag: 'hg-new-order' }),
    [liveOffers.length],
  );
  const alert = useOrderAlert({
    active: armAttempted && liveOffers.length > 0,
    alertKey: liveKey || 'none',
    soundUrl: chimeUrl(),
    repeatMs: 4000,
    notification,
  });
  const { arm, requestNotificationPermission } = alert;
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl) wakeLock.current = await wl.request('screen');
    } catch {
      /* not allowed here: the gate copy already asks to keep the screen on */
    }
  }, []);
  useEffect(() => {
    if (gate !== 'passed') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [gate, requestWakeLock]);
  useEffect(() => () => void wakeLock.current?.release().catch(() => {}), []);

  const goLive = useCallback(async () => {
    // All three start inside the click (the gesture browsers require for audio).
    try {
      const chime = typeof Audio === 'undefined' ? null : new Audio(chimeUrl());
      const played = chime?.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch {
      /* the armed loop reports a blocked context */
    }
    const permission = requestNotificationPermission().catch(() => 'unsupported' as const);
    // The loop starts only once arming has settled: a loop play() racing arm()'s
    // play-then-pause would be aborted and read as "blocked".
    const armed = arm().finally(() => setArmAttempted(true));
    void requestWakeLock();
    const [perm] = await Promise.all([permission, armed]);
    setGate(perm === 'denied' ? 'denied' : 'passed');
  }, [arm, requestNotificationPermission, requestWakeLock]);

  const goLiveWithoutNotifications = useCallback(() => setGate('passed'), []);
  const checkNotificationsAgain = useCallback(() => {
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    if (perm !== 'denied') setGate('passed');
  }, []);
  // "Turn sound back on" is a gesture too: once it arms the sound on a page without the gate,
  // this screen rings, so it counts as live (and starts the heartbeat).
  const rearm = useCallback(() => {
    void arm()
      .then((ok) => {
        if (ok) setGate((g) => (g === 'pending' ? 'passed' : g));
      })
      .finally(() => setArmAttempted(true));
  }, [arm]);

  // The heartbeat keeps the restaurant ONLINE (offered orders), so it starts only once this
  // screen can ring: after the go-live gate's gesture (manifest §2 "Go-live gate"). A screen
  // left on the gate sends none, and the server stops offering orders it would never show.
  useHeartbeat(gate === 'passed');

  useEffect(() => {
    publishWaitingCount(liveOffers.length);
  }, [liveOffers.length]);
  useEffect(() => () => publishWaitingCount(0), []);

  const remove = useCallback(
    (id: string) => {
      drop(id);
      window.setTimeout(() => focusStripTarget(null), 0);
    },
    [drop],
  );

  const api: NewOrdersApi = {
    status,
    offers: all,
    liveCount: liveOffers.length,
    get: (id) => (id ? (offersRef.current[id] ?? null) : null),
    connection: { reconnecting, offline, restDown: restDown && realtime !== 'open' && hadOpen.current },
    accept: (id) => void accept(id),
    setPrep,
    remove,
    reject,
    markOutOfStock,
    open,
    closePanel,
    acceptedHere: (id) => acceptedHere.current.has(id),
    panel,
    gate,
    goLive,
    goLiveWithoutNotifications,
    checkNotificationsAgain,
    sound: { state: alert.soundState, rearm },
  };

  return <NewOrdersContext.Provider value={api}>{children}</NewOrdersContext.Provider>;
}

/** For tests and galleries: the raw context. */
export const NewOrdersContextForTests = NewOrdersContext;
