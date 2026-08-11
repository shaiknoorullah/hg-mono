/**
 * Small helpers shared by the certification and content tiers.
 *
 * This module defines **no** design values. Colour, type, radius, elevation and spacing are all
 * consumed as Tailwind utilities generated from `src/tokens/theme.css` (`bg-halal-certified-seal`,
 * `text-label-sm`, `rounded-md`, `shadow-e1`, `p-4`, …), which is how lint L-1 (no raw colour)
 * and L-2 (roles, never ramp steps) are satisfied at the call site.
 *
 * The two things Tailwind has no utility for — the density scale and the touch-target floor —
 * are referenced here as the custom properties the token pipeline emits, so that no component
 * hard-codes 16 or 44 (`01-foundations.md` §4, `04-accessibility.md` §2).
 */
import type { CSSProperties } from 'react';

/** `density.cardPadding` etc. Set once at the theme root; components only read it. */
export const DENSITY = {
  rowHeight: 'var(--hg-density-row-height)',
  cardPadding: 'var(--hg-density-card-padding)',
  gutter: 'var(--hg-density-gutter)',
} as const;

/** `target.*`. The hit area grows to meet these; the visual never does. */
export const TARGET = {
  min: 'var(--hg-target-min)',
  field: 'var(--hg-target-field)',
  criticalField: 'var(--hg-target-critical-field)',
  spacing: 'var(--hg-target-spacing)',
} as const;

/** `icon.*`. */
export const ICON = {
  sm: 'var(--hg-icon-sm)',
  md: 'var(--hg-icon-md)',
  lg: 'var(--hg-icon-lg)',
  xl: 'var(--hg-icon-xl)',
} as const;

/**
 * Tabular figures. Mandatory on `Price`, `Rating`, `Countdown`, `StatusTimeline` and
 * `DataTable` (`01-foundations.md` §3.2): proportional figures make a changing number jitter.
 */
export const TABULAR: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/**
 * The two-layer focus ring of `04-accessibility.md` §4.1, as utilities: a 2px offset in the
 * container colour, then a 3px ring in `focus.ring`. `outline: none` without a replacement is
 * a lint failure, so this string is the only focus treatment used in these tiers.
 */
export const FOCUS_RING =
  'outline-none focus-visible:outline-3 focus-visible:outline-focus-ring focus-visible:outline-offset-2';

/**
 * The ring flips to `focus.onColor` on a container where `info.500` falls below 3:1 — measured
 * 2.33:1 on the halal seal, so a pressable seal uses this variant.
 */
export const FOCUS_RING_ON_COLOR =
  'outline-none focus-visible:outline-3 focus-visible:outline-[var(--hg-focus-ring-on-halal)] focus-visible:outline-offset-2';

/** Trivial class joiner. Falsy entries are dropped. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Expands a control's hit area to `target.min` without changing its visual size
 * (`04-accessibility.md` §2). Rendered as a child of the control, so a press anywhere inside it
 * activates the control.
 */
export const HIT_AREA_STYLE: CSSProperties = {
  position: 'absolute',
  insetInlineStart: '50%',
  insetBlockStart: '50%',
  transform: 'translate(-50%, -50%)',
  minInlineSize: TARGET.min,
  minBlockSize: TARGET.min,
  inlineSize: '100%',
  blockSize: '100%',
};
