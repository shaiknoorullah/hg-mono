/**
 * TEMPORARY STUB for the proposed DS `NewOrderStrip` (LO `NewOrderStrip`, `Keyboard-strip`,
 * `Proposed-components`; ds-request(web): #675). Delete when `@hg/ui-web/proposed` exports it.
 *
 * The persistent strip of new orders under the status bar: a heading column ("New orders",
 * "{n} waiting", the rule line, key hints on desktop) and up to three OfferTiles, soonest
 * deadline first; a fourth and later wait behind an overflow control so no Accept is ever
 * half hidden.
 *
 * Keyboard (the stray-key guard, LO `Keyboard-strip`):
 * - the tiles are ONE tab stop (roving tabindex); Tab again reaches that tile's buttons;
 * - Left/Right move between orders; A accepts, D opens decline, Enter opens the order, and
 *   only while a live tile ITSELF has focus. Nowhere else do these keys do anything;
 * - a new order never takes focus; a re-sort keeps focus on the same order;
 * - when the focused order ends, focus moves to its outcome note (A is then inert); when it
 *   leaves the strip, focus moves to the "New orders" heading, never onto another live order
 *   (a stray A would accept an order the user never moved to). The one exception is the
 *   caller's `advanceFocusFrom`: after the user's own accept, focus moves to the next order.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Icon, type IconName } from '@hg/ui-web/primitives';
import { Badge } from './Badge';
import { Countdown } from './Countdown';
import { OfferTile, type OfferTileProps } from './OfferTile';
import { glyph, type GlyphName } from './glyph';

export type NewOrderStripTile = Omit<OfferTileProps, 'tabIndex' | 'selected' | 'onKeyDown' | 'onFocus' | 'compactDecline'>;

export interface NewOrderStripAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  loading?: boolean;
}

export interface NewOrderStripEmpty {
  icon?: GlyphName;
  title: string;
  body: string;
  action?: NewOrderStripAction;
}

export interface NewOrderStripCompact {
  title: string;
  body: string;
  buttonLabel: string;
  buttonName: string;
  buttonVariant: 'tertiary' | 'primary';
  onPress: () => void;
  /** The timer shown: the soonest other live order (else the open one). */
  expiresAt: number | null;
}

export interface NewOrderStripProps {
  status: 'loading' | 'empty' | 'live';
  rule: string;
  tiles: readonly NewOrderStripTile[];
  empty?: NewOrderStripEmpty;
  /** An offer or decline is open in the panel: one 88 px row instead of tiles. */
  compact?: NewOrderStripCompact | null;
  now: () => number;
  /** Desktop shows key hints and a "Decline…" text button; tablet a close IconButton. */
  isDesktop: boolean;
  /** Strip tint pulse (1 Hz) while ringing; reduced motion keeps it steady. */
  flash?: boolean;
  /**
   * The focused tile left the strip: may focus move on to the next live tile? Only for the
   * user's own accept (spec §8). Otherwise, and by default, focus goes to the heading.
   */
  advanceFocusFrom?: (id: string) => boolean;
  testId?: string;
}

const MAX_TILES = 3;

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function GlyphIcon({ name, size, className }: { name: GlyphName; size: number; className?: string }): ReactNode {
  const g: IconName | null = glyph(name);
  return g ? <Icon name={g} size={size} className={className} /> : null;
}

