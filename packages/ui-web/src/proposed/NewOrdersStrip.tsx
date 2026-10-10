/**
 * `NewOrdersStrip` — the persistent strip of new orders under the restaurant console's status bar
 * (approval packet P33; Live Orders canvas `NewOrderStrip`, `Keyboard-strip`, `A11y-*`, every
 * `Offer-*` board, `Tablet-one-offer`, `Tablet-three-offers`). Proposed: awaiting approval.
 *
 * A heading column ("New orders", "{n} waiting", the rule line, key hints on desktop) and up to
 * three `OfferTile`s, soonest deadline first in the order given; a fourth and later wait behind
 * "+1 more", so no Accept is ever half hidden.
 *
 * Keyboard (the stray-key guard):
 * - the tiles are ONE tab stop (roving tabindex); Tab again reaches that tile's buttons;
 * - Left/Right move between orders; A accepts, D opens decline, Enter opens the order, and only
 *   while a live tile ITSELF has focus. Nowhere else on the page do these keys do anything;
 * - a new order never takes focus; a re-sort keeps focus on the same order, not the same place;
 * - when the focused order ends, focus moves to its own note (the next A does nothing); when it
 *   leaves the strip, focus moves to the "New orders" heading, never onto another live order,
 *   unless `advanceFocusFrom` says the user accepted it here.
 *
 * Speech: every tile's Countdown is silent. The strip is the only speaker, through the page's
 * PageAnnouncer: an arrival (polite; several at once are batched), 25% left (polite), 10% left
 * (assertive) and 0 (polite), once per order. Per-second ticks, re-sorts and the tint pulse are
 * never spoken. Sound is the caller's: `onRingChange` and `onNewOrders` are the hooks; the
 * strip ships no audio.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { Countdown } from '../ds/Countdown.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { KeyHint, StripOverflowButton } from '../lib/ui/offer-tile.js';
import { cn } from '../lib/utils.js';
import { InlineAlert } from './Banner.js';
import {
  OFFER_ANNOUNCE_AT,
  OFFER_WINDOW_SECONDS,
  arrivalMessage,
  batchArrivalMessage,
  secondsLeft,
  thresholdMessage,
} from './new-orders-copy.js';
import { OfferTile, isLiveTile, type OfferTileProps } from './OfferTile.js';
import { useAnnounce } from './PageAnnouncer.js';
import { Skeleton } from './Skeleton.js';

/** One tile as the strip takes it: the tile's props without the roving-focus wiring. */
export type NewOrdersStripTile = Omit<OfferTileProps, 'tabIndex' | 'selected' | 'onKeyDown' | 'onFocus' | 'compactDecline' | 'tileRef'>;
/** The packet's name for a strip tile (P33 `OrderOffer`). */
export type OrderOffer = NewOrdersStripTile;

/** A button in the empty card ("Resume now", "Turn on"). */
export interface NewOrdersStripAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  loading?: boolean;
}

/** The empty card: nothing is waiting (or orders are paused, off or closed). */
export interface NewOrdersStripEmpty {
  icon?: DsIconName;
  title: string;
  body: string;
  action?: NewOrdersStripAction;
}

/** The one-row strip while an offer or its decline is open in the panel. */
export interface NewOrdersStripCompact {
  title: string;
  body: string;
  buttonLabel: string;
  buttonName: string;
  buttonVariant: 'tertiary' | 'primary';
  onPress: () => void;
  /** The deadline shown: the soonest other live order (else the open one). */
  expiresAt: number | string | null;
}

