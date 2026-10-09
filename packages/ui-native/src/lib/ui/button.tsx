/**
 * RNR `Button`, adapted (redesign N0, design-system sizes and states N1) — `cva` variants over a
 * react-native `Pressable`.
 *
 * Adaptations from the RNR template, all deliberate:
 *   - colours are the generated aliases (`bg-primary` → `--primary` → `action.primary`), held
 *     as hex in `global.<theme>.css`; no `hsl()` anywhere;
 *   - the primary label is `text-primary-foreground` = `text.onBrand` (#0F241C), never white;
 *   - there is no `success` variant: solid green belongs to `color.halal.*` alone (invariant 10);
 *   - sizes are the live design system's (sm 36, md 44, lg 52, xl 60) and `critical` is
 *     `target.criticalField` (72); `field` lifts sm/md/lg to the field target (56), the rider
 *     theme's floor;
 *   - `disabled` and `loading` never reach `Pressable`'s own `disabled`, which would take the
 *     control out of focus order: the button stays focusable, announces
 *     `accessibilityState.disabled` / `busy`, and swallows presses;
 *   - no lucide icons; labels are not clamped, so they wrap at 200% font scale.
 *
 * `default`, `outline` and `destructive`, and the sizes `default` and `field`, are the N0 names,
 * kept so the N0 gallery and tests keep their meaning.
 */
import * as React from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../utils';
import { TextClassContext } from './text';

/** Container classes per `variant` × `size`: fill, border and the touch-target height. */
export const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-md border border-transparent', {
  variants: {
    variant: {
      default: 'bg-primary active:opacity-90',
      primary: 'bg-primary active:opacity-90',
      secondary: 'bg-secondary active:opacity-90',
      outline: 'border-input bg-background active:bg-accent',
      tertiary: 'border-input bg-transparent active:bg-muted',
      ghost: 'active:bg-muted',
      destructive: 'bg-destructive active:opacity-90',
      danger: 'bg-destructive active:opacity-90',
      /** IconButton: no fill, secondary-role glyph. */
      plain: 'active:bg-muted',
      /** IconButton: the subtle surface. */
      tonal: 'bg-muted active:opacity-90',
    },
    size: {
      default: 'min-h-target-min px-4 py-2',
      field: 'min-h-target-field px-6 py-3',
      sm: 'min-h-[36px] gap-1.5 px-3 py-1.5',
      md: 'min-h-target-min px-4 py-2',
      lg: 'min-h-[52px] px-5 py-2',
      xl: 'min-h-[60px] gap-2.5 px-6 py-3',
      critical: 'min-h-target-critical-field gap-2.5 px-6 py-3',
      /** IconButton squares: sm 36 (hit area 44), md 44, lg 56. */
      'icon-sm': 'min-h-[36px] min-w-[36px] p-0',
      'icon-md': 'min-h-target-min min-w-target-min p-0',
      'icon-lg': 'min-h-target-field min-w-target-field p-0',
    },
    /** The field (rider) floor: sm, md and lg grow to the 56pt field target. */
    field: { true: '', false: '' },
    /** Unset keeps the N0 behaviour (stretch in a column); `false` hugs the label, as the live Button does. */
    fullWidth: { true: 'self-stretch', false: 'self-start' },
    disabled: { true: 'opacity-60 dark:opacity-50', false: '' },
  },
  compoundVariants: [
    { field: true, size: ['sm', 'md', 'lg', 'default'], className: 'min-h-target-field' },
    { field: true, size: ['icon-sm', 'icon-md'], className: 'min-h-target-field min-w-target-field' },
  ],
  defaultVariants: { variant: 'default', size: 'default', field: false, disabled: false },
});

/** Label classes per `variant` × `size`, handed to the child `Text` through `TextClassContext`. */
export const buttonTextVariants = cva('text-center font-sans-semibold text-label-md', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      primary: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      tertiary: 'text-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground',
      danger: 'text-destructive-foreground',
      plain: 'text-muted-foreground',
      tonal: 'text-foreground',
    },
    size: {
      default: '',
      field: 'text-label-lg',
      sm: 'text-label-md',
      md: 'text-label-lg',
      lg: 'text-label-lg',
      xl: 'text-heading-sm',
      critical: 'text-heading-md',
      'icon-sm': '',
      'icon-md': '',
      'icon-lg': '',
    },
    /** The field theme's one-step type bump (`label.md` → `label.lg`). */
    field: { true: '', false: '' },
  },
  compoundVariants: [{ field: true, size: ['sm', 'default'], className: 'text-label-lg' }],
  defaultVariants: { variant: 'default', size: 'default', field: false },
});

type ContainerVariants = VariantProps<typeof buttonVariants>;

/** A react-native `Pressable`'s props plus the cva `variant` / `size` / `field` / `fullWidth`, `loading` and a `className`. */
export type ButtonProps = Omit<React.ComponentProps<typeof Pressable>, 'disabled'> &
  Omit<ContainerVariants, 'disabled'> & {
    className?: string;
    /** Still focusable; announced as disabled; presses are swallowed. */
    disabled?: boolean;
    /** Keeps colour and label; announced busy; presses are swallowed. */
    loading?: boolean;
  };

/** Half the gap between a visual size and the 44pt minimum hit area, for `hitSlop`. */
function hitSlopFor(size: ContainerVariants['size'], field: boolean | null | undefined) {
  if (field) return undefined;
  if (size === 'sm') return { top: 4, bottom: 4 };
  if (size === 'icon-sm') return { top: 4, bottom: 4, left: 4, right: 4 };
  return undefined;
}

/** An inert button gives no pressed feedback: its `active:` classes are dropped. */
function withoutPressFeedback(classes: string, inert: boolean): string {
  return inert ? classes.split(' ').filter((c) => !c.startsWith('active:')).join(' ') : classes;
}

/**
 * The RNR-style button: a `Pressable` styled by `buttonVariants`, publishing its label classes
 * to any `Text` child.
 */
export function Button({
  className,
  variant,
  size,
  field,
  fullWidth,
  disabled = false,
  loading = false,
  onPress,
  accessibilityState,
  ...props
}: ButtonProps): React.ReactElement {
  const inert = disabled || loading;
  const handlePress = React.useCallback(
    (event: GestureResponderEvent) => {
      if (!inert) onPress?.(event);
    },
    [inert, onPress],
  );
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size, field })}>
      <Pressable
        accessibilityRole="button"
        hitSlop={hitSlopFor(size, field)}
        className={cn(withoutPressFeedback(buttonVariants({ variant, size, field, fullWidth, disabled }), inert), className)}
        onPress={handlePress}
        {...props}
        accessibilityState={{ ...accessibilityState, disabled, busy: loading }}
      />
    </TextClassContext.Provider>
  );
}
