/**
 * TEMPORARY STUB for the proposed DS `OfferTile` (LO `OfferTile`, `Proposed-components`;
 * ds-request(web): #675). Delete when `@hg/ui-web/proposed` exports it.
 *
 * One new order in the strip. The tile itself is the focus stop (role group, roving tabindex
 * driven by `NewOrderStrip`, `aria-keyshortcuts="A D Enter"` on live tiles); the ring is drawn
 * on the tile from `:focus-visible`, never via the Accept button's own ring.
 *
 * Live: Countdown ring · code · Price (or loading) · summary · Customer note · status line ·
 * Decline… (ghost; a close IconButton on the tablet) and the 72 px orange Accept.
 * Outcome: icon · code + badge · title (the focus target when the focused order ends) · body
 * · Remove.
 */
import { forwardRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Cents } from '@hg/api-client';
import { Button, Icon, IconButton, type IconName } from '@hg/ui-web/primitives';
import { Price } from '@hg/ui-web/content';
import { Badge } from './Badge';
import { Countdown } from './Countdown';
import { glyph, type GlyphName } from './glyph';

export type OfferLineTone = 'neutral' | 'warning' | 'danger' | 'info';

export interface OfferStatusLine {
  tone: OfferLineTone;
  icon: GlyphName;
  text: string;
}

export interface OfferOutcomeView {
  tone: 'neutral' | 'danger';
  icon: GlyphName;
  badge: string;
  title: string;
  body: string;
  /** Capture failed stays until removed; everything else leaves by itself. */
  keep: boolean;
}

export interface OfferTileProps {
  id: string;
  code: string;
  /** The tile's accessible name ("New order A7K2, 2 minutes 12 seconds left, $37.69"). */
  ariaLabel: string;
  /** Roving tabindex: 0 on the active tile, −1 on the others. */
  tabIndex: 0 | -1;
  /** Keyboard focus is on this tile: draws the "Selected" badge. */
  selected?: boolean;
  /** This order is open in the panel: 2 px brand border and "Open in panel". */
  inPanel?: boolean;
  /** Tablet: Decline is a 44 px close IconButton. */
  compactDecline?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;

  // ── live ──
  live: boolean;
  expiresAt?: number;
  now?: () => number;
  windowSeconds?: number;
  /** Null while the order view loads (`Price loading`). */
  earnCents?: Cents | null;
  summary?: string;
  hasNote?: boolean;
  statusLine?: OfferStatusLine | null;
  acceptLabel?: string;
  acceptName?: string;
  acceptLoading?: boolean;
  acceptDisabled?: boolean;
  declineDisabled?: boolean;
  declineName?: string;
  onAccept?: () => void;
  onDecline?: () => void;
  onOpen?: () => void;

  // ── outcome ──
  outcome?: OfferOutcomeView | null;
  removeName?: string;
  onRemove?: () => void;
}

const LINE_TONE: Record<OfferLineTone, string> = {
  neutral: 'text-fg-secondary',
  warning: 'text-feedback-warning-tint-text',
  danger: 'text-feedback-danger-tint-text',
  info: 'text-feedback-info-tint-text',
};

function GlyphIcon({ name, size, className }: { name: GlyphName; size: number; className?: string }): ReactNode {
  const g: IconName | null = glyph(name);
  return g ? <Icon name={g} size={size} className={className} /> : null;
}

