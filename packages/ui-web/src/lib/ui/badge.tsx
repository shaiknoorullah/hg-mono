/**
 * shadcn/ui `Badge`, restyled to HalalGoes roles. A small, non-interactive status marker. NOT
 * the halal badge.
 *
 * There is no `success` variant and no green at all: the only filled green in the system is the
 * halal seal (invariant 10, lint L-4). Tints come from the `feedback-*-tint` roles; the brand
 * tint is the action fill at low strength, never a ramp step.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the badge plate (tint and solid) or the bare dot-plus-word row. */
export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border font-ui tabular-nums',
  {
    variants: {
      variant: { neutral: '', info: '', warning: '', danger: '', brand: '', outline: '' },
      appearance: { tint: '', solid: 'border-transparent', dot: 'border-transparent bg-transparent px-0 text-fg-secondary' },
      size: {
        sm: 'h-4.5 px-1.5 text-label-sm',
        md: 'h-5.5 px-2 text-label-sm',
        lg: 'h-6.5 px-2.5 text-label-md',
      },
    },
    compoundVariants: [
      { appearance: 'tint', variant: 'neutral', className: 'bg-surface-subtle text-fg-secondary border-line-decorative' },
      { appearance: 'tint', variant: 'info', className: 'bg-feedback-info-tint text-feedback-info-tint-text border-feedback-info-border/25' },
      { appearance: 'tint', variant: 'warning', className: 'bg-feedback-warning-tint text-feedback-warning-tint-text border-feedback-warning-border/25' },
      { appearance: 'tint', variant: 'danger', className: 'bg-feedback-danger-tint text-feedback-danger-tint-text border-feedback-danger-border/25' },
      { appearance: 'tint', variant: 'brand', className: 'bg-action-primary-bg/12 text-fg-primary border-line-brand/25' },
      { appearance: ['tint', 'solid'], variant: 'outline', className: 'bg-transparent text-fg-secondary border-line-interactive' },
      { appearance: 'solid', variant: 'neutral', className: 'bg-surface-inverse text-fg-on-inverse' },
      { appearance: 'solid', variant: 'info', className: 'bg-feedback-info-solid text-feedback-info-on-solid' },
      { appearance: 'solid', variant: 'warning', className: 'bg-feedback-warning-solid text-feedback-warning-on-solid' },
      { appearance: 'solid', variant: 'danger', className: 'bg-feedback-danger-solid text-feedback-danger-on-solid' },
      { appearance: 'solid', variant: 'brand', className: 'bg-action-primary-bg text-action-primary-fg' },
    ],
    defaultVariants: { variant: 'neutral', appearance: 'tint', size: 'md' },
  },
);

/** Colour of the dot in the `dot` appearance, per variant. */
export const badgeDotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    variant: {
      neutral: 'bg-fg-tertiary',
      info: 'bg-feedback-info-icon',
      warning: 'bg-feedback-warning-icon',
      danger: 'bg-feedback-danger-icon',
      brand: 'bg-action-primary-bg',
      outline: 'bg-fg-tertiary',
    },
    size: { sm: 'size-1.5', md: 'size-1.5', lg: 'size-2' },
  },
  defaultVariants: { variant: 'neutral', size: 'md' },
});

/** The variant props `badgeVariants` takes. */
export type BadgeVariantProps = VariantProps<typeof badgeVariants>;

/** Props of the library badge plate. */
export interface LibBadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariantProps {}

/** shadcn `Badge`: a span with the recipe applied. */
export function Badge({ className, variant, appearance, size, ...props }: LibBadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, appearance, size }), className)}
      {...props}
    />
  );
}