/** The waiting orders could not be loaded. */
export interface NewOrdersStripError {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Props of `NewOrdersStrip`. The restaurant stub's names are kept; the packet's are aliases. */
export interface NewOrdersStripProps {
  /** Default: `live` with tiles, else `empty`. */
  status?: 'loading' | 'empty' | 'live' | 'error';
  /** The orders, soonest deadline first. */
  tiles?: readonly NewOrdersStripTile[];
  /** Packet name for `tiles`. */
  offers?: readonly OrderOffer[];
  /** The line under the heading ("Answer within 3 minutes. Soonest deadline first."). */
  rule?: string;
  empty?: NewOrdersStripEmpty;
  error?: NewOrdersStripError;
  /** An offer or decline is open in the panel: one 88px row instead of tiles. */
  compact?: NewOrdersStripCompact | null;
  /** The page's server-corrected clock in epoch ms. Default: `serverNow` + elapsed, else `Date.now`. */
  now?: () => number;
  /** Server clock at response time (RFC 3339), when no `now` is given. */
  serverNow?: string;
  /** Desktop shows key hints and a "Decline…" text button; the tablet a close IconButton. Default true. */
  isDesktop?: boolean;
  /** The 1 Hz tint pulse while ringing; reduced motion keeps the tint steady. */
  flash?: boolean;
  /**
   * The focused tile left the strip: may focus move on to the next live tile? Only after the
   * user's own accept. Otherwise focus goes to the heading.
   */
  advanceFocusFrom?: (id: string) => boolean;
  /** Tiles shown in full before "+N more". Default 3. */
  maxTiles?: number;
  /** Strip-level handlers, used when a tile has none of its own. */
  onAccept?: (id: string) => void | Promise<void>;
  onDeclineStart?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** Sound is allowed on this device. Default true. False keeps `onRingChange` at false. */
  soundEnabled?: boolean;
  /** The sound hook: true while any live order waits (ring), false when none does. */
  onRingChange?: (ringing: boolean) => void;
  /** New live orders appeared after the first render (a chime hook; never a focus move). */
  onNewOrders?: (ids: string[]) => void;
  /** Speak arrivals and the 25% / 10% / 0 thresholds through PageAnnouncer. Default true. */
  announce?: boolean;
  /** The skip link's target. Default "new-orders". */
  id?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const KEYS = [
  ['Arrows', 'move'],
  ['A', 'accept'],
  ['D', 'decline'],
  ['Enter', 'details'],
] as const;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A clock from `now`, or from `serverNow` plus elapsed time, or the device clock. */
function useClock(now: (() => number) | undefined, serverNow: string | undefined): () => number {
  const offset = useMemo(() => {
    const server = serverNow ? Date.parse(serverNow) : Number.NaN;
    return Number.isFinite(server) ? server - Date.now() : 0;
  }, [serverNow]);
  return now ?? (() => Date.now() + offset);
}

/** Re-render once a second while orders wait (names carry the time left; it is never spoken). */
function useSecondTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return tick;
}

/** How many of the strip's thresholds a tile has passed (0 to 3). */
function passedSteps(t: NewOrdersStripTile, nowMs: number): number {
  const span = Math.max(1, t.windowSeconds ?? OFFER_WINDOW_SECONDS);
  const fraction = secondsLeft(t.expiresAt, nowMs) / span;
  return OFFER_ANNOUNCE_AT.filter((step) => fraction <= step).length;
}

/**
 * The strip's speech and sound: arrivals, thresholds and outcomes, once per order, and the ring
 * hook. Thresholds already behind an order when it first shows are recorded silently.
 */
function useStripVoice(
  tiles: readonly NewOrdersStripTile[],
  clock: () => number,
  opts: Pick<NewOrdersStripProps, 'announce' | 'soundEnabled' | 'onRingChange' | 'onNewOrders'> & { active: boolean },
) {
  const announce = useAnnounce();
  const seen = useRef<Set<string> | null>(null);
  const steps = useRef(new Map<string, number>());
  const wasLive = useRef(new Set<string>());
  const ringing = useRef(false);
  const speak = opts.announce !== false;

  useEffect(() => {
    const nowMs = clock();
    const live = opts.active ? tiles.filter(isLiveTile) : [];
    if (seen.current === null) {
      seen.current = new Set(live.map((t) => t.id));
      for (const t of live) steps.current.set(t.id, passedSteps(t, nowMs));
    } else {
      const arrivals = live.filter((t) => !seen.current!.has(t.id));
      for (const t of arrivals) {
        seen.current.add(t.id);
        steps.current.set(t.id, passedSteps(t, nowMs));
      }
      if (arrivals.length > 0) {
        opts.onNewOrders?.(arrivals.map((t) => t.id));
        if (speak) {
          const urgent = [...arrivals].sort((a, b) => secondsLeft(a.expiresAt, nowMs) - secondsLeft(b.expiresAt, nowMs))[0]!;
          const left = secondsLeft(urgent.expiresAt, nowMs);
          announce(
            arrivals.length === 1
              ? arrivalMessage(urgent.code, urgent.itemCount, left)
              : batchArrivalMessage(arrivals.length, urgent.code, left),
            { dedupeKey: `${arrivals.map((t) => t.id).join('+')}:new` },
          );
        }
      }
      // Thresholds, most urgent order first; only the newest step an order reached is spoken.
      const byUrgency = [...live].sort((a, b) => secondsLeft(a.expiresAt, nowMs) - secondsLeft(b.expiresAt, nowMs));
      for (const t of byUrgency) {
        const passed = passedSteps(t, nowMs);
        if (passed <= (steps.current.get(t.id) ?? 0)) continue;
        steps.current.set(t.id, passed);
        const step = OFFER_ANNOUNCE_AT[passed - 1]!;
        if (speak) {
          announce(thresholdMessage(t.code, step, secondsLeft(t.expiresAt, nowMs)), {
            politeness: step === 0.1 ? 'assertive' : 'polite',
            dedupeKey: step === 0 ? `${t.id}:end` : `${t.id}:${step}`,
          });
        }
      }
      // An order that ended on screen: its outcome is said once (the 0 step shares the key).
      for (const t of tiles) {
        if (!isLiveTile(t) && t.outcome && wasLive.current.has(t.id) && speak) {
          announce(`${t.code}: ${t.outcome.title}. ${t.outcome.body}`, { dedupeKey: `${t.id}:end` });
        }
      }
    }
    wasLive.current = new Set(live.map((t) => t.id));

    const ring = opts.soundEnabled !== false && live.length > 0;
    if (ring !== ringing.current) {
      ringing.current = ring;
      opts.onRingChange?.(ring);
    }
  });

  // The ring stops when the strip goes away.
  useEffect(
    () => () => {
      if (ringing.current) opts.onRingChange?.(false);
    },
    [],
  );
}

/** The new-order strip; see the module comment. */
export function NewOrdersStrip({
  status: statusProp,
  tiles: tilesProp,
  offers,
  rule,
  empty,
  error,
  compact,
  now,
  serverNow,
  isDesktop = true,
  flash = false,
  advanceFocusFrom,
  maxTiles = 3,
  onAccept,
  onDeclineStart,
  onOpen,
  soundEnabled,
  onRingChange,
  onNewOrders,
  announce,
  id = 'new-orders',
  testId = 'NewOrdersStrip',
  style,
}: NewOrdersStripProps) {
  const tiles = tilesProp ?? offers ?? [];
  const status = statusProp ?? (tiles.length > 0 ? 'live' : 'empty');
  const clock = useClock(now, serverNow);
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusInside, setFocusInside] = useState(false);
  const [start, setStart] = useState(0);
  const focusedId = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const prevLive = useRef(new Map<string, boolean>());
  const prevOrder = useRef<string[]>([]);

