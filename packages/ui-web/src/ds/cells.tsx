/**
 * The DataTable cell set (#141, docs/design/research/lytenyte-tables.md §5): what a column's
 * `render` returns. Every cell follows the same rules:
 *
 * 1. The text is the value; graphics (bars, glyphs) are `aria-hidden`.
 * 2. Numbers are tabular.
 * 3. Role tokens only; no ramp steps.
 * 4. No solid green except the halal seal; no red on a halal state.
 * 5. No per-cell timers: the countdown cells share one 1 Hz ticker (virtualisation removes
 *    off-screen cells, so local state would be lost anyway).
 * 6. A missing value renders an em dash that is spoken "Not available", EXCEPT the halal state,
 *    which never renders a badge for a missing value (invariant 8) and says "No status on file".
 * 7. Times are 12-hour, through `formatTime12h` (gate item 10).
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

import { reportHalalClientError } from '../certification/index.js';
import { reportDsClientError } from './client-error.js';
import { cn } from '../lib/utils.js';
import {
  GridCellButton,
  GridCellLink,
  GridMeterTrack,
  cellBadgeVariants,
  type GridMeterSegment,
} from '../lib/ui/data-grid.js';
import { Tooltip, TooltipProvider } from '../proposed/index.js';
import { formatFullDate, formatFullDateTime, formatRelative, formatShortDate, parseWireDate } from './data-format.js';
import { HalalBadge, Icon, Price, type DsIconName, type PriceProps } from './index.js';
import { formatTime12h } from './time.js';

/** Props every cell takes. */
interface CellCommon {
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

/** The missing-value mark: an em dash, spoken "Not available". */
export function MissingValue({ testId = 'MissingValue', style }: CellCommon) {
  return (
    <span data-testid={testId} style={style} className="text-fg-tertiary">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not available</span>
    </span>
  );
}

/** A tooltip that works with or without a provider above it. */
function CellTooltip({ content, children }: { content: ReactNode; children: React.ReactElement }) {
  return (
    <TooltipProvider>
      <Tooltip content={content}>{children}</Tooltip>
    </TooltipProvider>
  );
}

/* ───── TextCell ───── */

/** Props of `TextCell`: a name, a city, a reason. */
export interface TextCellProps extends CellCommon {
  value: string | null | undefined;
  /** A second, quieter line. */
  secondary?: string | null;
  /** Visible lines before truncation; the full text stays in the DOM and in `title`. */
  lines?: 1 | 2;
  muted?: boolean;
}

/** Plain text in a cell, with an optional secondary line. */
export function TextCell({ value, secondary, lines = 1, muted, testId = 'TextCell', style }: TextCellProps) {
  if (value === null || value === undefined || value === '') return <MissingValue testId={testId} style={style} />;
  return (
    <span data-testid={testId} style={style} className="flex min-w-0 flex-col">
      <span
        title={value}
        className={cn(
          'min-w-0 text-body-sm',
          muted ? 'text-fg-secondary' : 'text-fg-primary',
          lines === 1 ? 'truncate' : 'line-clamp-2 whitespace-normal',
        )}
      >
        {value}
      </span>
      {secondary ? <span className="truncate text-body-sm text-fg-secondary">{secondary}</span> : null}
    </span>
  );
}

/* ───── IdCell ───── */

/** Props of `IdCell`: an order code, a certificate number, a payout id. */
export interface IdCellProps extends CellCommon {
  value: string | null | undefined;
  /** Shows a Copy button named "Copy {noun} {value}"; announces "Copied". */
  copy?: boolean;
  /** Noun for the copy button's name, e.g. "order" → "Copy order HG-10482". */
  noun?: string;
  /** Makes the id a link to its record. */
  href?: string;
}

/** An id in the mono family, tabular, with an optional copy button and link. */
export function IdCell({ value, copy, noun, href, testId = 'IdCell', style }: IdCellProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!value) return <MissingValue testId={testId} style={style} />;
  const text = <span className="font-mono text-mono-sm tabular-nums">{value}</span>;
  return (
    <span data-testid={testId} style={style} className="inline-flex min-w-0 items-center gap-2">
      {href ? <GridCellLink href={href}>{text}</GridCellLink> : <span className="text-fg-primary">{text}</span>}
      {copy ? (
        <>
          <GridCellButton
            aria-label={`Copy ${noun ? `${noun} ` : ''}${value}`}
            className="w-auto px-2 text-label-sm"
            onClick={(event) => {
              event.stopPropagation();
              void navigator.clipboard?.writeText(value).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? <Icon name="check" size="sm" /> : 'Copy'}
          </GridCellButton>
          <span role="status" className="sr-only">
            {copied ? 'Copied' : ''}
          </span>
        </>
      ) : null}
    </span>
  );
}

/* ───── MoneyCell ───── */

/** Props of `MoneyCell`: int64 cents through `Price`, the only money renderer. */
export interface MoneyCellProps extends CellCommon {
  cents: number | null | undefined;
  currency?: 'CAD';
  sign?: 'auto' | 'always' | 'never';
  /** Refund and ledger amounts show "CAD". */
  showCode?: boolean;
  /** `negative-ops` (danger text) is for money only, e.g. a failed payout. Never halal. */
  tone?: 'default' | 'muted' | 'negative-ops';
}

/** Money in a cell: end-aligned, tabular, via `Price`. */
export function MoneyCell({
  cents,
  currency = 'CAD',
  sign,
  showCode,
  tone = 'default',
  testId = 'MoneyCell',
  style,
}: MoneyCellProps) {
  const integer = typeof cents === 'number' && Number.isSafeInteger(cents);
  useEffect(() => {
    if (cents !== null && cents !== undefined && !integer)
      reportDsClientError('MONEY_NOT_INTEGER_CENTS', {
        received: cents,
        surface: 'cell',
      });
  }, [cents, integer]);
  if (cents === null || cents === undefined) return <MissingValue testId={testId} style={style} />;
  // Money is int64 minor units (invariant 3). A fractional value is a bug upstream: render
  // nothing (never a rounded amount) and report it, as the live Price contract says.
  if (!integer) return <span data-testid={testId} data-money-invalid="true" style={style} />;
  return (
    <span
      data-testid={testId}
      style={style}
      className={cn(
        // Price sets its own text style; the cell's weight is restated on it.
        'inline-flex justify-end font-semibold tabular-nums [&_[data-testid=Price]]:font-semibold',
        tone === 'muted' && 'text-fg-secondary',
        tone === 'negative-ops' && 'text-feedback-danger-text',
      )}
    >
      <Price cents={cents as PriceProps['cents']} currency={currency} size="sm" sign={sign} showCode={showCode} />
    </span>
  );
}

/* ───── TimeCell and DateCell ───── */

/** Props of `TimeCell`: a clock time with the full date behind it. */
export interface TimeCellProps extends CellCommon {
  /** RFC-3339 from the server. */
  at: string | null | undefined;
  /** `absolute+relative` adds "12 min ago" as a secondary line (needs `serverNow`). */
  mode?: 'absolute' | 'absolute+relative';
  serverNow?: string;
  timeZone?: string;
}

/** "9:14 am" in the cell; the full date and time in a Tooltip and to screen readers. */
export function TimeCell({ at, mode = 'absolute', serverNow, timeZone, testId = 'TimeCell', style }: TimeCellProps) {
  const date = parseWireDate(at);
  const short = date ? formatTime12h(date, { timeZone }) : null;
  const full = date ? formatFullDateTime(date, { timeZone }) : null;
  if (!at || !short || !full) return <MissingValue testId={testId} style={style} />;
  const relative = mode === 'absolute+relative' && serverNow ? formatRelative(at, serverNow) : null;
  return (
    <span data-testid={testId} style={style} className="inline-flex flex-col">
      <CellTooltip content={full}>
        <time dateTime={at} className="whitespace-nowrap text-body-sm tabular-nums text-fg-primary">
          <span aria-hidden="true">{short}</span>
          <span className="sr-only">{full}</span>
        </time>
      </CellTooltip>
      {relative ? <span className="text-body-sm text-fg-tertiary">{relative}</span> : null}
    </span>
  );
}

/** Props of `DateCell`: a short date with the full date behind it. */
export interface DateCellProps extends CellCommon {
  /** ISO date-time, or a date-only value ("2026-10-20", read as a calendar date). */
  value: string | null | undefined;
  /** `datetime` adds the 12-hour time to the short form: "26 Sep, 5:55 pm". Default `date`. */
  mode?: 'date' | 'datetime';
  /** Shown instead of the em dash when there is no value (the admin stub's "Not set"). */
  emptyText?: string;
  /** Clock for the "this year" rule (tests, previews). */
  now?: Date;
  timeZone?: string;
}

/** "26 Sep" in the cell; "Saturday 26 September 2026" in a Tooltip and to screen readers. */
export function DateCell({
  value,
  mode = 'date',
  emptyText,
  now,
  timeZone,
  testId = 'DateCell',
  style,
}: DateCellProps) {
  const date = parseWireDate(value);
  const shortDate = formatShortDate(value, { now, timeZone });
  if (!value || !date || !shortDate) {
    return emptyText ? (
      <span data-testid={testId} style={style} className="text-body-sm text-fg-tertiary">
        {emptyText}
      </span>
    ) : (
      <MissingValue testId={testId} style={style} />
    );
  }
  const time = mode === 'datetime' ? formatTime12h(date, { timeZone }) : null;
  const short = time ? `${shortDate}, ${time}` : shortDate;
  const full =
    (mode === 'datetime' ? formatFullDateTime(value, { timeZone }) : formatFullDate(value, { timeZone })) ?? short;
  return (
    <span data-testid={testId} style={style} className="inline-flex">
      <CellTooltip content={full}>
        <time dateTime={value} className="whitespace-nowrap text-body-sm tabular-nums text-fg-primary">
          <span aria-hidden="true">{short}</span>
          <span className="sr-only">{full}</span>
        </time>
      </CellTooltip>
    </span>
  );
}

/* ───── CountdownCell ───── */

/** One shared 1 Hz clock for every countdown cell on the page. */
const ticker = (() => {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let now = Date.now();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          listeners.forEach((l) => l());
        }, 1000);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => now,
  };
})();

