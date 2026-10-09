/**
 * The NewOrderStrip on every console page (`StripSlot`, manifest §3 WP3): maps the waiting
 * orders to tiles, the open state to the rule line and the empty card, and an open offer or
 * decline panel to the compact row. Also the two strip-level banners: "Sound is blocked"
 * and "1 order timed out".
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatCents } from '@hg/api-client';
import { Banner, NewOrderStrip, type NewOrderStripEmpty, type NewOrderStripTile, type OfferStatusLine } from '../ds';
import { serverNow } from '../data/serverClock';
import { useAvailability, setAcceptingOrders, type Availability } from '../data/availability';
import { useConsole } from '../data/console';
import { formatTime } from '../format/time';
import { OUTCOME_TILE, WINDOW_SECONDS, acceptName, liveTileLabel, offerSummary } from './copy';
import { isLive, useNewOrders, type NewOrdersApi, type Offer } from './NewOrdersProvider';

/** Desktop is ≥ 1280 CSS px (the shell's breakpoint); below that the tablet layout. */
export function useIsDesktop(): boolean {
  const query = '(min-width: 1280px)';
  const [match, setMatch] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);
  return match;
}

/** Re-render once a second (accessible names carry the time left; never announced). */
function useSecondTick(active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setT((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return t;
}

export function statusLineOf(o: Offer, conn: NewOrdersApi['connection']): OfferStatusLine | null {
  if (o.phase === 'accepting')
    return { tone: 'neutral', icon: 'refresh', text: o.viaReconnect ? 'Sending your accept. Don’t tap again.' : 'Confirming with HalalGoes. Don’t tap again.' };
  if (o.phase === 'accept-failed')
    return { tone: 'danger', icon: 'error', text: o.viaReconnect ? 'Couldn’t reach HalalGoes. Still waiting.' : 'Couldn’t confirm. Still waiting for you.' };
  if (o.phase === 'unavailable') return { tone: 'danger', icon: 'error', text: o.failure ?? 'Your restaurant can’t take orders right now.' };
  if (conn.restDown) return { tone: 'warning', icon: 'refresh', text: 'Can’t reach HalalGoes' };
  if (conn.offline) return { tone: 'danger', icon: 'error', text: 'Offline: accept may fail' };
  if (conn.reconnecting) return { tone: 'warning', icon: 'refresh', text: 'Accept still works while reconnecting' };
  if (!o.order) return { tone: 'neutral', icon: 'refresh', text: 'Loading the rest of this order…' };
  return null;
}

export function acceptLabelOf(o: Offer, conn: NewOrdersApi['connection']): string {
  if (o.phase === 'accept-failed') return 'Try accept again';
  if (conn.restDown && o.phase === 'live') return 'Reconnect to accept';
  return `Accept · ${o.prep} min`;
}

function ruleFor(a: Availability | null, hasOffers: boolean): string {
  if (!hasOffers) return 'Each new order rings until it is answered or times out.';
  switch (a?.open_state) {
    case 'PAUSED':
      return 'Paused. These arrived before the pause and still need an answer.';
    case 'CLOSED_TOGGLE':
      return 'Arrived before you turned orders off. Each keeps its full 3 minutes.';
    case 'CLOSED_HOURS':
    case 'CLOSED_HOLIDAY':
      return 'Arrived before closing. Answer it; no new orders will come.';
    default:
      return 'Answer within 3 minutes. Soonest deadline first.';
  }
}

export function StripView() {
  const api = useNewOrders();
  const availability = useAvailability();
  const { timezone } = useConsole();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [turning, setTurning] = useState<'idle' | 'on' | 'failed'>('idle');
  const tick = useSecondTick(api.offers.length > 0);
  const { offers, connection: conn, panel } = api;

  // The go-live gate on /orders replaces the strip until this page load had the gesture.
  if (location.pathname === '/orders' && api.gate !== 'passed') return null;
  // First-load error: the board says so; the strip stays out of the way until orders arrive.
  if (api.status === 'error' && offers.length === 0) return <StripBanners api={api} />;

  const live = offers.filter(isLive);
  const now = serverNow();

  const tiles: NewOrderStripTile[] = offers.map((o) => {
    const inPanel = panel?.orderId === o.id;
    if (!isLive(o) && o.outcome) {
      const v = OUTCOME_TILE[o.outcome];
      return {
        id: o.id,
        code: o.code,
        live: false,
        ariaLabel: `New order ${o.code}, ${v.badge}`,
        inPanel,
        outcome: v,
        removeName: `Remove order ${o.code} from new orders`,
        onRemove: () => api.remove(o.id),
      };
    }
    const earn = o.order ? o.order.money.restaurant_net_cents : null;
    const label = acceptLabelOf(o, conn);
    const items = o.order ? o.order.lines.reduce((n, l) => n + l.quantity, 0) : o.itemCount;
    return {
      id: o.id,
      code: o.code,
      live: true,
      ariaLabel: liveTileLabel(o.code, o.deadlineAt - now, earn === null ? null : formatCents(earn)),
      inPanel,
      expiresAt: o.deadlineAt,
      now: serverNow,
      windowSeconds: WINDOW_SECONDS,
      earnCents: earn,
      summary: offerSummary(o.order?.customer.display_name ?? o.firstName, items),
      hasNote: Boolean(o.order?.special_instructions?.trim()),
      statusLine: statusLineOf(o, conn),
      acceptLabel: label,
      acceptName: acceptName(label, o.code, o.prep),
      acceptLoading: o.phase === 'accepting',
      acceptDisabled: o.phase === 'unavailable' || (conn.restDown && o.phase === 'live'),
      declineDisabled: o.phase === 'accepting' || conn.restDown,
      declineName: `Decline order ${o.code}, choose a reason`,
      onAccept: () => api.accept(o.id),
      onDecline: () => api.open(o.id, 'decline'),
      onOpen: () => api.open(o.id, 'offer'),
    };
  });

  // Compact row while an offer or decline of a waiting order is open in the panel.
  const openOffer = panel ? api.get(panel.orderId) : null;
  let compact = null;
  if (openOffer) {
    const others = live.filter((o) => o.id !== openOffer.id);
    const n = live.length;
    compact = {
      title: `${n} new ${n === 1 ? 'order' : 'orders'} waiting`,
      body: others.length
        ? `${openOffer.code} is open in the panel. Also waiting: ${others.map((o) => o.code).join(', ')} (timer shown).`
        : `${openOffer.code} is open in the panel. Nothing else is waiting.`,
      buttonLabel: 'Show all',
      buttonName: `Show all ${n} new orders`,
      buttonVariant: 'tertiary' as const,
      onPress: () => api.closePanel(openOffer.id),
      expiresAt: (others[0] ?? (isLive(openOffer) ? openOffer : null))?.deadlineAt ?? null,
    };
  }

  const a = availability.data;
  const turnOn = async () => {
    setTurning('on');
    try {
      await setAcceptingOrders({ is_accepting_orders: true, pause_until: null });
      await availability.refresh();
      setTurning('idle');
    } catch {
      setTurning('failed');
    }
  };
  const empty = emptyFor(a, timezone, turning, turnOn, () => navigate('/hours'));

  return (
    <>
      <StripBanners api={api} />
      <NewOrderStrip
        status={api.status === 'loading' ? 'loading' : offers.length ? 'live' : 'empty'}
        rule={ruleFor(a, offers.length > 0)}
        tiles={tiles}
        empty={empty}
        compact={compact}
        now={serverNow}
        isDesktop={isDesktop}
        flash={live.length > 0 && tick % 2 === 0}
        testId="new-order-strip"
      />
    </>
  );
}

function emptyFor(
  a: Availability | null,
  timezone: string,
  turning: 'idle' | 'on' | 'failed',
  turnOn: () => void,
  editHours: () => void,
): NewOrderStripEmpty | undefined {
  if (turning === 'on') return { icon: 'refresh', title: 'Turning orders on', body: 'The switch moves when HalalGoes confirms.' };
  if (turning === 'failed')
    return {
      title: 'You’re not accepting orders',
      body: 'Customers can see your menu but can’t order.',
      action: { label: 'Turn on', onPress: turnOn, variant: 'secondary' },
    };
  switch (a?.open_state) {
    case 'PAUSED':
      return {
        icon: 'clock',
        title: a.pause_until ? `Paused until ${formatTime(a.pause_until, timezone)}` : 'Paused',
        body: a.pause_until
          ? `New orders resume at ${formatTime(a.pause_until, timezone)}. Orders in progress still need finishing.`
          : 'Orders in progress still need finishing.',
        action: { label: 'Resume now', onPress: turnOn, variant: 'tertiary' },
      };
    case 'CLOSED_TOGGLE':
      return (a.missed_order_count ?? 0) >= 2
        ? { title: 'New orders are off', body: 'Turn them on when someone is at this screen.', action: { label: 'Turn on', onPress: turnOn, variant: 'secondary' } }
        : {
            title: 'You’re not accepting orders',
            body: 'Customers can see your menu but can’t order. Turn orders on when someone is at this screen.',
            action: { label: 'Turn on', onPress: turnOn, variant: 'secondary' },
          };
    case 'CLOSED_HOURS':
      return { icon: 'clock', title: 'Closed by your hours', body: 'New orders start when you next open.', action: { label: 'Edit hours', onPress: editHours, variant: 'tertiary' } };
    case 'CLOSED_HOLIDAY':
      return { icon: 'clock', title: 'Closed today', body: 'New orders start when you next open.', action: { label: 'Edit hours', onPress: editHours, variant: 'tertiary' } };
    case 'CLOSED_SUSPENDED':
      return {
        icon: 'lock',
        title: 'New orders are off while your account is suspended',
        body: 'Finish the orders in progress. Support tells you when you can take orders again.',
      };
    default:
      return undefined;
  }
}

function StripBanners({ api }: { api: NewOrdersApi }) {
  const availability = useAvailability();
  const location = useLocation();
  const hasLive = api.liveCount > 0;
  const blocked =
    api.sound.state === 'blocked' || (api.sound.state === 'unarmed' && hasLive && location.pathname !== '/orders' && api.gate !== 'passed');
  const timedOut = availability.data?.missed_order_count === 1 && api.offers.some((o) => o.outcome === 'timed-out' || o.outcome === 'too-late');
  if (!blocked && !timedOut) return null;
  return (
    <div className="mx-4 mt-2.5 flex flex-col gap-2">
      {blocked ? (
        <div role="alert">
          <Banner
            variant="warning"
            title="Sound is blocked"
            description="Your browser stopped the order sound. New orders won’t ring until sound is back on."
            action={{ label: 'Turn sound back on', onPress: api.sound.rearm }}
            testId="sound-blocked"
          />
        </div>
      ) : null}
      {timedOut ? (
        <Banner
          variant="warning"
          title="1 order timed out"
          description="One more in a row and new orders will stop until you turn them back on."
          testId="timed-out-banner"
        />
      ) : null}
    </div>
  );
}
