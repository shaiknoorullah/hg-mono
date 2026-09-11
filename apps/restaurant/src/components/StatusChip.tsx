import type { ReactNode } from 'react';
import { cx } from '@hg/ui-web';

/**
 * A small operational status pill — order/payout/document/onboarding state, role badges.
 *
 * `@hg/ui-web`'s own `Chip` (primitives tier) is deliberately narrower: it is the
 * attribute/filter/choice chip from `02-components.md` §10, with only `neutral | warning |
 * veg | nonveg` tones, and no `danger` or `halal` tone at all — by design, since solid green
 * is reserved to `color.halal.*` (RULE H-1 / lint L-4) and the certification tier's
 * `HalalBadge`/`HalalChecklist` own that namespace exclusively. A generic "here is this
 * order/payout/document's state" pill has no equivalent in the shared library, so this stays
 * a small local composition — built entirely from the same design tokens (never a hex, never
 * green) rather than a hand-rolled colour.
 */
export type StatusChipTone = 'neutral' | 'accent' | 'warning' | 'danger';

const TONE: Record<StatusChipTone, string> = {
  neutral: 'bg-surface-subtle text-fg-secondary border-line-decorative',
  // The soft orange wash `SideNav`'s active row and `Select`'s checked option both use —
  // reuses the system's one "in progress / selected" tint rather than inventing a new hue.
  accent: 'bg-[var(--hg-state-selected-tint)] text-fg-primary border-line-brand',
  warning: 'bg-feedback-warning-tint text-feedback-warning-text border-feedback-warning-border',
  danger: 'bg-feedback-danger-tint text-feedback-danger-text border-feedback-danger-border',
};

export function StatusChip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-label-sm font-semibold',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