/** Skew above which the server clock wins (live Countdown: 5 s). */
const SKEW_LIMIT_MS = 5000;

/** Props of `CountdownCell`: an operational deadline. Never a certificate's expiry. */
export interface CountdownCellProps extends CellCommon {
  /** RFC-3339 deadline from the server. */
  deadlineAt: string | null | undefined;
  /** Server clock at response time. Skew above 5 s → the server clock is used. */
  serverNow: string;
  /** Full window in seconds; enables the urgent and critical thresholds. */
  windowSeconds?: number;
  /** Fraction of the window below which it is "Due soon" (default 0.25). */
  urgentThreshold?: number;
  /** Fraction below which it is critical (default 0.1). */
  criticalThreshold?: number;
  /** Fires once when the deadline passes (including when it had already passed). */
  onExpire?: () => void;
}

function formatRemaining(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A silent countdown: no live region and no per-cell announcements (a queue of 50 rows would
 * flood a screen reader). Urgency is a word ("Due soon", "Overdue") as well as a colour.
 */
export function CountdownCell({
  deadlineAt,
  serverNow,
  windowSeconds,
  urgentThreshold = 0.25,
  criticalThreshold = 0.1,
  onExpire,
  testId = 'CountdownCell',
  style,
}: CountdownCellProps) {
  const now = useSyncExternalStore(ticker.subscribe, ticker.get, ticker.get);
  const offsetRef = useRef<number | null>(null);
  if (offsetRef.current === null) {
    const server = Date.parse(serverNow);
    const skew = Number.isNaN(server) ? 0 : server - Date.now();
    offsetRef.current = Math.abs(skew) > SKEW_LIMIT_MS ? skew : 0;
  }
  const deadline = deadlineAt ? Date.parse(deadlineAt) : NaN;
  const remaining = Number.isNaN(deadline) ? NaN : deadline - (now + offsetRef.current);
  const expired = !Number.isNaN(remaining) && remaining <= 0;
  const firedRef = useRef(false);
  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);
  if (Number.isNaN(remaining)) return <MissingValue testId={testId} style={style} />;

  const fraction = windowSeconds ? remaining / (windowSeconds * 1000) : null;
  const level = expired
    ? 'overdue'
    : fraction !== null && fraction <= criticalThreshold
      ? 'critical'
      : fraction !== null && fraction <= urgentThreshold
        ? 'urgent'
        : 'normal';
  const word = level === 'overdue' ? 'Overdue' : level === 'normal' ? null : 'Due soon';
  return (
    <span
      data-testid={testId}
      data-level={level}
      style={style}
      className={cn(
        'inline-flex items-baseline gap-1 whitespace-nowrap text-body-sm tabular-nums',
        level === 'normal' && 'text-fg-primary',
        level === 'urgent' && 'text-feedback-warning-text',
        (level === 'critical' || level === 'overdue') && 'text-feedback-danger-text font-semibold',
      )}
    >
      {word ? <span>{word}</span> : null}
      <span>{level === 'overdue' ? `by ${formatRemaining(remaining)}` : formatRemaining(remaining)}</span>
    </span>
  );
}

