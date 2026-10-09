/**
 * RNR `Badge`, adapted (design-system N1) — a small non-interactive status marker.
 *
 * **Not the halal badge**, and it never paints like one: there is no `success` variant (solid
 * green is the seal's alone, RULE H-1), and no `accent` (forest) variant. Every fill is a role
 * utility from the generated preset: the feedback tints and solids (`bg-feedback-info-tint`),
 * the brand fill (`bg-primary`) and the surfaces; never a ramp step.
 *
 * Never colour-only: a `dot` badge still renders its word beside the dot, and the whole badge is
 * one accessible text node in reading order.
 */
import * as React from 'react';
import { View } from 'react-native';
import { cva } from 'class-variance-authority';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';
import type { IconName } from '../../primitives/Icon';

/** `success` is absent on purpose — see the file header. */
export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';
/** tint (default) · solid · dot. */
export type BadgeAppearance = 'tint' | 'solid' | 'dot';
/** sm 18 · md 22 · lg 26. */
export type BadgeSize = 'sm' | 'md' | 'lg';

/** Plate classes: fill and border per variant × appearance, height per size. */
export const badgeVariants = cva('flex-row items-center self-start rounded-xs border', {
  variants: {
    variant: { neutral: '', info: '', warning: '', danger: '', brand: '', outline: '' },
    appearance: { tint: '', solid: 'border-transparent', dot: 'border-transparent bg-transparent' },
    size: {
      sm: 'min-h-[18px] gap-1 px-1.5',
      md: 'min-h-[22px] gap-1 px-2',
      lg: 'min-h-[26px] gap-1 px-2.5',
    },
    /** The field (rider) size: 32pt, `label.lg` (#191). */
    field: { true: 'min-h-8 px-2.5', false: '' },
  },
  compoundVariants: [
    { appearance: 'tint', variant: 'neutral', className: 'border-border bg-muted' },
    { appearance: 'tint', variant: 'info', className: 'border-feedback-info-border bg-feedback-info-tint' },
    { appearance: 'tint', variant: 'warning', className: 'border-feedback-warning-border bg-feedback-warning-tint' },
    { appearance: 'tint', variant: 'danger', className: 'border-feedback-danger-border bg-feedback-danger-tint' },
    { appearance: 'tint', variant: 'brand', className: 'border-border-brand bg-accent' },
    { appearance: ['tint', 'solid'], variant: 'outline', className: 'border-input bg-transparent' },
    { appearance: 'solid', variant: 'neutral', className: 'bg-surface-inverse' },
    { appearance: 'solid', variant: 'info', className: 'bg-feedback-info-solid' },
    { appearance: 'solid', variant: 'warning', className: 'bg-feedback-warning-solid' },
    { appearance: 'solid', variant: 'danger', className: 'bg-feedback-danger-solid' },
    { appearance: 'solid', variant: 'brand', className: 'bg-primary' },
  ],
  defaultVariants: { variant: 'neutral', appearance: 'tint', size: 'md', field: false },
});

/** Label classes: the role that reads on each plate. */
export const badgeTextVariants = cva('font-sans-semibold', {
  variants: {
    variant: { neutral: '', info: '', warning: '', danger: '', brand: '', outline: '' },
    appearance: { tint: '', solid: '', dot: 'text-muted-foreground' },
    size: { sm: 'text-label-sm', md: 'text-label-sm', lg: 'text-label-md' },
    field: { true: 'text-label-lg', false: '' },
  },
  compoundVariants: [
    { appearance: 'tint', variant: 'neutral', className: 'text-muted-foreground' },
    { appearance: 'tint', variant: 'info', className: 'text-feedback-info-tint-text' },
    { appearance: 'tint', variant: 'warning', className: 'text-feedback-warning-tint-text' },
    { appearance: 'tint', variant: 'danger', className: 'text-feedback-danger-tint-text' },
    { appearance: 'tint', variant: 'brand', className: 'text-foreground' },
    { appearance: ['tint', 'solid'], variant: 'outline', className: 'text-muted-foreground' },
    { appearance: 'solid', variant: 'neutral', className: 'text-fg-on-inverse' },
    { appearance: 'solid', variant: 'info', className: 'text-feedback-info-on-solid' },
    { appearance: 'solid', variant: 'warning', className: 'text-feedback-warning-on-solid' },
    { appearance: 'solid', variant: 'danger', className: 'text-feedback-danger-on-solid' },
    { appearance: 'solid', variant: 'brand', className: 'text-primary-foreground' },
  ],
  defaultVariants: { variant: 'neutral', appearance: 'tint', size: 'md', field: false },
});

/** The dot's fill per variant: the feedback icon role, the brand border, or tertiary text. */
const DOT: Record<BadgeVariant, string> = {
  neutral: 'bg-fg-tertiary',
  outline: 'bg-fg-tertiary',
  info: 'bg-feedback-info-icon',
  warning: 'bg-feedback-warning-icon',
  danger: 'bg-feedback-danger-icon',
  brand: 'bg-border-brand',
};

/** Props of the className-tier `Badge`. */
export interface BadgeProps {
  /** The word. Required: a badge is never colour-only. */
  text: string;
  variant?: BadgeVariant;
  appearance?: BadgeAppearance;
  size?: BadgeSize;
  /** The field (rider) size. */
  field?: boolean;
  /** A Solar glyph before the word, in the label's colour. */
  icon?: IconName;
  className?: string;
  testID?: string;
}

/** A status plate: optional dot or glyph, then the word, one accessible text node. */
export function Badge({
  text,
  variant = 'neutral',
  appearance = 'tint',
  size = 'md',
  field = false,
  icon,
  className,
  testID = 'Badge',
}: BadgeProps): React.ReactElement {
  const label = badgeTextVariants({ variant, appearance, size, field });
  const dot = size === 'lg' || field ? 'h-2 w-2' : 'h-1.5 w-1.5';
  const glyph = field ? 16 : size === 'lg' ? 16 : size === 'md' ? 14 : 12;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={text || undefined}
      className={cn(badgeVariants({ variant, appearance, size, field }), className)}
    >
      {appearance === 'dot' ? <View testID={`${testID}-dot`} className={cn('rounded-full', dot, DOT[variant])} /> : null}
      {icon ? <Glyph name={icon} size={glyph} className={label} /> : null}
      {text ? <Text className={label}>{text}</Text> : null}
    </View>
  );
}

/**
 * The count bubble on an `IconButton` (live rule: brand fill with the dark on-brand label, a
 * ring in the raised surface; a dot for `true`). Hidden from assistive technology: the count is
 * folded into the button's name, never a node of its own.
 */
export function CountBubble({ count, testID = 'IconButton-badge' }: { count?: string; testID?: string }): React.ReactElement {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        'absolute items-center justify-center rounded-full border-2 border-card bg-primary',
        count ? 'end-0.5 top-0.5 min-h-[18px] min-w-[18px] px-1' : 'end-1.5 top-1.5 h-2 w-2',
      )}
    >
      {count ? <Text className="font-sans-bold text-label-sm text-primary-foreground">{count}</Text> : null}
    </View>
  );
}
