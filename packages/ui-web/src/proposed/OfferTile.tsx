/**
 * `OfferTile` — one new order in the strip (approval packet P33; Live Orders canvas `OfferTile`,
 * `Proposed-components`, every `Offer-*` board). Proposed: awaiting the owner's approval.
 *
 * The tile itself is the focus stop: `role="group"`, roving tabindex driven by `NewOrdersStrip`,
 * `aria-keyshortcuts="A D Enter"` on a live tile, the ring from `:focus-visible`. Its name reads
 * "New order A7K2, 2 minutes 12 seconds left, $37.69".
 *
 * Live: Countdown ring (silent: the strip's PageAnnouncer is the only speaker) · the mono order
 * code · "You earn" Price (a skeleton while the order view loads) · "Name · N items" · the
 * customer-note flag · an optional status line · Decline… (44px ghost; a 44px close IconButton
 * on the tablet), 24px from the 72px `critical` orange Accept, the only orange on the page.
 * Ended: icon · code + badge · a note (the focus target when the focused order ends) · Remove.
 *
 * Disabled actions are `aria-disabled` (still focusable). Accepting holds Accept in its loading
 * state with the label kept; declining holds Decline… the same way.
 */

import { useMemo, type CSSProperties, type KeyboardEvent, type Ref } from 'react';

import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { Countdown } from '../ds/Countdown.js';
import { Icon, type DsIconName } from '../ds/Icon.js';
import { IconButton } from '../ds/IconButton.js';
import { Price } from '../ds/Price.js';
import { RovingTile } from '../lib/ui/offer-tile.js';
import { cn } from '../lib/utils.js';
import {
  OFFER_WINDOW_SECONDS,
  acceptLabel as defaultAcceptLabel,
  acceptName as defaultAcceptName,
  declineName as defaultDeclineName,
  deadlineMs,
  liveTileName,
  moneyText,
  offerSummary,
  secondsLeft,
  type OfferDeadline,
  type OfferOutcomeView,
} from './new-orders-copy.js';

/** The tone of a tile's status line. Danger is for a failed accept only; never a halal state. */
export type OfferLineTone = 'neutral' | 'warning' | 'danger' | 'info';

/** A one-line note under the summary ("Confirming with HalalGoes. Don’t tap again."). */
export interface OfferStatusLine {
  tone: OfferLineTone;
  icon: DsIconName;
  text: string;
}

export type { OfferOutcomeView };

/** Props of `OfferTile`. The restaurant stub's names are kept; the packet's names are aliases. */
export interface OfferTileProps {
  /** The order id; the strip's key and roving-focus identity. */
  id: string;
  /** The short order code, in the mono face ("A7K2"). */
  code: string;
  /** The tile's accessible name. Default: "New order A7K2, 2 minutes 12 seconds left, $37.69". */
  ariaLabel?: string;
  /** Roving tabindex: 0 on the strip's active tile, -1 on the others. Default 0 when alone. */
  tabIndex?: 0 | -1;
  /** Keyboard focus is on this tile: draws the "Selected" badge. */
  selected?: boolean;
  /** This order is open in the panel: a 2px brand border and "Open in panel". */
  inPanel?: boolean;
  /** Tablet: Decline is a 44px close IconButton so Accept keeps its width. */
  compactDecline?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;

  /** Live (waiting for an answer). Default: true unless `outcome` is set. */
  live?: boolean;
  /** The server's `deadline_at`: epoch ms or RFC 3339. */
  expiresAt?: OfferDeadline;
  /** Server clock (RFC 3339) for the Countdown's skew rule. Default: from `now()`. */
  serverNow?: string;
  /** The page's server-corrected clock, in epoch ms. Default `Date.now`. */
  now?: () => number;
  /** Default 180 (the restaurant's 3 minutes). */
  windowSeconds?: number;
  /** Fires once when the countdown reaches zero (the caller re-fetches). */
  onExpire?: () => void;
  /** "You earn" (`restaurant_net_cents`). `null` while the order view loads. */
  earnCents?: number | null;
  /** "Aisha K. · 3 items". Default: built from `customerName` and `itemCount`. */
  summary?: string;
  customerName?: string;
  itemCount?: number;
  /** The customer left a note: "Customer note" flag. */
  hasNote?: boolean;
  statusLine?: OfferStatusLine | null;
  /** Prep time on Accept ("Accept · 20 min"). */
  prepMinutes?: number;
  acceptLabel?: string;
  acceptName?: string;
  acceptLoading?: boolean;
  /** Packet name for `acceptLoading`. */
  accepting?: boolean;
  acceptDisabled?: boolean;
  /** A decline is being sent: Decline… holds its loading state and Accept is held. */
  declining?: boolean;
  declineDisabled?: boolean;
  declineName?: string;
  onAccept?: () => void;
  /** Opens the decline form (the packet's `onDeclineStart`). */
  onDecline?: () => void;
  /** Packet name for `onDecline`. */
  onDeclineStart?: () => void;
  /** Opens the order in the panel (Enter, or a click on the tile body). */
  onOpen?: () => void;

