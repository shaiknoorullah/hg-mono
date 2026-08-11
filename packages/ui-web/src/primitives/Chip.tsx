import { forwardRef, type ReactNode, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, X } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Chip / FilterChip — 02-components.md §10.
 *
 * `static` is an attribute (cuisine, allergen, veg marker). `filter` toggles
 * (role=button + aria-pressed). `choice` is single-select within a row.
 * `input` is removable.
 *
 * RULE H-1 lives here too: the veg marker is `success` OUTLINE, never a filled
 * green pill, and there is no filled-green tone in the union at all. `veg` and
 * `nonveg` are distinct GLYPHS (square-in-square, filled vs outline) before
 * they are colours — 04-accessibility.md §1.4 forbids a bare coloured dot.
 *
 * Selected state is border + tint + a check glyph, never fill alone.
 *
 * States: default · hover · active · focus-visible · selected · disabled ·
 * loading · error (a filter whose backing query failed; the chip carries the
 * danger border and the row above carries the message).
 */

export type ChipVariant = 'static' | 'filter' | 'choice' | 'input';
export type ChipTone = 'neutral' | 'warning' | 'veg' | 'nonveg';

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  tone?: ChipTone;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  selected?: boolean;
  count?: number;
  onPress?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  className?: string;
}

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-[26px] px-3 text-label-md gap-1',
  md: 'h-8 px-3 text-label-md gap-2',
};

/** Outline-only. There is no filled tone — see RULE H-1. */
const TONE: Record<ChipTone, string> = {
  neutral: 'border-line-interactive text-fg-primary',
  warning: 'border-feedback-warning-border text-feedback-warning-text',
  veg: 'border-feedback-success-border text-feedback-success-text',
  nonveg: 'border-feedback-danger-border text-feedback-danger-text',
};

/** Square-in-square: filled for veg, outline for nonveg (04-a11y §1.4). */
function DietGlyph({ tone }: { tone: 'veg' | 'nonveg' }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {tone === 'veg' ? (
        <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" />
      ) : (
        <rect x="5" y="5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  {
    label,
    variant = 'static',
    tone = 'neutral',
    size = 'md',
    icon,
    selected = false,
    count,
    onPress,
    onRemove,
    disabled = false,
    loading = false,
    error = false,
    className,
  },
  ref,
) {
  const interactive = variant === 'filter' || variant === 'choice';
  const inert = disabled || loading;

  const classes = cx(
    'inline-flex select-none items-center rounded-full border',
    'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
    SIZE[size],
    TONE[tone],
    // Selected is border + tint + check, never fill alone.
    selected && 'border-line-brand bg-[var(--hg-state-selected-tint)] text-fg-primary',
    error && 'border-2 border-feedback-danger-border',
    interactive && !inert && 'cursor-pointer hover:bg-[var(--hg-state-hover-overlay)] active:bg-[var(--hg-state-pressed-overlay)]',
    inert && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
    interactive && HG_FOCUS,
    className,
  );

  const body = (
    <>
      {loading ? (
        <Spinner size="sm" decorative />
      ) : tone === 'veg' || tone === 'nonveg' ? (
        <DietGlyph tone={tone} />
      ) : (
        (icon ?? null)
      )}
      {selected ? <Check aria-hidden="true" size={14} className="shrink-0" /> : null}
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span data-hg-numeric="tabular" className="text-fg-tertiary">
          {count}
        </span>
      ) : null}
    </>
  );

  if (variant === 'input') {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        data-testid="hg-chip"
        data-variant={variant}
        className={classes}
      >
        {body}
        <button
          type="button"
          onClick={onRemove}
          disabled={inert}
          // The visual X is small; the hit area is not (target.min).
          className={cx(
            'relative -me-1 inline-flex size-6 items-center justify-center rounded-full',
            'after:absolute after:-inset-2.5 after:content-[""]',
            HG_FOCUS,
          )}
          aria-label={`Remove ${label}`}
        >
          <X aria-hidden="true" size={14} />
        </button>
      </span>
    );
  }

  if (!interactive) {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        data-testid="hg-chip"
        data-variant={variant}
        className={classes}
      >
        {body}
      </span>
    );
  }

  const block = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      // `filter` is a toggle → aria-pressed. `choice` is one-of-N → aria-checked
      // on a radio role would need a group; the row that owns it supplies one,
      // so the chip itself reports pressed state and the group reports the name.
      aria-pressed={selected}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-testid="hg-chip"
      data-variant={variant}
      data-selected={selected || undefined}
      className={classes}
      onClick={(event) => {
        if (inert) return block(event);
        onPress?.();
      }}
    >
      {body}
    </button>
  );
});