export function NewOrderStrip({ status, rule, tiles, empty, compact, now, isDesktop, flash, advanceFocusFrom, testId }: NewOrderStripProps) {
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

  const liveCount = tiles.filter((t) => t.live).length;
  const ids = tiles.map((t) => t.id);
  const effectiveActive = activeId && ids.includes(activeId) ? activeId : (tiles.find((t) => t.live)?.id ?? tiles[0]?.id ?? null);

  // How many tiles fit in full (never a half-hidden Accept): up to three, each at least
  // 280 px (240 on the tablet), with 100 px kept for the overflow control when it shows.
  const groupRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  useEffect(() => {
    const el = groupRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAreaWidth(el.clientWidth));
    ro.observe(el);
    setAreaWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [status, compact]);
  const n = tiles.length;
  const minTile = isDesktop ? 280 : 240;
  const fit = (w: number) => Math.max(1, Math.min(MAX_TILES, Math.floor((w + 12) / (minTile + 12))));
  let perView = areaWidth > 0 ? fit(areaWidth) : MAX_TILES;
  if (areaWidth > 0 && n > perView) perView = fit(areaWidth - 100);

  // The window of tiles in full: keep the active order in view.
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
          const oldIdx = prevOrder.current.indexOf(fid);
          const after = prevOrder.current.slice(oldIdx + 1);
          const next = advanceFocusFrom?.(fid)
            ? (tiles.find((t) => t.live && after.includes(t.id)) ?? tiles.find((t) => t.live) ?? null)
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
      } else if (prevLive.current.get(fid) && !nowTile.live) {
        const note = tileRefs.current.get(fid)?.querySelector<HTMLElement>('[data-offer-note]');
        note?.focus();
      } else if (lost && prevOrder.current.join('|') !== ids.join('|')) {
        // A re-sort moved the focused tile's node: keep focus on the same order.
        tileRefs.current.get(fid)?.focus();
      }
    }
    prevLive.current = new Map(tiles.map((t) => [t.id, t.live]));
    prevOrder.current = tiles.map((t) => t.id);
  });

  // A tile that leaves the window while focused (overflow click) is not refocused.
  useEffect(() => {
    if (effectiveActive && effectiveActive !== activeId) setActiveId(effectiveActive);
  }, [effectiveActive, activeId]);

  const move = (fromId: string, dir: 1 | -1) => {
    const idx = ids.indexOf(fromId);
    const next = tiles[idx + dir];
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

  const onTileKeyDown = (tile: NewOrderStripTile) => (e: KeyboardEvent<HTMLDivElement>) => {
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
    if (!onTile || !tile.live) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'a') {
      e.preventDefault();
      if (e.repeat || tile.acceptDisabled || tile.acceptLoading) return;
      tile.onAccept?.();
    } else if (key === 'd') {
      e.preventDefault();
      if (!tile.declineDisabled) tile.onDecline?.();
    } else if (key === 'Enter') {
      e.preventDefault();
      tile.onOpen?.();
    }
  };

  const showOverflow = (dir: 1 | -1) => {
    const nextStart = dir === 1 ? Math.min(n - perView, winStart + perView) : Math.max(0, winStart - perView);
    setStart(nextStart);
    const first = tiles[dir === 1 ? Math.min(n - 1, nextStart + perView - 1) : nextStart];
    if (first) setActiveId(first.id);
  };

  const ringing = status === 'live' && liveCount > 0;
  const surface = ringing
    ? `${flash ? 'bg-brand-100 motion-reduce:bg-brand-50' : 'bg-brand-50'} border-b-2 border-line-brand`
    : 'bg-surface-base border-b border-line-decorative';
  const label = liveCount > 0 ? `New orders, ${liveCount} waiting` : 'New orders';

  if (compact) {
    return (
      <section ref={rootRef} aria-label={label} data-testid={testId} data-compact="" className={`mt-2.5 flex h-[88px] items-center gap-3 px-4 ${surface}`}>
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          New orders
        </h2>
        {compact.expiresAt !== null ? <Countdown variant="text" size="md" expiresAt={compact.expiresAt} now={now} windowSeconds={180} className="shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] font-bold leading-[22px]">{compact.title}</span>
          <span className="truncate text-[15px] text-fg-secondary">{compact.body}</span>
        </div>
        <Button variant={compact.buttonVariant} size="lg" accessibilityLabel={compact.buttonName} onPress={compact.onPress}>
          {compact.buttonLabel}
        </Button>
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      aria-label={label}
      data-testid={testId}
      onFocus={(e) => {
        setFocusInside(true);
        const target = e.target as HTMLElement;
        const tileEl = target.closest<HTMLElement>('[data-offer-tile]');
        if (tileEl) {
          const id = tileEl.dataset['offerId'] ?? null;
          focusedId.current = id;
          if (id) setActiveId(id);
          setSelectedId(target === tileEl ? id : null);
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
        // No next target: either a click on nothing (forget the order, so a later re-render
        // never pulls focus back) or the focused tile left the DOM (keep it: the layout
        // effect moves focus on). A window switch keeps everything.
        const from = e.target as HTMLElement;
        window.setTimeout(() => {
          const ae = document.activeElement;
          if (from.isConnected && (!ae || ae === document.body) && document.hasFocus()) {
            focusedId.current = null;
            setFocusInside(false);
          }
        }, 0);
      }}
      className={`mt-2.5 flex h-[186px] items-stretch gap-4 px-4 py-2.5 ${surface}`}
    >
      <div className={`flex shrink-0 flex-col justify-center gap-1.5 ${isDesktop ? 'w-[168px]' : 'w-[120px]'}`}>
        <h2 ref={headingRef} tabIndex={-1} className="hg-focus text-[17px] font-bold leading-[22px] outline-none">
          New orders
        </h2>
        {liveCount > 0 ? (
          <span>
            <Badge variant="brand" size="md" icon="bell" label={`${liveCount} waiting`} />
          </span>
        ) : null}
        <p className="text-[13px] leading-[17px] text-fg-secondary">{rule}</p>
        {isDesktop && status === 'live' ? (
          <p aria-hidden="true" className="flex flex-wrap items-center gap-1 text-[13px] text-fg-secondary">
            {(
              [
                ['Arrows', 'move'],
                ['A', 'accept'],
                ['D', 'decline'],
                ['Enter', 'details'],
              ] as const
            ).map(([k, what]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <kbd
                  className={`rounded-xs border px-1 font-mono text-[13px] font-semibold ${
                    focusInside ? 'border-line-brand bg-brand-50' : 'border-line-interactive bg-surface-raised'
                  }`}
                >
                  {k}
                </kbd>
                {what}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading new orders" className="flex min-w-0 flex-1 items-center gap-3">
          <span className="h-[166px] w-[372px] animate-pulse rounded-lg bg-skeleton-base motion-reduce:animate-none" />
          <span className="h-[166px] w-[372px] animate-pulse rounded-lg bg-skeleton-highlight motion-reduce:animate-none" />
          <span className="text-[15px] text-fg-secondary">Loading new orders…</span>
        </div>
      ) : status === 'empty' || tiles.length === 0 ? (
        <div
          role="status"
          className="flex min-w-0 flex-1 items-center gap-4 rounded-lg border border-dashed border-line-decorative bg-surface-raised px-5"
        >
          <span className="shrink-0 text-fg-secondary">
            <GlyphIcon name={empty?.icon ?? 'bell'} size={32} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[17px] font-bold">{empty?.title ?? 'No new orders'}</span>
            <span className="text-[15px] leading-[21px] text-fg-secondary">
              {empty?.body ?? 'New orders ring and appear here. Each one stays until you accept, decline, or it times out.'}
            </span>
          </div>
          {empty?.action ? (
            <Button variant={empty.action.variant ?? 'secondary'} size="lg" loading={empty.action.loading} onPress={empty.action.onPress}>
              {empty.action.label}
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          ref={groupRef}
          role="group"
          aria-label="New orders, soonest deadline first. Left and right arrow keys move between orders."
          className="flex min-w-0 flex-1 items-stretch gap-3 overflow-hidden"
        >
          {hiddenBefore > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Show ${hiddenBefore} earlier new ${plural(hiddenBefore, 'order', 'orders')}`}
              onClick={() => showOverflow(-1)}
              className="hg-focus flex h-[166px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-line-interactive bg-surface-raised text-[15px] font-bold"
            >
              {hiddenBefore} earlier
            </button>
          ) : null}
          {visible.map((tile) => (
            <div
              key={tile.id}
              className={`flex min-w-0 ${isDesktop ? 'min-w-[280px]' : 'min-w-[240px]'} max-w-[420px] flex-1`}
            >
              <OfferTile
                {...tile}
                ref={(el) => {
                  if (el) tileRefs.current.set(tile.id, el);
                  else tileRefs.current.delete(tile.id);
                }}
                tabIndex={tile.id === effectiveActive ? 0 : -1}
                selected={selectedId === tile.id}
                compactDecline={!isDesktop}
                onKeyDown={onTileKeyDown(tile)}
              />
            </div>
          ))}
          {hiddenAfter > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Show ${hiddenAfter} more new ${plural(hiddenAfter, 'order', 'orders')}`}
              onClick={() => showOverflow(1)}
              className="hg-focus flex h-[166px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-line-interactive bg-surface-raised text-[15px] font-bold"
            >
              +{hiddenAfter} more
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