export const OfferTile = forwardRef<HTMLDivElement, OfferTileProps>(function OfferTile(props, ref) {
  const { id, code, ariaLabel, tabIndex, selected, inPanel, onKeyDown, onFocus, live } = props;
  const border = inPanel
    ? 'border-2 border-line-brand'
    : live
      ? 'border border-line-decorative'
      : props.outcome?.tone === 'danger'
        ? 'border border-feedback-danger-border'
        : 'border border-line-decorative';
  const surface = live ? 'bg-surface-raised shadow-sm' : 'bg-surface-subtle';

  return (
    <div
      ref={ref}
      role="group"
      data-offer-tile=""
      data-offer-id={id}
      data-live={live ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-keyshortcuts={live ? 'A D Enter' : undefined}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={(e) => {
        // The tile body opens the order; its buttons do their own thing.
        if (!live || (e.target as HTMLElement).closest('button')) return;
        props.onOpen?.();
      }}
      className={`hg-focus flex h-[166px] min-w-0 flex-1 cursor-default flex-col gap-2.5 overflow-hidden rounded-lg p-2.5 text-fg-primary outline-none ${surface} ${border}`}
    >
      {live ? <LiveBody {...props} selected={selected} /> : <OutcomeBody {...props} code={code} />}
    </div>
  );
});

function LiveBody(p: OfferTileProps) {
  const noteInline = p.hasNote && p.statusLine;
  return (
    <>
      <div className="flex min-h-16 items-center gap-3">
        {p.expiresAt !== undefined && p.now ? (
          <Countdown variant="ring" size="md" expiresAt={p.expiresAt} now={p.now} windowSeconds={p.windowSeconds ?? 180} className="shrink-0" />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[20px] font-semibold leading-6">{p.code}</span>
            {p.earnCents === null || p.earnCents === undefined ? (
              <Price cents={0 as Cents} size="md" loading />
            ) : (
              <Price cents={p.earnCents} size="md" />
            )}
            {p.selected ? <Badge variant="brand" size="sm" label="Selected" /> : null}
            {p.inPanel ? <Badge variant="neutral" size="sm" label="Open in panel" /> : null}
          </div>
          <span className="truncate text-[15px] leading-5 text-fg-secondary">
            {p.summary}
            {noteInline ? (
              <>
                {' · '}
                <span className="font-semibold text-feedback-warning-text">Customer note</span>
              </>
            ) : null}
          </span>
          {p.hasNote && !p.statusLine ? (
            <span>
              <Badge variant="warning" size="sm" label="Customer note" />
            </span>
          ) : null}
          {p.statusLine ? (
            <span role="note" className={`flex items-center gap-1 text-[13px] font-semibold leading-4 ${LINE_TONE[p.statusLine.tone]}`}>
              <GlyphIcon name={p.statusLine.icon} size={14} />
              {p.statusLine.text}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-6">
        {p.compactDecline ? (
          <IconButton
            icon={<Icon name="close" size={20} />}
            accessibilityLabel={p.declineName ?? `Decline order ${p.code}, choose a reason`}
            variant="plain"
            size="md"
            disabled={p.declineDisabled}
            onPress={p.onDecline}
            tabIndex={p.tabIndex}
          />
        ) : (
          <Button
            variant="ghost"
            size="md"
            disabled={p.declineDisabled}
            accessibilityLabel={p.declineName ?? `Decline order ${p.code}, choose a reason`}
            onPress={p.onDecline}
            tabIndex={p.tabIndex}
          >
            Decline…
          </Button>
        )}
        <Button
          variant="primary"
          size="xl"
          fullWidth
          loading={p.acceptLoading}
          disabled={p.acceptDisabled}
          accessibilityLabel={p.acceptName}
          onPress={p.onAccept}
          tabIndex={p.tabIndex}
          className="h-[72px]! min-w-0 flex-1 text-[19px]"
        >
          {p.acceptLabel}
        </Button>
      </div>
    </>
  );
}

function OutcomeBody(p: OfferTileProps) {
  const o = p.outcome;
  if (!o) return null;
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className={o.tone === 'danger' ? 'text-feedback-danger-icon' : 'text-fg-secondary'}>
          <GlyphIcon name={o.icon} size={28} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[20px] font-semibold leading-6">{p.code}</span>
            <Badge variant={o.tone === 'danger' ? 'danger' : 'neutral'} size="sm" label={o.badge} />
          </span>
          <span role="note" tabIndex={-1} data-offer-note="" className="hg-focus text-[15px] font-bold leading-5 outline-none">
            {o.title}
          </span>
          <span className="text-[15px] leading-5">{o.body}</span>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <Button variant={o.keep ? 'tertiary' : 'ghost'} size="md" accessibilityLabel={p.removeName} onPress={p.onRemove} tabIndex={p.tabIndex}>
          {o.keep ? 'Remove' : 'Remove now'}
        </Button>
        <span className="text-[13px] text-fg-secondary">
          {o.keep ? 'Stays until you remove it. Kept in History.' : 'Leaves by itself in 60 s. Kept in History.'}
        </span>
      </div>
    </>
  );
}
