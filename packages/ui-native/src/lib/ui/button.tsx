/**
 * RNR `Button`, adapted (redesign, N0 spike) — `cva` variants over a react-native `Pressable`.
 *
 * Adaptations from the RNR template, all deliberate:
 *   - colours are the generated aliases (`bg-primary` → `--primary` → `action.primary`), held
 *     as hex in `global.<theme>.css`; no `hsl()` anywhere;
 *   - the primary label is `text-primary-foreground` = `text.onBrand` (#0F241C), never white;
 *   - there is no `success` variant: solid green belongs to `color.halal.*` alone (invariant 10);
 *   - sizes are touch targets from the preset (`min-h-target-min` 44, `min-h-target-field` 56);
 *   - no lucide icons.
 *
 * Not yet the design-system Button (that is N1): no loading state, no 200% label wrap check.
 */
import * as React from 'react';
import { Pressable } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../utils';
import { TextClassContext } from './text';

/** Container classes per `variant` × `size`: fill, border and the touch-target height. */
export const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-md', {
  variants: {
    variant: {
      default: 'bg-primary active:opacity-90',
      secondary: 'bg-secondary active:opacity-90',
      outline: 'border border-input bg-background active:bg-accent',
      ghost: 'active:bg-accent',
      destructive: 'bg-destructive active:opacity-90',
    },
    size: {
      default: 'min-h-target-min px-4 py-2',
      field: 'min-h-target-field px-6 py-3',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

/** Label classes per `variant` × `size`, handed to the child `Text` through `TextClassContext`. */
export const buttonTextVariants = cva('font-sans-semibold text-label-md', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground',
    },
    size: {
      default: '',
      field: 'text-label-lg',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

/** A react-native `Pressable`'s props plus the cva `variant` / `size` and a `className`. */
export type ButtonProps = React.ComponentProps<typeof Pressable> &
  VariantProps<typeof buttonVariants> & { className?: string };

/**
 * The RNR-style button: a `Pressable` styled by `buttonVariants`, publishing its label classes
 * to any `Text` child. `disabled` dims it and is announced through `accessibilityState`.
 */
export function Button({ className, variant, size, disabled, ...props }: ButtonProps): React.ReactElement {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        className={cn(disabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}