  /** The ended note; makes the tile not live. */
  outcome?: OfferOutcomeView | null;
  removeName?: string;
  onRemove?: () => void;

  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** The strip's handle on the tile's frame (roving focus). */
  tileRef?: Ref<HTMLDivElement>;
}

/** Tighter side padding so "Accept · 20 min" and its spinner fit a 280px tile. */
const ACCEPT_STYLE = { paddingInline: 'var(--hg-space-2)' } as const;

const LINE_TONE: Record<OfferLineTone, string> = {
  neutral: 'text-fg-secondary',
  warning: 'text-feedback-warning-tint-text',
  danger: 'text-feedback-danger-tint-text',
  info: 'text-feedback-info-tint-text',
};

/** Whether a tile is waiting for an answer. */
export function isLiveTile(p: Pick<OfferTileProps, 'live' | 'outcome'>): boolean {
  return p.live ?? !p.outcome;
}

/** One new order in the strip; see the module comment. */
export function OfferTile(props: OfferTileProps) {
  const { id, code, tabIndex = 0, selected, inPanel, onKeyDown, onFocus, testId = 'OfferTile', style, tileRef } = props;
  const live = isLiveTile(props);
  const nowMs = (props.now ?? Date.now)();
  const name =
    props.ariaLabel ??
    (live
      ? liveTileName(code, secondsLeft(props.expiresAt, nowMs), moneyText(props.earnCents))
      : `New order ${code}${props.outcome ? `, ${props.outcome.badge}` : ''}`);
  const surface = live ? 'live' : props.outcome?.tone === 'danger' ? 'failed' : 'ended';

  return (
    <RovingTile
      ref={tileRef}
      data-offer-tile=""
      data-offer-id={id}
      data-live={live ? 'true' : 'false'}
      data-testid={testId}
      aria-label={name}
      aria-keyshortcuts={live ? 'A D Enter' : undefined}
      tabIndex={tabIndex}
      surface={surface}
      inPanel={Boolean(inPanel)}
      style={style}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={(e) => {
        // The tile body opens the order; its buttons do their own thing.
        if (!live || (e.target as HTMLElement).closest('button,a')) return;
        props.onOpen?.();
      }}
    >
      {live ? <LiveBody {...props} tabIndex={tabIndex} /> : <EndedBody {...props} tabIndex={tabIndex} />}
    </RovingTile>
  );
}