/* ───── StatusCell ───── */

/** Tone of a status chip. No `success`: the only filled green is the halal seal. */
export type StatusCellVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';

/** Props of `StatusCell`: an order, payout or application state as a chip. */
export interface StatusCellProps extends CellCommon {
  label: string | null | undefined;
  /** Badge's variant name. Tint only. */
  variant?: StatusCellVariant;
  /** Alias of `variant` (the canvases' name). */
  tone?: StatusCellVariant;
  /** A glyph so the state never depends on colour alone. */
  icon?: DsIconName;
}

/** A status chip in a cell: the text label is the value, the icon is decoration. */
export function StatusCell({ label, variant, tone, icon, testId = 'StatusCell', style }: StatusCellProps) {
  if (!label) return <MissingValue testId={testId} style={style} />;
  return (
    <span data-testid={testId} style={style} className={cellBadgeVariants({ variant: variant ?? tone ?? 'neutral' })}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

/* ───── HalalStateCell ───── */

const HALAL_STATES = ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const;
/** The four server halal display states. */
export type HalalStateCellState = (typeof HALAL_STATES)[number];

/** Props of `HalalStateCell`. No colour, label or variant prop: a cell may not restyle the seal. */
export interface HalalStateCellProps extends CellCommon {
  /** Straight from the payload. Missing or unknown renders text, never a badge. */
  state: HalalStateCellState | null | undefined;
  restaurantId?: string;
  /** Wire date; EXPIRING_SOON shows "expires {d Mon}". */
  expiresOn?: string | null;
}

/** The text a missing halal state shows. Never a badge, never optimistic (invariant 8). */
export const HALAL_STATE_MISSING_TEXT = 'No status on file';

/** The operational HalalBadge in a cell; a missing state says "No status on file". */
export function HalalStateCell({
  state,
  restaurantId,
  expiresOn,
  testId = 'HalalStateCell',
  style,
}: HalalStateCellProps) {
  const known = typeof state === 'string' && (HALAL_STATES as readonly string[]).includes(state);
  useEffect(() => {
    if (!known)
      reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', {
        restaurantId,
        received: state,
        surface: 'cell',
      });
  }, [known, state, restaurantId]);
  if (!known) {
    return (
      <span data-testid={testId} data-halal-missing="true" style={style} className="text-body-sm text-fg-secondary">
        {HALAL_STATE_MISSING_TEXT}
      </span>
    );
  }
  return (
    // The legacy shield passes its size as an SVG attribute (`var(--hg-icon-sm)`), which SVG
    // ignores; the cell pins the glyph to the icon.sm token until the W5 rebuild lands.
    <span data-testid={testId} style={style} className="inline-flex [&_svg]:size-(--hg-icon-sm) [&_svg]:shrink-0">
      <HalalBadge state={state} surface="operational" size="sm" restaurantId={restaurantId} expiresOn={expiresOn} />
    </span>
  );
}

