/**
 * The live operations map — every active order and its rider on one map, moving in realtime.
 *
 * Load: `listOrdersAdmin` filtered to the states in which a rider can be on the way, then
 * `getOrderAdmin` for each (up to `MAX_TRACKED`) for the restaurant, delivery and rider
 * coordinates. Both are privileged cross-tenant reads the server audits.
 *
 * Live: one `order:{id}` subscription per order on the map, plus `admin:ops`. `rider.location`
 * glides that order's rider pin; a state or dispatch event refetches that one order;
 * `admin.dispatch_failure` raises a banner. The contract has no admin-wide "order created"
 * event, so the list is re-read every `DISCOVER_MS` to pick up new orders (details only for
 * the new ones). While the socket is down everything is re-read every `FALLBACK_POLL_MS` —
 * slower than the single-order 5 s, because each pass is one audited read per order on the map.
 *
 * What it cannot show: riders who are online but idle. No operation or event in the contract
 * carries the position of a rider without an assignment, so the map shows riders on active
 * deliveries only, and says so.
 *
 * States: loading (skeleton), error (retry), empty ("no active orders"), and the map with an
 * accessible list of the same orders beneath it — the list is the map's text alternative.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { Banner, Card, Chip, EmptyState, ErrorState, Icon, Skeleton } from '@hg/ui-web';
import {
  LiveMap,
  eventOfType,
  fixFromEvent,
  fixFromRest,
  lastUpdatedLabel,
  newerFix,
  usePolling,
  useRealtimeChannel,
  useRealtimeChannels,
  useRealtimeStatus,
  type ChannelSignal,
  type LiveMapPlace,
  type LiveMapRider,
  type RiderFix,
} from '@hg/ui-web/live';

import { api } from '../lib/api.js';
import { unwrap, useLoad } from '../lib/load.js';
import { enumLabel } from '../lib/format.js';
import { MAPBOX_PUBLIC_TOKEN, loadMapbox } from '../lib/realtime.js';
import { TRACKED_STATES, orderPlaces } from '../components/LiveMapBox.js';

type OrderAdminView = Schema['OrderAdminView'];

/** Orders followed at once: under the socket's 50 subscriptions, leaving room for `admin:ops`. */
export const MAX_TRACKED = 40;
/** How often the list is re-read for new orders while the socket is up. */
export const DISCOVER_MS = 30_000;
/** How often everything is re-read while the socket is down. */
export const FALLBACK_POLL_MS = 15_000;

async function getOrder(orderId: string): Promise<OrderAdminView | null> {
  try {
    return (await unwrap(api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId } } }))).data as OrderAdminView;
  } catch {
    return null; // one unreadable order must not blank the whole map
  }
}

/**
 * Reads the active orders and their coordinates, a few at a time. Orders in `reuse` are not
 * re-read: while the socket is up their channels keep them current, so a discovery pass costs
 * one list read plus one detail read per *new* order.
 */
async function loadActiveOrders(reuse: ReadonlyMap<string, OrderAdminView> | null = null): Promise<OrderAdminView[]> {
  const list = await unwrap(
    api.GET('/v1/admin/orders', { params: { query: { state: [...TRACKED_STATES], limit: MAX_TRACKED } } }),
  );
  const ids = list.data.map((o) => o.id);
  const known = new Map<string, OrderAdminView>();
  const missing: string[] = [];
  for (const id of ids) {
    const cached = reuse?.get(id);
    if (cached) known.set(id, cached);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 6) {
    const batch = await Promise.all(missing.slice(i, i + 6).map(getOrder));
    for (const order of batch) if (order) known.set(order.id, order);
  }
  return ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []));
}

const REFETCH_ON = new Set([
  'order.state_changed',
  'order.cancelled',
  'order.completed',
  'dispatch.assigned',
  'dispatch.unassigned',
  'dispatch.state_changed',
]);