function LiveBody(p: OfferTileProps & { tabIndex: 0 | -1 }) {
  const span = p.windowSeconds ?? OFFER_WINDOW_SECONDS;
  const expires = deadlineMs(p.expiresAt);
  // The Countdown re-anchors when serverNow changes, so it is read once per deadline.
  const serverNow = useMemo(
    () => p.serverNow ?? new Date((p.now ?? Date.now)()).toISOString(),
    [p.serverNow, expires],
  );
  const accepting = Boolean(p.acceptLoading ?? p.accepting);
  const declining = Boolean(p.declining);
  const label = p.acceptLabel ?? defaultAcceptLabel(p.prepMinutes);
  const summary = p.summary ?? offerSummary(p.customerName, p.itemCount);
  const noteInline = Boolean(p.hasNote && p.statusLine);
  const onDecline = p.onDecline ?? p.onDeclineStart;
  const declineLabel = p.declineName ?? defaultDeclineName(p.code);
  const declineDisabled = Boolean(p.declineDisabled) || accepting;

  return (
    <>
      <div className="flex min-h-16 items-center gap-3">
        {Number.isFinite(expires) ? (
          <Countdown
            variant="ring"
            size="md"
            silent
            expiresAt={new Date(expires).toISOString()}
            serverNow={serverNow}
            windowSeconds={span}
            onExpire={p.onExpire}
            className="shrink-0"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-heading-lg font-semibold">{p.code}</span>
            <span className="inline-flex items-baseline gap-1">
              <span className="sr-only">You earn</span>
              {typeof p.earnCents === 'number' ? (
                <Price cents={p.earnCents} size="md" />
              ) : (
                <Price cents={0} size="md" loading />
              )}
            </span>
            {p.selected ? <Badge variant="brand" size="sm" label="Selected" /> : null}
            {p.inPanel ? <Badge variant="neutral" size="sm" label="Open in panel" /> : null}
          </div>
          <span className="flex min-w-0 items-center gap-1.5 text-body-md">
            <span className="truncate text-fg-secondary">{summary}</span>
            {noteInline ? (
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap text-feedback-warning-text">
                <span aria-hidden="true" className="text-fg-secondary">
                  ·
                </span>
                <Icon name="warning" size={16} className="text-feedback-warning-icon" />
                Customer note
              </span>
            ) : null}
          </span>
          {p.hasNote && !p.statusLine ? (
            <span className="self-start">
              <Badge variant="warning" size="sm" icon="warning" label="Customer note" />
            </span>
          ) : null}
          {p.statusLine ? (
            <span role="note" className={cn('inline-flex items-center gap-1.5 text-label-md font-semibold', LINE_TONE[p.statusLine.tone])}>
              <Icon name={p.statusLine.icon} size={16} />
              {p.statusLine.text}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-6">
        {p.compactDecline ? (
          <IconButton
            icon="close"
            accessibilityLabel={declineLabel}
            variant="plain"
            size="md"
            loading={declining || undefined}
            disabled={declineDisabled}
            onPress={() => onDecline?.()}
            tabIndex={p.tabIndex}
            testId="OfferTile-decline"
          />
        ) : (
          <Button
            variant="ghost"
            size="md"
            loading={declining || undefined}
            disabled={declineDisabled}
            accessibilityLabel={declineLabel}
            onPress={() => onDecline?.()}
            tabIndex={p.tabIndex}
            testId="OfferTile-decline"
          >
            Decline…
          </Button>
        )}
        <span className="flex min-w-0 flex-1">
          <Button
            variant="primary"
            critical
            fullWidth
            loading={accepting || undefined}
            disabled={Boolean(p.acceptDisabled) || declining}
            style={ACCEPT_STYLE}
            accessibilityLabel={p.acceptName ?? defaultAcceptName(label, p.code, p.prepMinutes)}
            onPress={() => p.onAccept?.()}
            tabIndex={p.tabIndex}
            testId="OfferTile-accept"
          >
            {label}
          </Button>
        </span>
      </div>
    </>
  );
}

function EndedBody(p: OfferTileProps & { tabIndex: 0 | -1 }) {
  const o = p.outcome;
  if (!o) return null;
  const danger = o.tone === 'danger';
  return (
    <>
      <div className="flex min-h-0 flex-1 items-start gap-2.5">
        <Icon name={o.icon} size={32} className={cn('shrink-0', danger ? 'text-feedback-danger-icon' : 'text-fg-secondary')} />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-heading-lg font-semibold">{p.code}</span>
            <Badge variant={danger ? 'danger' : 'neutral'} size="sm" label={o.badge} />
          </span>
          <span role="note" tabIndex={-1} data-offer-note="" className="hg-focus text-body-md font-bold outline-none">
            {o.title}
          </span>
          <span className="text-body-md">{o.body}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant={o.keep ? 'tertiary' : 'ghost'}
          size="md"
          accessibilityLabel={p.removeName ?? `Remove order ${p.code} from new orders`}
          onPress={() => p.onRemove?.()}
          tabIndex={p.tabIndex}
          testId="OfferTile-remove"
        >
          {o.keep ? 'Remove' : 'Remove now'}
        </Button>
        <span className="text-label-md text-fg-secondary">
          {o.keep ? 'Stays until you remove it. Kept in History.' : 'Leaves by itself in 60 s. Kept in History.'}
        </span>
      </div>
    </>
  );
}