  const showing = status === 'live' && tiles.length > 0;
  const liveCount = showing ? tiles.filter(isLiveTile).length : 0;
  useSecondTick(liveCount > 0);
  useStripVoice(tiles, clock, { announce, soundEnabled, onRingChange, onNewOrders, active: status === 'live' });

  const ids = tiles.map((t) => t.id);
  const effectiveActive =
    activeId && ids.includes(activeId) ? activeId : (tiles.find((t) => isLiveTile(t))?.id ?? tiles[0]?.id ?? null);

  // The window of tiles in full keeps the active order in view.
  const n = tiles.length;
  const perView = Math.max(1, Math.min(maxTiles, n));
  let winStart = Math.max(0, Math.min(start, n - perView));
  const ai = effectiveActive ? ids.indexOf(effectiveActive) : -1;
  if (ai >= 0 && ai < winStart) winStart = ai;
  if (ai >= winStart + perView) winStart = ai - perView + 1;
  const visible = tiles.slice(winStart, winStart + perView);
  const hiddenBefore = winStart;
  const hiddenAfter = Math.max(0, n - winStart - perView);

  // Focus follows the ORDER, not the position, and never jumps to a new order.
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      const el = tileRefs.current.get(pendingFocus.current);
      pendingFocus.current = null;
      el?.focus();
    }
    const fid = focusedId.current;
    const activeEl = document.activeElement;
    const lost = !activeEl || activeEl === document.body;
    if (fid) {
      const nowTile = tiles.find((t) => t.id === fid);
      if (!nowTile) {
        if (lost) {
          const after = prevOrder.current.slice(prevOrder.current.indexOf(fid) + 1);
          const next = advanceFocusFrom?.(fid)
            ? (tiles.find((t) => isLiveTile(t) && after.includes(t.id)) ?? tiles.find((t) => isLiveTile(t)) ?? null)
            : null;
          if (next) {
            setActiveId(next.id);
            pendingFocus.current = next.id;
            tileRefs.current.get(next.id)?.focus();
          } else {
            focusedId.current = null;
            headingRef.current?.focus();
          }
        }
      } else if (prevLive.current.get(fid) && !isLiveTile(nowTile)) {
        tileRefs.current.get(fid)?.querySelector<HTMLElement>('[data-offer-note]')?.focus();
      } else if (lost && prevOrder.current.join('|') !== ids.join('|')) {
        // A re-sort moved the focused tile's node: keep focus on the same order.
        tileRefs.current.get(fid)?.focus();
      }
    }
    prevLive.current = new Map(tiles.map((t) => [t.id, isLiveTile(t)]));
    prevOrder.current = ids;
  });

  useEffect(() => {
    if (effectiveActive && effectiveActive !== activeId) setActiveId(effectiveActive);
  }, [effectiveActive, activeId]);

  const move = (fromId: string, dir: 1 | -1) => {
    const next = tiles[ids.indexOf(fromId) + dir];
    if (!next) return;
    setActiveId(next.id);
    pendingFocus.current = next.id;
    const el = tileRefs.current.get(next.id);
    if (el) {
      pendingFocus.current = null;
      el.focus();
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };

  const handlers = (tile: NewOrdersStripTile) => ({
    accept: tile.onAccept ?? (onAccept ? () => void onAccept(tile.id) : undefined),
    decline: tile.onDecline ?? tile.onDeclineStart ?? (onDeclineStart ? () => onDeclineStart(tile.id) : undefined),
    open: tile.onOpen ?? (onOpen ? () => onOpen(tile.id) : undefined),
  });

  const onTileKeyDown = (tile: NewOrdersStripTile) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    const onTile = target === e.currentTarget;
    const onNote = target.hasAttribute('data-offer-note');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!onTile && !onNote) return;
      e.preventDefault();
      move(tile.id, e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    // The guard: A / D / Enter act only on a live tile that itself has focus.
    if (!onTile || !isLiveTile(tile)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const h = handlers(tile);
    const accepting = Boolean(tile.acceptLoading ?? tile.accepting);
    if (key === 'a') {
      e.preventDefault();
      if (e.repeat || tile.acceptDisabled || accepting || tile.declining) return;
      h.accept?.();
    } else if (key === 'd') {
      e.preventDefault();
      if (!tile.declineDisabled && !accepting) h.decline?.();
    } else if (key === 'Enter') {
      e.preventDefault();
      h.open?.();
    }
  };

  const showOverflow = (dir: 1 | -1) => {
    const nextStart = dir === 1 ? Math.min(n - perView, winStart + perView) : Math.max(0, winStart - perView);
    setStart(nextStart);
    const first = tiles[dir === 1 ? Math.min(n - 1, nextStart + perView - 1) : nextStart];
    if (first) setActiveId(first.id);
  };

  // The compact row's Countdown re-anchors when serverNow changes, so it is read once per deadline.
  const compactExpires = compact?.expiresAt ?? null;
  const compactServerNow = useMemo(() => new Date(clock()).toISOString(), [compactExpires]);

  const ringingNow = liveCount > 0;
  const surface = ringingNow
    ? cn('border-b-2 border-line-brand', flash ? 'bg-surface-raised motion-reduce:bg-accent' : 'bg-accent')
    : 'border-b border-line-decorative bg-surface-base';
  const label = liveCount > 0 ? `New orders, ${liveCount} waiting` : 'New orders';

  if (compact) {
    const expires = compact.expiresAt === null ? Number.NaN : new Date(compact.expiresAt).getTime();
    return (
      <section
        id={id}
        ref={rootRef}
        tabIndex={-1}
        aria-label={label}
        data-testid={testId}
        data-compact=""
        style={style}
        className={cn('flex h-[88px] items-center gap-3 px-4 font-ui text-fg-primary outline-none', surface)}
      >
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          New orders
        </h2>
        {Number.isFinite(expires) ? (
          <Countdown
            variant="text"
            size="md"
            silent
            expiresAt={new Date(expires).toISOString()}
            serverNow={compactServerNow}
            windowSeconds={OFFER_WINDOW_SECONDS}
            className="shrink-0"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-lg font-bold">{compact.title}</span>
          <span className="truncate text-body-md text-fg-secondary">{compact.body}</span>
        </div>
        <Button variant={compact.buttonVariant} size="lg" accessibilityLabel={compact.buttonName} onPress={compact.onPress}>
          {compact.buttonLabel}
        </Button>
      </section>
    );
  }

  return (
    <section
      id={id}
      ref={rootRef}
      tabIndex={-1}
      aria-label={label}
      data-testid={testId}
      data-status={status}
      style={style}
      onFocus={(e) => {
        setFocusInside(true);
        const target = e.target as HTMLElement;
        const tileEl = target.closest<HTMLElement>('[data-offer-tile]');
        if (tileEl) {
          const tid = tileEl.dataset['offerId'] ?? null;
          focusedId.current = tid;
          if (tid) setActiveId(tid);
          setSelectedId(target === tileEl ? tid : null);
        } else {
          focusedId.current = null;
          setSelectedId(null);
        }
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        setSelectedId(null);
        if (next) {
          setFocusInside(false);
          focusedId.current = null;
          return;
        }
        // No next target: a click on nothing (forget the order, so a re-render never pulls focus
        // back) or the focused tile left the DOM (keep it: the layout effect moves focus on).
        const from = e.target as HTMLElement;
        setTimeout(() => {
          const ae = document.activeElement;
          if (from.isConnected && (!ae || ae === document.body) && document.hasFocus()) {
            focusedId.current = null;
            setFocusInside(false);
          }
        }, 0);
      }}
      className={cn('flex h-[186px] items-stretch gap-4 px-4 py-2.5 font-ui text-fg-primary outline-none', surface)}
    >
      <div className={cn('flex shrink-0 flex-col justify-center gap-1.5', isDesktop ? 'w-[168px]' : 'w-[120px]')}>
        <h2 ref={headingRef} tabIndex={-1} className="hg-focus m-0 text-body-lg font-bold outline-none">
          New orders
        </h2>
        {liveCount > 0 ? (
          <span className="self-start">
            <Badge variant="brand" size="md" icon="bell" label={`${liveCount} waiting`} />
          </span>
        ) : null}
        <p className="m-0 text-label-md text-fg-secondary">
          {rule ?? (liveCount > 0 ? 'Answer within 3 minutes. Soonest deadline first.' : 'Each new order rings until it is answered or times out.')}
        </p>
        {isDesktop && showing ? (
          <p aria-hidden="true" className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label-md text-fg-secondary">
            {KEYS.map(([k, what]) => (
              <KeyHint key={k} keyName={k} active={focusInside}>
                {what}
              </KeyHint>
            ))}
          </p>
        ) : null}
      </div>

      {status === 'loading' ? (
        <div role="status" aria-busy="true" aria-label="Loading new orders" className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton shape="rect" width={372} height={166} />
          <Skeleton shape="rect" width={372} height={166} />
          <span className="text-body-md text-fg-secondary">Loading new orders…</span>
        </div>
      ) : status === 'error' ? (
        <div className="flex min-w-0 flex-1 items-center">
          <InlineAlert
            tone="warning"
            title={error?.title ?? 'We couldn’t load new orders'}
            live="assertive"
            action={
              error?.onRetry ? (
                <Button variant="tertiary" size="md" iconStart="refresh" loading={Boolean(error.retrying)} onPress={() => error.onRetry?.()}>
                  Try again
                </Button>
              ) : undefined
            }
            className="w-full"
          >
            {error?.body ?? 'They are safe on the server, and their timers keep running. Check the connection and try again.'}
          </InlineAlert>
        </div>
      ) : !showing ? (
        <div
          role="status"
          className="flex min-w-0 flex-1 items-center gap-4 rounded-lg border border-dashed border-line-decorative bg-surface-raised px-5"
        >
          <Icon name={empty?.icon ?? 'bell'} size={32} className="shrink-0 text-fg-secondary" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body-lg font-bold">{empty?.title ?? 'No new orders'}</span>
            <span className="text-body-md text-fg-secondary">
              {empty?.body ?? 'New orders ring and appear here. Each one stays until you accept, decline, or it times out.'}
            </span>
          </div>
          {empty?.action ? (
            <Button
              variant={empty.action.variant ?? 'tertiary'}
              size="lg"
              loading={empty.action.loading}
              onPress={() => empty.action?.onPress()}
            >
              {empty.action.label}
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          role="group"
          aria-label="New orders, soonest deadline first. Left and right arrow keys move between orders."
          className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
        >
          {hiddenBefore > 0 ? (
            <StripOverflowButton
              aria-label={`Show ${hiddenBefore} earlier new ${plural(hiddenBefore, 'order', 'orders')}`}
              onClick={() => showOverflow(-1)}
            >
              <span>{hiddenBefore} earlier</span>
            </StripOverflowButton>
          ) : null}
          {visible.map((tile) => {
            const h = handlers(tile);
            return (
              <div key={tile.id} className={cn('flex max-w-[420px] min-w-0 flex-1', isDesktop ? 'min-w-[280px]' : 'min-w-[240px]')}>
                <OfferTile
                  {...tile}
                  now={tile.now ?? clock}
                  onAccept={h.accept}
                  onDecline={h.decline}
                  onOpen={h.open}
                  tileRef={(el) => {
                    if (el) tileRefs.current.set(tile.id, el);
                    else tileRefs.current.delete(tile.id);
                  }}
                  tabIndex={tile.id === effectiveActive ? 0 : -1}
                  selected={selectedId === tile.id}
                  compactDecline={!isDesktop}
                  onKeyDown={onTileKeyDown(tile)}
                  testId={tile.testId ?? `OfferTile-${tile.code}`}
                />
              </div>
            );
          })}
          {hiddenAfter > 0 ? (
            <StripOverflowButton
              aria-label={`Show ${hiddenAfter} more new ${plural(hiddenAfter, 'order', 'orders')}`}
              onClick={() => showOverflow(1)}
            >
              <span>+{hiddenAfter} more</span>
              <Icon name="chevron-right" size={20} />
            </StripOverflowButton>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** The restaurant stub's name for the strip (`NewOrderStrip`), kept so its seam can switch over. */
export const NewOrderStrip = NewOrdersStrip;
/** Stub name of `NewOrdersStripProps`. */
export type NewOrderStripProps = NewOrdersStripProps;
/** Stub name of `NewOrdersStripTile`. */
export type NewOrderStripTile = NewOrdersStripTile;
/** Stub name of `NewOrdersStripEmpty`. */
export type NewOrderStripEmpty = NewOrdersStripEmpty;
/** Stub name of `NewOrdersStripCompact`. */
export type NewOrderStripCompact = NewOrdersStripCompact;
