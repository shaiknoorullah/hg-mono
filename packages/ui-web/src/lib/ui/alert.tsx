/**
 * shadcn/ui `Alert`, styled with our role utilities: the base of the Banner + InlineAlert family
 * (approval packet P1). Tints only, never a solid: no tone here is a fill, so no tone can be a
 * green solid (invariant 10, lint L-4), and `slate` is the cool "we can't currently vouch" grey
 * for halal messages, which never use danger (invariant 9).
 *
 * `placement="page"` is a full-width bar with a bottom rule (the system banner slot);
 * `placement="inline"` is a rounded box in the flow of a region.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** Tone × placement classes for the alert box. */
export const alertVariants = cva('relative flex w-full items-start gap-3 text-fg-primary', {
  variants: {
    tone: {
      neutral: 'border-line-decorative bg-surface-subtle',
      info: 'border-feedback-info-border bg-feedback-info-tint',
      warning: 'border-feedback-warning-border bg-feedback-warning-tint',
      danger: 'border-feedback-danger-border bg-feedback-danger-tint',
      slate: 'border-halal-expired-border bg-halal-expired-tint',
    },
    placement: {
      page: 'border-b px-4 py-3',
      inline: 'rounded-md border p-3',
    },
    emphasis: {
      default: '',
      prominent: 'border-2 p-4',
    },
  },
  defaultVariants: { tone: 'info', placement: 'inline', emphasis: 'default' },
});

/** The tone's icon colour, from the same feedback (or halal slate) role as the box. */
export const alertIconTone = {
  neutral: 'text-fg-secondary',
  info: 'text-feedback-info-icon',
  warning: 'text-feedback-warning-icon',
  danger: 'text-feedback-danger-icon',
  slate: 'text-halal-expired-text',
} as const;

/** The alert box. The caller sets the live role (status, alert, or none). */
export function Alert({ className, tone, placement, emphasis, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={cn(alertVariants({ tone, placement, emphasis }), className)} {...props} />;
}

/** The alert's one-line title. */
export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('text-label-lg font-semibold text-fg-primary', className)} {...props} />;
}

/** The alert's body text. */
export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-body-sm text-fg-secondary', className)} {...props} />;
}