/* ───── MeterCell ───── */

/** Categorical colours a meter segment may use (viz roles). */
export type MeterVizToken = 'viz-1' | 'viz-2' | 'viz-3' | 'viz-4' | 'viz-5' | 'viz-6' | 'viz-7';

const VIZ_FILL: Record<MeterVizToken, string> = {
  'viz-1': 'bg-viz-1',
  'viz-2': 'bg-viz-2',
  'viz-3': 'bg-viz-3',
  'viz-4': 'bg-viz-4',
  'viz-5': 'bg-viz-5',
  'viz-6': 'bg-viz-6',
  'viz-7': 'bg-viz-7',
};

/** Props of `MeterCell`: progress ("5 / 7 checks") or a stacked inline bar. */
export interface MeterCellProps extends CellCommon {
  value: number;
  max: number;
  /** The visible text, and the value: "5 / 7 checks", "$41.20 of $58.00". */
  label: string;
  /** Stacked parts (e.g. a refund split); each has its own text in `label` or the row detail. */
  segments?: { value: number; token: MeterVizToken; label: string }[];
}

/**
 * A decorative bar plus the text. The bar is `aria-hidden` and there is no `progressbar` role
 * inside a grid cell. The single fill is info blue, never green, even when complete: a full
 * checklist is not a certification.
 */
export function MeterCell({ value, max, label, segments, testId = 'MeterCell', style }: MeterCellProps) {
  const safeMax = max > 0 ? max : 1;
  const parts: GridMeterSegment[] = segments?.length
    ? segments.map((s) => ({
        fraction: s.value / safeMax,
        className: VIZ_FILL[s.token],
      }))
    : [{ fraction: value / safeMax, className: 'bg-feedback-info-icon' }];
  const title = segments?.length ? segments.map((s) => s.label).join(' · ') : undefined;
  return (
    <span data-testid={testId} style={style} title={title} className="inline-flex w-full min-w-0 items-center gap-2">
      <GridMeterTrack segments={parts} className="w-16 flex-none" />
      <span className="truncate text-body-sm tabular-nums text-fg-primary">{label}</span>
    </span>
  );
}
