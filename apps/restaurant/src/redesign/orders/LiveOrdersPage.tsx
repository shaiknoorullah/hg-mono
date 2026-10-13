/**
 * Live orders (`/orders`; LO `Main`, `Board-detail-open`, `Board-quiet`, `Board-empty`,
 * `Board-loading`, `Board-first-load-error`, `Board-error-stale`, `Board-refreshed`,
 * `Board-other-screen`, and the in-progress states; wp4 spec §1, §2, §4, §5).
 *
 * The page body under the shell's status bar and strip: the In progress list and the order
 * detail panel (`?order={id}`). The go-live gate (WP3) wraps this page; the strip (WP3) owns
 * the pending offers.
 *
 * - #601: the server ignores `state` on `listRestaurantOrders`. The request always carries the
 *   filter AND the rows are guarded on the client (`guardLiveRows`).
 * - Live-only facts (rider here, cancel reasons, notes, "marked on another screen") come only
 *   from realtime events; a refresh shows what the REST view says (`Board-refreshed`).
 * - Mark ready sends one Idempotency-Key per order-ready intent and reuses it on every retry.
 * - The socket is an optimisation: REST polls every 15 s whenever it is not live (60 s when it is).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { idempotencyKey } from '@hg/api-client';
import { eventOfType, useRealtimeChannels, usePolling, type ChannelSignal } from '@hg/ui-web/live';
import { Badge, Button, DataTable, EmptyState, ErrorState, useToast, usePageAnnouncer } from '../ds';
import { useConsole } from '../data/console';
import { client } from '../data/client';
import { call } from '../data/call';
import { useConnection } from '../data/connection';
import { serverNow } from '../data/serverClock';
import { errorStatus, useServerResource } from '../data/useServerResource';
import { usePagePanelOpen } from '../shell/layout';
import { publishFirstLoadFailed, publishStale } from '../shell/stale';
import { onAcceptedHere, wasAcceptedHere } from './acceptedHere';
import { OrderDetail } from './OrderDetail';
import {
  LIVE_STATES,
  countRows,
  guardLiveRows,
  itemsSummary,
  readyByText,
  riderText,
  rowStatus,
  sortRows,
  type LiveFacts,
  type MarkPhase,
  type Order,
} from './model';

type Column = Parameters<typeof DataTable<Order>>[0]['columns'][number];

/** `listRestaurantOrders` with the live-state filter (#601: sent AND guarded). */
export async function loadLiveOrders(): Promise<Order[]> {
  const rows = (await call(
    client.GET('/v1/restaurant/orders', {
      params: { query: { state: [...LIVE_STATES], limit: 100 } },
      // The contract declares `style: form, explode: false`: state=PREPARING,READY_FOR_PICKUP,…
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  )) as unknown as Order[];
  return guardLiveRows(rows);
}

async function loadOrder(id: string): Promise<Order> {
  return (await call(client.GET('/v1/restaurant/orders/{orderId}', { params: { path: { orderId: id } } }))) as unknown as Order;
}

async function markReadyCall(id: string, key: string): Promise<Order> {
  return (await call(
    client.POST('/v1/restaurant/orders/{orderId}/ready', { params: { path: { orderId: id }, header: { 'Idempotency-Key': key } } }),
  )) as unknown as Order;
}

/** How long a just-accepted order stays pinned at the top if no refresh comes first. */
const JUST_ACCEPTED_MS = 60_000;

type WidthMode = 'full' | 'mid' | 'narrow';

/** Column set by the list's own width (§1.1): full ≥ 1260, mid ≥ 880, narrow below. */
function useWidthMode(): [React.RefObject<HTMLElement | null>, WidthMode] {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Unmeasured (0) reads as full: every column, nothing hidden.
  const mode: WidthMode = width === 0 || width >= 1260 ? 'full' : width >= 880 ? 'mid' : 'narrow';
  return [ref, mode];
}

/** Buttons in a cell keep Enter / Space to themselves (the grid would open the row instead). */
const keepKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

export function LiveOrdersPage() {
  const { core, timezone } = useConsole();
  const restaurantId = core.data?.restaurantId ?? null;
  const connection = useConnection();
  const { announce } = usePageAnnouncer();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const openId = params.get('order');
  usePagePanelOpen(Boolean(openId));

  const list = useServerResource(loadLiveOrders);
  const { mutate: mutateList, refresh: refreshList, reload: reloadList } = list;
  const [facts, setFacts] = useState<Record<string, LiveFacts>>({});
  const [cancelled, setCancelled] = useState<Record<string, Order>>({});
  const [marks, setMarks] = useState<Record<string, MarkPhase>>({});
  const [panelToken, setPanelToken] = useState(0);
  const keys = useRef(new Map<string, string>());
  const readyHere = useRef(new Set<string>());
  const [now, setNow] = useState(() => serverNow());
  const [listRef, widthMode] = useWidthMode();

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ── Rows: guarded server rows + cancelled rows kept from live events until removed ──────
  const rows = useMemo(() => {
    const server = (list.data ?? []).filter((o) => !cancelled[o.id]);
    return [...server, ...Object.values(cancelled)];
  }, [list.data, cancelled]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const codeOf = (id: string) => rowsRef.current.find((o) => o.id === id)?.code ?? null;

  const statusOf = useCallback((o: Order) => rowStatus(o, facts[o.id], marks[o.id] ?? null, now), [facts, marks, now]);
  const sorted = useMemo(() => sortRows(rows, statusOf), [rows, statusOf]);
  const counts = countRows(rows, (o) => facts[o.id] ?? {});

  // ── Stale: refresh failed, last good rows kept (Board-error-stale) ──────────────────────
  const lastOk = useRef<number | null>(null);
  if (list.status === 'ready') lastOk.current = Date.now();
  useEffect(() => {
    publishStale('orders', list.status === 'stale' && lastOk.current ? { lastOkAt: lastOk.current, retry: () => void refreshList() } : null);
  }, [list.status, refreshList]);
  useEffect(() => publishFirstLoadFailed('orders', list.status === 'error'), [list.status]);
  useEffect(
    () => () => {
      publishStale('orders', null);
      publishFirstLoadFailed('orders', false);
    },
    [],
  );

  // ── Polling: always on; faster whenever the socket is not live ───────────────────────────
  usePolling(() => refreshList(), connection.kind === 'live' ? 60_000 : 15_000, list.status !== 'loading' && list.status !== 'error', { immediate: false });

  const setFact = useCallback((id: string, patch: Partial<LiveFacts>) => setFacts((f) => ({ ...f, [id]: { ...f[id], ...patch } })), []);
  const patchRow = useCallback(
    (id: string, fn: (o: Order) => Order) => mutateList((prev) => (prev ? prev.map((o) => (o.id === id ? fn(o) : o)) : prev)),
    [mutateList],
  );

  // A just-accepted order from the strip (WP3) goes to the top with "Just accepted", then sorts
  // normally (§1.2): the fact clears on the next server refresh of the list, when the kitchen
  // marks it ready, or after JUST_ACCEPTED_MS, whichever comes first.
  const clearJustAccepted = useCallback(
    (id?: string) =>
      setFacts((f) => {
        let changed = false;
        const next: Record<string, LiveFacts> = {};
        for (const [k, v] of Object.entries(f)) {
          if (v.justAccepted && (id === undefined || id === k)) {
            next[k] = { ...v, justAccepted: false };
            changed = true;
          } else next[k] = v;
        }
        return changed ? next : f;
      }),
    [],
  );
  useEffect(() => {
    const timers = new Set<number>();
    const off = onAcceptedHere((order) => {
      mutateList((prev) => [order, ...(prev ?? []).filter((o) => o.id !== order.id)]);
      setFact(order.id, { justAccepted: true });
      const t = window.setTimeout(() => {
        timers.delete(t);
        clearJustAccepted(order.id);
      }, JUST_ACCEPTED_MS);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [mutateList, setFact, clearJustAccepted]);
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !list.refreshing && list.status === 'ready') clearJustAccepted();
    wasRefreshing.current = list.refreshing;
  }, [list.refreshing, list.status, clearJustAccepted]);

  // ── Realtime ─────────────────────────────────────────────────────────────────────────────
  const channels = useMemo(
    () => [...(restaurantId ? [`restaurant:${restaurantId}`] : []), ...rows.map((o) => `order:${o.id}`)],
    [restaurantId, rows],
  );

  const onSignal = (signal: ChannelSignal) => {
    if (signal.kind === 'refetch') {
      void refreshList();
      return;
    }
    const accepted = eventOfType(signal, 'restaurant.order_accepted');
    if (accepted) {
      if (!wasAcceptedHere(accepted.data.order_id)) {
        setFact(accepted.data.order_id, { acceptedElsewhere: true });
        void refreshList();
      }
      return;
    }
    const changed = eventOfType(signal, 'order.state_changed');
    if (changed) {
      const { order_id: id, to, at } = changed.data;
      const code = codeOf(id);
      if (to === 'DELIVERED' || to === 'COMPLETED' || to === 'RESOLVED' || to === 'REJECTED') {
        mutateList((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
        return;
      }
      if (to === 'CANCELLED') return; // order.cancelled carries the reason
      patchRow(id, (o) => ({ ...o, state: to, deadline_at: changed.data.deadline_at, ready_at: to === 'READY_FOR_PICKUP' ? (o.ready_at ?? at) : o.ready_at }));
      if (to === 'READY_FOR_PICKUP' && !readyHere.current.has(id)) {
        setFact(id, { markedElsewhere: true });
        if (code) toast.show({ variant: 'info', title: `${code} was marked ready on another screen`, description: 'It moved to Ready. Nothing to do here.' });
      } else if (to === 'PICKED_UP') {
        setFact(id, { riderPhase: 'carrying' });
        const rider = rowsRef.current.find((o) => o.id === id)?.rider?.display_name;
        if (code) toast.show({ variant: 'success', title: `${code} picked up`, description: `${rider ?? 'The rider'} entered the pickup code. It’s out for delivery.` });
      } else if (to === 'ARRIVED') {
        setFact(id, { riderPhase: 'at_customer' });
      } else if (to === 'DISPUTED') {
        if (code) toast.show({ variant: 'info', title: `${code} moved to support: a delivery problem`, description: 'It’s in History under Disputed.' });
      }
      setPanelToken((t) => t + 1);
      return;
    }
    const cancel = eventOfType(signal, 'order.cancelled');
    if (cancel) {
      const id = cancel.data.order_id;
      const row = rowsRef.current.find((o) => o.id === id);
      if (!row) return;
      setFact(id, { cancelled: { reasonCode: cancel.data.reason_code ?? null, afterReady: row.state === 'READY_FOR_PICKUP', fromEvent: true } });
      setCancelled((c) => ({ ...c, [id]: row }));
      return;
    }
    const adjusted = eventOfType(signal, 'order.items_adjusted');
    if (adjusted) {
      setFact(adjusted.data.order_id, { removedLines: adjusted.data.removed });
      void refreshList();
      setPanelToken((t) => t + 1);
      return;
    }
    const note = eventOfType(signal, 'order.note_added');
    if (note) {
      const id = note.data.order_id;
      setFacts((f) => ({ ...f, [id]: { ...f[id], notes: [...(f[id]?.notes ?? []), { author_kind: note.data.author_kind, text: note.data.text, at: note.data.at }] } }));
      const code = codeOf(id);
      if (code) announce(note.data.author_kind === 'RIDER' ? `Note from the rider on ${code}.` : `Note from support on ${code}.`, 'polite');
      return;
    }
    const eta = eventOfType(signal, 'order.eta_updated');
    if (eta) {
      const id = eta.data.order_id;
      const was = rowsRef.current.find((o) => o.id === id)?.rider?.eta_at ?? null;
      if (eta.data.pickup_eta_at) {
        setFact(id, { etaWas: was, etaUpdatedAt: new Date(serverNow()).toISOString() });
        patchRow(id, (o) => (o.rider ? { ...o, rider: { ...o.rider, eta_at: eta.data.pickup_eta_at } } : o));
      }
      return;
    }
    const dispatch = eventOfType(signal, 'dispatch.state_changed');
    if (dispatch) {
      const { order_id: id, to, at } = dispatch.data;
      if (to === 'AT_RESTAURANT') {
        setFact(id, { riderPhase: 'here', riderHereSince: at, unassigned: false, noRider: false });
        const code = codeOf(id);
        if (code) announce(`Rider here for ${code}.`, 'polite');
      } else if (to === 'CARRYING') setFact(id, { riderPhase: 'carrying' });
      else if (to === 'AT_CUSTOMER') setFact(id, { riderPhase: 'at_customer' });
      else if (to === 'NO_RIDER_FOUND') setFact(id, { noRider: true, riderPhase: undefined });
      else if (to === 'UNASSIGNED') setFact(id, { unassigned: true, riderPhase: undefined });
      return;
    }
    const unassigned = eventOfType(signal, 'dispatch.unassigned');
    if (unassigned) {
      setFact(unassigned.data.order_id, { unassigned: true, riderPhase: undefined });
      patchRow(unassigned.data.order_id, (o) => ({ ...o, rider: null }));
      return;
    }
    const assigned = eventOfType(signal, 'dispatch.assigned');
    if (assigned) {
      setFact(assigned.data.order_id, { unassigned: false, noRider: false });
      void refreshList();
    }
  };
  useRealtimeChannels(channels, onSignal);

  // ── Mark ready (Idempotency-Key reused on retry) ─────────────────────────────────────────
  const markReady = useCallback(
    async (order: Order) => {
      const id = order.id;
      const key = keys.current.get(id) ?? idempotencyKey();
      keys.current.set(id, key);
      readyHere.current.add(id);
      clearJustAccepted(id);
      setMarks((m) => ({ ...m, [id]: 'sending' }));
      try {
        const next = await markReadyCall(id, key);
        keys.current.delete(id);
        setMarks(({ [id]: _, ...rest }) => rest);
        patchRow(id, () => next);
        setPanelToken((t) => t + 1);
      } catch (e) {
        if (errorStatus(e) === 409) {
          // Server refused (ILLEGAL_TRANSITION): the order moved on. Refetch; this intent is over.
          keys.current.delete(id);
          readyHere.current.delete(id);
          setMarks((m) => ({ ...m, [id]: 'refused' }));
          await refreshList();
          setMarks(({ [id]: _, ...rest }) => rest);
          setPanelToken((t) => t + 1);
        } else {
          setMarks((m) => ({ ...m, [id]: 'failed' }));
        }
      }
    },
    [patchRow, refreshList, clearJustAccepted],
  );

  // ── Panel ────────────────────────────────────────────────────────────────────────────────
  const openOrder = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('order', id);
    setParams(next);
  };
  const closePanel = () => {
    const id = openId;
    const next = new URLSearchParams(params);
    next.delete('order');
    next.delete('timeline');
    setParams(next);
    // Focus back to the source row (only a row on screen: `?order=` is user-editable text).
    if (id && rowsRef.current.some((o) => o.id === id)) {
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-order-open]`)?.focus(), 0);
    }
  };
  const removeRow = (id: string) => {
    setCancelled(({ [id]: _, ...rest }) => rest);
    setFacts(({ [id]: _, ...rest }) => rest);
    mutateList((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    if (openId === id) closePanel();
  };

  // ── Columns ──────────────────────────────────────────────────────────────────────────────
  const narrow = widthMode === 'narrow';
  const columns: Column[] = [
    {
      key: 'order',
      header: 'Order',
      width: '120px',
      textValue: (o) => o.code,
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-order-open=""
            onClick={() => openOrder(o.id)}
            className="hg-focus min-h-11 rounded font-mono text-[17px] font-semibold underline-offset-2 hover:underline"
          >
            {o.code}
          </button>
          {openId === o.id ? <Badge size="sm" variant="brand" label="Open" /> : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '230px',
      cell: (o) => {
        const s = statusOf(o);
        return <Badge size="md" variant={s.badge.variant} icon={s.badge.icon} label={s.badge.label} />;
      },
    },
    { key: 'ready', header: 'Ready by', width: '160px', contentClass: 'numeric', align: 'start', cell: (o) => readyByText(o, now, timezone) },
  ];
  if (!narrow) {
    columns.push({
      key: 'items',
      header: 'Items',
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{itemsSummary(o)}</span>
          {o.special_instructions ? <Badge size="sm" variant="warning" label="Customer note" /> : null}
        </span>
      ),
    });
  }
  if (widthMode === 'full') {
    columns.push(
      { key: 'customer', header: 'Customer', width: '130px', cell: (o) => o.customer.display_name },
      { key: 'rider', header: 'Rider', width: '250px', cell: (o) => <span className="text-fg-secondary">{riderText(o, facts[o.id], timezone)}</span> },
    );
  }
  if (!narrow) {
    columns.push({
      key: 'action',
      header: 'Action',
      width: '160px',
      align: 'end',
      contentClass: 'actions',
      cell: (o) => <span onKeyDown={keepKeys}>{actionCell(o)}</span>,
    });
  }

  function actionCell(o: Order): ReactNode {
    const s = statusOf(o);
    switch (s.action) {
      case 'mark-ready':
        return (
          <Button variant="tertiary" size="md" loading={marks[o.id] === 'sending'} accessibilityLabel={`Mark order ${o.code} ready`} onPress={() => void markReady(o)}>
            Mark ready
          </Button>
        );
      case 'try-again':
        return (
          <Button variant="tertiary" size="md" accessibilityLabel={`Try marking order ${o.code} ready again`} onPress={() => void markReady(o)}>
            Try again
          </Button>
        );
      case 'refreshing':
        return <span className="text-fg-secondary">List refreshing</span>;
      case 'waiting':
        return <span className="text-fg-secondary">Waiting for pickup</span>;
      case 'read-the-code':
        return <strong>Read the pickup code to the rider</strong>;
      case 'remove':
        return (
          <Button variant="ghost" size="md" accessibilityLabel={`Remove order ${o.code} from the list`} onPress={() => removeRow(o.id)}>
            Remove
          </Button>
        );
      default:
        return <span className="text-fg-secondary">Read only</span>;
    }
  }

  // ── Panel data: its own read, with the list's fresher state merged in ────────────────────
  const openRow = openId ? (rows.find((o) => o.id === openId) ?? null) : null;

  if (list.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <div className="w-full max-w-[520px] rounded-xl border border-line-decorative bg-surface-raised p-6">
          <ErrorState
            variant="inline"
            headingLevel={2}
            title="We couldn’t load your orders"
            description="Nothing is lost: your orders are safe on the server. New orders can’t ring on this screen until it loads. Check the connection, then try again."
            onRetry={reloadList}
            retryLabel="Try again"
            testId="orders-first-load-error"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3" data-testid="live-orders">
      <section
        ref={listRef as React.RefObject<HTMLElement>}
        aria-labelledby="list-title"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised"
      >
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-decorative px-4 py-3">
          <h2 id="list-title" className="text-[20px] font-semibold">
            In progress
          </h2>
          {list.status !== 'loading' ? (
            <span className="text-[15px] tabular-nums text-fg-secondary" data-testid="in-progress-counts">
              Preparing {counts.preparing} · Ready {counts.ready} · Out for delivery {counts.out}
            </span>
          ) : null}
          <span className="flex-1" />
          {!narrow ? <span className="text-[13px] text-fg-secondary">Ready first, then soonest ready time</span> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DataTable<Order>
            caption="Orders in progress"
            columns={columns}
            rows={sorted}
            getRowId={(o) => o.id}
            getRowLabel={(o) => `order ${o.code}`}
            onRowActivate={(o) => openOrder(o.id)}
            density="comfortable"
            stickyHeader
            loading={list.status === 'loading'}
            className="rounded-none border-0"
            emptyState={
              <EmptyState
                variant="table"
                headingLevel={3}
                title="Nothing in progress"
                description="Orders you accept appear here, soonest ready time first. Ready orders stay until the rider picks them up."
                testId="in-progress-empty"
              />
            }
            testId="in-progress"
          />
        </div>
      </section>
      {openId ? (
        <PanelHost
          key={openId}
          orderId={openId}
          row={openRow}
          facts={facts[openId] ?? {}}
          mark={marks[openId] ?? null}
          token={panelToken}
          onMarkReady={(o) => void markReady(o)}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}

function PanelHost({
  orderId,
  row,
  facts,
  mark,
  token,
  onMarkReady,
  onClose,
}: {
  orderId: string;
  row: Order | null;
  facts: LiveFacts;
  mark: MarkPhase | null;
  token: number;
  onMarkReady: (o: Order) => void;
  onClose: () => void;
}) {
  const resource = useServerResource(() => loadOrder(orderId), [orderId]);
  const { refresh } = resource;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refresh();
  }, [token, refresh]);
  const data: Order | null = resource.data
    ? row
      ? { ...resource.data, state: row.state, ready_at: row.ready_at ?? resource.data.ready_at, rider: row.rider ?? null, is_late: row.is_late, deadline_at: row.deadline_at }
      : resource.data
    : null;
  return <OrderDetail orderId={orderId} resource={{ ...resource, data }} facts={facts} mark={mark} onMarkReady={onMarkReady} onClose={onClose} />;
}

