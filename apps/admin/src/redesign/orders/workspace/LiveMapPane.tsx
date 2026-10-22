/**
 * The live map pane (`admin/orders/LiveMapPane`): the order's pins, what the order is doing in
 * words, and how this browser is hearing about it. It opens in place of More detail, widened over
 * the list, and the order stays open beside it.
 *
 * - The map is the shared `LiveMap`, tile-free in mock mode (a plain sunken field, as the boards
 *   draw it) and Mapbox otherwise. It is `aria-hidden`; the "Text equivalent" card is the content.
 * - A position that stops arriving is shown frozen where it was, labelled "last known", never
 *   moved or estimated. A paused connection (reconnecting, offline, signed out) freezes it the
 *   same way and says since when.
 * - The destination is not drawn while the address is masked: see `placesOf`.
 * - Events are signals, the REST read is the truth: a signal refetches the order silently, and
 *   while the socket is down the order is read again every 5 seconds.
 * - Not on this pane, with the reason in the pull request: "Contact the rider" and a map of every
 *   active order (no API), and the 180 px mini map in the order pane.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Schema } from '@hg/api-client';
import { eventOfType, fixFromEvent, fixFromRest, newerFix, usePolling, useRealtimeChannel, useRealtimeControls, useRealtimeStatus, type RiderFix } from '@hg/ui-web/live';

import { MAPBOX_PUBLIC_TOKEN, loadMapbox } from '../../../lib/realtime';
import { useOnline } from '../../auth/online';
import { formatTime, formatTimeWithSeconds } from '../../data/format';
import { getSession, subscribeSession } from '../../data/session';
import { Badge, Banner, Button, Card, DetailPanel, LiveMap, type MapPhase } from '../../ds';
import { DeadlineCell, StateBadge } from '../cells';
import { ORDER_STATE } from '../labels';
import { LINK_CHIP, isFollowing, placesOf, riderOf, summarise, textOf, type Link, type Paused } from './liveMapModel';

type Order = Schema['OrderAdminView'];

/** The cadence of the REST read while the socket is not open. */
export const POLL_MS = 5_000;

/** Mock mode and the design captures set this to draw the tile-free map; a real build draws Mapbox, and with no token, words. */
const FLAT = import.meta.env['VITE_HG_MAP_FLAT'] === 'true';

const LABEL = 'text-label-md font-semibold text-fg-secondary';
const CELL = 'flex min-w-0 flex-col gap-1';