/** The live operations map screen. */
export function LiveOpsScreen() {
  const navigate = useNavigate();
  const status = useRealtimeStatus();
  /** Orders a discovery pass may keep as they are (set only while the socket is up). */
  const reuseRef = useRef<ReadonlyMap<string, OrderAdminView> | null>(null);
  // Memoised: useLoad reloads whenever its fetcher changes. The ref keeps the reuse cache current
  // without making a new fetcher on every render.
  const fetchActiveOrders = useCallback(() => loadActiveOrders(reuseRef.current), []);
  const { status: loadStatus, data, error, reload, refresh } = useLoad(fetchActiveOrders);
  /** Per-order overrides from realtime: a newer fix, or a re-read order. */
  const [liveFix, setLiveFix] = useState<Record<string, RiderFix | null>>({});
  const [patched, setPatched] = useState<Record<string, OrderAdminView | null>>({});
  const [failures, setFailures] = useState<Array<{ order_id: string; waves: number }>>([]);

  const orders = useMemo(() => {
    const base = data ?? [];
    return base
      .map((o) => (o.id in patched ? patched[o.id] : o))
      .filter((o): o is OrderAdminView => !!o && TRACKED_STATES.includes(o.state));
  }, [data, patched]);

  const refetchOne = useCallback(async (orderId: string) => {
    const next = await getOrder(orderId);
    setPatched((p) => ({ ...p, [orderId]: next }));
  }, []);

  const onOrderSignal = useCallback(
    (signal: ChannelSignal) => {
      if (signal.kind === 'refetch') {
        void refetchOne(signal.channel.slice('order:'.length));
        return;
      }
      const location = eventOfType(signal, 'rider.location');
      if (location) {
        const id = location.data.order_id;
        setLiveFix((f) => ({ ...f, [id]: newerFix(f[id] ?? null, fixFromEvent(location.data)) }));
        return;
      }
      if (REFETCH_ON.has(signal.event.type)) {
        const orderId = (signal.event.data as { order_id?: string }).order_id;
        if (orderId) void refetchOne(orderId);
      }
    },
    [refetchOne],
  );

  useRealtimeChannels(
    orders.map((o) => `order:${o.id}`),
    onOrderSignal,
  );
  useRealtimeChannel('admin:ops', (signal) => {
    const failure = eventOfType(signal, 'admin.dispatch_failure');
    if (failure) {
      setFailures((f) => [{ order_id: failure.data.order_id, waves: failure.data.waves }, ...f].slice(0, 5));
      void refetchOne(failure.data.order_id);
    }
  });

  const socketOpen = status === 'open';
  // Socket up: re-read the list and only the new orders (the rest are kept, patches included).
  // Socket down: re-read everything. Either way the result replaces the per-order patches.
  const refreshAll = useCallback(async () => {
    reuseRef.current = socketOpen ? new Map(orders.map((o) => [o.id, o])) : null;
    try {
      await refresh();
    } finally {
      reuseRef.current = null;
    }
    setPatched({});
  }, [refresh, socketOpen, orders]);
  usePolling(refreshAll, socketOpen ? DISCOVER_MS : FALLBACK_POLL_MS, loadStatus === 'ready', { immediate: false });

  const places = useMemo(() => {
    const byId = new Map<string, LiveMapPlace>();
    for (const order of orders) for (const place of orderPlaces(order)) byId.set(place.id, place);
    return [...byId.values()];
  }, [orders]);

  const fixes = useMemo(() => {
    const out: Record<string, RiderFix | null> = {};
    for (const order of orders) {
      out[order.id] = order.rider ? newerFix(fixFromRest(order.rider_location), liveFix[order.id] ?? null) : null;
    }
    return out;
  }, [orders, liveFix]);

  const riders: LiveMapRider[] = orders
    .filter((o) => o.rider)
    .map((o) => ({ id: `rider:${o.id}`, label: `${o.rider!.first_name} ${o.rider!.last_initial}. · ${o.code}`, fix: fixes[o.id] ?? null }));

  const openMarker = useCallback(
    (id: string) => {
      const [kind, ref] = id.split(':');
      if ((kind === 'rider' || kind === 'dest') && ref) navigate(`/orders/${ref}`);
    },
    [navigate],
  );

  const heading = (
    <header className="adm-stack" style={{ gap: 'var(--hg-space-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-3)', flexWrap: 'wrap' }}>
        <h1 id="live-heading" className="text-title-md text-fg-primary">
          Live operations map
        </h1>
        <Chip label={socketOpen ? 'Live' : status === 'offline' ? 'Offline — polling' : 'Reconnecting — polling'} tone={socketOpen ? 'neutral' : 'warning'} />
      </div>
      <p className="text-body-md text-fg-secondary">
        Active orders and the riders carrying them. Riders who are online without an order are not shown: the platform does
        not report their position.
      </p>
    </header>
  );

  if (loadStatus === 'loading') {
    return (
      <section aria-labelledby="live-heading" className="adm-stack" aria-busy="true">
        {heading}
        <Skeleton height={480} />
        <Skeleton height={160} />
      </section>
    );
  }

  if (loadStatus === 'error') {
    return (
      <section aria-labelledby="live-heading" className="adm-stack">
        {heading}
        <ErrorState variant="page" errorCode={error.code} description={error.message} onRetry={reload} />
      </section>
    );
  }

  const ridersMoving = riders.filter((r) => r.fix).length;

  return (
    <section aria-labelledby="live-heading" className="adm-stack">
      {heading}

      {failures.length > 0 ? (
        <Banner
          variant="warning"
          title={`${failures.length} order${failures.length === 1 ? '' : 's'} could not find a rider`}
          description={failures.map((f) => `${f.order_id.slice(0, 8)}… after ${f.waves} waves`).join(' · ')}
          dismissible
          onDismiss={() => setFailures([])}
        />
      ) : null}

      {orders.length === 0 ? (
        <EmptyState
          illustration={<Icon name="map" size={32} />}
          title="No active orders right now"
          description="Orders appear here, with their riders moving live, from the moment a restaurant has them until delivery."
          tone="positive"
        />
      ) : (
        <>
          <LiveMap
            accessToken={MAPBOX_PUBLIC_TOKEN}
            loadMapbox={loadMapbox}
            places={places}
            riders={riders}
            height="min(70vh, 640px)"
            ariaLabel="Live operations map: active orders and their riders"
            onMarkerClick={openMarker}
          >
            <div>
              {orders.length} active order{orders.length === 1 ? '' : 's'} · {ridersMoving} rider{ridersMoving === 1 ? '' : 's'} on the map
            </div>
            {!socketOpen ? (
              <div className="text-body-sm text-fg-secondary" role="status">
                Live updates reconnecting — refreshing every {FALLBACK_POLL_MS / 1000} seconds
              </div>
            ) : null}
          </LiveMap>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Active orders</h2>}>
            <ul className="adm-stack" style={{ gap: 'var(--hg-space-2)', listStyle: 'none', margin: 0, padding: 0 }}>
              {orders.map((order) => {
                const fix = fixes[order.id];
                return (
                  <li key={order.id} style={{ display: 'flex', gap: 'var(--hg-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <a href={`#/orders/${order.id}`} className="text-label-md font-semibold text-fg-link">
                      {order.code}
                    </a>
                    <Chip label={enumLabel(order.state)} tone="neutral" />
                    <span className="text-body-sm text-fg-primary">{order.restaurant.name}</span>
                    <span className="text-body-sm text-fg-secondary">
                      {order.rider
                        ? `${order.rider.first_name} ${order.rider.last_initial}. — ${fix ? lastUpdatedLabel(fix).toLowerCase() : 'no position yet'}`
                        : 'No rider assigned'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}
