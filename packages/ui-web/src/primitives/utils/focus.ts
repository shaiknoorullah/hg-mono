import { roles } from '../../tokens/index.js';

/**
 * The two-layer focus ring (04-accessibility.md §4.1, 02-components.md rule 3).
 *
 * Layer 1: 2px offset in the container's OWN colour.
 * Layer 2: 3px ring in `focus.ring`, flipping to `focus.onColor` on any
 *          container where the ring falls below 3:1.
 *
 * Which containers flip is not a judgement call and is not written down here:
 * the token generator measures contrast(focus.ring, container) for each
 * container and emits `--hg-focus-ring-on-<container>` already flipped.
 * `roles.light.focus.ringOn` carries the same values for TS consumers.
 *
 * Usage: put `HG_FOCUS` on any focusable element, plus one `focusOn.*` entry
 * when the element sits on a coloured fill.
 */

/** Base class. Draws nothing until :focus-visible. */
export const HG_FOCUS = 'hg-focus';

/** Inset variant for containers that clip (overflow: hidden). */
export const HG_FOCUS_INSET = 'hg-focus hg-focus-inset';

/**
 * For a wrapper that draws the ring on behalf of a focusable descendant —
 * a text field whose border, prefix and suffix live on the wrapper. Keyed on
 * :focus-visible inside, so pointer focus still does not draw a ring.
 */
export const HG_FOCUS_WITHIN = 'hg-focus-within';

/**
 * Per-container overrides. Each sets both layers: the offset takes the
 * container's fill so the 2px gap disappears into the control, and the ring
 * takes the generator's already-flipped value.
 */
export const focusOn = {
  /** Default: surface-coloured offset, info ring. Nothing to override. */
  surface: '',
  brand:
    '[--hg-focus-ring-offset:var(--hg-action-primary-bg)] [--hg-focus-ring-color:var(--hg-focus-ring-on-brand)]',
  accent:
    '[--hg-focus-ring-offset:var(--hg-action-secondary-bg)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]',
  danger:
    '[--hg-focus-ring-offset:var(--hg-action-danger-bg)] [--hg-focus-ring-color:var(--hg-focus-ring-on-danger)]',
  control:
    '[--hg-focus-ring-offset:var(--hg-control-selected-bg)] [--hg-focus-ring-color:var(--hg-focus-ring-on-brand)]',
  inverse:
    '[--hg-focus-ring-offset:var(--hg-surface-inverse)] [--hg-focus-ring-color:var(--hg-focus-ring-on-inverse)]',
} as const;

export type FocusContainer = keyof typeof focusOn;

/** The resolved ring colour for a container, for tests and non-CSS consumers. */
export function focusRingColor(
  container: keyof typeof roles.light.focus.ringOn,
  scheme: 'light' | 'dark' = 'light',
): string {
  return roles[scheme].focus.ringOn[container];
}