export interface LiveMapPaneProps {
  order: Order;
  /** A silent read of the order. */
  onRefresh: () => void;
  /** Close and Escape: More detail comes back. */
  onClose: () => void;
  /** Open the reveal panel, which replaces this pane. Null when the address is not revealable now. */
  onReveal: (() => void) | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function LiveMapPane({ order, onRefresh, onClose, onReveal, returnFocusRef }: LiveMapPaneProps) {
  const online = useOnline();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const status = useRealtimeStatus();
  const controls = useRealtimeControls();
  const following = isFollowing(order);
  const now = useTick(true);

  const [liveFix, setLiveFix] = useState<RiderFix | null>(null);
  const [phase, setPhase] = useState<MapPhase>('loading');
  const [wasFollowing, setWasFollowing] = useState(following);
  if (following && !wasFollowing) setWasFollowing(true);

  useRealtimeChannel(following ? `order:${order.id}` : null, (signal) => {
    const location = eventOfType(signal, 'rider.location');
    if (location) setLiveFix((current) => newerFix(current, fixFromEvent(location.data)));
    if (eventOfType(signal, 'dispatch.unassigned')) setLiveFix(null);
  });
  usePolling(onRefresh, POLL_MS, following && online && status !== 'open');

  // The live fix and the REST one: whichever the phone recorded later. Never both, never blended.
  const merged = useMemo<Order>(() => {
    if (!liveFix || !order.rider) return order;
    const restFix = fixFromRest(order.rider_location);
    const best = newerFix(restFix, liveFix);
    if (!best) return order;
    return {
      ...order,
      rider_location: { latitude: best.latitude, longitude: best.longitude, heading_deg: best.headingDeg, accuracy_m: best.accuracyM, recorded_at: best.recordedAt, is_coarse: best.coarse },
    };
  }, [order, liveFix]);

  const signedOut = session.ended !== null;
  const heard: Link = !following
    ? 'not-following'
    : signedOut
      ? 'signed-out'
      : !online
        ? 'offline'
        : status === 'reconnecting' || status === 'offline'
          ? 'reconnecting'
          : status === 'open'
            ? 'live'
            : 'connecting';
  const link: Link = phase === 'error' ? 'not-connected' : phase === 'loading' ? 'connecting' : heard;

  // Remember when the picture stopped being fresh, so "as of" names that moment and stays put.
  const pausedAt = useRef<string | null>(null);
  const isPaused = link === 'reconnecting' || link === 'offline' || link === 'signed-out';
  if (isPaused && pausedAt.current === null) pausedAt.current = new Date(now).toISOString();
  if (!isPaused) pausedAt.current = null;
  const paused: Paused | null = isPaused && pausedAt.current ? { link, at: pausedAt.current } : null;

  const seen = riderOf(merged, now, paused);
  const places = useMemo(() => placesOf(merged), [merged]);
  const riders = useMemo(() => (seen.rider ? [seen.rider] : []), [seen.rider]);
  const summary = summarise(merged, seen.stale);
  const text = textOf(merged, seen.sentence);
  const chip = LINK_CHIP[link];
  const unloaded = phase === 'loading' || phase === 'error';
  const placeholder = phase === 'loading' ? 'Loading…' : 'Not loaded.';
  const state = ORDER_STATE[order.state];
  const retryIn = controls.retry().nextAt ? Math.max(0, Math.round((controls.retry().nextAt! - now) / 1000)) : null;
  const delivered = !following && wasFollowing && (order.state === 'DELIVERED' || order.state === 'COMPLETED');

  const banner = (() => {
    if (link === 'reconnecting' && paused) {
      return (
        <Banner
          tone="neutral"
          title="Your connection is reconnecting."
          description={`Positions paused since ${formatTimeWithSeconds(paused.at)}.${retryIn !== null ? ` Retrying in ${retryIn} seconds.` : ''} When it's back, missed updates are replayed or the order is loaded again.`}
          action={{ label: 'Reconnect now', onPress: () => controls.reconnectNow() }}
        />
      );
    }
    if (link === 'offline' && paused) {
      return (
        <Banner
          tone="warning"
          title="You’re offline."
          description={`This computer has no network, so the map stopped at ${formatTimeWithSeconds(paused.at)} and isn't retrying. It reconnects by itself when the network is back. This isn't the rider's signal.`}
        />
      );
    }
    return null;
  })();

  return (
    <DetailPanel
      title={
        <>
          Live map · <span className="font-mono">{order.code}</span>
        </>
      }
      onClose={onClose}
      closeLabel="Close the live map. More detail comes back."
      {...(returnFocusRef ? { returnFocusRef } : {})}
      testId="LiveMapPane"
    >
      <div className="flex min-h-0 flex-1 flex-col" data-link={link} data-phase={phase}>
        {banner}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3">
          <span className="text-body-sm text-fg-secondary">
            {order.restaurant.name} · placed {formatTime(order.placed_at)} · the order stays open beside this map
          </span>
          {delivered ? (
            <Banner
              tone="info"
              title={`${state.label} at ${formatTime(order.state_since)}, while you were watching.`}
              description="The rider's position has stopped updating. Refunds and the rest of the order's actions are in the order pane beside this map."
            />
          ) : null}

          <section aria-label="Order status on the map" className="grid grid-cols-4 gap-3 rounded-lg border border-line-decorative bg-surface-raised p-3">
            <div className={CELL}>
              <span className={LABEL}>State</span>
              <span className="self-start">
                <StateBadge state={order.state} size="lg" />
              </span>
            </div>
            <div className={CELL}>
              <span className={LABEL}>Next deadline</span>
              {unloaded ? null : order.deadline_at ? (
                <DeadlineCell state={order.state} deadlineAt={order.deadline_at} since={order.state_since} note={summary.deadlineVerb} size="md" label={summary.deadlineLabel} />
              ) : (
                <span className="text-body-md text-fg-primary">None. This order is finished.</span>
              )}
            </div>
            <div className={CELL}>
              <span className={LABEL}>Delivery estimate</span>
              <span className="text-label-lg font-semibold tabular-nums text-fg-primary">{unloaded ? (phase === 'loading' ? 'Loading…' : 'Not loaded') : summary.eta}</span>
            </div>
            <div className={CELL}>
              <span className={LABEL}>Current leg</span>
              <span className="text-label-lg font-semibold text-fg-primary">{unloaded ? (phase === 'loading' ? 'Loading…' : 'Not loaded') : summary.leg}</span>
              {unloaded ? null : <span className="text-body-sm text-fg-secondary">{summary.legNote}</span>}
            </div>
          </section>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-3">
            <div className="relative flex min-h-0 flex-col">
              <LiveMap
                accessToken={MAPBOX_PUBLIC_TOKEN}
                loadMapbox={loadMapbox}
                flatStyle={FLAT}
                places={places}
                riders={riders}
                ariaLabel={`Map of order ${order.code}`}
                recenterLabel="Recenter on the order"
                textEquivalentId="live-map-text"
                loadingLabel="Loading the map…"
                errorTitle="The map didn't load"
                errorBody="The order's positions didn't arrive. Nothing was changed. The order pane beside this map still says where things are, in words."
                onPhaseChange={setPhase}
                height="100%"
                style={{ height: '100%' }}
                now={() => now}
              />
              {text.finished ? (
                <div
                  role="status"
                  className="absolute start-1/2 top-[40%] z-[2] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border border-line-decorative bg-surface-raised px-4 py-3 text-body-md text-fg-primary"
                >
                  {text.finished}
                </div>
              ) : null}
            </div>

            <aside aria-label="What the map shows" className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <Card variant="outlined" padding="var(--space-4)" radius="lg">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="m-0 flex-1 text-heading-sm font-semibold text-fg-primary">This order</h3>
                    <StateBadge state={order.state} />
                  </div>
                  {order.deadline_at && !unloaded ? (
                    <span className="text-body-md tabular-nums text-fg-primary">
                      Next deadline at {formatTime(order.deadline_at)}, {summary.deadlineLabel}
                    </span>
                  ) : null}
                  <span className="text-body-sm text-fg-secondary">
                    Everything you can do to this order is in the order pane beside the map. Closing the map brings More detail back.
                  </span>
                </div>
              </Card>
              <Card variant="outlined" padding="var(--space-4)" radius="lg">
                <div className="flex flex-col gap-3">
                  <h3 className="m-0 text-heading-sm font-semibold text-fg-primary">Text equivalent</h3>
                  <ul id="live-map-text" className="m-0 flex list-none flex-col gap-3 p-0 text-body-md text-fg-primary">
                    {text.finished && !unloaded ? (
                      <li>
                        <strong>Order.</strong> {text.finished}
                      </li>
                    ) : null}
                    <li>
                      <strong>Restaurant.</strong> {unloaded ? placeholder : text.restaurant}
                    </li>
                    <li className="flex flex-col items-start gap-2">
                      <span>
                        <strong>Destination.</strong> {unloaded ? placeholder : text.destination}
                      </span>
                      {!unloaded && text.canReveal && onReveal ? (
                        <Button variant="tertiary" iconStart="lock" onPress={onReveal}>
                          Reveal address…
                        </Button>
                      ) : null}
                    </li>
                    <li>
                      <strong>Rider.</strong> {unloaded ? placeholder : text.rider}
                    </li>
                  </ul>
                  <div className="flex items-center gap-2 border-t border-line-decorative pt-2">
                    <span className="flex-1 text-body-sm text-fg-secondary">Your connection</span>
                    <Badge variant={chip.tone} icon={chip.icon}>
                      {chip.label}
                    </Badge>
                  </div>
                </div>
              </Card>
              {seen.stale && !paused ? (
                <div role="note" className="flex flex-col gap-2 rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3 text-body-sm text-feedback-warning-tint-text">
                  <strong className="text-body-md">What happens next</strong>
                  <span>If there's no update by the deadline, the rider is pinged and ops are alerted automatically. You don't need to do anything yet.</span>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
